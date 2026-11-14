// The PnL job in OutLayer's real TEE, on testnet. No sign-up, no API key: every step is a NEAR transaction paid in testnet NEAR, or a public read of
// OutLayer's API. Run: npx tsx tools/outlayer.ts (needs the deployment's root key in the keyring, like `npm run demo -- --testnet`).
//
//  1. FastFS: res/keyhole_pnl_job.wasm (one transaction to outlayer.testnet, which fails by design: the indexer reads its arguments) is then served at
//     https://test.fastfs.io/<uploader>/outlayer.testnet/<sha256>.wasm. The worker refuses bytes whose sha256 isn't the one pinned.
//  2. The contract's owner points it at outlayer.testnet, pinned to that sha256 (`set_outlayer`).
//  3. A new trader, with a random tree seed kept in the keyring, registers, writes, and posts his epoch's figure.
//  4. That epoch's nodes become an OutLayer secret: encrypted here to the keystore's key (OutLayer's ECIES v1: X25519, HKDF-SHA256, ChaCha20-Poly1305), stored
//     on chain bound to the job's sha256, and usable only when this contract is the caller (a Predecessor whitelist).
//  5. He calls `request_attested`: the contract calls `request_execution` and yields; an OutLayer worker in Intel TDX runs the job, which reads the journal
//     over HTTP and opens the epoch with the secret; the callback, from outlayer.testnet itself, writes the figure labeled `OutLayerTee`.
//  6. The attestation (TDX quote; wasm, input and output hashes) is fetched from OutLayer's API into docs/research/, and docs/demo/testnet-run.json gains an
//     `outlayer` block that `npm run verify` checks.
import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { actions } from "near-api-js";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { hex, utf8 } from "../lib/src/bytes.ts";
import { DEPTH, near, NO_SETTLEMENT, TraderAgent, type EpochRec } from "../lib/src/client.ts";
import { cover } from "../lib/src/ggm.ts";
import { hasKey, keyFor, saveKey } from "./keys.ts";
import { CONTRACT, RPC, testnetWorld } from "./testnet.ts";

const OUTLAYER = "outlayer.testnet";
/** --direct: the trader signs `request_execution` himself, the same request the contract makes. For a deployment whose contract can't make it (see below). */
const DIRECT = process.argv.includes("--direct");
/** --fetch-attestation: the run is done (its transaction is in testnet-run.json); only fetch its attestation again. */
const FETCH_ONLY = process.argv.includes("--fetch-attestation");
const API = process.env.OUTLAYER_API ?? "https://testnet-api.outlayer.ai";
const PROFILE = "keyhole";
const JOB = new URL("../res/keyhole_pnl_job.wasm", import.meta.url);
const wasm = readFileSync(JOB);
const jobHash = createHash("sha256").update(wasm).digest("hex");
const RUN = new URL("../docs/demo/testnet-run.json", import.meta.url);
const say = (s: string) => console.log(s);
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** OutLayer's ECIES v1, as its dashboard (lib/ecies.ts) and CLI (src/crypto.rs) write it: 0x01 | ephemeral X25519 public key | nonce (12) | ciphertext and tag. */
export function eciesEncrypt(pubkeyHex: string, plaintext: Uint8Array): Uint8Array {
  const eph = x25519.utils.randomSecretKey();
  const shared = x25519.getSharedSecret(eph, Uint8Array.from(Buffer.from(pubkeyHex, "hex")));
  const key = hkdf(nobleSha256, shared, undefined, utf8("outlayer-keystore-v1"), 32);
  const nonce = randomBytes(12);
  const sealed = chacha20poly1305(key, nonce).encrypt(plaintext);
  return Uint8Array.from([1, ...x25519.getPublicKey(eph), ...nonce, ...sealed]);
}

/** FastFS's simple-file payload, borsh: variant 0 | path | Some | mime | content. */
function fastfsPayload(path: string, mime: string, content: Uint8Array): Uint8Array {
  const str = (s: string) => {
    const b = utf8(s);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(b.length);
    return [...len, ...b];
  };
  const len = Buffer.alloc(4);
  len.writeUInt32LE(content.length);
  return Uint8Array.from([0, ...str(path), 1, ...str(mime), ...len, ...content]);
}

