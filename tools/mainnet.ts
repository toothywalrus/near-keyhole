// The owner's mainnet steps, prepared and guarded. NOTHING HERE HAS BEEN RUN ON MAINNET. No mainnet transaction is sent unless CONFIRM_MAINNET=1 is set,
// and every key is the owner's own: from the OS keyring under the service `near-mainnet` (never the testnet one), or KEY_<id> in the environment.
//
//   npx tsx tools/mainnet.ts plan                      read-only: the accounts, balances and keys it would use, and what each step sends. Any time.
//   CONFIRM_MAINNET=1 npx tsx tools/mainnet.ts deploy  create app., recorder., treasury., trader. and buyer.<root>; deploy, `new` and lock app.<root> in ONE
//                                                      transaction (docs/decisions/0017). About 5.5 NEAR, most of it the contract's storage.
//   CONFIRM_MAINNET=1 npx tsx tools/mainnet.ts sale    one real window sale, in steps: run it again when it says to come back (about 3 hours in all). The trader
//                                                      bonds 1 NEAR and writes one entry; real Chainlink rounds are recorded; he posts the figure; the buyer pays
//                                                      0.01 NEAR into escrow; he delivers; after the challenge window the sale settles, 5% to the treasury.
//   CONFIRM_MAINNET=1 npx tsx tools/mainnet.ts copy    one real copy of the trader's entry through 1Click: the follower swaps 1 USDC for the entry's asset into his
//                                                      NEAR Intents balance. Needs 1 USDC on the follower's NEAR account.
//   npx tsx tools/mainnet.ts verify                    read-only: re-reads all of it from mainnet against deployments/mainnet.json
//
// Environment: KEYHOLE_MAINNET_ROOT (required: the owner's named account, e.g. keyhole.near), KEYHOLE_MAINNET_FOLLOWER (default buyer.<root>).
// deployments/mainnet.json holds public facts only: accounts and transaction hashes.
import type { TokenRec } from "../lib/src/client.ts";
process.env.KEYCHAIN_SERVICE = "near-mainnet";
const STEP = process.argv[2] ?? "plan";
const WRITES = ["deploy", "sale", "copy"];
if (!["plan", "verify", ...WRITES].includes(STEP)) {
  console.error("usage: npx tsx tools/mainnet.ts plan | deploy | sale | copy | verify");
  process.exit(2);
}
if (WRITES.includes(STEP) && process.env.CONFIRM_MAINNET !== "1") {
  console.error(`refused: \`${STEP}\` sends real mainnet transactions with the owner's keys and money. It's the owner's step: run \`npx tsx tools/mainnet.ts plan\` first, then CONFIRM_MAINNET=1 npx tsx tools/mainnet.ts ${STEP}`);
  process.exit(2);
}
const ROOT = process.env.KEYHOLE_MAINNET_ROOT;
if (!ROOT || !ROOT.endsWith(".near") || ROOT.split(".").length !== 2) {
  console.error("refused: set KEYHOLE_MAINNET_ROOT to the owner's named mainnet account, like keyhole.near");
  process.exit(2);
}

