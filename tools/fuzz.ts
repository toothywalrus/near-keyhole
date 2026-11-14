// A property test of the contract's books, on the real wasm: thousands of random operations by random parties, and after every one, the whole ledger re-added from
// the contract's own views. What must hold, always:
//   - obligations == every bond + every open escrow + every credit + every audit deposit, to the yocto;
//   - each trader's liability == the sum of the prices of its windows that can still claim;
//   - balance - storage cost - obligations never goes negative;
//   - the treasury holds exactly the protocol's fee on every window that closed in its trader's favour and on every resale, and nothing from a refund or a bond;
//   - nothing traps or under/overflows: every refusal is a sentence from the contract.
// Run: npm run fuzz [-- <ops per seed> <seeds>]
import { hex, sha256, utf8 } from "../lib/src/bytes.ts";
import { buyerKey, loadEntries, near, NO_SETTLEMENT, Prices, replayEpoch, type EpochRec, type Outcome, type TokenRec, type TraderRec, TraderAgent, Timing } from "../lib/src/client.ts";
import type { OneTime } from "../lib/src/entry.ts";
import { agent, FEE_BPS, vmWorld, type World } from "./world.ts";

const OPS = Number(process.argv[2] ?? 700);
const SEEDS = Number(process.argv[3] ?? 3);
let totalOps = 0;
let accepted = 0;
const refusals = new Map<string, number>();
const coverage = new Map<string, number>();

function rng(seed: string) {
  let s = BigInt("0x" + hex(sha256(utf8(seed))).slice(0, 16));
  return (n: number) => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number((s >> 33n) % BigInt(n));
  };
}

