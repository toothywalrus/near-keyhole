// One complete moment, on a real chain, with every gas number measured:
//   a stranger reads a public PnL with a bond behind it; buys a window; reads exactly those trades; tries the next day's entry and watches it fail to
//   decrypt, offline, with nobody revoking anything; catches a lying trader and collects the bond.
//
//   npm run demo                on a local sandbox node, free, about a minute
//   npm run demo -- --testnet   on NEAR testnet (the owner's funded root; writes docs/demo/testnet-run.json)
import { writeFileSync } from "node:fs";
import { hex } from "../lib/src/bytes.ts";
import { buyerKey, loadEntries, near, NO_SETTLEMENT, replayEpoch, runAudit, type EpochRec, type Outcome, type TokenRec, type TraderRec, TraderAgent, WindowReader } from "../lib/src/client.ts";
import { sandboxWorld, seedOf, type World } from "./world.ts";
import { tgas } from "./nearkit.ts";

const TESTNET = process.argv.includes("--testnet");
const EXPLORER = "https://testnet.nearblocks.io/txns/";
type Step = { what: string; tx?: string; tgas?: number; note?: string };
const steps: Step[] = [];
const failures: string[] = [];

function say(s: string): void {
  console.log(s);
}
function record(what: string, r: Outcome, note = ""): Outcome {
  const burnt = Number(r.burntGas) / 1e12;
  steps.push({ what, tx: r.tx, tgas: burnt, note });
  if (!r.ok) failures.push(`${what}: ${r.reason}`);
  say(`${r.ok ? "✓" : "✗"} ${what.padEnd(58)} ${burnt ? tgas(r.burntGas).padStart(11) : ""}  ${TESTNET && r.tx ? EXPLORER + r.tx : ""} ${note}`);
  return r;
}
function must(cond: boolean, what: string, detail = ""): void {
  say(`${cond ? "✓" : "✗"} ${what}${detail ? `: ${detail}` : ""}`);
  if (!cond) failures.push(what);
}
const usd = (e6: string | bigint) => `$${(Number(e6) / 1e6).toFixed(2)}`;
const nearStr = (y: string | bigint) => `${(Number(BigInt(y) / 10n ** 20n) / 10_000).toFixed(4)} NEAR`;

const w: World & { net?: any } = TESTNET ? await (await import("./testnet.ts")).testnetWorld() : await sandboxWorld();
say(TESTNET ? `On NEAR testnet, contract ${w.contract}.` : `On a local NEAR sandbox node, contract ${w.contract}.`);
const BOND = TESTNET ? near("0.35") : near(3);
const PRICE = TESTNET ? near("0.01") : near("0.05");
const SLOPE = TESTNET ? near("0.002") : near("0.01");
const STAMP = TESTNET ? (Date.now() % 100000).toString(36) : "";

const agentNamed = async (name: string, fund: string): Promise<TraderAgent> => {
  const account = await w.fund(`${name}${STAMP}`, near(fund));
  return new TraderAgent(w.chain, account, seedOf(`${name}${STAMP}`), w.timing);
};
const reg = async (t: TraderAgent, handle: string) => {
  const r = await t.register(handle, { book_usd: 100_000, floor_bps: 1000, base_price: PRICE, slope: SLOPE, bond: BOND });
  record(`${handle} registers: a bond, a root committing to a key tree`, r);
};

say("\n== Three traders. The numbers they'll post are public. ==");
const vega = await agentNamed("vega", TESTNET ? "0.6" : "10");
const lucky = await agentNamed("lucky", TESTNET ? "0.6" : "10");
const mallory = await agentNamed("mallory", TESTNET ? "0.6" : "10");
await reg(vega, "vega");
await reg(lucky, "lucky");
await reg(mallory, "mallory");
const buyer = await w.fund(`ines${STAMP}`, near(TESTNET ? "0.8" : "10"));

const trade = (feed: number, qty: number, fill: number, note: string) => ({ feed, flags: 0, qty_e8: BigInt(Math.round(qty * 1e8)), fill_e8: BigInt(Math.round(fill * 1e8)), settlement: NO_SETTLEMENT, note });

