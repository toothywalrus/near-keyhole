// Re-reads the testnet deployment from the chain and checks that it is what docs/demo/testnet-run.json says. Free: views and transaction lookups only. Run: npm run verify
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { hex, sha256, u32le, u64le, utf8 } from "../lib/src/bytes.ts";
import { unhex } from "../lib/src/bytes.ts";
import type { EntryRec, EpochRec, TokenRec, TraderRec } from "../lib/src/client.ts";
import { ARCHIVAL_RPCS, Net, txOutcome } from "./nearkit.ts";

const run = JSON.parse(readFileSync(new URL("../docs/demo/testnet-run.json", import.meta.url), "utf8"));
const net = new Net(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
const C: string = run.contract;
/** A public RPC drops a request now and then. Three tries, a moment apart, before a read counts as failed: a busy node isn't a false claim. */
async function tries<T>(f: () => Promise<T>, n = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await f(); } catch (e) { if (i >= n) throw e; await new Promise((ok) => setTimeout(ok, 1500 * i)); }
  }
}
const v = <T = any>(m: string, a: Record<string, unknown> = {}) => tries(() => net.view<T>(C, m, a));
/** A transaction by hash, from the first archival node that has it. */
async function txOf(hash: string, sender: string): Promise<any> {
  for (let round = 0; round < 2; round++) {
    for (const rpc of ARCHIVAL_RPCS) {
      const j = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: hash, sender_account_id: sender, wait_until: "NONE" } }), signal: AbortSignal.timeout(20_000) }).then((x) => x.json() as any).catch(() => null);
      if (j?.result?.transaction) return j;
    }
    await new Promise((ok) => setTimeout(ok, 2000));
  }
  return null;
}
let bad = 0;
let n = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(76)} ${detail}`);
};

console.log(`Reading ${C} on NEAR testnet (https://testnet.nearblocks.io/address/${C})\n`);
const acct = await tries(() => net.provider.viewAccount({ accountId: C }));
const wasm = readFileSync(new URL("../res/keyhole.wasm", import.meta.url));
const local = base58.encode(createHash("sha256").update(wasm).digest());
if (acct.code_hash === local || !run.code) {
  check("the code on chain is res/keyhole.wasm, byte for byte", acct.code_hash === local, `code_hash ${acct.code_hash}`);
} else {
  // A locked deployment can't follow the source. The run records which build it is; git shows that build.
  const git = spawnSync("git", ["show", `${run.code.source_commit}:res/keyhole.wasm`], { cwd: new URL("..", import.meta.url).pathname, maxBuffer: 1 << 24 });
  const then = git.status === 0 ? base58.encode(createHash("sha256").update(git.stdout).digest()) : null;
  check(`the code on chain is res/keyhole.wasm as built at ${run.code.source_commit}, byte for byte`, acct.code_hash === run.code.code_hash && (then === null || then === acct.code_hash), `code_hash ${acct.code_hash}${then === null ? " (no git here: compared with the recorded hash)" : ", = git show " + run.code.source_commit + ":res/keyhole.wasm"}`);
  console.log(`  (this tree's res/keyhole.wasm is ahead of the deployment: ${run.code.ahead ?? "request_attested sends OutLayer's resource limits as numbers, which outlayer.testnet requires"}.)`);
}
const keys = ((await tries(() => net.provider.viewAccessKeyList({ accountId: C } as never))) as unknown as { keys: { access_key: { permission: unknown } }[] }).keys;
check("LOCKED: the contract account holds no key at all, so nobody can change its code or move its NEAR", keys.length === 0, `${keys.length} access key(s)`);
if (run.deploy_tx) {
  // Deploy, `new` and the key's deletion were one transaction: there was never a moment with code and a key on the account together.
  const r = await txOf(run.deploy_tx, C);
  const kinds = (r?.result?.transaction?.actions ?? []).map((a: any) => (typeof a === "string" ? a : Object.keys(a)[0]));
  check("it was deployed, initialised and locked in one transaction", JSON.stringify(kinds) === JSON.stringify(["DeployContract", "FunctionCall", "DeleteKey"]) && r?.result?.status?.Failure === undefined, `${kinds.join(" + ")}: https://testnet.nearblocks.io/txns/${run.deploy_tx}`);
}

const cfg = await v("get_config");
check("one trusted recorder, as the README says", cfg.recorder === `recorder.${C.split(".").slice(1).join(".")}`, `recorder ${cfg.recorder}`);
check("the protocol fee: 5% of a sale that closes for the trader, to a treasury", cfg.fee_bps === 500 && cfg.treasury === run.treasury, `${cfg.fee_bps} bps to ${cfg.treasury}`);
const outlayer = await v("get_outlayer");
const treeJobSha = createHash("sha256").update(readFileSync(new URL("../res/keyhole_pnl_job.wasm", import.meta.url))).digest("hex");
// The job this deployment pinned. When this tree's job has moved on (a locked deployment can't follow), it's the job as built at the deployment's commit: git shows it.
let jobSha = treeJobSha;
let jobFrom = "res/keyhole_pnl_job.wasm";
if (run.outlayer && run.outlayer.wasm_hash !== treeJobSha && run.code?.source_commit) {
  const git = spawnSync("git", ["show", `${run.code.source_commit}:res/keyhole_pnl_job.wasm`], { cwd: new URL("..", import.meta.url).pathname, maxBuffer: 1 << 24 });
  const then = git.status === 0 ? createHash("sha256").update(git.stdout).digest("hex") : null;
  jobSha = then ?? run.outlayer.wasm_hash;
  jobFrom = `res/keyhole_pnl_job.wasm as built at ${run.code.source_commit}${then === null ? " (no git here: the recorded hash)" : ""}`;
}
if (run.outlayer) {
  check(`OutLayer is configured: outlayer.testnet, the job pinned by the sha256 of ${jobFrom}`, outlayer?.contract === "outlayer.testnet" && outlayer?.wasm_hash === jobSha && run.outlayer.wasm_hash === jobSha, `${outlayer?.contract}: ${outlayer?.wasm_hash?.slice(0, 16)}…`);
} else {
  check("no OutLayer configured, so nothing here can be labeled OutLayerTee", outlayer === null);
}
const feeds = await v<any[]>("get_feeds");
check("three feeds are labeled Recorded, one BorrowedOracle: the label is the contract's", feeds.filter((f) => f.source === "Recorded").length === 3 && !!feeds[3]?.source?.BorrowedOracle, feeds.map((f) => `${f.symbol}: ${f.rounds} rounds`).join(", "));
check("the borrowed feed holds a real round read from oracle.borrowed-oracle-u2hivj.testnet", feeds[3]?.rounds >= 1, JSON.stringify((await v<any[]>("get_rounds", { feed: 3, from: 0, limit: 1 }))[0] ?? null));

const vega = await v<TraderRec>("get_trader", { account: run.traders.vega });
const lucky = await v<TraderRec>("get_trader", { account: run.traders.lucky });
const mallory = await v<TraderRec>("get_trader", { account: run.traders.mallory });
check("vega, the honest trader, is Active", vega.status === "Active");
check("lucky, who posted a false figure, is slashed on the contract's own recomputation", !!lucky.status?.Slashed, lucky.status?.Slashed?.reason ?? "");
check("mallory, who delivered garbage, is slashed", !!mallory.status?.Slashed, mallory.status?.Slashed?.reason ?? "");
const le = (await v<EpochRec[]>("get_epochs", { account: run.traders.lucky, from: run.epoch, limit: 1 }))[0];
check("lucky's epoch shows the lie and the truth side by side", !!le.verdict?.False && le.verdict.False.recomputed_e6 !== le.posted_e6, `posted ${le.posted_e6}, recomputed ${le.verdict?.False?.recomputed_e6}`);
const ve = (await v<EpochRec[]>("get_epochs", { account: run.traders.vega, from: run.epoch, limit: 1 }))[0];
check("vega's epoch carries a figure labeled SimulatedLocal, equal to the posted one", ve.attested?.kind === "SimulatedLocal" && ve.attested?.pnl_e6 === ve.posted_e6, `${ve.attested?.kind}: ${ve.attested?.pnl_e6}`);
if (run.outlayer) {
  const o = run.outlayer;
  const oe = (await v<EpochRec[]>("get_epochs", { account: o.trader, from: o.epoch, limit: 1 }))[0];
  if (o.direct) {
    // The job in OutLayer's TEE, asked for by the trader himself. Its attestation binds the wasm, the input and the output; the last two recompute from the chain.
    const att = existsSync(new URL(`../${o.direct.attestation}`, import.meta.url)) ? JSON.parse(readFileSync(new URL(`../${o.direct.attestation}`, import.meta.url), "utf8")).attestation : null;
    const tx = await txOf(o.direct.request_tx, o.trader);
    const outBytes = tx?.result?.status?.SuccessValue ? Buffer.from(tx.result.status.SuccessValue, "base64") : Buffer.alloc(0);
    const args = tx?.result?.transaction?.actions?.[0]?.FunctionCall?.args ? JSON.parse(Buffer.from(tx.result.transaction.actions[0].FunctionCall.args, "base64").toString()) : {};
    const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
    check("OutLayer ran the job in Intel TDX on testnet: its attestation names this job, and its input and output hashes recompute from the transaction", !!att && att.wasm_hash === jobSha && att.executed_wasm_sha256 === jobSha && att.input_hash === sha(args.input_data ?? "") && att.output_hash === sha(outBytes) && att.transaction_hash === o.direct.request_tx && (att.tdx_quote?.length ?? 0) > 1000, `request ${att?.request_id}, ${Math.round((att?.tdx_quote?.length ?? 0) * 0.75)}-byte TDX quote: ${o.direct.attestation}`);
    const out = outBytes.length ? JSON.parse(outBytes.toString()) : {};
    const lastHead = oe?.entries ? (await v<EntryRec[]>("get_entries", { account: o.trader, from: String(Number(oe.first_seq) + oe.entries - 1), limit: 1 }))[0]?.head : null;
    check("the figure the enclave computed, with the epoch's keys as an OutLayer secret, is the one the trader posted, to the unit", out.pnl_e6 === oe?.posted_e6 && out.head === lastHead && out.applied === oe?.entries, `enclave ${out.pnl_e6}, posted ${oe?.posted_e6}, ${out.applied} entries opened`);
  }
  if (o.contract_path && oe?.attested?.kind !== "OutLayerTee") {
    check("the locked contract's own request failed on OutLayer's types, and labeled nothing: nothing reads as enclave-made that wasn't", oe?.attested === null, `${o.contract_path.request_tx}: attested ${JSON.stringify(oe?.attested)}`);
  } else {
    check("an epoch labeled OutLayerTee: the figure came back from OutLayer's own contract, equal to the posted one", oe?.attested?.kind === "OutLayerTee" && oe.attested.via === "outlayer.testnet" && oe.attested.pnl_e6 === oe.posted_e6, `${oe?.attested?.kind} via ${oe?.attested?.via}: ${oe?.attested?.pnl_e6}`);
  }
}

// Recompute the hash chain from the entries, with no help from the contract.
const entries = await v<EntryRec[]>("get_entries", { account: run.traders.vega, from: "0", limit: 200 });
let head = new Uint8Array(32);
let chainOk = entries.length === Number(vega.next_seq);
for (const e of entries) {
  head = sha256(utf8("keyhole/chain/v1"), head, u64le(BigInt(e.seq)), u32le(e.slot), u64le(BigInt(e.at_ms)), unhex(e.ct), unhex(e.tag));
  if (hex(head) !== e.head) chainOk = false;
}
check("vega's journal: numbered with no gaps, and the hash chain recomputes to the head", chainOk && hex(head) === vega.head, `${entries.length} entries, head ${vega.head.slice(0, 16)}…`);

const tv = await v<TokenRec>("get_token", { token_id: run.tokens.vega });
check("vega's sold window was delivered, and closed in her favour", tv.state === "Closed" && tv.wrapped.length > 0, `state ${tv.state}, ${tv.wrapped.length} wrapped nodes`);
const nft = await v("nft_token", { token_id: String(run.tokens.vega) });
check("it's a NEP-171 token, held by the buyer", nft.owner_id === run.buyer, nft.owner_id);
const fee = (BigInt(tv.price) * BigInt(cfg.fee_bps)) / 10_000n;
const treasury = BigInt(await v("credit_of", { account: cfg.treasury }));
check("the treasury holds the fee on that sale", fee > 0n && treasury >= fee, `fee ${fee} yocto on a price of ${tv.price}; treasury credit ${treasury}`);
const tl = await v<TokenRec>("get_token", { token_id: run.tokens.lucky });
const tm = await v<TokenRec>("get_token", { token_id: run.tokens.mallory });
check("the windows on both liars were refunded, whole", tl.state === "Refunded" && tm.state === "Refunded", `${tl.state}, ${tm.state}`);
const s = await v("solvency");
check("the contract can pay everything it owes", BigInt(s.slack) >= 0n, `balance ${s.balance}, storage ${s.storage_locked}, obligations ${s.obligations}`);

// Old transactions are looked up on archival nodes: a regular node forgets them after two or three days.
const sample = (run.steps as { what: string; tx?: string }[]).filter((x) => x.tx && /dispute_wrap: secret|audit_conclude|buy epoch|settle/.test(x.what)).slice(0, 4);
for (const x of sample) {
  const o = await txOutcome(x.tx!, run.buyer);
  check(`the transaction is on chain and succeeded: ${x.what.slice(0, 40)}`, o.found && o.ok, `https://testnet.nearblocks.io/txns/${x.tx}${o.found ? "" : ` (${o.why})`}`);
}
console.log(`\n${n - bad}/${n} chain checks passed`);
process.exit(bad ? 1 : 0);
