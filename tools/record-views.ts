// Re-records fixtures/testnet-views.json, the page test's copy of the deployed contract's views, after a new deployment. Read-only: no key, nothing sent.
// It runs the page's own `readLive` (web/src/Live.tsx) against the real RPC and keeps every answer under the key tools/page-test.ts looks it up by. Then it
// adds one stranger the page must never name: a trader whose handle is "NOT-OURS: buy my coin", and a window on him held by `rude-words-here.testnet`. Those
// two rows are made up, and only here: the test checks that the page counts them and prints neither. Run: npx tsx tools/record-views.ts
import { readFileSync, writeFileSync } from "node:fs";
import { readLive } from "../web/src/Live.tsx";
import type { Run } from "../web/src/testnet.ts";

const run: Run = JSON.parse(readFileSync(new URL("../docs/demo/testnet-run.json", import.meta.url), "utf8"));
const views: Record<string, any> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const r = await realFetch(input, init);
  const q = JSON.parse(String(init?.body ?? "{}")).params ?? {};
  const j = await r.clone().json();
  const args = q.args_base64 ? Buffer.from(q.args_base64, "base64").toString() : "";
  if (q.request_type === "view_access_key_list") views.view_access_key_list = j.result?.keys;
  else if (j.result?.result) views[`${q.method_name}${args === "{}" ? "" : args}`] = JSON.parse(Buffer.from(j.result.result).toString());
  return r;
}) as typeof fetch;

const live = await readLive(run);
globalThis.fetch = realFetch;
if (live.others !== 0 || live.otherTokens !== 0) {
  console.error(`refused: the contract already has ${live.others} trader(s) and ${live.otherTokens} window(s) from outside the run. The page test expects exactly the one stranger this adds: check what they are first.`);
  process.exit(1);
}

const tradersKey = 'list_traders{"from":0,"limit":100}';
const traders: any[] = views[tradersKey];
const stranger = { ...traders[0], id: traders.length, account: "stranger.testnet", handle: "NOT-OURS: buy my coin", status: "Active", sold: 0, buyers: 0 };
traders.push(stranger);
const supply = Number(views.nft_total_supply);
if (supply >= 12) throw new Error("the page reads the first 12 windows; with 12 or more already sold, the stranger's wouldn't be read");
const model = views[`get_token{"token_id":${supply}}`];
views[`get_token{"token_id":${supply + 1}}`] = { ...model, id: supply + 1, trader: stranger.id, owner: "rude-words-here.testnet", state: "Pending", eph: null, wrapped: [], commits: [] };
views.nft_total_supply = String(supply + 1);

writeFileSync(new URL("../fixtures/testnet-views.json", import.meta.url), JSON.stringify(views, null, 1) + "\n");
console.log(`fixtures/testnet-views.json: ${Object.keys(views).length} views of ${run.contract}, ${live.ours.length} of the run's traders, ${supply} windows, plus the made-up stranger and his window`);
