// The attack suite. Each attack states what must happen, runs against the real contract wasm and checks it did.
//   npm run attack              the whole suite on the local wasm host, months of contract time in seconds
//   npm run attack -- --sandbox the core attacks on a real local NEAR node (short epochs, so it takes minutes)
// Exits 1 on any failure. KEYHOLE_WASM points it at another build: the mutation check uses that.
import { hex, sha256, unhex, utf8 } from "../lib/src/bytes.ts";
import { encryptEntry, entryKey, type Entry } from "../lib/src/entry.ts";
import { buyerKey, DEPTH, firstRoundAtOrAfter, loadEntries, near, NO_SETTLEMENT, Prices, runAudit, TraderAgent, WindowReader, type Outcome, type TokenRec, type TraderRec } from "../lib/src/client.ts";
import { commit, cover, Tree } from "../lib/src/ggm.ts";
import { agent, sandboxWorld, seedOf, vmWorld, type World } from "./world.ts";

const SANDBOX = process.argv.includes("--sandbox");
const QUIET = process.argv.includes("--quiet");
const results: { name: string; ok: boolean; detail: string }[] = [];

function check(name: string, ok: boolean, detail = ""): void {
  results.push({ name, ok, detail });
  if (!QUIET || !ok) console.log(`${ok ? "✓" : "✗"} ${name.padEnd(74)} ${detail.length > 100 ? detail.slice(0, 100) + "…" : detail}`);
}
const refused = (name: string, r: Outcome, want: string) => check(name, !r.ok && (r.reason ?? "").includes(want), r.ok ? `ACCEPTED: ${JSON.stringify(r.value)}` : r.reason ?? "");
const accepted = (name: string, r: Outcome) => check(name, r.ok, r.ok ? "" : r.reason ?? "");

const trade = (feed: number, qty: number, note = "x"): Entry => ({ feed, flags: 0, qty_e8: BigInt(Math.round(qty * 1e8)), fill_e8: 100n, settlement: NO_SETTLEMENT, note });

// The contract's slack can't fall below where it started: nobody's storage is paid for out of the contract's own balance.
let slack0: bigint | null = null;
const solvent = async (w: World, label: string) => {
  const s = await w.chain.view("solvency");
  slack0 ??= BigInt(s.slack);
  check(`solvency holds: ${label}`, BigInt(s.slack) >= 0n && BigInt(s.slack) >= slack0, `slack ${(Number(BigInt(s.slack) / 10n ** 21n) / 1000).toFixed(3)} NEAR, started at ${(Number(slack0 / 10n ** 21n) / 1000).toFixed(3)}`);
};

const BOND = near(5);
const PRICE = near("0.1");
/** The protocol's cut of a closed sale, as the contract computes it: rounded down. */
const feeOf = (w: World, price: bigint) => (price * BigInt(w.config.fee_bps ?? 0)) / 10_000n;
const creditOf = async (w: World, account: string) => BigInt(await w.chain.view("credit_of", { account }));

async function newTrader(w: World, name: string, seed = "shared", opts: { floor_bps?: number; book?: number; base?: bigint; slope?: bigint; root?: Uint8Array; bond?: bigint } = {}): Promise<TraderAgent> {
  const account = await w.fund(name, near(40));
  const t = agent(w, account, seed);
  const r = await t.register(name, { book_usd: opts.book ?? 100_000, floor_bps: opts.floor_bps ?? 1000, base_price: opts.base ?? PRICE, slope: opts.slope ?? near("0.01"), bond: opts.bond ?? BOND, root: opts.root });
  if (!r.ok) throw new Error(`register ${name}: ${r.reason}`);
  return t;
}

async function currentEpoch(w: World): Promise<number> {
  return (await w.chain.view("clock")).epoch;
}

/** Wait into a fresh epoch, so a scenario starts with time to spare in it. */
async function nextEpoch(w: World): Promise<number> {
  const e = (await currentEpoch(w)) + 1;
  await w.chain.advanceTo(w.timing.epochStart(e));
  return e;
}

/** Move past an epoch's end, and put rounds after it so its figure can be computed. */
async function closeEpoch(w: World, e: number): Promise<void> {
  await w.chain.advanceTo(w.timing.epochStart(e + 1));
  await w.rounds();
  await w.prices.load();
}

async function honestEpoch(w: World, t: TraderAgent, e: number, trades: Entry[]): Promise<void> {
  for (const x of trades) {
    const r = await t.write(x);
    if (!r.ok) throw new Error(`write: ${r.reason}`);
  }
  await w.rounds();
  await closeEpoch(w, e);
  const f = await t.figure(e, w.prices);
  const p = await t.post(e, f.pnl_e6);
  if (!p.ok) throw new Error(`post: ${p.reason}`);
}

async function buy(w: World, buyer: string, t: TraderAgent, first: number, last: number) {
  const one = buyerKey();
  const r = await w.chain.call(buyer, "buy_window", { trader: t.account, first_epoch: first, last_epoch: last, buyer_pub: hex(one.pub) }, near(3));
  if (!r.ok) throw new Error(`buy: ${r.reason}`);
  const id = Number(r.value);
  return { id, one, token: () => w.chain.view<TokenRec>("get_token", { token_id: id }) };
}

