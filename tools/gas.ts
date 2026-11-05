// The other half of the hard question: how much of a journal can the contract recompute? Measured on a local sandbox node, with real entries.
// Run: npm run gas. It takes about 10 minutes, most of it waiting for a real epoch to end on the node. `-- --write` updates docs/research/gas-audit.json.
import { writeFileSync } from "node:fs";
import { near, NO_SETTLEMENT, type Config } from "../lib/src/client.ts";
import { agent, sandboxWorld, FAST_CONFIG } from "./world.ts";
import { tgas } from "./nearkit.ts";

const N = Number(process.env.N ?? 260);
const long = (r: string): Config => ({ ...FAST_CONFIG(r), slot_secs: 60, epoch_slots: 10, post_grace_secs: 600, challenge_secs: 900 });
const w = await sandboxWorld(long);
const account = await w.fund("heavy", near(60));
const t = agent(w, account, "heavy");
const reg = await t.register("heavy", { book_usd: 1_000_000, floor_bps: 1000, base_price: near("0.01"), slope: 0n, bond: near(5) });
if (!reg.ok) throw new Error(reg.reason);
const e = (await w.chain.view("clock")).epoch;
await w.rounds();
console.log(`Writing ${N} entries in one epoch ...`);
for (let i = 0; i < N; i++) {
  const r = await t.write({ feed: i % 3, flags: 0, qty_e8: BigInt((i % 2 === 0 ? 1 : -1) * 1_000_000), fill_e8: 1n, settlement: NO_SETTLEMENT, note: `entry ${i}` });
  if (!r.ok) throw new Error(`entry ${i}: ${r.reason}`);
  if (i % 40 === 0) await w.rounds();
}
await w.rounds();
// Jump past the epoch: wait out the clock on the sandbox.
const end = w.timing.epochStart(e + 1);
console.log(`Waiting for the epoch to end (${Math.ceil((end - (await w.chain.nowMs())) / 1000)} s) ...`);
await w.chain.advanceTo(end);
await w.rounds();
await w.prices.load();
const fig = await t.figure(e, w.prices);
const post = await t.post(e, fig.pnl_e6);
if (!post.ok) throw new Error(post.reason);

const rows: { batch: number; entries_opened: number; burnt_tgas: number; ok: boolean; reason?: string }[] = [];
const auditor = await w.fund("auditor", near(5));
const open = await w.chain.call(auditor, "audit_open", { trader: account, epoch: e }, near("0.5"));
if (!open.ok) throw new Error(open.reason);
const audit = Number(open.value);
let at = 0;
for (const batch of [1, 10, 40, 80, 120]) {
  const s = await w.chain.call(auditor, "audit_step", { audit, openings: fig.openings.slice(at, at + batch) });
  rows.push({ batch, entries_opened: s.ok ? batch : 0, burnt_tgas: Number(s.burntGas) / 1e12, ok: s.ok, reason: s.reason });
  console.log(`  audit_step with ${String(batch).padStart(3)} entries: ${s.ok ? tgas(s.burntGas) : `refused: ${s.reason}`}`);
  if (s.ok) at += batch;
}
while (at < fig.openings.length) {
  const s = await w.chain.call(auditor, "audit_step", { audit, openings: fig.openings.slice(at, at + 40) });
  if (!s.ok) throw new Error(s.reason);
  at += 40;
}
const c = await w.chain.call(auditor, "audit_conclude", { audit, mark_indices: fig.mark_indices });
console.log(`  audit_conclude: ${tgas(c.burntGas)}: ${c.value?.detail ?? c.reason}`);
const ok = rows.filter((r) => r.ok && r.batch >= 10);
const per = ok.length >= 2 ? (ok[ok.length - 1].burnt_tgas - ok[0].burnt_tgas) / (ok[ok.length - 1].batch - ok[0].batch) : 0;
const fixed = ok.length ? ok[0].burnt_tgas - per * ok[0].batch : 0;
console.log(`  about ${per.toFixed(3)} Tgas per entry + ${fixed.toFixed(2)} fixed, so about ${Math.floor((300 - fixed) / per)} entries fit in one 300 Tgas transaction, and an audit takes as many transactions as it needs.`);
if (process.argv.includes("--write")) writeFileSync(new URL("../docs/research/gas-audit.json", import.meta.url), JSON.stringify({ measured: new Date().toISOString(), chain: "near-sandbox 2.14.0", entries: N, rows, conclude_tgas: Number(c.burntGas) / 1e12, per_entry_tgas: per, fixed_tgas: fixed, fits_in_300_tgas: Math.floor((300 - fixed) / per) }, null, 1));
w.stop();
process.exit(0);
