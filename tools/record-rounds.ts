// Records real Chainlink rounds from Ethereum mainnet (read-only eth_call against the AggregatorV3 proxies) into fixtures/chainlink-rounds.json.
// These are what the sandbox replays and the seeded journals trade against. Run: npx tsx tools/record-rounds.ts [days]
import { writeFileSync } from "node:fs";

const RPC = process.env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com";
const FEEDS: { symbol: string; proxy: string }[] = [
  { symbol: "ETH/USD", proxy: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" },
  { symbol: "BTC/USD", proxy: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c" },
  { symbol: "SOL/USD", proxy: "0x4ffC43a60e009B551865A93d232E33Fce9f01507" },
  { symbol: "NEAR/USD", proxy: "0xC12A6d1D827e23318266Ef16Ba6F397F2F91dA9b" },
];
const days = Number(process.argv[2] ?? 75);

async function rpc(calls: { method: string; params: unknown[] }[]): Promise<any[]> {
  const body = calls.map((c, i) => ({ jsonrpc: "2.0", id: i, ...c }));
  for (let attempt = 0; attempt < 6; attempt++) {
    const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "near-keyhole" }, body: JSON.stringify(body) });
    if (r.ok) {
      const j = (await r.json()) as any[];
      j.sort((a, b) => a.id - b.id);
      return j;
    }
    await new Promise((ok) => setTimeout(ok, 1500 * (attempt + 1)));
  }
  throw new Error("RPC keeps refusing");
}

const word = (hex: string, i: number) => BigInt("0x" + hex.slice(2 + i * 64, 2 + (i + 1) * 64));
const LATEST = "0xfeaf968c";
const GET_ROUND = "0x9a6fc8f5";
const DECIMALS = "0x313ce567";
const oldest = Math.floor(Date.now() / 1000) - days * 86400;
const out: Record<string, unknown> = {};

for (const f of FEEDS) {
  const [d, l] = await rpc([
    { method: "eth_call", params: [{ to: f.proxy, data: DECIMALS }, "latest"] },
    { method: "eth_call", params: [{ to: f.proxy, data: LATEST }, "latest"] },
  ]);
  if (l.error || !l.result || l.result === "0x") {
    console.log(`${f.symbol}: no answer (${JSON.stringify(l.error ?? l.result)}), skipped`);
    continue;
  }
  const decimals = Number(BigInt(d.result));
  let id = word(l.result, 0);
  const rows: [string, string, number][] = [];
  let done = false;
  while (!done) {
    const ids = Array.from({ length: 100 }, (_, i) => id - BigInt(i));
    const res = await rpc(ids.map((r) => ({ method: "eth_call", params: [{ to: f.proxy, data: GET_ROUND + r.toString(16).padStart(64, "0") }, "latest"] })));
    for (const x of res) {
      if (x.error || !x.result || x.result === "0x") { done = true; break; }
      const updated = Number(word(x.result, 3));
      if (updated < oldest || updated === 0) { done = true; break; }
      rows.push([word(x.result, 0).toString(), word(x.result, 1).toString(), updated]);
    }
    id -= 100n;
  }
  rows.reverse();
  out[f.symbol] = { proxy: f.proxy, decimals, rounds: rows };
  console.log(`${f.symbol}: ${rows.length} rounds, decimals ${decimals}, ${new Date((rows[0]?.[2] ?? 0) * 1000).toISOString()} .. ${new Date((rows.at(-1)?.[2] ?? 0) * 1000).toISOString()}`);
}
writeFileSync(new URL("../fixtures/chainlink-rounds.json", import.meta.url), JSON.stringify({
  note: "Real Chainlink rounds read from Ethereum mainnet by tools/record-rounds.ts. Each row: [roundId, answer, updatedAt].",
  recorded: new Date().toISOString(), rpc: RPC, feeds: out,
}));