await w.rounds();
const now0 = await w.chain.nowMs();
const e0 = w.timing.epochOf(now0) + 1;
await w.chain.advanceTo(w.timing.epochStart(e0));
say(`\n== Epoch ${e0}: everyone writes as it happens. No backdating, no gaps. ==`);
record("vega writes: long ETH", await vega.write(trade(0, 3, 2400, "breakout above the weekly high")), "an encrypted entry, committed when written");
record("lucky writes: a small long", await lucky.write(trade(0, 0.5, 2400, "small starter")));
record("lucky writes: a BTC short", await lucky.write(trade(1, -1.5, 70000, "short BTC against the long")));
record("vega writes: a BTC hedge", await vega.write(trade(1, -0.05, 70000, "hedge the beta")));
await w.rounds();
await w.chain.advanceTo(w.timing.epochStart(e0 + 1));
await w.rounds();
await w.prices.load();
const figV = await vega.figure(e0, w.prices);
const figL = await lucky.figure(e0, w.prices);
const LIE = figL.pnl_e6 + 25_000_000_000n;
record(`vega posts the true figure: ${usd(figV.pnl_e6)}`, await vega.post(e0, figV.pnl_e6));
record(`lucky posts a LIE: ${usd(LIE)} (truth: ${usd(figL.pnl_e6)})`, await lucky.post(e0, LIE));
record("mallory posts an empty epoch", await mallory.post(e0, 0n));

say(`\n== Epoch ${e0 + 1}: the day after. ==`);
const e1 = e0 + 1;
const nextDay = await vega.write(trade(0, -3, 2410, "taking profit: past any window ending yesterday"));
record("vega writes the next day's entry", nextDay);
await w.rounds();

say("\n== A stranger reads the board, before paying anything. ==");
const board = await w.chain.view<TraderRec[]>("list_traders", { from: 0, limit: 100 });
for (const name of [vega.account, lucky.account, mallory.account]) {
  const t = board.find((x) => x.account === name)!;
  say(`   ${t.handle.padEnd(10)} PnL ${usd(t.cum_pnl_e6).padStart(14)}   bond ${nearStr(t.bond)}   ${t.next_seq} entries   ${t.buyers} past buyers`);
}

say("\n== She buys the window, and pays into escrow. ==");
const q = await w.chain.view<string>("quote", { trader: vega.account, first_epoch: e0, last_epoch: e0 });
const one = buyerKey();
const bought = record(`buy epoch ${e0} of vega's journal, a NEP-171 token`, await w.chain.call(buyer, "buy_window", { trader: vega.account, first_epoch: e0, last_epoch: e0, buyer_pub: hex(one.pub) }, BigInt(q) + near("0.02")), `price ${nearStr(q)}`);
const tokenId = Number(bought.value);
record("vega delivers: nodes wrapped to her one-time key", await vega.deliver(tokenId));
const token = await w.chain.view<TokenRec>("get_token", { token_id: tokenId });
const reader = new WindowReader(token, one);
must(reader.verifyNodes().every(Boolean), `she checks ${token.wrapped.length} nodes against the commitments, locally`);

say("\n== She reads exactly that window. Everything below happens offline, with what was delivered. ==");
const vRec = await w.chain.view<TraderRec>("get_trader", { account: vega.account });
const entries = await loadEntries(w.chain, vega.account, 0, Number(vRec.next_seq));
for (const e of entries) {
  const r = reader.read(e);
  if (r.readable) say(`   #${e.seq}  slot ${e.slot}  ${Number(r.entry!.qty_e8) / 1e8 > 0 ? "BUY " : "SELL"} ${Math.abs(Number(r.entry!.qty_e8)) / 1e8} ${w.prices.rounds.length ? ["ETH", "BTC", "SOL"][r.entry!.feed] : ""}  "${r.entry!.note}"`);
  else say(`   #${e.seq}  slot ${e.slot}  DOESN'T DECRYPT: ${r.why}`);
}
const reads = entries.map((e) => reader.read(e));
must(reads.slice(0, 2).every((r) => r.readable), "the window's two entries read");
must(!reads[2].readable, "the entry past the window does not, with nobody revoking anything");
const eps = await w.chain.view<EpochRec[]>("get_epochs", { account: vega.account, from: e0, limit: 1 });
const local = replayEpoch(entries.slice(0, 2), (x) => reader.key(x)!, w.prices, BigInt(vRec.book_usd_e6), w.timing.epochStart(e0 + 1));
must(local.pnl_e6.toString() === eps[0].posted_e6, "she recomputes vega's figure from the oracle: it's exact", usd(local.pnl_e6));

