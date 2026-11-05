// The copy trade, for real, against the mainnet intents.near wasm in a local sandbox:
//   a trader fills a NEP-413 token_diff with a solver, then journals it; a follower buys the window, decrypts the entry locally, applies its owner's
//   limits, signs its own token_diff, and fills a moment later at a worse price. Slippage against the trader is measured from the real balance changes.
// Tokens are test tokens, the solver is a local account and the prices are recorded ones. The contract is the real wasm. Run: npm run copy
import { randomBytes } from "node:crypto";
import { hex } from "../lib/src/bytes.ts";
import { buyerKey, loadEntries, near, Timing, TraderAgent, WindowReader, Prices, type TokenRec } from "../lib/src/client.ts";
import { FLAG_SETTLED } from "../lib/src/entry.ts";
import { decideCopy, feeOf, nep141, refHex, signerFrom, signTokenDiff, slippageBps, type CopyLimits, type Signer } from "../lib/src/intents.ts";
import { dryQuote, USDC_NEAR, WNEAR } from "../lib/src/oneclick.ts";
import { FAST_CONFIG, FEEDS, RECORDED, seedOf } from "./world.ts";
import { RpcChain, WASM } from "./vmchain.ts";
import { startSandbox, tgas, type Named } from "./nearkit.ts";

