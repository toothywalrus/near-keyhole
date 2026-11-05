// Pull the live mainnet intents.near wasm over RPC (a read, nothing signed), to deploy in the local sandbox. Run: npx tsx tools/pull-intents.ts
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
const RPC = process.env.NEAR_MAINNET_RPC ?? "https://rpc.mainnet.fastnear.com";
const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_code", finality: "final", account_id: "intents.near" } }) });
const j = (await r.json()) as { result?: { code_base64: string; hash: string; block_height: number }; error?: unknown };
if (!j.result) throw new Error(JSON.stringify(j.error));
const code = Buffer.from(j.result.code_base64, "base64");
const out = new URL("../res/intents.near.wasm", import.meta.url).pathname;
writeFileSync(out, code);
console.log(`intents.near code_hash ${j.result.hash} at block ${j.result.block_height}: ${code.length} bytes, sha256 ${createHash("sha256").update(code).digest("hex")}`);