say("\n== She buys lucky's window, and does the same sum. ==");
const q2 = await w.chain.view<string>("quote", { trader: lucky.account, first_epoch: e0, last_epoch: e0 });
const one2 = buyerKey();
const b2 = record(`buy epoch ${e0} of lucky's journal`, await w.chain.call(buyer, "buy_window", { trader: lucky.account, first_epoch: e0, last_epoch: e0, buyer_pub: hex(one2.pub) }, BigInt(q2) + near("0.02")));
record("lucky delivers honestly: the journal itself isn't the lie", await lucky.deliver(Number(b2.value)));
const t2 = await w.chain.view<TokenRec>("get_token", { token_id: Number(b2.value) });
const r2 = new WindowReader(t2, one2);
const lEntries = await loadEntries(w.chain, lucky.account, 0, 2);
const lRec = await w.chain.view<TraderRec>("get_trader", { account: lucky.account });
const myFig = replayEpoch(lEntries, (x) => r2.key(x)!, w.prices, BigInt(lRec.book_usd_e6), w.timing.epochStart(e0 + 1));
must(myFig.pnl_e6.toString() !== LIE.toString(), `lucky posted ${usd(LIE)}. The journal and the oracle say ${usd(myFig.pnl_e6)}`);

say("\n== She catches the liar, on-chain. The contract recomputes it. ==");
const auditBond = BigInt(w.config.audit_bond);
const bondBefore = BigInt(lRec.bond);
const creditBefore = BigInt(await w.chain.view("credit_of", { account: buyer }));
const audit = await runAudit(w.chain, buyer, lucky.account, e0, myFig, { bond: auditBond + near("0.01") });
record("audit_open: the deposit goes at risk", audit.opened);
audit.steps.forEach((s) => record(`audit_step: ${myFig.openings.length} entries opened in the contract`, s));
record("audit_conclude: recomputed, compared, slashed", audit.verdict);
const v = audit.verdict.value;
must(v?.trader_at_fault === true, "the verdict", v?.detail);
must(BigInt(v?.slashed_to_prover ?? 0) === (bondBefore * BigInt(w.config.prover_bps)) / 10_000n, `${w.config.prover_bps / 100}% of the bond goes to her, and ${w.config.burn_bps / 100}% burns`, nearStr(v?.slashed_to_prover ?? 0));
const refund = record("claim_refund: the escrow back", await w.chain.call(buyer, "claim_refund", { token_id: Number(b2.value) }));
const credit = BigInt(await w.chain.view("credit_of", { account: buyer }));
say(`   her credit on the contract: ${nearStr(credit)} (was ${nearStr(creditBefore)})`);
const bal0 = await (w as any).chain.net.balance(buyer);
record("withdraw", await w.chain.call(buyer, "withdraw", {}));
const bal1 = await (w as any).chain.net.balance(buyer);
must(bal1 > bal0, "the money really moved", `balance up ${nearStr(bal1 - bal0)}`);
void refund;

say("\n== Garbage for sale: the dispute the kill test was about, on the real contract. ==");
const one3 = buyerKey();
const q3 = await w.chain.view<string>("quote", { trader: mallory.account, first_epoch: e0, last_epoch: e1 });
const b3 = record("she buys two epochs of mallory's journal", await w.chain.call(buyer, "buy_window", { trader: mallory.account, first_epoch: e0, last_epoch: e1, buyer_pub: hex(one3.pub) }, BigInt(q3) + near("0.02")));
record("mallory delivers garbage for one node", await mallory.deliver(Number(b3.value), { garbage: 0 }));
const t3 = await w.chain.view<TokenRec>("get_token", { token_id: Number(b3.value) });
must(new WindowReader(t3, one3).verifyNodes()[0] === false, "she sees it at once: that node doesn't match its commitment");
const dispute = record("dispute_wrap: secret revealed, the contract unwraps and compares", await w.chain.call(buyer, "dispute_wrap", { token_id: Number(b3.value), one_time_secret: hex(one3.secret), node_index: 0 }, BigInt(t3.price) + near("0.002")), "x25519 x2, ChaCha20, SHA-256");
must(dispute.value?.trader_at_fault === true, "the verdict", dispute.value?.detail);