const { existsSync, mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
const { createHash, randomBytes } = await import("node:crypto");
const { base58 } = await import("@scure/base");
const { BACKEND, DURABLE, hasKey, keyFor, saveKey } = await import("./keys.ts");
const { Net, txOutcome } = await import("./nearkit.ts");
const { RpcChain, WASM } = await import("./vmchain.ts");
const { deployLocked, ensure } = await import("./testnet.ts");
const { CHAINLINK, MAINNET_CONFIG, MAINNET_RPC } = await import("./mainnet-config.ts");
const { buyerKey, near, NO_SETTLEMENT, Prices, Timing, TraderAgent } = await import("../lib/src/client.ts");
const { hex } = await import("../lib/src/bytes.ts");
const { ONECLICK, USDC_NEAR } = await import("../lib/src/oneclick.ts");

const ids = { app: `app.${ROOT}`, recorder: `recorder.${ROOT}`, treasury: `treasury.${ROOT}`, trader: `trader.${ROOT}`, buyer: `buyer.${ROOT}` };
const follower = process.env.KEYHOLE_MAINNET_FOLLOWER ?? ids.buyer;
const RECORD = new URL("../deployments/mainnet.json", import.meta.url);
type Rec = { contract?: string; deploy_tx?: string; at?: string; steps: { what: string; tx?: string; signer?: string; at: string }[]; token?: number; epoch?: number; priced?: boolean; copy?: Record<string, unknown> };
const rec: Rec = existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : { steps: [] };
const save = () => {
  mkdirSync(new URL("../deployments/", import.meta.url), { recursive: true });
  writeFileSync(RECORD, JSON.stringify(rec, null, 1) + "\n");
};
const net = new Net(MAINNET_RPC);
const EXPLORER = "https://nearblocks.io/txns/";
const nearOf = async (id: string) => (await net.exists(id)) ? `${(Number(await net.balance(id)) / 1e24).toFixed(3)} NEAR` : "doesn't exist";

if (STEP === "plan") {
  console.log(`Mainnet plan for ${ROOT}. Nothing is sent. Keys: ${BACKEND} (service near-mainnet)${DURABLE ? "" : ": NOT a durable keyring, so deploy would refuse"}.\n`);
  console.log(`  ${ROOT}: ${await nearOf(ROOT)}; key ${hasKey(ROOT) ? "present" : "MISSING: store it with secret-tool or the keychain, service near-mainnet"}`);
  for (const [role, id] of Object.entries(ids)) console.log(`  ${role.padEnd(9)} ${id}: ${await nearOf(id)}`);
  const wasm = readFileSync(WASM);
  console.log(`\n  res/keyhole.wasm: ${wasm.length} bytes, code hash ${base58.encode(createHash("sha256").update(wasm).digest())} (testnet's locked deployment has the same)`);
  console.log(`  config: ${JSON.stringify(MAINNET_CONFIG(ids.recorder, ids.treasury))}`);
  console.log(`
  deploy: create recorder. (0.2), treasury. (0.05), trader. (1.3), buyer. (0.2) and app. (4.7 NEAR) under ${ROOT}; then one transaction from app.:
          DeployContract(res/keyhole.wasm) + FunctionCall new(owner ${ROOT}, the config above, feeds ETH/BTC/SOL Recorded) + DeleteKey(its only key).
  sale:   trader registers (1 NEAR bond); the recorder records Chainlink's latest ETH/BTC/SOL rounds; the trader writes one entry; rounds again;
          after the epoch ends, rounds and the figure; the buyer buys that epoch (0.01 NEAR + storage); the trader delivers; after the challenge
          window anyone settles: 95% to the trader, 5% to treasury.${ROOT}.
  copy:   a 1Click quote (dry: false) for 1 USDC of the follower's (${follower}) into the entry's asset, held in his NEAR Intents balance;
          an ft_transfer of 1 USDC to the quote's deposit address; then 1Click's status until it settles.
  verify: read-only, against deployments/mainnet.json.`);
  process.exit(0);
}

if (STEP === "verify") {
  if (!rec.contract) throw new Error("no deployments/mainnet.json yet: deploy first");
  const acct = await net.provider.viewAccount({ accountId: rec.contract });
  const local = base58.encode(createHash("sha256").update(readFileSync(WASM)).digest());
  const keys = ((await net.provider.viewAccessKeyList({ accountId: rec.contract } as never)) as unknown as { keys: unknown[] }).keys;
  const cfg = await net.view(rec.contract, "get_config");
  const rows: [string, boolean, string][] = [
    ["the code on mainnet is res/keyhole.wasm", acct.code_hash === local, acct.code_hash],
    ["locked: no key on the contract account", keys.length === 0, `${keys.length} keys`],
    ["5% fee to the treasury", cfg.fee_bps === 500 && cfg.treasury === ids.treasury, `${cfg.fee_bps} bps to ${cfg.treasury}`],
  ];
  if (rec.token) {
    const k: TokenRec = await net.view(rec.contract, "get_token", { token_id: rec.token });
    rows.push(["the real sale settled in the trader's favour", k.state === "Closed", `token ${rec.token}: ${k.state}`]);
  }
  for (const s of rec.steps.filter((x) => x.tx)) {
    const o = await txOutcome(s.tx!, s.signer ?? ROOT, [process.env.NEAR_MAINNET_ARCHIVAL_RPC ?? "https://archival-rpc.mainnet.fastnear.com"]);
    rows.push([`on chain: ${s.what}`, o.found && o.ok, EXPLORER + s.tx]);
  }
  for (const [name, ok, detail] of rows) console.log(`${ok ? "✓" : "✗"} ${name.padEnd(56)} ${detail}`);
  console.log(`\n${rows.filter((r) => r[1]).length}/${rows.length} mainnet checks passed`);
  process.exit(rows.every((r) => r[1]) ? 0 : 1);
}

if (!DURABLE) throw new Error(`refused: no durable keyring (${BACKEND}); a new mainnet account's key would be lost`);
const root = net.named(ROOT, keyFor(ROOT));
const step = (what: string, tx?: string, signer?: string) => {
  rec.steps.push({ what, tx, signer, at: new Date().toISOString() });
  save();
  console.log(`✓ ${what}${tx ? `  ${EXPLORER}${tx}` : ""}`);
};

if (STEP === "deploy") {
  if (rec.contract) throw new Error(`refused: deployments/mainnet.json already names ${rec.contract}`);
  for (const [name, amount] of [["recorder", 0.2], ["treasury", 0.05], ["trader", 1.3], ["buyer", 0.2]] as const) await ensure(net, root, name, amount);
  const tx = await deployLocked(net, root, ids.app, { owner: ROOT, config: MAINNET_CONFIG(ids.recorder, ids.treasury), feeds: CHAINLINK.map((f) => ({ symbol: f.symbol, source: "Recorded" })) });
  Object.assign(rec, { contract: ids.app, deploy_tx: tx, at: new Date().toISOString() });
  step(`deploy + new + lock ${ids.app}`, tx, ids.app);
  process.exit(0);
}

const chain = new RpcChain(net, rec.contract ?? ids.app);
chain.defaultTgas = 100n;
for (const id of [ids.recorder, ids.trader, ids.buyer, ids.treasury]) if (hasKey(id)) chain.add(net.named(id, keyFor(id)));

/** The latest Chainlink round of each feed, read from Ethereum mainnet (eth_call, no key), recorded by the recorder. */
async function recordRounds(): Promise<void> {
  for (let f = 0; f < CHAINLINK.length; f++) {
    const r = await fetch(process.env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: CHAINLINK[f].proxy, data: "0xfeaf968c" }, "latest"] }) });
    const out = ((await r.json()) as { result: string }).result;
    const word = (i: number) => BigInt("0x" + out.slice(2 + i * 64, 2 + (i + 1) * 64));
    const o = await chain.call(ids.recorder, "record_round", { feed: f, round_id: String(word(0) & 0xffffffffffffn), answer_e8: Number(word(1)), source_updated_at: String(word(3)) }, near("0.002"));
    if (!o.ok) throw new Error(`record_round ${CHAINLINK[f].symbol}: ${o.reason}`);
    step(`recorder records ${CHAINLINK[f].symbol} at ${(Number(word(1)) / 1e8).toFixed(2)}`, o.tx, ids.recorder);
  }
}