async function runSeed(seed: string): Promise<void> {
  const w: World & { chain: any } = (await vmWorld()) as any;
  const vm = w.chain.vm;
  const r = rng(seed);
  const accounts = ["ann", "ben", "cat", "dan", "eli"].map((n) => `${n}.test`);
  for (const a of accounts) vm.fund(a, near(100_000));
  const traders: { a: TraderAgent; lastFigure: Map<number, bigint> }[] = [];
  const tokens: { id: number; one: Map<string, OneTime> }[] = [];
  const audits: number[] = [];
  const bondsIn = new Map<string, bigint>();
  const cuts = new Map<string, bigint>();
  const prices = new Prices(w.chain);
  await w.rounds();
  const pick = <T,>(x: T[]) => x[r(x.length)];
  const creditAccounts = new Set<string>([...accounts, w.treasury]);
  const feeBps = BigInt(w.config.fee_bps ?? 0);
  let resaleFees = 0n;

  const ledger = async (op: string) => {
    const list: TraderRec[] = await w.chain.view("list_traders", { from: 0, limit: 100 });
    let bonds = 0n;
    const liab = new Map<number, bigint>();
    for (const t of list) {
      bonds += BigInt(t.bond);
      creditAccounts.add(t.account);
      liab.set(t.id, 0n);
    }
    let escrow = 0n;
    let fees = resaleFees;
    for (let id = 1; id < (Number(await w.chain.view("nft_total_supply")) + 1); id++) {
      const k: TokenRec = await w.chain.view("get_token", { token_id: id });
      if (k.state === "Closed") fees += (BigInt(k.price) * feeBps) / 10_000n;
      if (k.state === "Pending" || k.state === "Delivered") {
        escrow += BigInt(k.price);
        liab.set(k.trader, liab.get(k.trader)! + BigInt(k.price));
      }
    }
    let credits = 0n;
    for (const a of creditAccounts) credits += BigInt(await w.chain.view("credit_of", { account: a }));
    let auditDeposits = 0n;
    for (const id of audits) {
      const a = await w.chain.view("get_audit", { audit: id });
      if (a) auditDeposits += BigInt(a.deposit);
    }
    const s = await w.chain.view("solvency");
    const sum = bonds + escrow + credits + auditDeposits;
    if (BigInt(s.obligations) !== sum) throw new Error(`after ${op}: obligations ${s.obligations} != bonds ${bonds} + escrow ${escrow} + credits ${credits} + audits ${auditDeposits}`);
    if (BigInt(s.slack) < 0n) throw new Error(`after ${op}: slack is negative: ${JSON.stringify(s)}`);
    const treasury = BigInt(await w.chain.view("credit_of", { account: w.treasury }));
    if (treasury !== fees) throw new Error(`after ${op}: the treasury holds ${treasury}, and the fees on closed windows add up to ${fees}`);
    for (const t of list) {
      if (BigInt(t.liability) !== liab.get(t.id)) throw new Error(`after ${op}: ${t.handle}'s liability ${t.liability} != ${liab.get(t.id)} from its tokens`);
      // A bond leaves only by burning, to a prover, or by the trader's own withdrawal, which ends the record.
      const paidIn = bondsIn.get(t.account) ?? 0n;
      const out = BigInt(t.bond) + BigInt(t.burned) + (cuts.get(t.account) ?? 0n);
      if (t.status !== "Exited" && out !== paidIn) throw new Error(`after ${op}: ${t.handle}: bond ${t.bond} + burned ${t.burned} + prover's cuts ${cuts.get(t.account) ?? 0n} != ${paidIn} paid in`);
    }
  };

  const note = (op: string, o: Outcome) => {
    totalOps++;
    coverage.set(op, (coverage.get(op) ?? 0) + 1);
    if (o.ok) { accepted++; return; }
    const why = (o.reason ?? "").replace(/[0-9]+/g, "N").slice(0, 70);
    refusals.set(why, (refusals.get(why) ?? 0) + 1);
    if (/wasm trap|underflow|overflow|host function/.test(o.reason ?? "")) throw new Error(`${op} broke: ${o.reason}`);
  };

  for (let i = 0; i < OPS; i++) {
    const who = pick(accounts);
    const clock = await w.chain.view("clock");
    const epoch: number = clock.epoch;
    const t = traders.length ? pick(traders) : null;
    const k = tokens.length ? pick(tokens) : null;
    let op = "";
    let o: Outcome = { ok: true, logs: [], burntGas: 0n, receiptGas: [] };
    switch (r(26)) {
      case 0: {
        op = "register";
        if (traders.length < 4) {
          const account = `t${traders.length}.test`;
          vm.fund(account, near(100_000));
          const a = agent(w, account, "shared");
          o = await a.register(`t${traders.length}`, { book_usd: 10_000 + r(100_000), floor_bps: 100 + r(3000), base_price: near("0.05") + BigInt(r(1000)) * 10n ** 21n, slope: BigInt(r(100)) * 10n ** 21n, bond: near(1 + r(20)) + 10n ** 22n });
          if (o.ok) {
            traders.push({ a, lastFigure: new Map() });
            bondsIn.set(account, BigInt((await a.record()).bond));
          }
        }
        break;
      }
      case 1: case 2: case 3: case 4: {
        op = "write";
        if (t) o = await t.a.write({ feed: r(4), flags: 0, qty_e8: BigInt(r(400_000_000) - 200_000_000) * (r(20) === 0 ? 100_000n : 1n), fill_e8: 1n, settlement: NO_SETTLEMENT, note: "fuzz" });
        break;
      }
      case 5: case 6: { op = "round"; await w.rounds(); break; }
      case 7: case 8: case 9: {
        op = "advance";
        await w.chain.advanceTo(vm.clockMs + (1 + r(40)) * 600_000);
        await w.rounds();
        break;
      }
      case 10: case 11: {
        op = "post";
        if (t) {
          await prices.load();
          const rec = await t.a.record();
          const ep = Math.min(rec.next_epoch + r(2), epoch);
          try {
            const f = await t.a.figure(ep, prices);
            const figure = r(5) === 0 ? f.pnl_e6 + BigInt(r(1000) + 1) : f.pnl_e6;
            o = await t.a.post(ep, figure);
            if (o.ok) t.lastFigure.set(ep, figure);
          } catch { op = "post-no-round"; }
        }
        break;
      }
      case 12: case 13: {
        op = "buy";
        if (t) {
          const rec = await t.a.record();
          const first = rec.first_epoch + r(Math.max(epoch - rec.first_epoch + 4, 1));
          const one = buyerKey();
          o = await w.chain.call(who, "buy_window", { trader: t.a.account, first_epoch: first, last_epoch: first + r(4), buyer_pub: hex(one.pub) }, near(30));
          if (o.ok) tokens.push({ id: Number(o.value), one: new Map([[who, one]]) });
        }
        break;
      }
      case 14: case 15: {
        op = "deliver";
        if (k) {
          const tok: TokenRec = await w.chain.view("get_token", { token_id: k.id });
          const tr = traders[tok.trader];
          if (tr && tok.buyer_pub && tok.state === "Pending") o = await w.chain.call(tr.a.account, "deliver", tr.a.delivery(tok, r(4) === 0 ? { garbage: 0 } : {}), near(1));
        }
        break;
      }
      case 16: {
        op = "dispute";
        if (k) {
          const tok: TokenRec = await w.chain.view("get_token", { token_id: k.id });
          const one = k.one.get(tok.owner);
          if (one) {
            o = await w.chain.call(tok.owner, "dispute_wrap", { token_id: k.id, one_time_secret: hex(one.secret), node_index: r(2) }, near(30));
            if (o.ok && o.value?.slashed_to_prover) {
              const acct = traders[tok.trader].a.account;
              cuts.set(acct, (cuts.get(acct) ?? 0n) + BigInt(o.value.slashed_to_prover));
            }
          }
        }
        break;
      }
      case 17: { op = "settle"; if (k) o = await w.chain.call(who, "settle", { token_id: k.id }); break; }
      case 18: {
        op = "claim";
        if (k) {
          const tok: TokenRec = await w.chain.view("get_token", { token_id: k.id });
          o = await w.chain.call(tok.owner, r(2) === 0 ? "claim_refund" : "claim_undelivered", { token_id: k.id });
        }
        break;
      }
      case 19: {
        op = "audit_cancel";
        if (audits.length) o = await w.chain.call(who, "audit_cancel", { audit: pick(audits) });
        break;
      }
      case 20: {
        op = "transfer";
        if (k) {
          const tok: TokenRec = await w.chain.view("get_token", { token_id: k.id });
          o = await w.chain.call(tok.owner, "nft_transfer", { receiver_id: pick(accounts), token_id: String(k.id) }, 1n);
          if (o.ok) {
            const now: TokenRec = await w.chain.view("get_token", { token_id: k.id });
            const one = buyerKey();
            const s = await w.chain.call(now.owner, "set_wrap_key", { token_id: k.id, buyer_pub: hex(one.pub) });
            if (s.ok) k.one.set(now.owner, one);
          }
        }
        break;
      }
      case 21: {
        op = "resale";
        if (k) {
          const tok: TokenRec = await w.chain.view("get_token", { token_id: k.id });
          o = await w.chain.call(tok.owner, "list_resale", { token_id: k.id, price: near("0.2").toString() });
          if (o.ok && who !== tok.owner) {
            const one = buyerKey();
            const b = await w.chain.call(who, "buy_resale", { token_id: k.id, buyer_pub: hex(one.pub) }, near(1));
            if (b.ok) {
              k.one.set(who, one);
              resaleFees += (near("0.2") * feeBps) / 10_000n;
            }
            note("buy_resale", b);
          }
        }
        break;
      }
      case 22: { op = "withdraw"; o = await w.chain.call(r(3) === 0 && t ? t.a.account : who, "withdraw", {}); break; }
      case 23: {
        op = "unbond";
        if (t) o = await w.chain.call(t.a.account, r(2) === 0 && r(10) === 0 ? "begin_unbond" : "withdraw_bond", {});
        break;
      }
      case 24: {
        op = "add_bond";
        if (t) {
          o = await w.chain.call(t.a.account, "add_bond", {}, near(1));
          if (o.ok) bondsIn.set(t.a.account, (bondsIn.get(t.a.account) ?? 0n) + near(1));
        }
        break;
      }
      case 25: {
        op = "audit";
        if (t) {
          await prices.load();
          const rec = await t.a.record();
          const eps: EpochRec[] = await w.chain.view("get_epochs", { account: t.a.account, from: rec.first_epoch, limit: 400 });
          const posted = eps.filter((e) => e.posted_e6 !== null);
          if (posted.length) {
            const ep = pick(posted);
            const open = await w.chain.call(who, "audit_open", { trader: t.a.account, epoch: ep.epoch }, near(1));
            note("audit_open", open);
            if (open.ok) {
              audits.push(Number(open.value));
              const entries = await loadEntries(w.chain, t.a.account, Number(ep.first_seq), ep.entries);
              try {
                const f = replayEpoch(entries, t.a.keyOf, prices, BigInt(rec.book_usd_e6), w.timing.epochStart(ep.epoch + 1));
                for (let j = 0; j < f.openings.length; j += 20) note("audit_step", await w.chain.call(who, "audit_step", { audit: open.value, openings: f.openings.slice(j, j + 20) }));
                await ledger("audit_step");
                o = await w.chain.call(who, "audit_conclude", { audit: open.value, mark_indices: f.mark_indices });
                if (o.ok) {
                  cuts.set(t.a.account, (cuts.get(t.a.account) ?? 0n) + BigInt(o.value.slashed_to_prover));
                  const honest = t.lastFigure.get(ep.epoch);
                  const lied = honest !== undefined && honest !== f.pnl_e6;
                  // The verdict must be exactly whether the posted figure differs from the recomputed one.
                  if (o.value.trader_at_fault !== (BigInt(ep.posted_e6!) !== f.pnl_e6)) throw new Error(`verdict ${o.value.trader_at_fault} on a figure that ${lied ? "lied" : "was true"}: ${o.value.detail}`);
                }
              } catch (e) {
                if (!/no round/.test(String(e))) throw e;
                op = "audit-no-round";
              }
            }
          }
        }
        break;
      }
    }
    note(op || "noop", o);
    await ledger(op);
  }
}

const started = Date.now();
for (let s = 0; s < SEEDS; s++) await runSeed(`fuzz ${s}`);
console.log(`\n${totalOps} random operations over ${SEEDS} seeds in ${((Date.now() - started) / 1000).toFixed(1)} s: ${accepted} accepted, ${totalOps - accepted} refused, with the whole ledger re-added after each.`);
console.log("Accepted or attempted, by operation:", Object.fromEntries([...coverage].sort()));
const top = [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 14);
console.log("Most common refusals:");
for (const [why, n] of top) console.log(`  ${String(n).padStart(5)}  ${why}`);
console.log(`\nThe books balanced to the yocto after every operation. Every yocto of every bond is accounted for: still bonded, burned, or a prover's share. The treasury held exactly the ${FEE_BPS} bps fee on closed windows and resales, and nothing else. Nothing trapped or under/overflowed.`);
void Timing;
