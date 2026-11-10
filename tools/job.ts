// The attested path, run for real: the wasm32-wasip2 job under wasmtime reads the journal from a sandbox node over HTTP, opens one epoch with key material from
// its environment, and prints the figure. Then both ways in:
//   - a registered runner submits it: labeled SimulatedLocal, because this was a local run with no enclave;
//   - the production shape: `request_attested` yields on a stand-in for OutLayer, the "worker" runs the same job and resolves, and the callback writes it.
// Run: npm run job. Needs wasmtime on PATH (`brew install wasmtime`).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { hex } from "../lib/src/bytes.ts";
import { DEPTH, loadEntries, near, NO_SETTLEMENT, Prices, replayEpoch, type EpochRec, type TraderRec } from "../lib/src/client.ts";
import { cover } from "../lib/src/ggm.ts";
import { agent, sandboxWorld, FAST_CONFIG } from "./world.ts";

const JOB = new URL("../res/keyhole_pnl_job.wasm", import.meta.url).pathname;
const MOCK = new URL("../res/mock_outlayer.wasm", import.meta.url).pathname;
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name.padEnd(74)} ${detail}`);
};

const jobHash = createHash("sha256").update(readFileSync(JOB)).digest("hex");
const w = await sandboxWorld();
try {
  const account = await w.fund("loner", near(20));
  const t = agent(w, account, "loner");
  const r0 = await t.register("loner", { book_usd: 100_000, floor_bps: 1000, base_price: near("0.1"), slope: 0n, bond: near(3) });
  if (!r0.ok) throw new Error(r0.reason);
  await w.rounds();
  const e = (await w.chain.view("clock")).epoch + 1;
  await w.chain.advanceTo(w.timing.epochStart(e));
  await t.write({ feed: 0, flags: 0, qty_e8: 200_000_000n, fill_e8: 1n, settlement: NO_SETTLEMENT, note: "a trader with no buyers yet" });
  await t.write({ feed: 1, flags: 0, qty_e8: -5_000_000n, fill_e8: 1n, settlement: NO_SETTLEMENT, note: "hedge" });
  await w.rounds();
  await w.chain.advanceTo(w.timing.epochStart(e + 1));
  await w.rounds();
  await w.prices.load();
  const fig = await t.figure(e, w.prices);
  const p = await t.post(e, fig.pnl_e6);
  if (!p.ok) throw new Error(p.reason);

  const [first, last] = w.timing.window(e, e);
  const nodes = cover(first, last, DEPTH).map((n) => ({ level: n.level, index: n.index, value: hex(t.tree.node(n)) }));
  const run = (rpcInput: Record<string, unknown>, env: Record<string, string>) => {
    try {
      return { ok: true, out: JSON.parse(execFileSync("wasmtime", ["run", "-S", "http", ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), JOB], { input: JSON.stringify(rpcInput), stdio: ["pipe", "pipe", "pipe"] }).toString()) };
    } catch (err) {
      return { ok: false, err: String((err as { stderr?: Buffer }).stderr ?? err) };
    }
  };
  const input = { contract: w.contract, trader: account, epoch: e, rpc: w.sb!.rpc };
  const env = { KEYHOLE_NODES: JSON.stringify(nodes), KEYHOLE_JOB_SHA256: jobHash };
  const out = run(input, env);
  check("the job runs under wasmtime and reads the journal from the node over HTTP", out.ok, out.ok ? "" : out.err?.slice(0, 200));
  if (!out.ok) throw new Error(out.err);
  check("JOB = TRADER = CONTRACT'S RULE: the job's figure equals the local replay, to the unit", out.out.pnl_e6 === fig.pnl_e6.toString(), `job ${out.out.pnl_e6}, local ${fig.pnl_e6}`);
  check("it read the whole epoch", out.out.applied === 2 && out.out.void === 0, `applied ${out.out.applied}, void ${out.out.void}`);
  // The price delay (docs/decisions/0020): the job and the local replay must move together. Everything is handed to the job here, with a delay this deployment doesn't have.
  {
    const D = 3000;
    const tr = await w.chain.view<{ book_usd_e6: string }>("get_trader", { account });
    const entries = await loadEntries(w.chain, account, 0, 2);
    const later = new Prices(w.chain);
    await later.load();
    later.delayMs = D;
    later.nowMs += 60_000;
    const local = replayEpoch(entries, (x) => t.keyOf(x), later, BigInt(tr.book_usd_e6), w.timing.epochStart(e + 1));
    const given = run({ trader: account, epoch: e, data: { book_usd_e6: tr.book_usd_e6, feeds: later.feeds, epoch_end_ms: w.timing.epochStart(e + 1), head: entries[entries.length - 1].head, entries, rounds: later.rounds, gap_ms: later.gapMs, delay_ms: D, now_ms: later.nowMs } }, env);
    check("PRICE DELAY: with a delay the job and the local replay still agree, to the unit", given.ok && given.out.pnl_e6 === local.pnl_e6.toString(), given.ok ? `job ${given.out.pnl_e6}, local ${local.pnl_e6} (no delay: ${fig.pnl_e6})` : given.err?.slice(0, 160));
  }
  const wrong = run(input, { ...env, KEYHOLE_NODES: JSON.stringify(nodes.map((n) => ({ ...n, value: "11".repeat(32) }))) });
  check("with the wrong key material the job refuses and prints no figure", !wrong.ok, wrong.err?.trim().slice(0, 90));
  const outside = run(input, { ...env, KEYHOLE_NODES: JSON.stringify(cover(last + 1, last + 1, DEPTH).map((n) => ({ level: n.level, index: n.index, value: hex(t.tree.node(n)) }))) });
  check("with nodes for another window it refuses too", !outside.ok, outside.err?.trim().slice(0, 90));

  const runner = await w.fund("runner", near(2));
  const set = await w.chain.call(w.owner, "set_runner", { runner, enabled: true });
  check("the owner registers a local runner", set.ok, set.reason ?? "");
  const sub = await w.chain.call(runner, "submit_attested", { output: { trader: account, epoch: e, pnl_e6: out.out.pnl_e6, head: out.out.head, job_sha256: jobHash } }, near("0.01"));
  check("the runner submits the job's output", sub.ok, sub.reason ?? "");
  let ep = (await w.chain.view<EpochRec[]>("get_epochs", { account, from: e, limit: 1 }))[0];
  check("SIMULATED: it is labeled a local run, with no enclave", ep.attested?.kind === "SimulatedLocal", JSON.stringify(ep.attested?.kind));

  console.log("\n-- The production shape, against a stand-in for OutLayer with real yield/resume --");
  const mock = await w.sb!.net.sub(w.sb!.root, "mock-outlayer", 5);
  await w.sb!.net.deploy(mock, MOCK);
  const worker = await w.fund("worker", near(2));
  (w.chain as any).add(mock);
  const initM = await (w.chain as any).net.call(mock, mock.id, "new", { operator: worker });
  check("the stand-in deploys", initM.ok, initM.reason ?? "");
  const cfg = await w.chain.call(w.owner, "set_outlayer", { outlayer: { contract: mock.id, rpc: w.sb!.rpc, wasm_url: "https://example.invalid/keyhole_pnl_job.wasm", wasm_hash: jobHash, max_instructions: "10000000000", max_execution_seconds: "60" } });
  check("the owner points the contract at it, pinned to the job's sha256", cfg.ok, jobHash.slice(0, 16) + "…");
  const pending = t.chain.call(account, "request_attested", { epoch: e, secrets_ref: null }, near("0.03"));
  await new Promise((ok) => setTimeout(ok, 2000));
  const open = await (w.chain as any).net.view(mock.id, "pending", {});
  check("request_attested is waiting on the yield", open.length === 1, `input: ${open[0]?.input_data}`);
  const reqInput = JSON.parse(open[0].input_data);
  // The worker runs the job with exactly what the contract sent, and hands back exactly what it printed.
  const workerOut = run(reqInput, env);
  check("the job runs on exactly the input the contract sent: `rpc` comes from the contract", workerOut.ok && reqInput.rpc === w.sb!.rpc, workerOut.ok ? `figure ${workerOut.out.pnl_e6}` : workerOut.err?.slice(0, 80));
  const resolved = await (w.chain as any).net.call((w.chain as any).accounts.get(worker), mock.id, "resolve_execution", { request_id: open[0].request_id, response: { success: true, output: { Json: workerOut.out }, error: null } });
  check("the stand-in's worker runs the job and resolves", resolved.ok, resolved.reason ?? "");
  const final = await pending;
  check("the yield resumes into the contract's callback", final.ok && final.value === true, JSON.stringify(final.value ?? final.reason));
  ep = (await w.chain.view<EpochRec[]>("get_epochs", { account, from: e, limit: 1 }))[0];
  check("STAND-IN: a callback from anything but OutLayer's own account can't earn the enclave's label", ep.attested?.kind === "OutLayerStandIn" && ep.attested?.via === mock.id, `kind ${ep.attested?.kind}, via ${ep.attested?.via}`);
  check("and the pinned hash, not the job's word for it", ep.attested?.job_sha256 === jobHash);
  const rec = await w.chain.view<TraderRec>("get_trader", { account });
  check("an attestation changes no money and no status", rec.status === "Active");
} catch (e) {
  check("the job path ran to the end", false, String((e as Error).stack ?? e));
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} job checks passed. The job's sha256: ${jobHash}`);
w.stop();
process.exit(bad.length ? 1 : 0);