say("\n== And a false dispute costs the griefer: an honest delivery stands. ==");
const one4 = buyerKey();
const q4 = await w.chain.view<string>("quote", { trader: vega.account, first_epoch: e0, last_epoch: e0 });
const griefer = await w.fund(`grif${STAMP}`, near(TESTNET ? "0.35" : "5"));
const b4 = record("someone else buys vega's window", await w.chain.call(griefer, "buy_window", { trader: vega.account, first_epoch: e0, last_epoch: e0, buyer_pub: hex(one4.pub) }, BigInt(q4) + near("0.02")));
record("vega delivers honestly", await vega.deliver(Number(b4.value)));
const fd = record("dispute_wrap with nothing wrong", await w.chain.call(griefer, "dispute_wrap", { token_id: Number(b4.value), one_time_secret: hex(one4.secret), node_index: 0 }, BigInt(q4) + near("0.002")));
must(fd.value?.trader_at_fault === false, "dismissed, and the deposit goes to vega", fd.value?.detail);

say("\n== A trader with no buyers can still earn a number: the attested job, labeled for what it is. ==");
{
  const { execFileSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { readFileSync } = await import("node:fs");
  const { cover } = await import("../lib/src/ggm.ts");
  const JOB = new URL("../res/keyhole_pnl_job.wasm", import.meta.url).pathname;
  const hash = createHash("sha256").update(readFileSync(JOB)).digest("hex");
  const [first, last] = w.timing.window(e0, e0);
  const nodes = cover(first, last, 16).map((n) => ({ level: n.level, index: n.index, value: hex(vega.tree.node(n)) }));
  try {
    const rpc = (w as any).chain.net.rpc as string;
    const out = JSON.parse(execFileSync("wasmtime", ["run", "-S", "http", "--env", `KEYHOLE_NODES=${JSON.stringify(nodes)}`, "--env", `KEYHOLE_JOB_SHA256=${hash}`, JOB], { input: JSON.stringify({ contract: w.contract, trader: vega.account, epoch: e0, rpc }), stdio: ["pipe", "pipe", "pipe"] }).toString());
    must(out.pnl_e6 === figV.pnl_e6.toString(), "the wasm job under wasmtime reads the chain over HTTP and gets the same figure, to the unit", usd(out.pnl_e6));
    const setR = await w.chain.call(w.owner, "set_runner", { runner: w.owner, enabled: true });
    record("the owner registers a local runner", setR);
    record("the runner submits the job's output", await w.chain.call(w.owner, "submit_attested", { output: { trader: vega.account, epoch: e0, pnl_e6: out.pnl_e6, head: out.head, job_sha256: hash } }, near("0.005")));
    const ep = (await w.chain.view<EpochRec[]>("get_epochs", { account: vega.account, from: e0, limit: 1 }))[0];
    must(ep.attested?.kind === "SimulatedLocal", "the contract labels it: SIMULATED, a local run with no enclave", String(ep.attested?.kind));
  } catch (err) {
    say(`   (skipped: wasmtime isn't installed here: ${String(err).slice(0, 80)})`);
  }
}
if (TESTNET) {
  say("\n== The price table can read near-borrowed-oracle: MPC-proven Chainlink rounds, on testnet. ==");
  const imp = record("import_round: a real cross-contract read of the proven round", await w.chain.call(w.owner, "import_round", { feed: 3 }, near("0.003")));
  const rr = await w.chain.view<any[]>("get_rounds", { feed: 3, from: 0, limit: 5 });
  must(imp.ok && rr.length >= 1, "the round is in the table, labeled by its feed", JSON.stringify(rr[rr.length - 1]));
}

const final = await w.chain.view<any>("solvency");
must(BigInt(final.slack) >= 0n, "the contract can pay everything it owes", `obligations ${nearStr(final.obligations)}, slack ${nearStr(final.slack)}`);
say("\n== What it cost, measured on this chain ==");
for (const s of steps.filter((x) => x.tgas)) say(`   ${(s.tgas ?? 0).toFixed(2).padStart(7)} Tgas  ${s.what}`);

const out = {
  chain: TESTNET ? "testnet" : "sandbox", contract: w.contract, at: new Date().toISOString(), epoch: e0,
  traders: { vega: vega.account, lucky: lucky.account, mallory: mallory.account }, buyer, tokens: { vega: tokenId, lucky: Number(b2.value), mallory: Number(b3.value) },
  steps,
};
writeFileSync(new URL(TESTNET ? "../docs/demo/testnet-run.json" : "../docs/research/gas-sandbox.json", import.meta.url), JSON.stringify(out, null, 1));
w.stop();
say(failures.length ? `\nFAILED:\n  ${failures.join("\n  ")}` : `\nThe whole moment ran. ${steps.length} transactions, every one above.`);
process.exit(failures.length ? 1 : 0);