/** The trader's tree seed: 32 random bytes made once, kept in the keyring beside his key, never printed. */
function treeSeed(): Uint8Array {
  const id = `keyhole-tree-seed:${ids.trader}`;
  if (!hasKey(id)) saveKey(id, hex(randomBytes(32)));
  return Uint8Array.from(Buffer.from(keyFor(id), "hex"));
}

if (STEP === "sale") {
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  const t = new TraderAgent(chain, ids.trader, treeSeed(), timing);
  const clock = await chain.view<{ epoch: number; now_ms: string }>("clock");
  const me = await chain.view("get_trader", { account: ids.trader }).catch(() => null);
  const later = (ms: number, why: string) => {
    console.log(`\nCome back after ${new Date(ms).toISOString()} (${Math.ceil((ms - Date.now()) / 60_000)} min): ${why}. Then run the same command again.`);
    process.exit(0);
  };
  if (!me) {
    const r = await t.register("keyhole-mainnet", { book_usd: 1000, floor_bps: 1000, base_price: near("0.01"), slope: 0n, bond: near(1) });
    if (!r.ok) throw new Error(`register: ${r.reason}`);
    step("trader registers: a 1 NEAR bond and a root committing to his key tree", r.tx, ids.trader);
  }
  if (rec.epoch === undefined) {
    await recordRounds();
    await prices.load();
    const eth = prices.rounds[0][prices.rounds[0].length - 1].answer_e8;
    const w = await t.write({ feed: 0, flags: 0, qty_e8: 10_000_000n, fill_e8: BigInt(eth), settlement: NO_SETTLEMENT, note: "long 0.1 ETH: the mainnet sale's one entry" });
    if (!w.ok) throw new Error(`write: ${w.reason}`);
    rec.epoch = clock.epoch;
    step(`trader writes one entry in epoch ${clock.epoch}`, w.tx, ids.trader);
    later(Date.now() + 6 * 60_000, "a round recorded after the entry prices it. Come back within 45 minutes, or the entry is void (max_round_gap_secs)");
  }
  const epoch = rec.epoch!;
  const posted = (await chain.view<{ posted_e6: string | null }[]>("get_epochs", { account: ids.trader, from: epoch, limit: 1 }))[0]?.posted_e6;
  if (!rec.priced) {
    await recordRounds();
    rec.priced = true;
    save();
  }
  if (posted == null) {
    if (Date.now() < timing.epochStart(epoch + 1) + 60_000) later(timing.epochStart(epoch + 1) + 60_000, `epoch ${epoch} ends`);
    await recordRounds();
    await prices.load();
    const f = await t.figure(epoch, prices);
    const p = await t.post(epoch, f.pnl_e6);
    if (!p.ok) throw new Error(`post: ${p.reason}`);
    step(`trader posts epoch ${epoch}: $${(Number(f.pnl_e6) / 1e6).toFixed(2)}`, p.tx, ids.trader);
  }
  if (rec.token === undefined) {
    const q = await chain.view<string>("quote", { trader: ids.trader, first_epoch: epoch, last_epoch: epoch });
    const one = buyerKey();
    saveKey(`keyhole-one-time:${ids.buyer}:${epoch}`, hex(one.secret));
    const b = await chain.call(ids.buyer, "buy_window", { trader: ids.trader, first_epoch: epoch, last_epoch: epoch, buyer_pub: hex(one.pub) }, BigInt(q) + near("0.01"));
    if (!b.ok) throw new Error(`buy_window: ${b.reason}`);
    rec.token = Number(b.value);
    step(`buyer buys epoch ${epoch}, a NEP-171 token: ${Number(BigInt(q)) / 1e24} NEAR into escrow`, b.tx, ids.buyer);
    const d = await t.deliver(rec.token);
    if (!d.ok) throw new Error(`deliver: ${d.reason}`);
    step("trader delivers: the window's nodes, wrapped to the buyer's one-time key", d.tx, ids.trader);
  }
  const k = await chain.view<TokenRec>("get_token", { token_id: rec.token });
  if (k.state === "Delivered") {
    if (Date.now() < Number(k.settle_at_ms) + 5_000) later(Number(k.settle_at_ms) + 5_000, "the challenge window closes");
    const s = await chain.call(ids.buyer, "settle", { token_id: rec.token });
    if (!s.ok || s.value !== "closed") throw new Error(`settle: ${s.reason ?? s.value}`);
    step("settle: 95% of the price to the trader, 5% to the treasury", s.tx, ids.buyer);
  }
  console.log("\nThe mainnet sale is complete. `npx tsx tools/mainnet.ts verify` re-reads it.");
  process.exit(0);
}

