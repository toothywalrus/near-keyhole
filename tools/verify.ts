// Re-reads the testnet deployment from the chain and checks that it is what docs/demo/testnet-run.json says. Free: views only. Run: npm run verify
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { base58 } from "@scure/base";
import { hex, sha256, u32le, u64le, utf8 } from "../lib/src/bytes.ts";
import { unhex } from "../lib/src/bytes.ts";
import type { EntryRec, EpochRec, TokenRec, TraderRec } from "../lib/src/client.ts";
import { Net } from "./nearkit.ts";

const run = JSON.parse(readFileSync(new URL("../docs/demo/testnet-run.json", import.meta.url), "utf8"));
const net = new Net(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
const C: string = run.contract;
const v = <T = any>(m: string, a: Record<string, unknown> = {}) => net.view<T>(C, m, a);
let bad = 0;
let n = 0;
const check = (name: string, ok: boolean, detail = "") => {
  n++;
  if (!ok) bad++;
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(72)} ${detail}`);
};

console.log(`Reading ${C} on NEAR testnet (https://testnet.nearblocks.io/address/${C})\n`);
const acct = await net.provider.viewAccount({ accountId: C });
const wasm = readFileSync(new URL("../res/keyhole.wasm", import.meta.url));
const local = base58.encode(createHash("sha256").update(wasm).digest());
check("the code on chain is res/keyhole.wasm, byte for byte", acct.code_hash === local, `code_hash ${acct.code_hash}`);
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
check("vega's sold token holds a delivery", tv.state !== "Pending" && tv.wrapped.length > 0, `state ${tv.state}, ${tv.wrapped.length} wrapped nodes`);
const nft = await v("nft_token", { token_id: String(run.tokens.vega) });
check("it's a NEP-171 token, held by the buyer", nft.owner_id === run.buyer, nft.owner_id);
const tl = await v<TokenRec>("get_token", { token_id: run.tokens.lucky });
const tm = await v<TokenRec>("get_token", { token_id: run.tokens.mallory });
check("the windows on both liars were refunded", tl.state === "Refunded" && tm.state === "Refunded", `${tl.state}, ${tm.state}`);
const s = await v("solvency");
check("the contract can pay everything it owes", BigInt(s.slack) >= 0n, `balance ${s.balance}, storage ${s.storage_locked}, obligations ${s.obligations}`);

const sample = (run.steps as { what: string; tx?: string }[]).filter((x) => x.tx && /dispute_wrap: secret|audit_conclude|buy epoch/.test(x.what)).slice(0, 3);
for (const x of sample) {
  const r = await fetch(net.rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tx", params: { tx_hash: x.tx, sender_account_id: run.buyer, wait_until: "NONE" } }) });
  const j = (await r.json()) as any;
  const okTx = j.result?.status?.SuccessValue !== undefined || (j.result?.final_execution_status && !j.result?.status?.Failure);
  check(`the transaction is on chain: ${x.what.slice(0, 40)}`, Boolean(okTx), `https://testnet.nearblocks.io/txns/${x.tx}`);
}
console.log(`\n${n - bad}/${n} chain checks passed`);
process.exit(bad ? 1 : 0);
