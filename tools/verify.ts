// Re-reads the testnet deployment from the chain and checks that it is what docs/demo/testnet-run.json says. Free: views and transaction lookups only. Run: npm run verify
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { hex, sha256, u32le, u64le, utf8 } from "../lib/src/bytes.ts";
import { unhex } from "../lib/src/bytes.ts";
import type { EntryRec, EpochRec, TokenRec, TraderRec } from "../lib/src/client.ts";
import { ARCHIVAL_RPCS, Net, txOutcome } from "./nearkit.ts";

const run = JSON.parse(readFileSync(new URL("../docs/demo/testnet-run.json", import.meta.url), "utf8"));
const net = new Net(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
const C: string = run.contract;
const v = <T = any>(m: string, a: Record<string, unknown> = {}) => net.view<T>(C, m, a);
let bad = 0;
let n = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(76)} ${detail}`);
};

console.log(`Reading ${C} on NEAR testnet (https://testnet.nearblocks.io/address/${C})\n`);
const acct = await net.provider.viewAccount({ accountId: C });
const wasm = readFileSync(new URL("../res/keyhole.wasm", import.meta.url));
const local = base58.encode(createHash("sha256").update(wasm).digest());
check("the code on chain is res/keyhole.wasm, byte for byte", acct.code_hash === local, `code_hash ${acct.code_hash}`);
const keys = ((await net.provider.viewAccessKeyList({ accountId: C } as never)) as unknown as { keys: { access_key: { permission: unknown } }[] }).keys;
check("LOCKED: the contract account holds no key at all, so nobody can change its code or move its NEAR", keys.length === 0, `${keys.length} access key(s)`);
if (run.deploy_tx) {
  // Deploy, `new` and the key's deletion were one transaction: there was never a moment with code and a key on the account together.
  const r = await fetch(ARCHIVAL_RPCS[0], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: run.deploy_tx, sender_account_id: C, wait_until: "NONE" } }) }).then((x) => x.json() as any).catch(() => null);
  const kinds = (r?.result?.transaction?.actions ?? []).map((a: any) => (typeof a === "string" ? a : Object.keys(a)[0]));
  check("it was deployed, initialised and locked in one transaction", JSON.stringify(kinds) === JSON.stringify(["DeployContract", "FunctionCall", "DeleteKey"]) && r?.result?.status?.Failure === undefined, `${kinds.join(" + ")}: https://testnet.nearblocks.io/txns/${run.deploy_tx}`);
}

const cfg = await v("get_config");
check("one trusted recorder, as the README says", cfg.recorder === `recorder.${C.split(".").slice(1).join(".")}`, `recorder ${cfg.recorder}`);
check("the protocol fee: 5% of a sale that closes for the trader, to a treasury", cfg.fee_bps === 500 && cfg.treasury === run.treasury, `${cfg.fee_bps} bps to ${cfg.treasury}`);
const outlayer = await v("get_outlayer");
if (run.outlayer) {
  check("OutLayer is configured: outlayer.testnet, the job pinned by its sha256", outlayer?.contract === "outlayer.testnet" && outlayer?.wasm_hash === run.outlayer.wasm_hash, `${outlayer?.contract}: ${outlayer?.wasm_hash?.slice(0, 16)}…`);
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
  const oe = (await v<EpochRec[]>("get_epochs", { account: run.outlayer.trader, from: run.outlayer.epoch, limit: 1 }))[0];
  check("an epoch labeled OutLayerTee: the figure came back from OutLayer's own contract, equal to the posted one", oe?.attested?.kind === "OutLayerTee" && oe.attested.via === "outlayer.testnet" && oe.attested.pnl_e6 === oe.posted_e6, `${oe?.attested?.kind} via ${oe?.attested?.via}: ${oe?.attested?.pnl_e6}`);
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