const w = await testnetWorld();
const net = w.net;
const run = JSON.parse(readFileSync(RUN, "utf8"));
if (run.contract !== CONTRACT) throw new Error(`docs/demo/testnet-run.json is for ${run.contract}, not ${CONTRACT}: run the demo on this deployment first`);
const owner = net.named(w.owner, keyFor(w.owner));
say(`OutLayer on testnet for ${CONTRACT}. The job: res/keyhole_pnl_job.wasm, sha256 ${jobHash}\n`);

// 1. The wasm, on FastFS.
const url = `https://test.fastfs.io/${owner.id}/${OUTLAYER}/${jobHash}.wasm`;
const served = async () => {
  const r = await fetch(url).catch(() => null);
  return r?.ok ? createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex") === jobHash : false;
};
let uploadTx: string | undefined = run.outlayer?.upload_tx;
if (!(await served())) {
  const r = await owner.account.signAndSendTransaction({ receiverId: OUTLAYER, actions: [actions.functionCall("__fastdata_fastfs", fastfsPayload(`${jobHash}.wasm`, "application/wasm", wasm), 1n, 0n)], waitUntil: "FINAL" as never, throwOnFailure: false });
  uploadTx = (r as any).transaction.hash;
  say(`✓ uploaded ${wasm.length} bytes to FastFS (the transaction fails by design: gas 1, the indexer reads its arguments): https://testnet.nearblocks.io/txns/${uploadTx}`);
  for (let i = 0; i < 40 && !(await served()); i++) await sleep(15_000);
}
if (!(await served())) throw new Error(`${url} isn't serving the job's bytes`);
say(`✓ ${url} serves the job, and its sha256 matches`);

// 2. The contract, pointed at OutLayer.
const cfg = { contract: OUTLAYER, rpc: RPC, wasm_url: url, wasm_hash: jobHash, max_instructions: "10000000000", max_execution_seconds: "60" };
const have = await w.chain.view("get_outlayer");
if (have?.wasm_hash !== jobHash || have?.contract !== OUTLAYER) {
  const r = await w.chain.call(w.owner, "set_outlayer", { outlayer: cfg });
  if (!r.ok) throw new Error(`set_outlayer: ${r.reason}`);
  say(`✓ the owner points the contract at ${OUTLAYER}, pinned to the job's sha256: https://testnet.nearblocks.io/txns/${r.tx}`);
}

// 3. A trader with a figure and no buyers.
const name = run.outlayer?.trader?.split(".")[0] ?? `oli${(Date.now() % 100000).toString(36)}`;
const seedId = `keyhole-tree-seed:${name}.${w.root.id}`;
if (!hasKey(seedId)) saveKey(seedId, hex(randomBytes(32)));
const account = await w.fund(name, near("0.75"));
const t = new TraderAgent(w.chain, account, Uint8Array.from(Buffer.from(keyFor(seedId), "hex")), w.timing);
let epoch: number = run.outlayer?.epoch;
if (epoch === undefined) {
  const reg = await t.register(name, { book_usd: 100_000, floor_bps: 1000, base_price: near("0.01"), slope: 0n, bond: near("0.35") });
  if (!reg.ok) throw new Error(`register: ${reg.reason}`);
  say(`✓ ${account} registers, with a tree seed nobody else holds`);
  await w.rounds();
  epoch = w.timing.epochOf(await w.chain.nowMs()) + 1;
  await w.chain.advanceTo(w.timing.epochStart(epoch));
  for (const [feed, qty, note] of [[0, 2, "long ETH"], [1, -0.05, "short BTC"]] as const) {
    const r = await t.write({ feed, flags: 0, qty_e8: BigInt(Math.round(qty * 1e8)), fill_e8: 1n, settlement: NO_SETTLEMENT, note });
    if (!r.ok) throw new Error(`write: ${r.reason}`);
  }
  await w.rounds();
  await w.chain.advanceTo(w.timing.epochStart(epoch + 1));
  await w.rounds();
  await w.prices.load();
  const f = await t.figure(epoch, w.prices);
  const p = await t.post(epoch, f.pnl_e6);
  if (!p.ok) throw new Error(`post: ${p.reason}`);
  say(`✓ he writes two entries in epoch ${epoch} and posts $${(Number(f.pnl_e6) / 1e6).toFixed(2)}: nobody has bought it, so nobody can check it`);
  run.outlayer = { trader: account, epoch, wasm_url: url, wasm_hash: jobHash, upload_tx: uploadTx };
  writeFileSync(RUN, JSON.stringify(run, null, 1));
}