async function run(w: World): Promise<void> {
  await solvent(w, "at the start");
  const bob = await w.fund("bob", near(40));
  const carol = await w.fund("carol", near(40));
  const dave = await w.fund("dave", near(40));

  console.log("\n-- Journal: backdating, deleting losers, posting --");
  await w.rounds();
  const liar = await newTrader(w, "lucky");
  let e = await nextEpoch(w);
  await w.prices.load();
  const clock = await w.chain.view("clock");
  const slot = Number(clock.slot);
  if (slot % w.config.epoch_slots !== 0) await w.chain.advanceTo(w.timing.epochStart(e + 1));
  // The one-slot tolerance does not cross an epoch's end: a trade written after the close could see the mark first.
  const crossing = agent(w, await w.fund("crossing", near(40)), "shared");
  accepted("a trader to test the epoch boundary", await crossing.register("crossing", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
  refused("an entry for the last slot of the epoch that just ended is refused", await crossing.write(trade(0, 1), { slot: slot - 1 }), "epoch is over");
  await w.chain.advanceTo(w.timing.genesisMs + (slot + 2) * w.timing.slotMs);
  const nowSlot = Number((await w.chain.view("clock")).slot);
  refused("backdated entry: a slot two back is refused", await liar.write(trade(0, 1), { slot: nowSlot - 2 }), "no backdating");
  refused("entry from the future is refused", await liar.write(trade(0, 1), { slot: nowSlot + 2 }), "no backdating");
  refused("deleted loser: skipping a number is refused", await liar.write(trade(0, 1), { seq: 1 }), "no gaps");
  const seqDup = await liar.write(trade(0, 0.5, "the entry the next one tries to overwrite"));
  accepted("the next entry, with the right number, is accepted", seqDup);
  refused("overwriting an entry by reusing its number is refused", await liar.write(trade(0, -5, "rewriting history"), { seq: 0 }), "no gaps");
  {
    const c0 = Number((await w.chain.view("clock")).slot);
    const { ct, tag } = encryptEntry(liar.tree.leaf(c0), 1, c0, trade(0, 1));
    refused("an entry that doesn't pay for its storage is refused", await w.chain.call(liar.account, "commit_entry", { seq: "1", slot: c0, ct: hex(ct), tag: hex(tag) }), "for ");
    refused("a round that doesn't pay for its storage is refused", await w.chain.call(w.recorder, "record_round", { feed: 0, round_id: "9", answer_e8: 1, source_updated_at: "1" }), "for ");
  }
  refused("an entry of the wrong size is refused", await w.chain.call(liar.account, "commit_entry", { seq: "1", slot: Number((await w.chain.view("clock")).slot), ct: "00".repeat(100), tag: "00".repeat(32) }, near("0.01")), "exactly 128");
  refused("only a registered trader can write", await w.chain.call(bob, "commit_entry", { seq: "0", slot: nowSlot, ct: "00".repeat(128), tag: "00".repeat(32) }, near("0.01")), "not a registered trader");
  refused("a figure before the epoch has ended is refused", await liar.post(e, 0n), "hasn't ended");
  refused("registering twice is refused", await w.chain.call(liar.account, "register_trader", { handle: "again", root: "00".repeat(32), book_usd_e6: "1", floor_bps: 1, base_price: "1", slope: "0" }, near(2)), "already registered");
  refused("a bond below the minimum is refused", await w.chain.call(dave, "register_trader", { handle: "cheap", root: "00".repeat(32), book_usd_e6: "1000000", floor_bps: 100, base_price: near(1).toString(), slope: "0" }, near("0.5")), "minimum bond");
  await solvent(w, "after the journal attacks");

  console.log("\n-- A false figure: every buyer is an auditor --");
  // The lucky trader wrote a small long; the market moved. It now writes a losing trade too, and posts a figure that leaves it out.
  await w.rounds();
  const loser = await liar.write(trade(1, -0.5, "the loser he'd rather forget"));
  accepted("the loser is written like any other entry", loser);
  await w.rounds();
  await closeEpoch(w, e);
  const honest = await liar.figure(e, w.prices);
  const FAKE = honest.pnl_e6 + 123_000_000n;
  accepted("the lie is accepted when posted: figures are optimistic", await liar.post(e, FAKE));
  refused("posting the same epoch again is refused", await liar.post(e, honest.pnl_e6), "already posted");
  const sale = await buy(w, bob, liar, e, e);
  accepted("delivery of the honest nodes", await liar.deliver(sale.id));
  const reader = new WindowReader(await sale.token(), sale.one);
  check("the buyer's nodes match the commitments", reader.verifyNodes().every(Boolean));
  const entries = await loadEntries(w.chain, liar.account, 0, 2);
  const local = await (async () => {
    const { replayEpoch } = await import("../lib/src/client.ts");
    const rec = await liar.record();
    return replayEpoch(entries, (x) => reader.key(x)!, w.prices, BigInt(rec.book_usd_e6), w.timing.epochStart(e + 1));
  })();
  check("the buyer recomputes the figure locally and sees the lie, for free", local.pnl_e6 === honest.pnl_e6 && local.pnl_e6 !== FAKE, `posted ${FAKE}, computed ${local.pnl_e6}`);

  const open = await w.chain.call(bob, "audit_open", { trader: liar.account, epoch: e }, near("0.5"));
  accepted("the buyer opens an audit", open);
  const auditId = Number(open.value);
  refused("audit: a bad key is refused and records nothing", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [{ key: "11".repeat(32), price_index: local.openings[0].price_index }] }), "doesn't open");
  refused("audit: entries out of order are refused (the keys don't match)", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [local.openings[1]] }), "doesn't open");
  refused("audit: a price hint before the trade is refused", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [{ ...local.openings[0], price_index: Math.max(local.openings[0].price_index - 1, 0) }] }), local.openings[0].price_index === 0 ? "" : "before the trade");
  refused("audit: a price hint past the first round after the trade is refused", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [{ ...local.openings[0], price_index: local.openings[0].price_index + 1 }] }), "an earlier round also follows");
  refused("audit: someone else can't step this audit", await w.chain.call(carol, "audit_step", { audit: auditId, openings: [] }), "someone else's");
  refused("audit: concluding before opening every entry is refused", await w.chain.call(bob, "audit_conclude", { audit: auditId, mark_indices: local.mark_indices }), "every entry");
  accepted("audit: the first entry opens", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [local.openings[0]] }));
  accepted("audit: the second entry opens", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [local.openings[1]] }));
  refused("audit: one entry too many is refused", await w.chain.call(bob, "audit_step", { audit: auditId, openings: [local.openings[1]] }), "already open");
  refused("audit: a wrong mark hint is refused", await w.chain.call(bob, "audit_conclude", { audit: auditId, mark_indices: local.mark_indices.map((m) => (m === null ? null : m + 1)) }), "hint");
  const bondBefore = BigInt((await liar.record()).bond);
  const verdict = await w.chain.call(bob, "audit_conclude", { audit: auditId, mark_indices: local.mark_indices });
  check("FALSE PNL: the contract recomputes the figure and slashes", verdict.ok && verdict.value.trader_at_fault === true, verdict.value?.detail ?? verdict.reason ?? "");
  check("the prover takes its share of the bond, and the rest burns", BigInt(verdict.value?.slashed_to_prover ?? 0) === (bondBefore * 4000n) / 10_000n && BigInt((await liar.record()).burned) === bondBefore - (bondBefore * 4000n) / 10_000n && BigInt((await liar.record()).bond) === 0n, `${verdict.value?.slashed_to_prover}`);
  check("the audit deposit comes back to the prover", BigInt(verdict.value?.refunded ?? 0) === near("0.2"));
  const after = await liar.record();
  check("the trader is marked slashed, for good", JSON.stringify(after.status).includes("Slashed"), JSON.stringify(after.status).slice(0, 80));
  const epochs = await w.chain.view("get_epochs", { account: liar.account, from: e, limit: 1 });
  check("the epoch shows the recomputed figure next to the lie", epochs[0].verdict?.False?.recomputed_e6 === honest.pnl_e6.toString(), JSON.stringify(epochs[0].verdict));
  refused("a slashed trader can't sell", await w.chain.call(carol, "buy_window", { trader: liar.account, first_epoch: e, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, near(3)), "isn't selling");
  refused("a slashed trader can't be slashed twice", await w.chain.call(carol, "audit_open", { trader: liar.account, epoch: e }, near("0.5")), "already slashed");
  refused("a slashed trader can't write", await liar.write(trade(0, 1)), "closed");
  const credit0 = BigInt(await w.chain.view("credit_of", { account: bob }));
  const claim = await w.chain.call(bob, "claim_refund", { token_id: sale.id });
  accepted("the buyer claims: escrow back plus a share of the rest of the bond", claim);
  const credit1 = BigInt(await w.chain.view("credit_of", { account: bob }));
  check("the claim paid the whole price back from escrow", credit1 - credit0 >= PRICE, `${Number((credit1 - credit0) / 10n ** 21n) / 1000} NEAR`);
  refused("a second claim is refused", await w.chain.call(bob, "claim_refund", { token_id: sale.id }), "can't claim");
  const wd = await w.chain.call(bob, "withdraw", {});
  accepted("the prover withdraws", wd);
  refused("a second withdrawal finds nothing", await w.chain.call(bob, "withdraw", {}), "nothing to withdraw");
  await solvent(w, "after the slash");

  console.log("\n-- The key sale: garbage, forgery, griefing --");
  await w.rounds();
  const sam = await newTrader(w, "sam", "shared", { floor_bps: 10_000 });
  e = await nextEpoch(w);
  await honestEpoch(w, sam, e, [trade(0, 1, "a real trade"), trade(0, -1, "and out")]);

  // Garbage key.
  const g1 = await buy(w, bob, sam, e, e);
  const tokenG = await g1.token();
  check("a sale is pending, with its price in escrow", tokenG.state === "Pending" && BigInt(tokenG.price) === PRICE, tokenG.state);
  refused("delivery by anyone but the trader is refused", await w.chain.call(carol, "deliver", sam.delivery(tokenG), near("0.05")), "only this window's trader");
  const forged = sam.delivery(tokenG) as { commits: string[] };
  forged.commits = forged.commits.map(() => "ab".repeat(32));
  refused("forged commitments don't match the root posted before the sale", await w.chain.call(sam.account, "deliver", forged, near("0.05")), "don't match the root");
  const short = sam.delivery(tokenG) as { wrapped: string[]; commits: string[] };
  short.wrapped = [...short.wrapped, short.wrapped[0]];
  refused("a delivery that isn't the cover's size is refused", await w.chain.call(sam.account, "deliver", short, near("0.05")), "cover");
  const noProof = sam.delivery(tokenG) as { proof: string[] };
  noProof.proof = noProof.proof.slice(1);
  refused("a delivery with a truncated proof is refused", await w.chain.call(sam.account, "deliver", noProof, near("0.05")), "don't match the root");
  const lowOrder = sam.delivery(tokenG) as { eph: string };
  lowOrder.eph = "00".repeat(32);
  refused("a low-order ephemeral key is refused", await w.chain.call(sam.account, "deliver", lowOrder, near("0.05")), "low-order");
  refused("a low-order one-time key is refused at purchase", await w.chain.call(carol, "buy_window", { trader: sam.account, first_epoch: e, last_epoch: e, buyer_pub: "00".repeat(32) }, near(3)), "low-order");
  refused("a trader can't buy his own window", await w.chain.call(sam.account, "buy_window", { trader: sam.account, first_epoch: e, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, near(3)), "his own");
  refused("too little attached is refused", await w.chain.call(carol, "buy_window", { trader: sam.account, first_epoch: e, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, 1n), "costs");
  refused("a window before this journal began is refused", await w.chain.call(carol, "buy_window", { trader: sam.account, first_epoch: 0, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, near(3)), "");
  accepted("GARBAGE KEY: a garbage wrap is accepted at delivery (the contract can't read it)", await sam.deliver(g1.id, { garbage: 0 }));
  const tokenD = await g1.token();
  const readerG = new WindowReader(tokenD, g1.one);
  check("the buyer sees it at once: the node doesn't match its commitment", readerG.verifyNodes()[0] === false);
  refused("dispute: a wrong secret proves nothing and is refused", await w.chain.call(bob, "dispute_wrap", { token_id: g1.id, one_time_secret: "33".repeat(32), node_index: 0 }, near(1)), "isn't this token's one-time key");
  refused("dispute: only the holder can dispute", await w.chain.call(carol, "dispute_wrap", { token_id: g1.id, one_time_secret: hex(g1.one.secret), node_index: 0 }, near(1)), "only the holder");
  refused("dispute: a deposit below the price is refused", await w.chain.call(bob, "dispute_wrap", { token_id: g1.id, one_time_secret: hex(g1.one.secret), node_index: 0 }, 1n), "deposit");
  refused("dispute: a node that isn't in the sale is refused", await w.chain.call(bob, "dispute_wrap", { token_id: g1.id, one_time_secret: hex(g1.one.secret), node_index: 99 }, near(1)), "no such node");
  const samBond = BigInt((await sam.record()).bond);
  const dg = await w.chain.call(bob, "dispute_wrap", { token_id: g1.id, one_time_secret: hex(g1.one.secret), node_index: 0 }, near(1));
  check("GARBAGE KEY: the contract unwraps, compares and slashes", dg.ok && dg.value.trader_at_fault === true, dg.value?.detail ?? dg.reason ?? "");
  check("the buyer takes the prover's share of the bond", BigInt(dg.value?.slashed_to_prover ?? 0) === (samBond * 4000n) / 10_000n);
  refused("the settled dispute can't be repeated", await w.chain.call(bob, "dispute_wrap", { token_id: g1.id, one_time_secret: hex(g1.one.secret), node_index: 0 }, near(1)), "only a delivered window");
  await solvent(w, "after the garbage key");

  // A false dispute.
  await w.rounds();
  const tess = await newTrader(w, "tess");
  e = await nextEpoch(w);
  await honestEpoch(w, tess, e, [trade(0, 1, "fine")]);
  const fd = await buy(w, bob, tess, e, e);
  accepted("honest delivery", await tess.deliver(fd.id));
  const before = BigInt(await w.chain.view("credit_of", { account: tess.account }));
  const fdv = await w.chain.call(bob, "dispute_wrap", { token_id: fd.id, one_time_secret: hex(fd.one.secret), node_index: 0 }, near("0.5"));
  check("FALSE DISPUTE: it ends in a dismissal, not a panic", fdv.ok && fdv.value.trader_at_fault === false, fdv.value?.detail ?? fdv.reason ?? "");
  check("the griefer's deposit goes to the trader", BigInt(await w.chain.view("credit_of", { account: tess.account })) - before === near("0.5"));
  check("the honest trader isn't slashed", (await tess.record()).status === "Active");
  check("the window stays open for the holder", (await fd.token()).state === "Delivered");
  await solvent(w, "after the false dispute");

  // Audit of a true figure.
  const fig = await tess.figure(e, w.prices);
  const a = await runAudit(w.chain, carol, tess.account, e, fig);
  check("TRUE FIGURE: the audit concludes against the auditor", a.verdict.ok && a.verdict.value.trader_at_fault === false, a.verdict.value?.detail ?? a.verdict.reason ?? "");
  check("the audit deposit goes to the trader", BigInt(a.verdict.value?.deposit_lost ?? 0) === near("0.2"));
  const epT = await w.chain.view("get_epochs", { account: tess.account, from: e, limit: 1 });
  check("the epoch records that an audit passed", epT[0].audits_passed === 1);

  console.log("\n-- A tree that isn't one --");
  // The root commits to one tree, and the journal is encrypted with another: every node matches its commitment and opens nothing.
  await w.rounds();
  const realTree = new Tree(seedOf("the real journal key"), DEPTH);
  const ruth = await newTrader(w, "ruth", "shared");
  e = await nextEpoch(w);
  const slotNow = Number((await w.chain.view("clock")).slot);
  const wrongLeaf = realTree.leaf(slotNow);
  const we = await ruth.write(trade(0, 1, "not under the committed tree"), { leafOverride: wrongLeaf });
  accepted("she writes an entry under a key her committed tree doesn't derive", we);
  const hon = await w.chain.call(ruth.account, "commit_entry", (() => { const s = slotNow; const { ct, tag } = encryptEntry(ruth.tree.leaf(s), 1, s, trade(0, 1, "this one is honest")); return { seq: "1", slot: s, ct: hex(ct), tag: hex(tag) }; })(), near("0.01"));
  accepted("and one under the committed tree", hon);
  await w.rounds();
  await closeEpoch(w, e);
  accepted("she posts a figure", await ruth.post(e, 42n));
  const rs = await buy(w, bob, ruth, e, e);
  accepted("delivery passes: the nodes do match the root", await ruth.deliver(rs.id));
  const rt = await rs.token();
  const rr = new WindowReader(rt, rs.one);
  check("every node verifies, so the wrap dispute can't catch this", rr.verifyNodes().every(Boolean));
  const ents = await loadEntries(w.chain, ruth.account, 0, 2);
  const rRead = rr.read(ents[0]);
  check("yet the entry doesn't open", !rRead.readable, rRead.readable ? "readable" : rRead.why);
  const ids = cover(rt.first_slot, rt.last_slot, DEPTH);
  const idx = ids.findIndex((n) => (ents[0].slot >= n.index * 2 ** (DEPTH - n.level)) && (ents[0].slot < (n.index + 1) * 2 ** (DEPTH - n.level)));
  refused("a number that doesn't fit is refused, not truncated into another entry's", await w.chain.call(bob, "dispute_entry", { token_id: rs.id, node_index: idx, node: hex(rr.nodes[idx].value), seq: "4294967297" }, near(1)), "out of range");
  refused("dispute_entry: a deposit below the price is refused", await w.chain.call(bob, "dispute_entry", { token_id: rs.id, node_index: idx, node: hex(rr.nodes[idx].value), seq: "0" }, 1n), "deposit");
  refused("dispute_entry: only the holder can bring it", await w.chain.call(carol, "dispute_entry", { token_id: rs.id, node_index: idx, node: hex(rr.nodes[idx].value), seq: "0" }, near(1)), "only the holder");
  refused("dispute_entry: a node that isn't the delivered one is refused", await w.chain.call(bob, "dispute_entry", { token_id: rs.id, node_index: idx, node: "22".repeat(32), seq: "0" }, near(1)), "isn't the node delivered");
  const wrongIdx = ids.findIndex((n, i) => i !== idx);
  if (wrongIdx >= 0) refused("dispute_entry: an entry that isn't under the node is refused", await w.chain.call(bob, "dispute_entry", { token_id: rs.id, node_index: wrongIdx, node: hex(rr.nodes[wrongIdx].value), seq: "0" }, near(1)), "isn't under this node");
  const honDisp = await w.chain.call(bob, "dispute_entry", { token_id: rs.id, node_index: idx, node: hex(rr.nodes[idx].value), seq: "1" }, near("0.3"));
  check("dispute_entry on the entry that does open is dismissed", honDisp.ok && honDisp.value.trader_at_fault === false, honDisp.value?.detail ?? honDisp.reason ?? "");
  const bad = await w.chain.call(bob, "dispute_entry", { token_id: rs.id, node_index: idx, node: hex(rr.nodes[idx].value), seq: "0" }, near(1));
  check("NOT A TREE: the contract walks the node down to the entry and slashes", bad.ok && bad.value.trader_at_fault === true, bad.value?.detail ?? bad.reason ?? "");
  await solvent(w, "after the fake tree");

  console.log("\n-- The window: exactly its slots, nothing past them --");
  await w.rounds();
  const wren = await newTrader(w, "wren");
  e = await nextEpoch(w);
  const inW = await wren.write(trade(0, 1, "inside the window"));
  accepted("an entry inside the window", inW);
  await w.rounds();
  await closeEpoch(w, e);
  accepted("figure", await wren.post(e, (await wren.figure(e, w.prices)).pnl_e6));
  const nextE = await currentEpoch(w);
  await w.chain.advanceTo(w.timing.epochStart(nextE));
  const outW = await wren.write(trade(0, -1, "the next day: past the window"));
  accepted("an entry the next epoch, past the window", outW);
  const wn = await buy(w, bob, wren, e, e);
  accepted("delivery", await wren.deliver(wn.id));
  const wtok = await wn.token();
  const wr = new WindowReader(wtok, wn.one);
  const wents = await loadEntries(w.chain, wren.account, 0, 2);
  const rIn = wr.read(wents[0]);
  check("WINDOW: the entry inside reads, offline, with what was delivered", rIn.readable && rIn.entry?.note === "inside the window", rIn.readable ? rIn.entry?.note : rIn.why);
  const rOut = wr.read(wents[1]);
  check("WINDOW OVERREACH: the entry past it fails, offline, with nobody revoking anything", !rOut.readable, rOut.readable ? "READ" : rOut.why);
  // Hash down from every delivered node along every path: the next slot's key isn't reachable by any amount of hashing.
  let reached = false;
  const realKey = entryKey(wren.tree.leaf(wents[1].slot), 1);
  for (const n of wr.nodes) {
    const stack = [{ v: n.value, level: n.id.level }];
    while (stack.length && stack.length < 5000) {
      const top = stack.pop()!;
      if (top.level === DEPTH) {
        if (hex(entryKey(top.v, 1)) === hex(realKey)) reached = true;
        continue;
      }
      for (const b of [0, 1]) stack.push({ v: sha256(utf8("keyhole/ggm/v1"), Uint8Array.of(b), top.v), level: top.level + 1 });
    }
  }
  check("hashing down from every node delivered never reaches that key", !reached);
  const nextCover = cover(wtok.first_slot, wtok.last_slot + 1, DEPTH);
  check("the contract computes the cover, so a longer window can't be delivered for this price", nextCover.length !== 0 && wtok.commits.length === cover(wtok.first_slot, wtok.last_slot, DEPTH).length);
  await solvent(w, "after the window");

  console.log("\n-- Resale before the start: replay and overreach --");
  await w.rounds();
  const nia = await newTrader(w, "nia");
  const cur = await nextEpoch(w);
  const future = cur + 3;
  const res = await buy(w, bob, nia, future, future);
  refused("a transfer by someone else is refused", await w.chain.call(carol, "nft_transfer", { receiver_id: carol, token_id: String(res.id) }, 1n), "only the holder");
  refused("buy_resale of an unlisted token is refused", await w.chain.call(carol, "buy_resale", { token_id: res.id, buyer_pub: hex(buyerKey().pub) }, near(1)), "isn't for sale");
  refused("delivering too early is refused: until then the token can be resold", await nia.deliver(res.id), "too early");
  accepted("the holder lists it", await w.chain.call(bob, "list_resale", { token_id: res.id, price: near("0.3").toString() }));
  refused("a low bid is refused", await w.chain.call(carol, "buy_resale", { token_id: res.id, buyer_pub: hex(buyerKey().pub) }, near("0.1")), "ask");
  const c1 = buyerKey();
  const bobCredit = BigInt(await w.chain.view("credit_of", { account: bob }));
  const trCredit = await creditOf(w, w.treasury);
  accepted("the resale goes through, and the seller is paid", await w.chain.call(carol, "buy_resale", { token_id: res.id, buyer_pub: hex(c1.pub) }, near(1)));
  check("the seller gets the asking price, less the protocol's fee", BigInt(await w.chain.view("credit_of", { account: bob })) - bobCredit === near("0.3") - feeOf(w, near("0.3")));
  check("FEE: a resale pays the fee at once, so selling cheap to your own account and reselling dodges nothing", (await creditOf(w, w.treasury)) - trCredit === feeOf(w, near("0.3")) && feeOf(w, near("0.3")) > 0n);
  const nft = await w.chain.view("nft_token", { token_id: String(res.id) });
  check("NEP-171 shows the new holder", nft.owner_id === carol, nft.owner_id);
  refused("RESALE REPLAY: the seller can't dispute any more", await w.chain.call(bob, "dispute_wrap", { token_id: res.id, one_time_secret: hex(res.one.secret), node_index: 0 }, near(1)), "only the holder");
  await w.chain.advanceTo(w.timing.epochStart(future) - w.config.delivery_lead_secs * 1000);
  refused("once delivery can begin the token can't move: a trader must be able to rely on the key he read", await w.chain.call(carol, "nft_transfer", { receiver_id: dave, token_id: String(res.id) }, 1n), "delivery can begin");
  refused("nor can it be listed then", await w.chain.call(carol, "list_resale", { token_id: res.id, price: "1" }), "delivery can begin");
  const stale = nia.delivery(await res.token()) as { buyer_pub: string };
  stale.buyer_pub = hex(res.one.pub);
  refused("RESALE RACE: a delivery for a key that's no longer the holder's is refused, not slashed", await w.chain.call(nia.account, "deliver", stale, near("0.05")), "has changed");
  // The trader wraps to the OLD holder's key: the new holder sees garbage and slashes.
  accepted("the trader delivers, wrapped to the OLD holder's key", await nia.deliver(res.id, { toKey: hex(res.one.pub) }));
  refused("RESALE REPLAY: the old secret is refused for the new holder as well", await w.chain.call(carol, "dispute_wrap", { token_id: res.id, one_time_secret: hex(res.one.secret), node_index: 0 }, near(1)), "isn't this token's one-time key");
  const rd = await w.chain.call(carol, "dispute_wrap", { token_id: res.id, one_time_secret: hex(c1.secret), node_index: 0 }, near(1));
  check("RESALE REPLAY: a wrap to the old key slashes when the new holder disputes", rd.ok && rd.value.trader_at_fault === true, rd.value?.detail ?? rd.reason ?? "");
  await solvent(w, "after the resale");

  // Transfer after delivery, and a plain transfer's key handling.
  await w.rounds();
  const pam = await newTrader(w, "pam");
  const pe = (await nextEpoch(w)) + 3;
  const p1 = await buy(w, bob, pam, pe, pe);
  accepted("a plain NEP-171 transfer before delivery", await w.chain.call(bob, "nft_transfer", { receiver_id: dave, token_id: String(p1.id) }, 1n));
  const pt = await p1.token();
  check("the transfer clears the old one-time key", pt.buyer_pub === null && pt.owner === dave);
  await w.chain.advanceTo(w.timing.epochStart(pe) - w.config.delivery_lead_secs * 1000);
  refused("the trader can't deliver to nobody", await w.chain.call(pam.account, "deliver", { token_id: p1.id, buyer_pub: "00".repeat(32), eph: hex(buyerKey().pub), wrapped: [], commits: [], proof: [] }, near("0.05")), "hasn't registered");
  refused("the old holder can't set the key", await w.chain.call(bob, "set_wrap_key", { token_id: p1.id, buyer_pub: hex(buyerKey().pub) }), "only the holder");
  const d1 = buyerKey();
  accepted("the new holder registers a one-time key", await w.chain.call(dave, "set_wrap_key", { token_id: p1.id, buyer_pub: hex(d1.pub) }));
  refused("one purchase, one key: it can't be replaced", await w.chain.call(dave, "set_wrap_key", { token_id: p1.id, buyer_pub: hex(buyerKey().pub) }), "already registered");
  accepted("the trader delivers to it", await pam.deliver(p1.id));
  check("the new holder reads the delivery", new WindowReader(await p1.token(), d1).verifyNodes().every(Boolean));
  refused("RESALE: a delivered token can't move: the old holder would keep what he read", await w.chain.call(dave, "nft_transfer", { receiver_id: bob, token_id: String(p1.id) }, 1n), "already delivered");
  refused("nor can a delivered token be listed", await w.chain.call(dave, "list_resale", { token_id: p1.id, price: "1" }), "already delivered");
  await solvent(w, "after the transfer");

  console.log("\n-- Deadlines and settlement --");
  await w.rounds();
  const una = await newTrader(w, "una");
  e = await nextEpoch(w);
  const u1 = await buy(w, bob, una, e, e);
  refused("claiming non-delivery before the deadline is refused", await w.chain.call(bob, "claim_undelivered", { token_id: u1.id }), "still has time");
  const u1t = await u1.token();
  await w.chain.advanceTo(Number(u1t.deliver_by_ms) + 1);
  refused("delivering after the deadline is refused", await una.deliver(u1.id), "too late");
  refused("settling before the challenge window ends is refused", await w.chain.call(dave, "settle", { token_id: u1.id }), "still open");
  const cu0 = BigInt(await w.chain.view("credit_of", { account: bob }));
  accepted("the holder of an undelivered window claims", await w.chain.call(bob, "claim_undelivered", { token_id: u1.id }));
  const unaAfter = await una.record();
  check("the refund is the whole price and not a yocto more: the penalty burns, so no second account can farm it", BigInt(await w.chain.view("credit_of", { account: bob })) - cu0 === PRICE && BigInt(unaAfter.burned) === PRICE / 2n, `burned ${unaAfter.burned}`);
  const refusedRow = (await w.chain.view("get_epochs", { account: una.account, from: e, limit: 1 }))[0];
  check("CHECKABLE: a refused window counts as refused on its epoch, not as somebody holding the keys", refusedRow.refused_sales === 1 && refusedRow.covering_sales === 0, JSON.stringify({ refused: refusedRow.refused_sales, covering: refusedRow.covering_sales }));
  check("the late delivery is on the trader's public record", (await una.record()).late_deliveries === 1);
  refused("it can't be claimed twice", await w.chain.call(bob, "claim_undelivered", { token_id: u1.id }), "delivered or closed");
  const u2 = await buy(w, carol, una, e, e);
  await w.chain.advanceTo(Number((await u2.token()).settle_at_ms));
  const u2c = BigInt(await w.chain.view("credit_of", { account: carol }));
  const u2s = await w.chain.call(dave, "settle", { token_id: u2.id });
  check("ABSENT HOLDER: anyone settling an undelivered window refunds its holder, not the trader", u2s.ok && u2s.value === "refunded" && BigInt(await w.chain.view("credit_of", { account: carol })) - u2c >= PRICE, String(u2s.value ?? u2s.reason));
  await solvent(w, "after the deadlines");

  // A healthy window settles to the trader.
  await w.rounds();
  const vic = await newTrader(w, "vic");
  e = await nextEpoch(w);
  await honestEpoch(w, vic, e, [trade(0, 1, "fine")]);
  const v1 = await buy(w, bob, vic, e, e);
  accepted("delivery", await vic.deliver(v1.id));
  refused("a healthy window can't claim a refund", await w.chain.call(bob, "claim_refund", { token_id: v1.id }), "can't claim");
  const vt = await v1.token();
  await w.chain.advanceTo(Number(vt.settle_at_ms));
  await w.rounds();
  refused("a dispute after the challenge window is refused", await w.chain.call(bob, "dispute_wrap", { token_id: v1.id, one_time_secret: hex(v1.one.secret), node_index: 0 }, near(1)), "over");
  const vc = BigInt(await w.chain.view("credit_of", { account: vic.account }));
  const st = await w.chain.call(dave, "settle", { token_id: v1.id });
  check("anyone can settle: the escrow goes to the trader, less the protocol's fee", st.ok && st.value === "closed" && BigInt(await w.chain.view("credit_of", { account: vic.account })) - vc === PRICE - feeOf(w, PRICE), String(st.value ?? st.reason));
  refused("settling twice is refused", await w.chain.call(dave, "settle", { token_id: v1.id }), "can't be settled");
  check("a closed window no longer counts against the bond", BigInt((await vic.record()).liability) === 0n);
  await solvent(w, "after settling");

  console.log("\n-- The protocol fee: from a sale the trader earned, never from a refund or a bond --");
  {
    check("this deployment takes a protocol fee, credited to its treasury", (w.config.fee_bps ?? 0) > 0 && w.config.treasury === w.treasury, `${w.config.fee_bps} bps to ${w.config.treasury}`);
    await w.rounds();
    // A price that isn't a round number, so a fee rounded up rather than down shows by a yocto.
    const fia = await newTrader(w, "fia", "shared", { base: PRICE + 7n, slope: 0n });
    e = await nextEpoch(w);
    await honestEpoch(w, fia, e, [trade(0, 1, "fine")]);
    const f1 = await buy(w, bob, fia, e, e);
    const f2 = await buy(w, carol, fia, e, e);
    accepted("she delivers the first window, and never the second", await fia.deliver(f1.id));
    const [p1, p2] = [BigInt((await f1.token()).price), BigInt((await f2.token()).price)];
    await w.chain.advanceTo(Math.max(Number((await f1.token()).settle_at_ms), Number((await f2.token()).settle_at_ms)));
    await w.rounds();
    const [tc0, fc0, rec0] = [await creditOf(w, w.treasury), await creditOf(w, fia.account), await fia.record()];
    const s1 = await w.chain.call(dave, "settle", { token_id: f1.id });
    const [tc1, fc1, rec1] = [await creditOf(w, w.treasury), await creditOf(w, fia.account), await fia.record()];
    check("FEE: a closed sale pays the trader its price less the fee", s1.ok && s1.value === "closed" && fc1 - fc0 === p1 - feeOf(w, p1), `${fc1 - fc0} of ${p1}`);
    check("FEE: the fee is credited to the treasury, to the yocto", tc1 - tc0 === feeOf(w, p1) && feeOf(w, p1) > 0n, `${tc1 - tc0}`);
    check("FEE: no part of it comes from the bond", rec1.bond === rec0.bond && rec1.burned === rec0.burned);
    const cc0 = await creditOf(w, carol);
    const s2 = await w.chain.call(dave, "settle", { token_id: f2.id });
    check("FEE: a window that goes back to its holder goes back whole, and the treasury takes nothing", s2.ok && s2.value === "refunded" && (await creditOf(w, carol)) - cc0 === p2 && (await creditOf(w, w.treasury)) === tc1, String(s2.value ?? s2.reason));
    const tw = await w.chain.call(w.treasury, "withdraw", {});
    check("the treasury withdraws its fees like anyone else", tw.ok && (await creditOf(w, w.treasury)) === 0n, tw.reason ?? "");
    await solvent(w, "after the fee");
  }

  console.log("\n-- The floor and the lapse: refunds from the bond --");
  await w.rounds();
  const xan = await newTrader(w, "xan", "shared", { floor_bps: 100, book: 10_000, base: near("0.5"), slope: 0n });
  e = await nextEpoch(w);
  await xan.write(trade(0, 3, "too long, too big"));
  const x1 = await buy(w, bob, xan, e, e);
  const x2 = await buy(w, carol, xan, e, e);
  accepted("delivery one", await xan.deliver(x1.id));
  accepted("delivery two", await xan.deliver(x2.id));
  await w.roundAt(0, 300_000_000_000n);
  await closeEpoch(w, e);
  await w.chain.advanceTo((await w.chain.nowMs()) + 1);
  const crash = await w.roundAt(0, 270_000_000_000n);
  accepted("the market falls 10% on him", crash);
  await w.prices.load();
  const xf = await xan.figure(e, w.prices);
  accepted("he posts his real loss", await xan.post(e, xf.pnl_e6));
  refused("KNOWN BAD: a window already past its floor isn't for sale, or it would be free reading", await w.chain.call(dave, "buy_window", { trader: xan.account, first_epoch: e, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, near(3)), "past its floor");
  await w.chain.advanceTo(Number((await x2.token()).settle_at_ms));
  const xr = await xan.record();
  const xb0 = BigInt(await w.chain.view("credit_of", { account: bob }));
  const xt0 = BigInt(await w.chain.view("credit_of", { account: xan.account }));
  const xtr0 = await creditOf(w, w.treasury);
  const s1 = await w.chain.call(dave, "settle", { token_id: x1.id });
  check("FLOOR: a window past the floor goes back to its holder", s1.ok && s1.value === "refunded", `figure ${xf.pnl_e6}, floor -100000000: ${s1.value ?? s1.reason}`);
  const xprice = BigInt((await x1.token()).price);
  check("the holder gets the whole price, whatever the size of the bond", BigInt(await w.chain.view("credit_of", { account: bob })) - xb0 === xprice);
  check("the trader doesn't get the escrow", BigInt(await w.chain.view("credit_of", { account: xan.account })) === xt0);
  check("and the treasury takes no fee from a refund", (await creditOf(w, w.treasury)) === xtr0);
  check("and his bond is untouched: a true loss costs him the sale, never the bond", BigInt((await xan.record()).burned) === 0n && BigInt((await xan.record()).bond) === BigInt(xr.bond));
  accepted("the other window too", await w.chain.call(dave, "settle", { token_id: x2.id }));
  refused("it can't be settled twice", await w.chain.call(dave, "settle", { token_id: x2.id }), "can't be settled");
  check("no liability is left", BigInt((await xan.record()).liability) === 0n);
  await solvent(w, "after the floor");

  // The lapse.
  await w.rounds();
  const yan = await newTrader(w, "yan");
  e = await nextEpoch(w);
  const y1 = await buy(w, bob, yan, e, e);
  accepted("delivery", await yan.deliver(y1.id));
  await w.chain.advanceTo(w.timing.epochStart(e + 1) + (w.config.post_grace_secs + 1) * 1000);
  refused("LAPSE: a figure after the grace is refused", await yan.post(e, 0n), "too late");
  await w.chain.advanceTo(Number((await y1.token()).settle_at_ms));
  const ytr0 = await creditOf(w, w.treasury);
  const ys = await w.chain.call(dave, "settle", { token_id: y1.id });
  check("LAPSE: a window with a missing figure goes back to its holder", ys.ok && ys.value === "refunded", String(ys.value ?? ys.reason));
  check("and the treasury takes no fee from it", (await creditOf(w, w.treasury)) === ytr0);
  check("and a missing figure burns half the price from the bond: that one is his doing", BigInt((await yan.record()).burned) === BigInt((await y1.token()).price) / 2n, (await yan.record()).burned);
  refused("KNOWN BAD: a window with a missed figure isn't for sale, or it would be free reading", await w.chain.call(dave, "buy_window", { trader: yan.account, first_epoch: e, last_epoch: e, buyer_pub: hex(buyerKey().pub) }, near(3)), "no figure");
  await solvent(w, "after the lapse");

  const zoe = await newTrader(w, "zoe");
  e = await nextEpoch(w);
  refused("a window too far ahead is refused", await w.chain.call(bob, "buy_window", { trader: zoe.account, first_epoch: (await currentEpoch(w)) + 40, last_epoch: (await currentEpoch(w)) + 40, buyer_pub: hex(buyerKey().pub) }, near(3)), "too far ahead");

  // Somebody takes a token and never registers a key: the trader isn't at fault.
  await w.rounds();
  const kit = await newTrader(w, "kit");
  const ke = (await nextEpoch(w)) + 3;
  const k1 = await buy(w, bob, kit, ke, ke);
  accepted("a transfer to someone who never registers a key", await w.chain.call(bob, "nft_transfer", { receiver_id: carol, token_id: String(k1.id) }, 1n));
  refused("he can't claim non-delivery without a key", await w.chain.call(carol, "claim_undelivered", { token_id: k1.id }), "register a one-time key");
  await w.chain.advanceTo(Number((await k1.token()).settle_at_ms));
  await w.rounds();
  const kc = await w.chain.call(dave, "settle", { token_id: k1.id });
  accepted("after the challenge window it settles to the trader", kc);
  await solvent(w, "after the absent holder");

  console.log("\n-- Exposure, malformed entries and exact figures --");
  await w.rounds();
  const zed = await newTrader(w, "zed", "shared", { book: 1000 });
  e = await nextEpoch(w);
  await zed.write(trade(0, 0.1, "within the limit"));
  await zed.write(trade(0, 1000, "a thousand ETH on a $1,000 book"));
  const leafSlot = Number((await w.chain.view("clock")).slot);
  const bogus = encryptEntry(zed.tree.leaf(leafSlot), 2, leafSlot, trade(0, 1));
  // A malformed plaintext: the wrong version byte, under the right key.
  const { entryXor, entryTag } = await import("../lib/src/entry.ts");
  const key2 = entryKey(zed.tree.leaf(leafSlot), 2);
  const junk = new Uint8Array(128);
  junk[0] = 9;
  const ctM = entryXor(key2, junk);
  void bogus;
  accepted("a malformed entry under the right key is accepted: the contract can't read it", await w.chain.call(zed.account, "commit_entry", { seq: "2", slot: leafSlot, ct: hex(ctM), tag: hex(entryTag(key2, 2, leafSlot, ctM)) }, near("0.01")));
  await zed.write(trade(9, 1, "a feed that doesn't exist"));
  await w.rounds();
  await closeEpoch(w, e);
  const zf = await zed.figure(e, w.prices);
  check("the replay counts one trade and voids three", zf.book.applied === 1 && zf.book.void === 3, `applied ${zf.book.applied}, void ${zf.book.void}`);
  accepted("he posts the honest figure, which ignored them", await zed.post(e, zf.pnl_e6));
  const zAudit = await runAudit(w.chain, carol, zed.account, e, zf);
  check("EXPOSURE: the contract agrees to the unit, voids included", zAudit.verdict.ok && zAudit.verdict.value.trader_at_fault === false, zAudit.verdict.value?.detail ?? zAudit.verdict.reason ?? "");

  // A loss smaller than the published unit: rounding is down, on both sides, or an honest trader gets slashed.
  await w.rounds();
  const fay = await newTrader(w, "fay");
  e = await nextEpoch(w);
  await fay.write({ feed: 0, flags: 0, qty_e8: 1n, fill_e8: 1n, settlement: NO_SETTLEMENT, note: "the smallest possible trade" });
  await w.roundAt(0, 300_000_000_001n);
  await w.chain.advanceTo(w.timing.epochStart(e + 1));
  await w.roundAt(0, 300_000_000_000n);
  await w.prices.load();
  const ff = await fay.figure(e, w.prices);
  check("the figure is a fraction of a unit below zero, so it rounds to -1", ff.pnl_e6 === -1n, String(ff.pnl_e6));
  accepted("she posts it", await fay.post(e, ff.pnl_e6));
  const fa = await runAudit(w.chain, carol, fay.account, e, ff);
  check("ROUNDING: the contract rounds down too, so the honest figure stands", fa.verdict.ok && fa.verdict.value.trader_at_fault === false, fa.verdict.value?.detail ?? fa.verdict.reason ?? "");

  await w.rounds();
  const ova = await newTrader(w, "ova", "shared", { book: 1000 });
  e = await nextEpoch(w);
  await ova.write(trade(0, 1000, "over the limit"));
  await ova.write(trade(0, 0.01, "within it"));
  await w.rounds();
  await closeEpoch(w, e);
  const of = await ova.figure(e, w.prices);
  accepted("she posts a figure one unit away from the truth", await ova.post(e, of.pnl_e6 + 1n));
  const oAudit = await runAudit(w.chain, carol, ova.account, e, of);
  check("OFF BY ONE: a difference of one unit slashes", oAudit.verdict.ok && oAudit.verdict.value.trader_at_fault === true, oAudit.verdict.value?.detail ?? oAudit.verdict.reason ?? "");
  await solvent(w, "after the exact figures");

  console.log("\n-- The bond, the oracle, the attested path, private methods --");
  const bea = await newTrader(w, "bea");
  refused("unbonding is a two-step exit", await w.chain.call(bea.account, "withdraw_bond", {}), "begin unbonding");
  await w.chain.advanceTo((await w.chain.nowMs()) + (w.config.unbond_secs + 1) * 1000);
  accepted("she asks to leave", await w.chain.call(bea.account, "begin_unbond", {}));
  refused("an unbonding trader can't sell", await w.chain.call(bob, "buy_window", { trader: bea.account, first_epoch: await currentEpoch(w), last_epoch: await currentEpoch(w), buyer_pub: hex(buyerKey().pub) }, near(3)), "isn't selling");
  refused("the bond stays at risk through the delay", await w.chain.call(bea.account, "withdraw_bond", {}), "still at risk");
  await w.chain.advanceTo((await w.chain.nowMs()) + (w.config.unbond_secs + 1) * 1000);
  const bb = await w.chain.call(bea.account, "withdraw_bond", {});
  check("after the delay, with nothing open, the bond is hers", bb.ok && BigInt(bb.value) > 0n);
  refused("nobody else can withdraw it", await w.chain.call(bob, "withdraw_bond", {}), "not a registered trader");

  const cov = await newTrader(w, "cov", "shared", { base: near(4), slope: 0n, bond: near("1.1") });
  const ce = await nextEpoch(w);
  refused("COVERAGE: a sale the bond can't cover is refused", await w.chain.call(bob, "buy_window", { trader: cov.account, first_epoch: ce, last_epoch: ce, buyer_pub: hex(buyerKey().pub) }, near(5)), "doesn't cover");

  refused("only the recorder may record rounds", await w.chain.call(bob, "record_round", { feed: 0, round_id: "9", answer_e8: 1, source_updated_at: "1" }), "only the recorder");
  refused("a price must be positive", await w.chain.call(w.recorder, "record_round", { feed: 0, round_id: "9", answer_e8: -1, source_updated_at: "1" }), "positive");
  refused("a feed that doesn't exist is refused", await w.chain.call(w.recorder, "record_round", { feed: 3, round_id: "9", answer_e8: 1, source_updated_at: "1" }), "no such feed");
  refused("a recorded feed can't be imported from a borrowed oracle", await w.chain.call(bob, "import_round", { feed: 0 }, near("0.01")), "isn't a borrowed one");
  refused("nobody calls a private callback: withdraw's", await w.chain.call(bob, "on_withdraw", { who: bob, amount: near(1000).toString() }), "private");
  refused("nobody calls a private callback: the oracle's", await w.chain.call(bob, "on_imported", { feed: 0 }), "private");
  refused("nobody calls a private callback: OutLayer's", await w.chain.call(bob, "on_attested", { trader: bob, epoch: 0 }), "private");
  refused("only the owner can register a runner", await w.chain.call(bob, "set_runner", { runner: bob, enabled: true }), "owner only");
  refused("an import that can't pay for its storage is refused", await w.chain.call(bob, "import_round", { feed: 0 }), "storage");
  refused("a non-runner can't report an attested figure", await w.chain.call(bob, "submit_attested", { output: { trader: bob, epoch: 0, pnl_e6: "0", head: "00".repeat(32), job_sha256: "x" } }), "not a registered runner");
  await solvent(w, "at the end");

  console.log("\n-- The attested path --");
  await w.rounds();
  const ana = await newTrader(w, "ana");
  e = await nextEpoch(w);
  await honestEpoch(w, ana, e, [trade(0, 1, "no buyers yet")]);
  const ar = await ana.record();
  const af = await ana.figure(e, w.prices);
  const runner = await w.fund("runner", near(2));
  accepted("the owner registers a local runner", await w.chain.call(w.owner, "set_runner", { runner, enabled: true }));
  const okOut = { trader: ana.account, epoch: e, pnl_e6: af.pnl_e6.toString(), head: ar.head, job_sha256: "aa".repeat(32) };
  refused("the runner's job must have read the epoch's last entry", await w.chain.call(runner, "submit_attested", { output: { ...okOut, head: "00".repeat(32) } }, near("0.01")), "didn't read");
  accepted("the runner reports the job's figure", await w.chain.call(runner, "submit_attested", { output: okOut }, near("0.01")));
  const ae = await w.chain.view("get_epochs", { account: ana.account, from: e, limit: 1 });
  check("SIMULATED: a local run is labeled as one, by the code path, with no way to say otherwise", ae[0].attested?.kind === "SimulatedLocal", JSON.stringify(ae[0].attested?.kind));
  await w.chain.call(runner, "submit_attested", { output: { ...okOut, kind: "OutLayerTee" } }, near("0.01"));
  const ae2 = await w.chain.view("get_epochs", { account: ana.account, from: e, limit: 1 });
  check("a runner can't claim the enclave's label: an extra field changes nothing", ae2[0].attested?.kind === "SimulatedLocal", JSON.stringify(ae2[0].attested?.kind));
}

async function vmOnly(w: World & { chain: any }): Promise<void> {
  console.log("\n-- Failed promises roll back (local host, which can make a transfer fail) --");
  const vm = w.chain.vm;
  await w.rounds();
  const sameMs = await w.chain.call(w.recorder, "record_round", { feed: 0, round_id: "1", answer_e8: 1, source_updated_at: "1" }, near("0.002"));
  const sameMs2 = await w.chain.call(w.recorder, "record_round", { feed: 0, round_id: "2", answer_e8: 1, source_updated_at: "1" }, near("0.002"));
  check("ORACLE: a round at the same moment as the last is refused: rounds only go forward, so no price can be rewritten", sameMs.ok && !sameMs2.ok && (sameMs2.reason ?? "").includes("forward"), sameMs2.reason ?? "ACCEPTED");
  const brokenId = "broken.seller.test";
  vm.fund(brokenId, near(40));
  const t = new TraderAgent(w.chain, brokenId, seedOf("shared"), w.timing);
  accepted("a trader whose account can't receive", await t.register("broken", { book_usd: 1000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
  const buyer = await w.fund("eve", near(40));
  const e = await nextEpoch(w);
  await honestEpoch(w, t, e, []);
  const s = await buy(w, buyer, t, e, e);
  accepted("delivery", await t.deliver(s.id));
  await w.chain.advanceTo(Number((await s.token()).settle_at_ms));
  await w.rounds();
  accepted("settle", await w.chain.call(buyer, "settle", { token_id: s.id }));
  const c0 = BigInt(await w.chain.view("credit_of", { account: brokenId }));
  check("the escrow is credited, less the protocol's fee", c0 >= PRICE - feeOf(w, PRICE));
  const wd = await w.chain.call(brokenId, "withdraw", {});
  check("the transfer fails, the callback says so", wd.ok && wd.value === false, JSON.stringify(wd.value ?? wd.reason));
  check("FAILED TRANSFER: the credit is restored in full", BigInt(await w.chain.view("credit_of", { account: brokenId })) === c0);
  await solvent(w, "after the failed transfer");

  console.log("\n-- Can a trader's second account pull the bond out? --");
  {
    // Every way a bond can reach a buyer: a refused delivery, a lapse, a floor, a slash. Sock is the trader's own second account: count what the pair of them end up with.
    const pairWorth = async (t: TraderAgent, sock: string) => vm.balance(t.account) + vm.balance(sock) + BigInt(await w.chain.view("credit_of", { account: t.account })) + BigInt(await w.chain.view("credit_of", { account: sock }));
    const buyAt = async (sock: string, t: TraderAgent, first: number, last: number) => {
      const one = buyerKey();
      const b = await w.chain.call(sock, "buy_window", { trader: t.account, first_epoch: first, last_epoch: last, buyer_pub: hex(one.pub) }, near(60));
      if (!b.ok) throw new Error(`buy: ${b.reason}`);
      return { id: Number(b.value), one, token: () => w.chain.view<TokenRec>("get_token", { token_id: Number(b.value) }) };
    };

    const dr = new TraderAgent(w.chain, await w.fund("drainer", near(200)), seedOf("shared"), w.timing);
    accepted("a trader, with a 10 NEAR bond", await dr.register("drainer", { book_usd: 100_000, floor_bps: 1000, base_price: near("0.6"), slope: 0n, bond: near(10) }));
    const sock = await w.fund("sock", near(2000));
    const drW0 = await pairWorth(dr, sock);
    let lastBond = BigInt((await dr.record()).bond);
    let cycles = 0;
    for (; cycles < 12; cycles++) {
      const rec = await dr.record();
      const ep = await currentEpoch(w);
      const epochs = Math.min(31, Number((BigInt(rec.bond) * 2n) / BigInt(rec.base_price)));
      if (epochs < 1) break;
      const one = buyerKey();
      const b = await w.chain.call(sock, "buy_window", { trader: dr.account, first_epoch: ep, last_epoch: ep + epochs - 1, buyer_pub: hex(one.pub) }, near(60));
      if (!b.ok) break;
      const tok = await w.chain.view<TokenRec>("get_token", { token_id: Number(b.value) });
      await w.chain.advanceTo(Number(tok.deliver_by_ms) + 1);
      const c = await w.chain.call(sock, "claim_undelivered", { token_id: Number(b.value) });
      if (!c.ok) throw new Error(c.reason);
      lastBond = BigInt((await dr.record()).bond);
    }
    const drW1 = await pairWorth(dr, sock);
    const drRec = await dr.record();
    check("BOND ESCAPE, refused deliveries: the pair gain nothing, and what left the bond burned", drW1 <= drW0 && BigInt(drRec.burned) > 0n, `${cycles} cycles: bond ${Number(lastBond / 10n ** 21n) / 1000} NEAR, burned ${Number(BigInt(drRec.burned) / 10n ** 21n) / 1000}, the pair down ${Number((drW0 - drW1) / 10n ** 21n) / 1000}`);
    check("and the refusals are on the public record", drRec.late_deliveries === cycles, String(drRec.late_deliveries));
    check("the bond is now below the minimum", BigInt(drRec.bond) < BigInt(w.config.min_bond), `${Number(BigInt(drRec.bond) / 10n ** 21n) / 1000} NEAR`);
    refused("BOND ESCAPE: below the minimum, the trader isn't selling", await w.chain.call(sock, "buy_window", { trader: dr.account, first_epoch: await currentEpoch(w), last_epoch: await currentEpoch(w), buyer_pub: hex(buyerKey().pub) }, near(60)), "below the minimum");

    const la = new TraderAgent(w.chain, await w.fund("lapser", near(200)), seedOf("shared"), w.timing);
    accepted("a trader with a 10 NEAR bond", await la.register("lapser", { book_usd: 100_000, floor_bps: 1000, base_price: near(10), slope: 0n, bond: near(10) }));
    const sock2 = await w.fund("sock2", near(200));
    const laW0 = await pairWorth(la, sock2);
    const la1 = await buyAt(sock2, la, await currentEpoch(w), await currentEpoch(w));
    accepted("he delivers to his own second account", await la.deliver(la1.id));
    await w.chain.advanceTo(Number((await la1.token()).settle_at_ms));
    await w.rounds();
    const ls = await w.chain.call(sock2, "settle", { token_id: la1.id });
    const laRec = await la.record();
    check("BOND ESCAPE, a deliberate lapse: the pair gain nothing, and the bond goes to nobody", ls.ok && ls.value === "refunded" && BigInt(laRec.burned) > 0n && (await pairWorth(la, sock2)) <= laW0, `bond ${Number(BigInt(laRec.bond) / 10n ** 21n) / 1000}, burned ${Number(BigInt(laRec.burned) / 10n ** 21n) / 1000}`);

    const selfT = new TraderAgent(w.chain, await w.fund("self-slasher", near(200)), seedOf("shared"), w.timing);
    accepted("a trader with a 10 NEAR bond", await selfT.register("self", { book_usd: 100_000, floor_bps: 1000, base_price: near(5), slope: 0n, bond: near(10) }));
    const sybil = await w.fund("his-sybil", near(200));
    const honestBuyer = await w.fund("real-buyer", near(100));
    const ee = (await nextEpoch(w)) + 1;
    const realTok = await buyAt(honestBuyer, selfT, ee, ee);
    const oldSock = await buyAt(sybil, selfT, ee, ee);
    await w.chain.advanceTo((await w.chain.nowMs()) + (w.config.challenge_secs + 60) * 1000);
    const cur = await currentEpoch(w);
    const syb = await buyAt(sybil, selfT, cur, cur);
    accepted("he delivers his second account garbage, on purpose", await selfT.deliver(syb.id, { garbage: 0 }));
    const before = BigInt((await selfT.record()).bond);
    const selfW0 = await pairWorth(selfT, sybil);
    const sd = await w.chain.call(sybil, "dispute_wrap", { token_id: syb.id, one_time_secret: hex(syb.one.secret), node_index: 0 }, near(6));
    check("his second account's dispute slashes him", sd.ok && sd.value.trader_at_fault === true, sd.value?.detail ?? sd.reason ?? "");
    const selfRec = await selfT.record();
    const claimedOld = await w.chain.call(sybil, "claim_refund", { token_id: oldSock.id });
    accepted("the second account's older window takes its escrow back", claimedOld);
    const gainFromBond = (await pairWorth(selfT, sybil)) - selfW0;
    check("SELF-SLASH: the most a trader can recover through a second account is the prover's share, old window or not", gainFromBond <= (before * 4000n) / 10_000n + 2n * BigInt((await oldSock.token()).price), `${Number(gainFromBond / 10n ** 21n) / 1000} NEAR of a ${Number(before / 10n ** 21n) / 1000} NEAR bond`);
    check("the rest burned, and nothing is left to claim", BigInt(selfRec.bond) === 0n && BigInt(selfRec.burned) === before - (before * 4000n) / 10_000n, `burned ${Number(BigInt(selfRec.burned) / 10n ** 21n) / 1000}`);
    const rc = BigInt(await w.chain.view("credit_of", { account: honestBuyer }));
    refused("nobody else can claim his escrow", await w.chain.call(sybil, "claim_refund", { token_id: realTok.id }), "only the holder");
    accepted("the real buyer claims", await w.chain.call(honestBuyer, "claim_refund", { token_id: realTok.id }));
    check("the real buyer gets the whole price back, however many second accounts bought in", BigInt(await w.chain.view("credit_of", { account: honestBuyer })) - rc === BigInt((await realTok.token()).price));
    await solvent(w, "after the self-slash");
  }

  console.log("\n-- An honest loss is never slashable --");
  {
    // Issue #15: a trader loses past his floor, honestly, and strangers buy his windows to burn his bond. No bond may move for a true figure.
    const hl = new TraderAgent(w.chain, await w.fund("honest-loser", near(200)), seedOf("shared"), w.timing);
    accepted("a trader with a 10 NEAR bond and a 1% floor", await hl.register("loser", { book_usd: 10_000, floor_bps: 100, base_price: near(5), slope: 0n, bond: near(10) }));
    const strangers = [await w.fund("stranger-a", near(100)), await w.fund("stranger-b", near(100))];
    await w.rounds();
    const he = await nextEpoch(w);
    accepted("he goes long", await hl.write(trade(0, 3, "a real loss coming")));
    const windows = [];
    for (const st of strangers) {
      const one = buyerKey();
      const bb = await w.chain.call(st, "buy_window", { trader: hl.account, first_epoch: he, last_epoch: he, buyer_pub: hex(one.pub) }, near(6));
      if (!bb.ok) throw new Error(bb.reason);
      const k = { id: Number(bb.value), one, token: () => w.chain.view<TokenRec>("get_token", { token_id: Number(bb.value) }) };
      accepted("a stranger buys the losing day", await hl.deliver(k.id));
      windows.push({ st, k });
    }
    await w.roundAt(0, 300_000_000_000n);
    await w.chain.advanceTo(w.timing.epochStart(he + 1));
    await w.chain.advanceTo((await w.chain.nowMs()) + 1);
    await w.roundAt(0, 240_000_000_000n);
    await w.prices.load();
    const hf = await hl.figure(he, w.prices);
    accepted("he posts his true loss, far past his floor", await hl.post(he, hf.pnl_e6));
    const bond0 = BigInt((await hl.record()).bond);
    await w.chain.advanceTo(Number((await windows[1].k.token()).settle_at_ms));
    await w.rounds();
    for (const { st, k } of windows) {
      const c0 = BigInt(await w.chain.view("credit_of", { account: st }));
      const sres = await w.chain.call(st, "settle", { token_id: k.id });
      check("a window past the floor still gives its buyer the escrow back", sres.ok && sres.value === "refunded" && BigInt(await w.chain.view("credit_of", { account: st })) - c0 === BigInt((await k.token()).price), String(sres.value ?? sres.reason));
    }
    const hr = await hl.record();
    check("DRAWDOWN: an honest loss burns nothing: strangers can't spend his bond", BigInt(hr.bond) === bond0 && BigInt(hr.burned) === 0n, `bond ${Number(bond0 / 10n ** 21n) / 1000} -> ${Number(BigInt(hr.bond) / 10n ** 21n) / 1000}, burned ${Number(BigInt(hr.burned) / 10n ** 21n) / 1000}`);
    await solvent(w, "after the drawdown");
  }

  console.log("\n-- The third read: an offline trader, a laundered loss, a free read --");
  {
    // R1. A stranger buys many windows over the same past epochs while the trader's agent is down. A missed delivery must cost in proportion to
    // what was really withheld: each epoch once, not once per window.
    const off = new TraderAgent(w.chain, await w.fund("offline", near(200)), seedOf("shared"), w.timing);
    accepted("an honest trader with a 10 NEAR bond", await off.register("offline", { book_usd: 100_000, floor_bps: 1000, base_price: near("0.3"), slope: 0n, bond: near(10) }));
    const oe = await nextEpoch(w);
    for (let i = 0; i < 3; i++) {
      await w.chain.advanceTo(w.timing.epochStart(oe + i + 1) + 1000);
      accepted(`a true figure, day ${i + 1}`, await off.post(oe + i, 800_000_000n));
    }
    const stranger = await w.fund("burner", near(200));
    const ks: { id: number; one: ReturnType<typeof buyerKey> }[] = [];
    for (let i = 0; i < 3; i++) {
      const one = buyerKey();
      const r = await w.chain.call(stranger, "buy_window", { trader: off.account, first_epoch: oe, last_epoch: oe + 2, buyer_pub: hex(one.pub) }, near(5));
      if (!r.ok) throw new Error(r.reason);
      ks.push({ id: Number(r.value), one });
    }
    const tk0 = await w.chain.view<TokenRec>("get_token", { token_id: ks[0].id });
    check("a window already past gets a longer grace to deliver, for a trader's agent that's down for a while", Number(tk0.deliver_by_ms) - Number(tk0.bought_ms) >= w.config.delivery_grace_secs * 1000 * 4, `${(Number(tk0.deliver_by_ms) - Number(tk0.bought_ms)) / 3600_000} h`);
    await w.chain.advanceTo(Number(tk0.deliver_by_ms) + 1);
    const ob0 = BigInt((await off.record()).bond);
    for (const k of ks) accepted("the stranger claims a refused window", await w.chain.call(stranger, "claim_undelivered", { token_id: k.id }));
    const orec = await off.record();
    const oneWindow = BigInt((await w.chain.view<TokenRec>("get_token", { token_id: ks[0].id })).price);
    check("OFFLINE: the same epochs refused three times burn once, in proportion to what was withheld", ob0 - BigInt(orec.bond) === oneWindow / 2n, `burned ${Number((ob0 - BigInt(orec.bond)) / 10n ** 21n) / 1000} NEAR for three windows of ${Number(oneWindow / 10n ** 21n) / 1000}`);
    accepted("a trader can pause his sales", await w.chain.call(off.account, "set_paused", { paused: true }));
    refused("a paused trader isn't selling", await w.chain.call(stranger, "buy_window", { trader: off.account, first_epoch: oe, last_epoch: oe, buyer_pub: hex(buyerKey().pub) }, near(5)), "paused");
    refused("only the trader can pause", await w.chain.call(stranger, "set_paused", { paused: false }), "not a registered trader");
    accepted("and resume", await w.chain.call(off.account, "set_paused", { paused: false }));

    // R2. Voiding a loss must never raise the record.
    const lau = new TraderAgent(w.chain, await w.fund("launderer", near(200)), seedOf("shared"), w.timing);
    refused("a price below the minimum is refused at registration", await lau.register("cheap", { book_usd: 100_000, floor_bps: 200, base_price: 1n, slope: 0n, bond: near(10) }), "minimum");
    accepted("a trader with a 2% floor", await lau.register("launderer", { book_usd: 100_000, floor_bps: 200, base_price: near("0.1"), slope: 0n, bond: near(10) }));
    const le = await nextEpoch(w);
    await w.chain.advanceTo(w.timing.epochStart(le + 1) + 1000);
    accepted("he posts a big loss", await lau.post(le, -10_000_000_000n));
    const sybil = await w.fund("launder-sybil", near(100));
    const before = await w.chain.view("score", { account: lau.account });
    const one = buyerKey();
    const lb = await w.chain.call(sybil, "buy_window", { trader: lau.account, first_epoch: le, last_epoch: le + 1, buyer_pub: hex(one.pub) }, near(5));
    accepted("his sybil buys a window over the loss and today", lb);
    await w.chain.advanceTo(Number((await w.chain.view<TokenRec>("get_token", { token_id: Number(lb.value) })).deliver_by_ms) + 1);
    accepted("and is refused", await w.chain.call(sybil, "claim_undelivered", { token_id: Number(lb.value) }));
    const after = await w.chain.view("score", { account: lau.account });
    check("LAUNDERED LOSS: refusing his own buyer can't raise his record: only a gain stops counting", BigInt(after.score_e6) <= BigInt(before.score_e6), `${before.score_e6} -> ${after.score_e6}`);

    // R3. A window whose loss was already posted can't be read for free by adding today.
    const dd = new TraderAgent(w.chain, await w.fund("known-loss", near(200)), seedOf("shared"), w.timing);
    accepted("a trader with a 1% floor", await dd.register("known-loss", { book_usd: 10_000, floor_bps: 100, base_price: near("0.5"), slope: 0n, bond: near(10) }));
    const de = await nextEpoch(w);
    await w.chain.advanceTo(w.timing.epochStart(de + 1) + 1000);
    accepted("he posts a loss past his floor", await dd.post(de, -1_000_000_000n));
    const reader = await w.fund("free-reader", near(100));
    const fr = await buy(w, reader, dd, de, de + 1);
    accepted("he delivers", await dd.deliver(fr.id));
    await w.chain.advanceTo(w.timing.epochStart(de + 2) + 1000);
    accepted("and posts a flat day", await dd.post(de + 1, 0n));
    await w.chain.advanceTo(Number((await fr.token()).settle_at_ms));
    const ddc = BigInt(await w.chain.view("credit_of", { account: dd.account }));
    const fs = await w.chain.call(reader, "settle", { token_id: fr.id });
    check("FREE READ: a loss already posted when the window was bought can't make it refundable", fs.ok && fs.value === "closed" && BigInt(await w.chain.view("credit_of", { account: dd.account })) - ddc === BigInt((await fr.token()).price) - feeOf(w, BigInt((await fr.token()).price)), String(fs.value ?? fs.reason));

    // R4. An oracle outage must never stop an honest trader posting in time.
    const { VmChain } = await import("./vmchain.ts");
    const c5 = new VmChain("kh5.test", Date.UTC(2026, 9, 1));
    c5.vm.fund("o.test", near(10));
    refused("ORACLE OUTAGE: a deployment whose posting grace doesn't outlast twice the round gap is refused", c5.vm.call("o.test", "new", { owner: "o.test", config: { ...w.config, post_grace_secs: 3600, max_round_gap_secs: 3600 }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }] }), "round gap");
    refused("FEE CAP: a deployment taking more than 20% of a sale is refused", c5.vm.call("o.test", "new", { owner: "o.test", config: { ...w.config, fee_bps: 2001 }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }] }), "at most 2000");
    refused("FEE: a fee with nobody to receive it is refused", c5.vm.call("o.test", "new", { owner: "o.test", config: { ...w.config, treasury: null }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }] }), "needs a treasury");
    refused("FEE: the treasury can't be the contract itself, which could never withdraw", c5.vm.call("o.test", "new", { owner: "o.test", config: { ...w.config, treasury: "kh5.test" }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }] }), "can't be the contract");
    const c6 = new VmChain("kh6.test", Date.UTC(2026, 9, 1));
    c6.vm.fund("o.test", near(10));
    accepted("a fee of exactly 20% is allowed", c6.vm.call("o.test", "new", { owner: "o.test", config: { ...w.config, fee_bps: 2000 }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }] }));
    accepted("a deployment with no fee needs no treasury", c5.vm.call("o.test", "new", { owner: "o.test", config: { ...w.config, fee_bps: 0, treasury: null }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }] }));
    await solvent(w, "after the third read");
  }

  console.log("\n-- An entry nobody can open --");
  {
    const j = new TraderAgent(w.chain, await w.fund("junker", near(100)), seedOf("shared"), w.timing);
    accepted("a trader", await j.register("junker", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    const holder = await w.fund("holder", near(100));
    const stranger = await w.fund("stranger", near(100));
    await w.rounds();
    const je = await nextEpoch(w);
    const jr = await j.write(trade(0, 1, "real"));
    const jj = await j.write(trade(0, 1, "junk"), { leafOverride: new Uint8Array(32).fill(9) });
    accepted("a real entry and a junk one", jr.ok && jj.ok ? jr : jj);
    await w.rounds();
    await closeEpoch(w, je);
    accepted("a false figure", await j.post(je, 999_000_000n));
    const k = await buy(w, holder, j, je, je);
    accepted("delivery", await j.deliver(k.id));
    const r = new WindowReader(await k.token(), k.one);
    const rows = await loadEntries(w.chain, j.account, 0, 2);
    const realKey = hex(r.key(rows[0])!);
    const realHint = (await (async () => { const { firstRoundAtOrAfter } = await import("../lib/src/client.ts"); await w.prices.load(); return firstRoundAtOrAfter(w.prices.rounds[0], Number(rows[0].at_ms)); })());
    const open = await w.chain.call(stranger, "audit_open", { trader: j.account, epoch: je }, near(1));
    accepted("an auditor opens", open);
    accepted("the first entry opens", await w.chain.call(stranger, "audit_step", { audit: open.value, openings: [{ key: realKey, price_index: realHint }] }));
    refused("JUNK ENTRY: the second never will", await w.chain.call(stranger, "audit_step", { audit: open.value, openings: [{ key: realKey, price_index: realHint }] }), "doesn't open");
    refused("nobody can cancel someone else's audit", await w.chain.call(holder, "audit_cancel", { audit: open.value }), "someone else's");
    const creditJ0 = BigInt(await w.chain.view("credit_of", { account: j.account }));
    const stranger0 = BigInt(await w.chain.view("credit_of", { account: stranger }));
    const cancel = await w.chain.call(stranger, "audit_cancel", { audit: open.value });
    const dep = BigInt(w.config.audit_bond);
    check("the auditor can give up: half the deposit back while the trader stands, half to him, so leaving keys on the chain isn't free", cancel.ok && BigInt(await w.chain.view("credit_of", { account: stranger })) - stranger0 === dep / 2n && BigInt(await w.chain.view("credit_of", { account: j.account })) - creditJ0 === dep / 2n, String(cancel.value ?? cancel.reason));
    const open2 = await w.chain.call(stranger, "audit_open", { trader: j.account, epoch: je }, near(1));
    await w.chain.advanceTo(Number((await k.token()).settle_at_ms));
    await w.rounds();
    accepted("the challenge window ends, and the window settles", await w.chain.call(stranger, "settle", { token_id: k.id }));
    const nodeI = r.nodes.findIndex((n) => { const size = 2 ** (DEPTH - n.id.level); return rows[1].slot >= n.id.index * size && rows[1].slot < (n.id.index + 1) * size; });
    const held = BigInt(await w.chain.view("credit_of", { account: holder }));
    const late = await w.chain.call(holder, "dispute_entry", { token_id: k.id, node_index: nodeI, node: hex(r.nodes[nodeI].value), seq: "1" }, near(1));
    check("JUNK ENTRY: the holder can still prove it after settlement: the false figure can't hide behind it", late.ok && late.value.trader_at_fault === true, late.value?.detail ?? late.reason ?? "");
    check("a settled window has no escrow left, so the prover's share and the deposit are what come back", BigInt(await w.chain.view("credit_of", { account: holder })) - held === BigInt(late.value?.slashed_to_prover ?? 0) + near(1));
    const s0 = BigInt(await w.chain.view("credit_of", { account: stranger }));
    const c2 = await w.chain.call(stranger, "audit_cancel", { audit: open2.value });
    check("and an audit stuck behind it gets its whole deposit back, the trader being slashed", c2.ok && BigInt(await w.chain.view("credit_of", { account: stranger })) - s0 === dep, String(c2.value ?? c2.reason));
    await solvent(w, "after the junk entry");
  }

  console.log("\n-- Who earns the enclave's label --");
  {
    const at = new TraderAgent(w.chain, await w.fund("attested", near(100)), seedOf("shared"), w.timing);
    accepted("a trader with no buyers", await at.register("attested", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    const ae = await nextEpoch(w);
    await w.chain.advanceTo(w.timing.epochStart(ae + 1) + 1000);
    accepted("he posts two empty epochs", await at.post(ae, 0n));
    await w.chain.advanceTo(w.timing.epochStart(ae + 2) + 1000);
    accepted("the second", await at.post(ae + 1, 0n));
    const head = (await at.record()).head;
    const job = (epoch: number) => (m: string) => {
      if (m !== "request_execution") throw new Error("unexpected");
      return { Json: { trader: at.account, epoch, pnl_e6: "0", head, job_sha256: "the job's word" } };
    };
    const cfg = (contract: string) => ({ outlayer: { contract, rpc: "x", wasm_url: "x", wasm_hash: "aa".repeat(32), max_instructions: "1", max_execution_seconds: "1" } });
    vm.mock("stand-in.test", job(ae));
    accepted("the owner points the contract at a stand-in", await w.chain.call(w.owner, "set_outlayer", cfg("stand-in.test")));
    const ra = await w.chain.call(at.account, "request_attested", { epoch: ae }, near("0.02"));
    const rr1 = (await w.chain.view("get_epochs", { account: at.account, from: ae, limit: 1 }))[0];
    check("STAND-IN: a callback from any other contract can't earn the enclave's label", ra.ok && rr1.attested?.kind === "OutLayerStandIn" && rr1.attested?.job_sha256 === "aa".repeat(32), JSON.stringify(rr1.attested?.kind ?? ra.reason));
    // The arguments as outlayer.testnet's own contract deserializes them (out-layer/outlayer contract/src/lib.rs): a U64 sent as a string failed there.
    let sent: any = null;
    vm.mock("outlayer.testnet", (m: string, args: any) => {
      sent = args;
      return job(ae + 1)(m);
    });
    accepted("and at OutLayer's own account", await w.chain.call(w.owner, "set_outlayer", cfg("outlayer.testnet")));
    await w.chain.call(at.account, "request_attested", { epoch: ae + 1 }, near("0.02"));
    const rr2 = (await w.chain.view("get_epochs", { account: at.account, from: ae + 1, limit: 1 }))[0];
    check("only a callback from OutLayer's own account gets it", rr2.attested?.kind === "OutLayerTee", JSON.stringify(rr2.attested?.kind));
    const lim = sent?.resource_limits ?? {};
    check("REAL OUTLAYER'S TYPES: resource limits are JSON numbers, the source a WasmUrl with a 64-hex hash, the format Json",
      ["max_instructions", "max_memory_mb", "max_execution_seconds"].every((k) => Number.isInteger(lim[k])) && /^[0-9a-f]{64}$/.test(sent?.source?.WasmUrl?.hash ?? "") && typeof sent?.source?.WasmUrl?.url === "string" && sent?.response_format === "Json" && typeof sent?.input_data === "string",
      JSON.stringify({ resource_limits: lim, response_format: sent?.response_format }));
    refused("a deposit that can't pay for the callback's storage is refused", await w.chain.call(at.account, "request_attested", { epoch: ae }, 1n), "storage");
  }

  console.log("\n-- Posting winners only --");
  {
    const wn = new TraderAgent(w.chain, await w.fund("winners-only", near(100)), seedOf("shared"), w.timing);
    accepted("a trader with a $100,000 book and a 1% floor", await wn.register("winners", { book_usd: 100_000, floor_bps: 100, base_price: PRICE, slope: 0n, bond: BOND }));
    const we = await nextEpoch(w);
    await w.chain.advanceTo(w.timing.epochStart(we + 1) + 1000);
    accepted("he stays silent on a losing day, and posts the next day's win", (await w.chain.advanceTo(w.timing.epochStart(we + 2) + 1000), await wn.post(we + 1, 200_000_000n)));
    const sc = await w.chain.view("score", { account: wn.account });
    check("SKIPPED LOSER: the missed epoch counts against him, at the worse of his floor and 2% of the book", sc.missed >= 1 && sc.charge_per_missed_e6 === "2000000000" && BigInt(sc.score_e6) === 200_000_000n - BigInt(sc.missed) * 2_000_000_000n, JSON.stringify(sc));
    await w.chain.advanceTo((await w.chain.nowMs()) + 5 * 86400_000);
    const sc2 = await w.chain.view("score", { account: wn.account });
    check("and silence after his last figure counts too, once the grace is over", sc2.missed > sc.missed, `missed ${sc.missed} then ${sc2.missed}`);
    // A refusal can keep an old false figure from ever being checked: it counts like a missed day, on every epoch it covers.
    const rf = new TraderAgent(w.chain, await w.fund("refuser", near(100)), seedOf("shared"), w.timing);
    accepted("a trader", await rf.register("refuser", { book_usd: 100_000, floor_bps: 100, base_price: PRICE, slope: 0n, bond: BOND }));
    const rfBuyer = await w.fund("rf-buyer", near(100));
    const re = await nextEpoch(w);
    const rb = await buy(w, rfBuyer, rf, re, re + 1);
    await w.chain.advanceTo(Number((await rb.token()).deliver_by_ms) + 1);
    accepted("he won't deliver", await w.chain.call(rfBuyer, "claim_undelivered", { token_id: rb.id }));
    const rs = await w.chain.view("score", { account: rf.account });
    await solvent(w, "after a refusal, whose rows the token prepaid");
    // The refusal came before he posted those epochs: the figures he posts afterwards don't count either.
    await w.chain.advanceTo(w.timing.epochStart(re + 2) + 1000);
    accepted("he posts a figure for a refused epoch", await rf.post(re + 1, 4_000_000_000n));
    const rs2 = await w.chain.view("score", { account: rf.account });
    check("a figure posted after a refusal doesn't count either", BigInt(rs2.voided_e6) === 4_000_000_000n && BigInt(rs2.score_e6) === BigInt(rs2.posted_e6) - 4_000_000_000n - BigInt(rs2.missed + rs2.refused) * BigInt(rs2.charge_per_missed_e6), JSON.stringify(rs2));
    // A refusal shields an old figure from proof (#13): it stops counting instead.
    const rv = new TraderAgent(w.chain, await w.fund("shielder", near(100)), seedOf("shared"), w.timing);
    accepted("a trader", await rv.register("shielder", { book_usd: 100_000, floor_bps: 100, base_price: PRICE, slope: 0n, bond: BOND }));
    const ve = await nextEpoch(w);
    await w.chain.advanceTo(w.timing.epochStart(ve + 1) + 1000);
    accepted("he posts a big figure for an empty day", await rv.post(ve, 9_000_000_000n));
    const before13 = await w.chain.view("score", { account: rv.account });
    const vb = await buy(w, rfBuyer, rv, ve, ve);
    await w.chain.advanceTo(Number((await vb.token()).deliver_by_ms) + 1);
    accepted("a buyer asks to check it, and he won't deliver", await w.chain.call(rfBuyer, "claim_undelivered", { token_id: vb.id }));
    const after13 = await w.chain.view("score", { account: rv.account });
    check("SHIELDED FIGURE: a figure he refuses to let anyone check stops counting, and costs a charge on top", BigInt(after13.voided_e6) === 9_000_000_000n && after13.refused === 1 && BigInt(after13.score_e6) === BigInt(after13.posted_e6) - 9_000_000_000n - BigInt(after13.missed + after13.refused) * BigInt(after13.charge_per_missed_e6), `${before13.score_e6} -> ${after13.score_e6}`);
    check("REFUSED: two refused epochs cost him two charges on his public record", rs.refused === 2 && BigInt(rs.score_e6) === -BigInt(rs.missed + 2) * BigInt(rs.charge_per_missed_e6), JSON.stringify(rs));
  }

  console.log("\n-- The last figure gets its time to be audited --");
  {
    const lea = new TraderAgent(w.chain, await w.fund("lea", near(40)), seedOf("shared"), w.timing);
    accepted("a trader", await lea.register("lea", { book_usd: 1000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    accepted("she asks to leave", await w.chain.call(lea.account, "begin_unbond", {}));
    const since = await w.chain.nowMs();
    const delay = w.config.unbond_secs * 1000;
    await w.chain.advanceTo(since + delay - 26 * 3600_000);
    const lastEpoch = await currentEpoch(w);
    await w.chain.advanceTo(w.timing.epochStart(lastEpoch + 1) + 1000);
    accepted("just before the delay is up, she posts one last figure", await lea.post(lastEpoch, 123_456_789n));
    await w.chain.advanceTo(since + delay + 1000);
    refused("LATE LIE: she can't leave with it unaudited", await w.chain.call(lea.account, "withdraw_bond", {}), "time to be audited");
    await w.chain.advanceTo((await w.chain.nowMs()) + delay);
    accepted("after its time, she can", await w.chain.call(lea.account, "withdraw_bond", {}));
  }

  console.log("\n-- A dead feed can't hold an audit up --");
  {
    const { VmChain } = await import("./vmchain.ts");
    const { Timing, Prices } = await import("../lib/src/client.ts");
    const c3 = new VmChain("kh3.test", Date.UTC(2026, 9, 1));
    const v3 = c3.vm;
    for (const a of ["o.test", "liar.test", "aud.test", "r.test"]) v3.fund(a, near(100));
    accepted("a deployment with a feed that will never get another round", v3.call("o.test", "new", { owner: "o.test", config: { ...w.config, recorder: "r.test", max_round_gap_secs: 72000, post_grace_secs: 150000, challenge_secs: 160000 }, feeds: [{ symbol: "ETH/USD", source: "Recorded" }, { symbol: "QUIET", source: "Recorded" }] }));
    v3.call("r.test", "record_round", { feed: 0, round_id: "1", answer_e8: 200_000_000_000, source_updated_at: "1" }, near("0.01"));
    const t3 = await Timing.read(c3);
    const p3 = new Prices(c3);
    const liar3 = new TraderAgent(c3, "liar.test", seedOf("shared"), t3);
    accepted("a trader", await liar3.register("liar", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    await c3.advanceTo(t3.epochStart(1));
    accepted("he trades on the quiet feed, so that no audit can price it", await liar3.write({ feed: 1, flags: 0, qty_e8: 100_000_000n, fill_e8: 1n, settlement: NO_SETTLEMENT, note: "nobody can price this" }));
    await c3.advanceTo(t3.epochStart(2));
    accepted("and posts a figure out of nothing", await liar3.post(1, 777_000_000n));
    const open3 = await c3.call("aud.test", "audit_open", { trader: "liar.test", epoch: 1 }, near(1));
    accepted("an auditor opens", open3);
    const [e3] = await loadEntries(c3, "liar.test", 0, 1);
    const key3 = hex(liar3.keyOf(e3));
    refused("before the wait is over, claiming no round is refused", await c3.call("aud.test", "audit_step", { audit: open3.value, openings: [{ key: key3, price_index: 0 }] }), "no such round yet");
    await c3.advanceTo(Number(e3.at_ms) + 2 * 72000 * 1000 + 1000);
    accepted("after it, the entry is void and the audit goes on", await c3.call("aud.test", "audit_step", { audit: open3.value, openings: [{ key: key3, price_index: 0 }] }));
    const v3r = await c3.call("aud.test", "audit_conclude", { audit: open3.value, mark_indices: [null, null, null, null] });
    check("DEAD FEED: the figure out of nothing is proven false", v3r.ok && v3r.value.trader_at_fault === true, v3r.value?.detail ?? v3r.reason ?? "");

    // A claim of no round, when one exists; and a round too late to price a trade.
    const hon = new TraderAgent(c3, "aud.test", seedOf("shared"), t3);
    accepted("another trader", await hon.register("hon", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    const eNow = t3.epochOf(await c3.nowMs()) + 1;
    await c3.advanceTo(t3.epochStart(eNow));
    accepted("a real trade on the live feed", await hon.write({ feed: 0, flags: 0, qty_e8: 100_000_000n, fill_e8: 1n, settlement: NO_SETTLEMENT, note: "ok" }));
    c3.vm.advance(1000);
    v3.call("r.test", "record_round", { feed: 0, round_id: "2", answer_e8: 210_000_000_000, source_updated_at: "2" }, near("0.01"));
    await c3.advanceTo(t3.epochStart(eNow + 1));
    v3.call("r.test", "record_round", { feed: 0, round_id: "3", answer_e8: 220_000_000_000, source_updated_at: "3" }, near("0.01"));
    await p3.load();
    const ff3 = await hon.figure(eNow, p3);
    check("the replay prices it, and marks it", ff3.pnl_e6 === 100_000_000n * 10n / 10n, String(ff3.pnl_e6));
    accepted("she posts it", await hon.post(eNow, ff3.pnl_e6));
    v3.fund("aud2.test", near(10));
    const open4 = await c3.call("aud2.test", "audit_open", { trader: "aud.test", epoch: eNow }, near(1));
    refused("claiming no round follows, when one does, is refused", await c3.call("aud2.test", "audit_step", { audit: open4.value, openings: [{ ...ff3.openings[0], price_index: 3 }] }), "a round follows");
    accepted("the true hint opens it", await c3.call("aud2.test", "audit_step", { audit: open4.value, openings: ff3.openings }));
    const v4 = await c3.call("aud2.test", "audit_conclude", { audit: open4.value, mark_indices: ff3.mark_indices });
    check("and the honest figure stands", v4.ok && v4.value.trader_at_fault === false, v4.value?.detail ?? v4.reason ?? "");

    // Now a round far too late.
    const late = new TraderAgent(c3, "aud2.test", seedOf("shared"), t3);
    accepted("a third", await late.register("late", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    const eL = t3.epochOf(await c3.nowMs()) + 1;
    await c3.advanceTo(t3.epochStart(eL));
    accepted("a trade", await late.write({ feed: 0, flags: 0, qty_e8: 100_000_000n, fill_e8: 1n, settlement: NO_SETTLEMENT, note: "the feed then goes quiet" }));
    await c3.advanceTo(await c3.nowMs() + (72000 + 60) * 1000);
    v3.call("r.test", "record_round", { feed: 0, round_id: "4", answer_e8: 900_000_000_000, source_updated_at: "4" }, near("0.01"));
    await p3.load();
    const fl = await late.figure(eL, p3);
    check("a round that comes after the gap prices nothing: the trade is void, so a stale feed can't be a free option", fl.book.void === 1 && fl.pnl_e6 === 0n, `void ${fl.book.void}, figure ${fl.pnl_e6}`);
    await c3.advanceTo(t3.epochStart(eL + 1));
    accepted("she posts the zero", await late.post(eL, fl.pnl_e6));
    const a5 = await runAudit(c3, "aud.test", "aud2.test", eL, fl, { bond: near(1) });
    check("and the contract agrees: that round prices nothing", a5.verdict.ok && a5.verdict.value.trader_at_fault === false, a5.verdict.value?.detail ?? a5.verdict.reason ?? "");
  }

  console.log("\n-- What a stranger with no key can work out (a stated limit, shown) --");
  {
    // An entry's time, an epoch's entry count and its posted figure are public, and so are the rounds. For an epoch with ONE trade that is one equation in one
    // unknown: figure = size x (mark - fill). Nobody needs a key to solve it. The ciphertext still hides the note, the claimed fill and which feed it was,
    // and nothing is known before the figure is posted, so a copier still needs the window. But a record of single trades is not private after the fact.
    const quiet = new TraderAgent(w.chain, await w.fund("quiet", near(40)), seedOf("one-trade"), w.timing);
    accepted("a trader who writes one trade in an epoch", await quiet.register("quiet", { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
    const qe = await nextEpoch(w);
    await honestEpoch(w, quiet, qe, [trade(1, -0.37, "a short nobody paid to see")]);
    // The stranger: views only, no key.
    const row = (await w.chain.view("get_epochs", { account: quiet.account, from: qe, limit: 1 }))[0];
    const only = (await w.chain.view("get_entries", { account: quiet.account, from: row.first_seq, limit: 1 }))[0];
    const pub = new Prices(w.chain);
    await pub.load();
    const guesses: bigint[] = [];
    const delay = (w.config.price_delay_secs ?? 0) * 1000;
    for (let f = 0; f < pub.rounds.length; f++) {
      const fill = firstRoundAtOrAfter(pub.rounds[f], Number(only.at_ms) + delay);
      const mark = firstRoundAtOrAfter(pub.rounds[f], w.timing.epochStart(qe + 1) + delay);
      if (fill < 0 || mark < 0) continue;
      const move = BigInt(pub.rounds[f][mark].answer_e8) - BigInt(pub.rounds[f][fill].answer_e8);
      if (move !== 0n) guesses.push((BigInt(row.posted_e6) * 10_000_000_000n) / move);
    }
    const near37 = (q: bigint) => q >= -37_000_100n && q <= -36_999_900n;
    check("LIMIT, shown: with no key, a one-trade epoch's side and size follow from its time, its figure and the public rounds", row.entries === 1 && guesses.some(near37), `candidates, one per feed: ${guesses.map((q) => (Number(q) / 1e8).toFixed(4)).join(", ")}; the trade was -0.3700 on feed 1`);
    check("which feed it was stays hidden: every feed gives a candidate", guesses.length === pub.rounds.length, `${guesses.length} candidates`);
  }

  console.log("\n-- NEP-171 transfer_call --");
  const nora = new TraderAgent(w.chain, await w.fund("nora", near(40)), seedOf("shared"), w.timing);
  accepted("a trader", await nora.register("nora", { book_usd: 1000, floor_bps: 1000, base_price: PRICE, slope: 0n, bond: BOND }));
  const ne = (await nextEpoch(w)) + 3;
  const nb = await buy(w, buyer, nora, ne, ne);
  vm.mock("market.test", (method: string, args: any) => {
    if (method !== "nft_on_transfer") throw new Error("unexpected");
    return args.msg === "keep" ? false : true;
  });
  const tc = await w.chain.call(buyer, "nft_transfer_call", { receiver_id: "market.test", token_id: String(nb.id), msg: "return it" }, 1n);
  check("a receiver that returns true gives the token back", tc.ok && (await nb.token()).owner === buyer, JSON.stringify(tc.value ?? tc.reason));
  check("and the one-time key has to be set again", (await nb.token()).buyer_pub === null);
  let listedInCallback = false;
  vm.mock("lister.test", (_m: string, args: any) => {
    listedInCallback = vm.nested("lister.test", "list_resale", { token_id: Number(args.token_id), price: "1" }).ok;
    return true;
  });
  const tl = await w.chain.call(buyer, "nft_transfer_call", { receiver_id: "lister.test", token_id: String(nb.id), msg: "" }, 1n);
  check("a receiver that lists it and hands it back leaves no listing behind", tl.ok && listedInCallback && (await nb.token()).resale_price === null && (await nb.token()).owner === buyer, JSON.stringify(tl.value ?? tl.reason));
  const tk = await w.chain.call(buyer, "nft_transfer_call", { receiver_id: "market.test", token_id: String(nb.id), msg: "keep" }, 1n);
  check("a receiver that keeps it holds it", tk.ok && (await nb.token()).owner === "market.test", JSON.stringify(tk.value ?? tk.reason));
  const nc = await w.chain.call(buyer, "nft_transfer_call", { receiver_id: "no-such-contract.test", token_id: String(nb.id), msg: "" }, 1n);
  refused("the old holder can't move it again", nc, "only the holder");
  check("nft_total_supply counts mints", BigInt(await w.chain.view("nft_total_supply")) > 0n);
  check("NEP-181 lists a holder's tokens", (await w.chain.view("nft_tokens_for_owner", { account_id: "market.test" })).length === 1);

  console.log("\n-- A feed borrowed from near-borrowed-oracle (mocked here; real on testnet) --");
  const { VmChain } = await import("./vmchain.ts");
  const c2 = new VmChain("kh2.test", Date.UTC(2026, 9, 31));
  c2.vm.fund("o.test", near(10));
  const cfg = { ...w.config, recorder: null };
  const init = c2.vm.call("o.test", "new", { owner: "o.test", config: cfg, feeds: [{ symbol: "ETH/USD", source: { BorrowedOracle: { oracle: "oracle.test", pair: "ETH/USD" } } }] });
  accepted("a deployment with no recorder and one proven feed", init);
  refused("with no recorder, nobody can record a round", c2.vm.call("o.test", "record_round", { feed: 0, round_id: "1", answer_e8: 1, source_updated_at: "1" }), "only the recorder");
  const updated = Math.floor(Date.UTC(2026, 9, 30) / 1000);
  c2.vm.mock("oracle.test", (m: string) => {
    if (m !== "latest") throw new Error("unexpected");
    return { pair: "ETH/USD", age_secs: 10, answer: "225000000000", decimals: 8, round_id: "289448", updated_at: String(updated), proven_at_ms: "1", chain: "base-sepolia" };
  });
  const imp = c2.vm.call("o.test", "import_round", { feed: 0 }, near("0.01"));
  check("anyone can import the oracle's round", imp.ok && imp.value === true, JSON.stringify(imp.value ?? imp.reason));
  const rr = c2.vm.view("get_rounds", { feed: 0, from: 0, limit: 5 });
  check("the round is stored with the time it was proven for", rr.length === 1 && rr[0].answer_e8 === 225000000000 && Number(rr[0].t_ms) === updated * 1000, JSON.stringify(rr[0]));
  const again = c2.vm.call("o.test", "import_round", { feed: 0 }, near("0.01"));
  check("importing the same round again changes nothing", again.ok && again.value === false && c2.vm.view("get_rounds", { feed: 0, from: 0, limit: 5 }).length === 1, JSON.stringify(again.value ?? again.reason));
  c2.vm.mock("oracle.test", () => ({ pair: "ETH/USD", age_secs: 10, answer: "1", decimals: 8, round_id: "289449", updated_at: String(updated + 1), proven_at_ms: "1", chain: "base-sepolia" }));
  c2.vm.advance(10 * 86400_000);
  const stale = c2.vm.call("o.test", "import_round", { feed: 0 }, near("0.01"));
  check("a newer round that's too old to import is refused: figures already computed stay right", stale.ok && stale.value === false && c2.vm.view("get_rounds", { feed: 0, from: 0, limit: 5 }).length === 1, JSON.stringify(stale.value ?? stale.reason));
  c2.vm.mock("oracle.test", () => { throw new Error("oracle down"); });
  const down = c2.vm.call("o.test", "import_round", { feed: 0 }, near("0.01"));
  check("an oracle that fails imports nothing", down.ok && down.value === false, JSON.stringify(down.value ?? down.reason));
}

const started = Date.now();
const w = SANDBOX ? await sandboxWorld() : await vmWorld();
console.log(`Attack suite on ${SANDBOX ? "a local NEAR sandbox node" : "the local wasm host (the real contract, no gas metering)"}.`);
try {
  await run(w);
  if (!SANDBOX) await vmOnly(w as any);
} catch (e) {
  check("the suite ran to the end", false, String((e as Error).stack ?? e));
}
// The result first, then the cleanup: a run killed while a node shuts down has still said how it went.
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} attack checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (bad.length) {
  for (const b of bad) console.log(`  FAILED: ${b.name}: ${b.detail}`);
}
w.stop();
process.exit(bad.length ? 1 : 0);