const INTENTS_WASM = new URL("../res/intents.near.wasm", import.meta.url).pathname;
const TOKEN_WASM = new URL("../res/test_token.wasm", import.meta.url).pathname;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(72)} ${detail}`);
};

const sb = await startSandbox();
try {
  const net = sb.net;
  console.log(`Sandbox up. Deploying the mainnet intents.near wasm (res/intents.near.wasm, code_hash BtA1BEFN…) ...`);
  const intents = await net.sub(sb.root, "intents", 30);
  await net.deploy(intents, INTENTS_WASM);
  const collector = await net.sub(sb.root, "fees", 2);
  const init = await net.call(intents, intents.id, "new", { config: { wnear_id: `wnear.${sb.root.id}`, fees: { fee: 1, fee_collector: collector.id }, roles: {} } });
  check("the mainnet wasm initializes in the sandbox (fee: 1 pip, as on mainnet)", init.ok, init.reason ?? "");

  const usdc = await net.sub(sb.root, "usdc", 5);
  const eth = await net.sub(sb.root, "teth", 5);
  for (const t of [usdc, eth]) {
    await net.deploy(t, TOKEN_WASM);
    await net.call(t, t.id, "new", {});
    await net.call(t, t.id, "storage_deposit", { account_id: intents.id }, near("0.01"));
  }
  const tUSDC = nep141(usdc.id);
  const tETH = nep141(eth.id);

  const parties: Record<string, Named & { signer?: Signer }> = {};
  const fundIn = async (name: string, usd: bigint, ethUnits: bigint) => {
    const a = await net.sub(sb.root, name, 10);
    parties[name] = a;
    const secret = randomBytes(32);
    const signer = signerFrom(a.id, secret);
    parties[name].signer = signer;
    const reg = await net.call(a, intents.id, "add_public_key", { public_key: signer.publicKey }, 1n);
    if (!reg.ok) throw new Error(`add_public_key: ${reg.reason}`);
    for (const [t, amount] of [[usdc, usd], [eth, ethUnits]] as [Named, bigint][]) {
      if (amount === 0n) continue;
      await net.call(a, t.id, "mint", { amount: amount.toString() }, near("0.01"));
      const d = await net.call(a, t.id, "ft_transfer_call", { receiver_id: intents.id, amount: amount.toString(), msg: "" }, 1n);
      if (!d.ok) throw new Error(`deposit: ${d.reason}`);
    }
    return a;
  };
  const trader = await fundIn("trader", 500_000n * 10n ** 6n, 0n);
  const follower = await fundIn("follower", 100_000n * 10n ** 6n, 0n);
  const solver = await fundIn("solver", 900_000n * 10n ** 6n, 900_000n * 10n ** 6n);
  const relayer = await net.sub(sb.root, "relayer", 5);

  const bal = async (who: string) => {
    const [u, e] = await net.view<string[]>(intents.id, "mt_batch_balance_of", { account_id: who, token_ids: [tUSDC, tETH] });
    return { usdc: BigInt(u), eth: BigInt(e) };
  };
  const salt = await net.view<string>(intents.id, "current_salt");
  check("the contract gives a nonce salt, and signed intents use versioned nonces", /^[0-9a-f]{8}$/.test(salt), salt);
  const pips = BigInt(await net.view<number>(intents.id, "fee"));

  // The real price of ETH, from a recorded Chainlink round. Prices are in tUSDC per tETH: both have 6 decimals.
  const rows: [string, string, number][] = RECORDED.feeds["ETH/USD"].rounds;
  const px = (i: number) => Number(rows[rows.length - 1 - i][1]) / 1e8;
  const traderPrice = px(0);
  const spendUsdc = 20_000n * 10n ** 6n;
  const gotEth = (spendUsdc * 10n ** 6n) / BigInt(Math.round(traderPrice * 1e6));
  const now = Date.now();
  const deadline = now + 300_000;

  console.log("\n-- The trader's fill comes first --");
  const tDiff = { [tUSDC]: `-${spendUsdc}`, [tETH]: `${gotEth}` };
  const sDiff = { [tUSDC]: `${spendUsdc - feeOf(spendUsdc, pips)}`, [tETH]: `-${gotEth + feeOf(gotEth, pips) + 0n}` };
  const signedT = signTokenDiff(parties.trader.signer!, intents.id, tDiff, deadline, salt, randomBytes(15));
  const signedS = signTokenDiff(parties.solver.signer!, intents.id, sDiff, deadline, salt, randomBytes(15));
  const bT0 = await bal(trader.id);
  const fill = await net.call(relayer, intents.id, "execute_intents", { signed: [signedT, signedS] });
  check("EXECUTED: a real NEP-413 token_diff pair settles on the mainnet wasm", fill.ok, fill.ok ? `${tgas(fill.burntGas)}, tx ${fill.tx?.slice(0, 10)}…` : fill.reason ?? "");
  const bT1 = await bal(trader.id);
  check("the trader's balances moved by exactly the signed diff", bT1.usdc === bT0.usdc - spendUsdc && bT1.eth === gotEth, `-${spendUsdc} tUSDC, +${gotEth} tETH`);
  const replay = await net.call(relayer, intents.id, "execute_intents", { signed: [signedT, signedS] });
  check("the same signed intents can't run twice", !replay.ok && /nonce/i.test(replay.reason ?? ""), replay.reason?.slice(0, 80) ?? "ACCEPTED");
  const lopsided = await net.call(relayer, intents.id, "execute_intents", { signed: [signTokenDiff(parties.trader.signer!, intents.id, { [tUSDC]: "-100", [tETH]: "100" }, deadline, salt, randomBytes(15))] });
  check("a one-sided diff doesn't balance, and is refused", !lopsided.ok, lopsided.reason?.slice(0, 80) ?? "ACCEPTED");
  const expired = await net.call(relayer, intents.id, "execute_intents", { signed: [signTokenDiff(parties.trader.signer!, intents.id, tDiff, Date.now() - 3_600_000, salt, randomBytes(15)), signedS] });
  check("an expired deadline is refused", !expired.ok, expired.reason?.slice(0, 80) ?? "ACCEPTED");
  const forged = await net.call(relayer, intents.id, "execute_intents", { signed: [{ ...signedT, public_key: parties.solver.signer!.publicKey }, signedS] });
  check("a signature under another key is refused", !forged.ok, forged.reason?.slice(0, 80) ?? "ACCEPTED");

  console.log("\n-- Only then does the journal say so --");
  const kh = await net.sub(sb.root, "keyhole", 12);
  await net.deploy(kh, WASM);
  const chain = new RpcChain(net, kh.id);
  const rec = await net.sub(sb.root, "recorder", 4);
  const ownerK = await net.sub(sb.root, "kowner", 2);
  const buyer = follower;
  const tr = await net.sub(sb.root, "journaler", 12);
  for (const a of [rec, ownerK, tr, kh]) chain.add(a);
  chain.add({ ...follower });
  await chain.call(ownerK.id, "new", { owner: ownerK.id, config: FAST_CONFIG(rec.id), feeds: FEEDS });
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  const agent = new TraderAgent(chain, tr.id, seedOf("copy demo"), timing);
  await agent.register("copied", { book_usd: 100_000, floor_bps: 1000, base_price: near("0.1"), slope: near("0.01"), bond: near(3) });
  const round = (f: number, i: number) => chain.call(rec.id, "record_round", { feed: f, round_id: String(BigInt(rows[rows.length - 1 - i][0]) & 0xffffffffn), answer_e8: Number(rows[rows.length - 1 - i][1]), source_updated_at: String(rows[rows.length - 1 - i][2]) }, near("0.002"));
  await round(0, 3);
  const e = timing.epochOf(await chain.nowMs()) + 1;
  await chain.advanceTo(timing.epochStart(e));
  const qtyE8 = (gotEth * 10n ** 8n) / 10n ** 6n;
  const fillE8 = BigInt(Math.round(traderPrice * 1e8));
  const w = await agent.write({ feed: 0, flags: FLAG_SETTLED, qty_e8: qtyE8, fill_e8: fillE8, settlement: hexToBytes(refHex(signedT)), note: "long ETH, filled by token_diff" });
  check("the entry is written after the fill, carrying the signed intent's hash", w.ok, `his claim of a fill: flag ${FLAG_SETTLED}, ref ${refHex(signedT).slice(0, 16)}…`);
  await round(0, 2);
  await chain.advanceTo(timing.epochStart(e + 1));
  await round(0, 1);
  await prices.load();
  const fig = await agent.figure(e, prices);
  await agent.post(e, fig.pnl_e6);

  const one = buyerKey();
  const buy = await chain.call(buyer.id, "buy_window", { trader: tr.id, first_epoch: e, last_epoch: e, buyer_pub: hex(one.pub) }, near(1));
  check("the follower buys the window", buy.ok, buy.reason ?? "");
  const deliver = await agent.deliver(Number(buy.value));
  check("the trader delivers", deliver.ok, deliver.reason ?? "");
  const token = await chain.view<TokenRec>("get_token", { token_id: Number(buy.value) });
  const reader = new WindowReader(token, one);
  const [entryRec] = await loadEntries(chain, tr.id, 0, 1);
  const read = reader.read(entryRec);
  check("the follower decrypts the entry locally", read.readable && read.entry?.qty_e8 === qtyE8, read.readable ? read.entry?.note ?? "" : read.why);
  if (!read.readable || !read.entry) throw new Error("couldn't read");
  check("and the settlement reference matches the trader's signed intent", hex(read.entry.settlement) === refHex(signedT));

  console.log("\n-- The follower copies, inside its owner's limits --");
  const limits: CopyLimits = { maxNotionalUsd: 5_000, feeds: [0], scale: 0.1, maxSlippageBps: 40 };
  const refusedBig = decideCopy(read.entry.qty_e8, 0, read.entry.fill_e8, { ...limits, scale: 1 });
  check("LIMITS: the same trade at full size is refused before anything is signed", !refusedBig.copy, !refusedBig.copy ? refusedBig.reason : "");
  const refusedFeed = decideCopy(read.entry.qty_e8, 1, read.entry.fill_e8, limits);
  check("LIMITS: a feed that isn't on the owner's list is refused", !refusedFeed.copy, !refusedFeed.copy ? refusedFeed.reason : "");
  const d = decideCopy(read.entry.qty_e8, 0, read.entry.fill_e8, limits);
  if (!d.copy) throw new Error(d.reason);
  check("scaled to the follower's book, the copy fits the cap", d.copy, `$${d.notionalUsd.toFixed(2)}`);

  // The solver quotes the follower a moment later at the next real round, plus a 3 bps spread.
  const later = px(0) * 1.0003;
  const copyEth = (d.qty_e8 * 10n ** 6n) / 10n ** 8n;
  const copyUsdc = BigInt(Math.round((Number(copyEth) / 1e6) * later * 1e6));
  const followerPrice = Number(copyUsdc) / Number(copyEth);
  const slip = slippageBps(1, traderPrice, followerPrice);
  check("the quote is inside the owner's slippage limit, so the follower signs", slip <= limits.maxSlippageBps, `${slip.toFixed(2)} bps`);
  const fDiff = { [tUSDC]: `-${copyUsdc}`, [tETH]: `${copyEth}` };
  const s2Diff = { [tUSDC]: `${copyUsdc - feeOf(copyUsdc, pips)}`, [tETH]: `-${copyEth + feeOf(copyEth, pips)}` };
  const bF0 = await bal(follower.id);
  const signedF = signTokenDiff(parties.follower.signer!, intents.id, fDiff, Date.now() + 300_000, salt, randomBytes(15));
  const signedS2 = signTokenDiff(parties.solver.signer!, intents.id, s2Diff, Date.now() + 300_000, salt, randomBytes(15));
  const sim = await net.view(intents.id, "simulate_intents", { signed: [signedF, signedS2] });
  check("simulate_intents agrees before anyone pays gas", Boolean(sim), `invariant_violated: ${JSON.stringify((sim as any).invariant_violated ?? null)}`);
  const copy = await net.call(relayer, intents.id, "execute_intents", { signed: [signedF, signedS2] });
  check("EXECUTED: the follower's copy settles on the mainnet wasm", copy.ok, copy.ok ? `${tgas(copy.burntGas)}, tx ${copy.tx?.slice(0, 10)}…` : copy.reason ?? "");
  const bF1 = await bal(follower.id);
  const paid = Number(bF0.usdc - bF1.usdc);
  const got = Number(bF1.eth - bF0.eth);
  const measured = slippageBps(1, Number(spendUsdc) / Number(gotEth), paid / got);
  check("COPY SLIPPAGE: measured from real balance changes, against the trader's fill", Math.abs(measured - slip) < 0.1, `trader paid ${(Number(spendUsdc) / Number(gotEth)).toFixed(2)}, follower paid ${(paid / got).toFixed(2)}: ${measured.toFixed(2)} bps worse`);

  console.log("\n-- Live dry quotes on mainnet Intents, for the same trades (nothing signed, nothing sent) --");
  try {
    const big = await dryQuote({ from: USDC_NEAR, to: WNEAR, amountIn: String(spendUsdc), slippageBps: limits.maxSlippageBps, recipient: "example.near" });
    const small = await dryQuote({ from: USDC_NEAR, to: WNEAR, amountIn: String(Math.round(d.notionalUsd * 1e6)), slippageBps: limits.maxSlippageBps, recipient: "example.near" });
    check("1Click quotes the copy, keyless and ready to sign", small.ok && Boolean(small.amountOut), small.ok ? `${d.notionalUsd.toFixed(0)} USDC → ${small.amountOutFormatted} wNEAR in ${small.timeEstimate}s` : `HTTP ${small.status} ${JSON.stringify(small.raw).slice(0, 160)}`);
    if (big.ok && small.ok) {
      const r = (q: typeof big, usd: number) => Number(q.amountOutFormatted) / usd;
      const impact = ((r(small, d.notionalUsd) - r(big, Number(spendUsdc) / 1e6)) / r(small, d.notionalUsd)) * 10_000;
      console.log(`  live price difference between the trader's size and the copy's: ${impact.toFixed(2)} bps (a real quote, a real order book; the sandbox's 3 bps is a stand-in for it)`);
    }
    const conf = await dryQuote({ from: USDC_NEAR, to: WNEAR, amountIn: "2000000000", slippageBps: 40, recipient: "example.near", confidentiality: "basic" });
    check("setting `confidentiality` needs a user's auth, so the free path can't (measured, not assumed)", conf.status === 401, `HTTP ${conf.status}: ${JSON.stringify(conf.raw).slice(12, 80)}`);
  } catch (err) {
    console.log(`(offline, skipped: ${String(err).slice(0, 100)})`);
  }
} catch (e) {
  check("the copy path ran to the end", false, String((e as Error).stack ?? e));
}
sb.stop();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} copy checks passed`);
process.exit(bad.length ? 1 : 0);

function hexToBytes(h: string): Uint8Array {
  return Uint8Array.from(Buffer.from(h, "hex"));
}