// 4. The epoch's nodes, as an OutLayer secret. Through the contract, only a run the contract asked for can use it (a Predecessor whitelist); run directly,
//    only one the trader himself signs.
const [first, last] = w.timing.window(epoch, epoch);
const nodes = cover(first, last, DEPTH).map((n) => ({ level: n.level, index: n.index, value: hex(t.tree.node(n)) }));
const pk = (await (await fetch(`${API}/secrets/pubkey`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessor: { type: "WasmHash", hash: jobHash }, owner: account, profile: PROFILE, secrets_json: JSON.stringify({ KEYHOLE_NODES: "", KEYHOLE_JOB_SHA256: "" }) }) })).json()) as { pubkey?: string };
if (!pk.pubkey) throw new Error(`no keystore pubkey: ${JSON.stringify(pk)}`);
const sealed = Buffer.from(eciesEncrypt(pk.pubkey, utf8(JSON.stringify({ KEYHOLE_NODES: JSON.stringify(nodes), KEYHOLE_JOB_SHA256: jobHash })))).toString("base64");
const done = FETCH_ONLY ? (DIRECT ? run.outlayer?.direct : run.outlayer) : undefined;
if (FETCH_ONLY && !done?.request_tx) throw new Error("--fetch-attestation: no finished run in docs/demo/testnet-run.json");
const access = DIRECT ? { Whitelist: { accounts: [account] } } : { Predecessor: { condition: { Whitelist: { accounts: [CONTRACT] } } } };
const storeArgs = { accessor: { WasmHash: { hash: jobHash } }, profile: PROFILE, encrypted_secrets_base64: sealed, access, vault_id: null };
const cost = BigInt(await net.view(OUTLAYER, "estimate_storage_cost", { ...storeArgs, owner: account }));
const stored = done ? { ok: true, tx: done.secret_tx as string, reason: "" } : await net.call(net.named(account, keyFor(account)), OUTLAYER, "store_secrets", storeArgs, cost + near("0.005"), 50n);
if (!stored.ok) throw new Error(`store_secrets: ${stored.reason}`);
if (!done) say(`✓ the epoch's ${nodes.length} nodes are an OutLayer secret: encrypted here to the keystore's key, bound to the job's sha256, usable only ${DIRECT ? `in a run ${account} signs` : `with ${CONTRACT} as the caller`}: https://testnet.nearblocks.io/txns/${stored.tx}`);

/** A transaction's final outcome, once every receipt (the yield's callback included) has run. */
async function settled(hash: string, sender: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const j = (await (await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "FINAL" } }) })).json()) as any;
    if (j.result?.final_execution_status === "FINAL" && j.result?.status && !("Started" in j.result.status)) return j.result;
    await sleep(10_000);
  }
  throw new Error(`${hash} didn't finish`);
}
const input = JSON.stringify({ contract: CONTRACT, trader: account, epoch, rpc: RPC });
const posted = (await w.chain.view<EpochRec[]>("get_epochs", { account, from: epoch, limit: 1 }))[0].posted_e6;