if (STEP === "copy") {
  if (rec.copy) throw new Error("refused: deployments/mainnet.json already has a copy");
  const f = net.named(follower, keyFor(follower));
  const tokens = (await (await fetch(`${ONECLICK}/tokens`)).json()) as { assetId: string; symbol: string; blockchain: string }[];
  const asset = tokens.find((x) => x.symbol === "ETH" && x.blockchain === "eth")?.assetId;
  if (!asset) throw new Error("1Click lists no ETH asset");
  const body = {
    dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC_NEAR, destinationAsset: asset, amount: "1000000",
    depositType: "ORIGIN_CHAIN", refundTo: follower, refundType: "ORIGIN_CHAIN", recipient: follower, recipientType: "INTENTS",
    deadline: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
  const q = (await (await fetch(`${ONECLICK}/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json()) as any;
  const deposit = q?.quote?.depositAddress;
  if (!deposit) throw new Error(`1Click gave no deposit address: ${JSON.stringify(q).slice(0, 200)}`);
  console.log(`quote: 1 USDC -> ${q.quote.amountOutFormatted} ETH into ${follower}'s NEAR Intents balance; deposit to ${deposit}`);
  const usdc = USDC_NEAR.replace("nep141:", "");
  await f.account.callFunctionRaw({ contractId: usdc, methodName: "storage_deposit", args: { account_id: deposit, registration_only: true }, deposit: near("0.00125"), gas: 30n * 10n ** 12n, waitUntil: "FINAL" }).catch(() => null);
  const r = await f.account.callFunctionRaw({ contractId: usdc, methodName: "ft_transfer", args: { receiver_id: deposit, amount: "1000000" }, deposit: 1n, gas: 30n * 10n ** 12n, waitUntil: "FINAL" });
  const out = net.outcome(r);
  if (!out.ok) throw new Error(`ft_transfer: ${out.reason}`);
  rec.copy = { deposit_address: deposit, quote: q.quote, asset };
  step("copy: the follower sends 1 USDC to 1Click's deposit address", out.tx, follower);
  for (let i = 0; i < 60; i++) {
    const s = (await (await fetch(`${ONECLICK}/status?depositAddress=${deposit}`)).json()) as any;
    console.log(`  1Click status: ${s.status}`);
    if (["SUCCESS", "REFUNDED", "FAILED"].includes(s.status)) {
      rec.copy = { ...rec.copy, status: s.status, swap: s.swapDetails ?? null };
      save();
      break;
    }
    await new Promise((ok) => setTimeout(ok, 10_000));
  }
  process.exit(0);
}
