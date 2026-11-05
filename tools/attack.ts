// The attack suite. Each attack states what must happen, runs against the real contract wasm and checks it did.
//   npm run attack              the whole suite on the local wasm host, months of contract time in seconds
//   npm run attack -- --sandbox the core attacks on a real local NEAR node (short epochs, so it takes minutes)
// Exits 1 on any failure. KEYHOLE_WASM points it at another build: the mutation check uses that.
import { hex, sha256, unhex, utf8 } from "../lib/src/bytes.ts";
import { encryptEntry, entryKey, type Entry } from "../lib/src/entry.ts";
import { buyerKey, DEPTH, loadEntries, near, NO_SETTLEMENT, runAudit, TraderAgent, WindowReader, type Outcome, type TokenRec, type TraderRec } from "../lib/src/client.ts";
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
  refused("a bond below the minimum is refused", await w.chain.call(dave, "register_trader", { handle: "cheap", root: "00".repeat(32), book_usd_e6: "1000000", floor_bps: 100, base_price: "1", slope: "0" }, near("0.5")), "minimum bond");
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
  refused("audit: a wrong mark hint is refused", await w.chain.call(bob, "audit_conclude", { audit: auditId, mark_indices: local.mark_indices.map((m) => (m === null ? null : m + 1)) }), "");
  const bondBefore = BigInt((await liar.record()).bond);
  const verdict = await w.chain.call(bob, "audit_conclude", { audit: auditId, mark_indices: local.mark_indices });
  check("FALSE PNL: the contract recomputes the figure and slashes", verdict.ok && verdict.value.trader_at_fault === true, verdict.value?.detail ?? verdict.reason ?? "");
  check("the prover takes half the bond", BigInt(verdict.value?.slashed_to_prover ?? 0) === bondBefore / 2n, `${verdict.value?.slashed_to_prover}`);
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
  check("the claim paid the whole price from escrow, plus the bond's cover", credit1 - credit0 >= PRICE, `${Number((credit1 - credit0) / 10n ** 21n) / 1000} NEAR`);
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
  check("the buyer's share of the bond is half of it", BigInt(dg.value?.slashed_to_prover ?? 0) === samBond / 2n);
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
  accepted("the resale goes through, and the seller is paid", await w.chain.call(carol, "buy_resale", { token_id: res.id, buyer_pub: hex(c1.pub) }, near(1)));
  check("the seller gets the asking price", BigInt(await w.chain.view("credit_of", { account: bob })) - bobCredit === near("0.3"));
  const nft = await w.chain.view("nft_token", { token_id: String(res.id) });
  check("NEP-171 shows the new holder", nft.owner_id === carol, nft.owner_id);
  refused("RESALE REPLAY: the seller can't dispute any more", await w.chain.call(bob, "dispute_wrap", { token_id: res.id, one_time_secret: hex(res.one.secret), node_index: 0 }, near(1)), "only the holder");
  await w.chain.advanceTo(w.timing.epochStart(future) - w.config.delivery_lead_secs * 1000);
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
  refused("the trader can't deliver to nobody", await w.chain.call(pam.account, "deliver", { token_id: p1.id, eph: hex(buyerKey().pub), wrapped: [], commits: [], proof: [] }, near("0.05")), "hasn't registered");
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
  const penalty = PRICE / 10_000n * 1000n;
  check("the refund is the whole price plus the penalty from the bond", BigInt(await w.chain.view("credit_of", { account: bob })) - cu0 === PRICE + penalty);
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
  check("anyone can settle: the escrow goes to the trader", st.ok && st.value === "closed" && BigInt(await w.chain.view("credit_of", { account: vic.account })) - vc === PRICE, String(st.value ?? st.reason));
  refused("settling twice is refused", await w.chain.call(dave, "settle", { token_id: v1.id }), "can't be settled");
  check("a closed window no longer counts against the bond", BigInt((await vic.record()).liability) === 0n);
  await solvent(w, "after settling");

  console.log("\n-- The floor and the lapse: refunds from the bond --");
  await w.rounds();
  const xan = await newTrader(w, "xan", "shared", { floor_bps: 100, book: 10_000, base: near("0.5"), slope: 0n });
  e = await nextEpoch(w);
  await xan.write(trade(0, 3, "too long, too big"));
  await w.roundAt(0, 300_000_000_000n);
  await closeEpoch(w, e);
  await w.chain.advanceTo((await w.chain.nowMs()) + 1);
  const crash = await w.roundAt(0, 270_000_000_000n);
  accepted("the market falls 10% on him", crash);
  await w.prices.load();
  const xf = await xan.figure(e, w.prices);
  accepted("he posts his real loss", await xan.post(e, xf.pnl_e6));
  const x1 = await buy(w, bob, xan, e, e);
  const x2 = await buy(w, carol, xan, e, e);
  accepted("delivery one", await xan.deliver(x1.id));
  accepted("delivery two", await xan.deliver(x2.id));
  await w.chain.advanceTo(Number((await x2.token()).settle_at_ms));
  const s1 = await w.chain.call(dave, "settle", { token_id: x1.id });
  check("FLOOR: a window past the floor settles as refundable", s1.ok && s1.value === "refundable", `figure ${xf.pnl_e6}, floor -100000000: ${s1.value ?? s1.reason}`);
  const s2 = await w.chain.call(dave, "settle", { token_id: x2.id });
  accepted("the other too", s2);
  const xr = await xan.record();
  const c0 = BigInt(await w.chain.view("credit_of", { account: bob }));
  accepted("the first holder claims", await w.chain.call(bob, "claim_refund", { token_id: x1.id }));
  const paid = BigInt(await w.chain.view("credit_of", { account: bob })) - c0;
  check("with a bond that covers it, the holder gets the whole price from the bond", paid === BigInt((await x1.token()).price), `${paid}`);
  check("the bond really paid", BigInt((await xan.record()).bond) === BigInt(xr.bond) - paid);
  refused("someone else's token can't be claimed", await w.chain.call(bob, "claim_refund", { token_id: x2.id }), "only the holder");
  accepted("the second holder claims", await w.chain.call(carol, "claim_refund", { token_id: x2.id }));
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
  const ys = await w.chain.call(dave, "settle", { token_id: y1.id });
  check("LAPSE: a window with a missing figure settles as refundable", ys.ok && ys.value === "refundable", String(ys.value ?? ys.reason));
  accepted("the holder claims from the bond", await w.chain.call(bob, "claim_refund", { token_id: y1.id }));
  await solvent(w, "after the lapse");

  // A holder who never claims can't lock the trader's bond for ever.
  await w.rounds();
  const zoe = await newTrader(w, "zoe");
  e = await nextEpoch(w);
  const z1 = await buy(w, bob, zoe, e, e);
  accepted("delivery", await zoe.deliver(z1.id));
  await w.chain.advanceTo(Number((await z1.token()).settle_at_ms));
  accepted("no figure, so the window settles as refundable", await w.chain.call(dave, "settle", { token_id: z1.id }));
  refused("closing it before the holder's time is up is refused", await w.chain.call(dave, "close_unclaimed", { token_id: z1.id }), "still has time");
  await w.chain.advanceTo(Number((await z1.token()).settle_at_ms) + w.config.unbond_secs * 1000);
  accepted("ABSENT HOLDER: after the delay, anyone can close the unclaimed refund", await w.chain.call(dave, "close_unclaimed", { token_id: z1.id }));
  check("and the bond is free of it", BigInt((await zoe.record()).liability) === 0n);
  refused("a closed window can't claim", await w.chain.call(bob, "claim_refund", { token_id: z1.id }), "can't claim");
  refused("a window too far ahead is refused", await w.chain.call(bob, "buy_window", { trader: zoe.account, first_epoch: (await currentEpoch(w)) + 40, last_epoch: (await currentEpoch(w)) + 40, buyer_pub: hex(buyerKey().pub) }, near(3)), "too far ahead");

  // Pro rata: the bond can't cover everyone, and the order of claims doesn't matter.
  await w.rounds();
  const pia = await newTrader(w, "pia", "shared", { floor_bps: 1, book: 10_000, base: near(1), slope: 0n, bond: near("1.2") });
  e = await nextEpoch(w);
  await pia.write(trade(0, 1, "long into a fall"));
  await w.roundAt(0, 300_000_000_000n);
  await closeEpoch(w, e);
  await w.chain.advanceTo((await w.chain.nowMs()) + 1);
  await w.roundAt(0, 270_000_000_000n);
  await w.prices.load();
  accepted("she posts the loss", await pia.post(e, (await pia.figure(e, w.prices)).pnl_e6));
  const q1 = await buy(w, bob, pia, e, e);
  const q2 = await buy(w, carol, pia, e, e);
  accepted("delivery", await pia.deliver(q1.id));
  accepted("delivery", await pia.deliver(q2.id));
  await w.chain.advanceTo(Number((await q2.token()).settle_at_ms));
  await w.chain.call(dave, "settle", { token_id: q1.id });
  await w.chain.call(dave, "settle", { token_id: q2.id });
  const pb = BigInt((await pia.record()).bond);
  const bc0 = BigInt(await w.chain.view("credit_of", { account: bob }));
  accepted("the first holder claims", await w.chain.call(bob, "claim_refund", { token_id: q1.id }));
  const bc1 = BigInt(await w.chain.view("credit_of", { account: bob })) - bc0;
  const cc0 = BigInt(await w.chain.view("credit_of", { account: carol }));
  accepted("the second holder claims", await w.chain.call(carol, "claim_refund", { token_id: q2.id }));
  const cc1 = BigInt(await w.chain.view("credit_of", { account: carol })) - cc0;
  check("PRO RATA: both get the same fraction whatever the order", bc1 > 0n && (bc1 > cc1 ? bc1 - cc1 : cc1 - bc1) <= 2n, `${Number(bc1 / 10n ** 21n) / 1000} and ${Number(cc1 / 10n ** 21n) / 1000} NEAR of a 1.2 NEAR bond`);
  check("claims never exceed the bond", bc1 + cc1 <= pb, `left ${pb - bc1 - cc1} yocto`);
  await solvent(w, "after the pro rata");

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
  check("the escrow is credited", c0 >= PRICE);
  const wd = await w.chain.call(brokenId, "withdraw", {});
  check("the transfer fails, the callback says so", wd.ok && wd.value === false, JSON.stringify(wd.value ?? wd.reason));
  check("FAILED TRANSFER: the credit is restored in full", BigInt(await w.chain.view("credit_of", { account: brokenId })) === c0);
  await solvent(w, "after the failed transfer");

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
w.stop();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} attack checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (bad.length) {
  for (const b of bad) console.log(`  FAILED: ${b.name}: ${b.detail}`);
}
process.exit(bad.length ? 1 : 0);