// 5. The run.
let tx: string = done?.request_tx;
let figure: string | undefined = done?.figure;
let via: string = done?.via;
if (done) {
  say(`  (the run is done: https://testnet.nearblocks.io/txns/${tx})`);
} else if (DIRECT) {
  // The same request the contract makes (attest.rs), signed by the trader: OutLayer's answer comes back to his transaction instead of the contract's callback.
  const sent = await net.named(account, keyFor(account)).account.signAndSendTransaction({
    receiverId: OUTLAYER,
    actions: [actions.functionCall("request_execution", {
      source: { WasmUrl: { url, hash: jobHash, build_target: "wasm32-wasip2" } },
      resource_limits: { max_instructions: 10_000_000_000, max_memory_mb: 64, max_execution_seconds: 60 },
      input_data: input, secrets_ref: { profile: PROFILE, account_id: account }, response_format: "Json", payer_account_id: account, params: null,
    }, 300n * 10n ** 12n, near("0.01"))],
    waitUntil: "INCLUDED_FINAL" as never,
    throwOnFailure: false,
  });
  tx = (sent as any).transaction.hash;
  say(`✓ request_execution, signed by ${account}: OutLayer's worker runs the job in Intel TDX: https://testnet.nearblocks.io/txns/${tx}`);
  const out = await settled(tx, account);
  const value = out.status?.SuccessValue ? JSON.parse(Buffer.from(out.status.SuccessValue, "base64").toString()) : null;
  figure = value?.pnl_e6;
  via = `${OUTLAYER}, returned to ${account}'s transaction`;
  say(`✓ the job's output, from the enclave: ${JSON.stringify(value)}`);
} else {
  const sent = await net.named(account, keyFor(account)).account.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall("request_attested", { epoch, secrets_ref: { profile: PROFILE, account_id: account } }, 300n * 10n ** 12n, near("0.03"))],
    waitUntil: "INCLUDED_FINAL" as never,
    throwOnFailure: false,
  });
  tx = (sent as any).transaction.hash;
  say(`✓ request_attested: the contract asks ${OUTLAYER} and yields: https://testnet.nearblocks.io/txns/${tx}`);
  await settled(tx, account);
  const after = (await w.chain.view<EpochRec[]>("get_epochs", { account, from: epoch, limit: 1 }))[0];
  if (after?.attested?.kind !== "OutLayerTee") throw new Error(`no OutLayerTee figure: ${JSON.stringify(after?.attested)}; see the transaction's logs`);
  figure = after.attested.pnl_e6;
  via = after.attested.via;
  say(`✓ the figure came back from ${via}, labeled ${after.attested.kind}`);
}
const logs: string[] = ((await settled(tx, account)).receipts_outcome ?? []).flatMap((o: any) => o.outcome.logs);
// OutLayer's event carries the request as a JSON string inside JSON: its quotes are escaped.
const requestId = logs.map((l) => l.match(/\\?"request_id\\?":\s*(\d+)/)?.[1]).find(Boolean);
const equal = figure === posted;
say(`${equal ? "✓" : "✗"} JOB IN THE ENCLAVE = TRADER'S POSTED FIGURE: ${figure} (posted ${posted})`);

// 6. The attestation.
let att: any = null;
for (let i = 0; i < 24 && !att; i++) {
  const r = await fetch(requestId ? `${API}/attestations/by-request/${requestId}` : `${API}/attestations/by-tx/${tx}`);
  if (r.ok) att = await r.json();
  else await sleep(5_000);
}
const file = `docs/research/outlayer-attestation-request-${requestId}.json`;
if (att) writeFileSync(new URL(`../${file}`, import.meta.url), JSON.stringify({ fetched: new Date().toISOString(), from: `${API}/attestations/by-request/${requestId}`, path: DIRECT ? "direct: the trader signed request_execution" : "the contract's request_attested", request_tx: tx, contract: CONTRACT, trader: account, epoch, input_data: input, attestation: att }, null, 1) + "\n");
const inputOk = att?.input_hash === createHash("sha256").update(input).digest("hex");
say(att ? `✓ the attestation: wasm ${att.wasm_hash?.slice(0, 16)}… (${att.wasm_hash === jobHash ? "the job's" : "NOT the job's"}), input ${att.input_hash?.slice(0, 16)}… (${inputOk ? "sha256 of the request's input" : "NOT the input's"}), output ${att.output_hash?.slice(0, 16)}…, a ${Math.round((att.tdx_quote?.length ?? 0) * 0.75)}-byte TDX quote: ${file}` : `✗ no attestation from ${API} for request ${requestId}`);
const record = { request_tx: tx, request_id: requestId ? Number(requestId) : null, figure, posted, via, attestation: att ? file : null, secret_tx: stored.tx };
run.outlayer = { ...run.outlayer, trader: account, epoch, wasm_url: url, wasm_hash: jobHash, upload_tx: uploadTx, ...(DIRECT ? { direct: record } : record) };
writeFileSync(RUN, JSON.stringify(run, null, 1));
process.exit(equal && att && att.wasm_hash === jobHash && inputOk ? 0 : 1);
