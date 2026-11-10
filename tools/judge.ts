// The judge's command. Free, no keys, nothing to install beyond `npm ci`.
//   npm run judge               the fast path: about a minute on a 2-CPU Linux box. No local node, no Rust, no browser.
//                               The TypeScript twin, the attack suite and the ledger fuzz on the real contract wasm, then the deployed contract re-read from testnet.
//   npm run judge -- --offline  the same without the testnet reads (they show as SKIP)
//   npm run judge:full          also the Rust tests, the suites on a local NEAR node, the web app in a headless browser, and every mutant (about 45 minutes)
//   npm run judge:full -- --no-mutate   all of that but the mutants (30 minutes or more on their own: npm run mutate; the last log is docs/research/mutation-run.txt)
// Every step prints its own row the moment it ends, so a run that is cut off still shows what it got. A step whose tool is missing says SKIP and why, never FAIL.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FULL = process.argv.includes("--full");
const OFFLINE = process.argv.includes("--offline");
const MUTATE = !process.argv.includes("--no-mutate");
const extraPath = [join(homedir(), ".cargo/bin"), "/opt/homebrew/bin", "/opt/homebrew/opt/rustup/bin"].filter((p) => existsSync(p));
const repoEnv = { ...process.env, PATH: [...extraPath, process.env.PATH].join(":") };
type Row = { step: string; ok: boolean | null; detail: string; secs: number };
const rows: Row[] = [];
const children = new Set<ChildProcess>();
const t0 = Date.now();

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutSecs: number }): Promise<{ code: number; out: string; secs: number; timedOut: boolean }> {
  const started = Date.now();
  return new Promise((ok) => {
    const c = spawn(cmd, args, { env: repoEnv, cwd: opts.cwd, detached: true });
    children.add(c);
    let out = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill(c);
    }, opts.timeoutSecs * 1000);
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("error", (e) => (out += String(e)));
    c.on("close", (code) => {
      clearTimeout(timer);
      children.delete(c);
      ok({ code: timedOut ? 124 : code ?? 1, out, secs: (Date.now() - started) / 1000, timedOut });
    });
  });
}

function kill(c: ChildProcess): void {
  // The step's whole process group: a sandbox node or a browser under it goes too.
  try { process.kill(-c.pid!, "SIGKILL"); } catch { try { c.kill("SIGKILL"); } catch { /* gone */ } }
}

function emit(row: Row): void {
  rows.push(row);
  const mark = row.ok === null ? "SKIP" : row.ok ? "PASS" : "FAIL";
  console.log(`${mark}  ${row.step}: ${row.detail}${row.ok === null ? "" : ` (${row.secs.toFixed(0)} s)`}`);
}

const tally = (out: string, re: RegExp) => out.match(re)?.[0] ?? "";
function add(step: string, r: { code: number; out: string; secs: number; timedOut: boolean }, detail: string): void {
  const ok = r.code === 0;
  const why = r.timedOut ? "timed out" : r.out.split("\n").filter((l) => /FAILED|✗|[Ee]rror/.test(l)).slice(0, 2).join(" ").slice(0, 160);
  emit({ step, ok, detail: ok ? detail || "ok" : `${detail} ${why}`.trim(), secs: r.secs });
  if (!ok) console.log(r.out.split("\n").slice(-25).map((l) => `      ${l}`).join("\n"));
}
const skip = (step: string, why: string) => emit({ step, ok: null, detail: `skipped: ${why}`, secs: 0 });

function table(): void {
  const w = Math.max(...rows.map((x) => x.step.length), 10);
  console.log(`\n${"-".repeat(w + 50)}`);
  for (const x of rows) console.log(`${x.ok === null ? "SKIP" : x.ok ? "PASS" : "FAIL"}  ${x.step.padEnd(w)}  ${x.detail.slice(0, 60)}`);
  console.log("-".repeat(w + 50));
  const failed = rows.filter((x) => x.ok === false).length;
  console.log(`${rows.filter((x) => x.ok).length} passed, ${failed} failed, ${rows.filter((x) => x.ok === null).length} skipped, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    for (const c of children) kill(c);
    console.log(`\n${sig}: stopped. What finished:`);
    table();
    process.exit(130);
  });
}

/** Can this host reach testnet's RPC at all? A judge without network gets SKIP, not FAIL. */
async function online(rpc: string): Promise<string | null> {
  try {
    const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] }), signal: AbortSignal.timeout(10_000) });
    return r.ok ? null : `testnet RPC answered HTTP ${r.status}`;
  } catch (e) {
    return `no network to ${rpc} (${String((e as Error).message ?? e).slice(0, 60)})`;
  }
}

/** NEAR's sandbox binary needs glibc 2.38 or newer on Linux. Find out once whether it runs here, rather than four suites failing the same way. */
async function sandboxRuns(): Promise<string | null> {
  if (process.platform === "linux") {
    const g = spawnSync("getconf", ["GNU_LIBC_VERSION"], { encoding: "utf8" }).stdout?.trim().split(" ")[1];
    if (g) {
      const [maj, min] = g.split(".").map(Number);
      if (maj < 2 || (maj === 2 && min < 38)) return `NEAR's sandbox binary needs glibc 2.38 or newer, and this host has ${g} (Ubuntu 24.04 or Debian 13 work; see the README's Docker line)`;
    }
  }
  const probe = "Promise.all([import('./tools/nearkit.ts'), import('node:child_process')]).then(([m, cp]) => { const r = cp.spawnSync(m.sandboxBinary(), ['--version']); if (r.status !== 0) { console.error(String(r.stderr || r.error)); process.exit(1); } })";
  const r = await run("npx", ["tsx", "-e", probe], { timeoutSecs: 300 });
  return r.code === 0 ? null : `the sandbox binary didn't run here: ${r.out.trim().split("\n").pop()?.slice(0, 120)}`;
}

/** Run jobs with at most `limit` at a time; each prints its own row as it ends. */
async function pool(jobs: (() => Promise<void>)[], limit: number): Promise<void> {
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let j = queue.shift(); j; j = queue.shift()) await j();
  }));
}

const has = (cmd: string, ...args: string[]) => spawnSync(cmd, args, { env: repoEnv, stdio: "ignore" }).status === 0;
const tsx = (args: string[], timeoutSecs: number) => run("npx", ["tsx", ...args], { timeoutSecs });

console.log(`Keyhole's judge run${FULL ? ", full" : ""}. Free and keyless: nothing leaves this machine except reads of public APIs (NEAR testnet RPC${FULL ? ", 1Click dry quotes" : ""}).\n`);

// The testnet reads go first and run beside everything else: they wait on the network, not on the CPU.
const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
const chain = (async () => {
  const step = "Testnet: the deployed contract re-read from the chain (views only)";
  if (OFFLINE) return skip(step, "--offline");
  const why = await online(RPC);
  if (why) return skip(step, why);
  const r = await tsx(["tools/verify.ts"], 180);
  add(step, r, tally(r.out, /\d+\/\d+ chain checks passed/));
})();

const tests = readdirSync("lib/test").filter((f) => f.endsWith(".test.ts")).map((f) => `lib/test/${f}`);
let r = await tsx(["--test", ...tests], 240);
add("TypeScript twin = the Rust core's vectors; deflated Sharpe; seeded state; a copy trade on the real intents.near wasm", r, tally(r.out, /pass \d+/).replace("pass", "tests passed:"));

r = await tsx(["tools/attack.ts", "--quiet"], 300);
add("Attack suite on the real contract wasm (local host)", r, tally(r.out, /\d+\/\d+ attack checks passed/));

r = await tsx(["tools/fuzz.ts", "300", "2"], 300);
add("Ledger fuzz: every yocto re-added after each random operation", r, `${tally(r.out, /\d+ random operations/)}, books balanced`);

await chain;

if (FULL) {
  if (has("cargo", "--version")) {
    r = await run("cargo", ["test", "--release", "-p", "keyhole-core", "--features", "sha2"], { cwd: "contracts", timeoutSecs: 1200 });
    add("Rust core: a window's keys read exactly that window (property tests)", r, `${r.out.match(/test result: ok\. (\d+) passed/g)?.map((x) => Number(x.match(/\d+/)![0])).reduce((a, b) => a + b, 0) ?? 0} passed`);
    r = await run("cargo", ["test", "--release", "-p", "keyhole"], { cwd: "contracts", timeoutSecs: 1200 });
    add("Rust contract: unit and property tests", r, `${r.out.match(/test result: ok\. (\d+) passed/g)?.map((x) => Number(x.match(/\d+/)![0])).reduce((a, b) => a + b, 0) ?? 0} passed`);
  } else {
    skip("Rust tests", "no cargo on PATH (Rust 1.93.0, pinned by contracts/rust-toolchain.toml)");
  }

  const nodeWhy = await sandboxRuns();
  const wasmtime = has("wasmtime", "--version");
  const onNode: [string, string[], (o: string) => string, number][] = [
    ["Kill test: a key-sale dispute's gas, on a local NEAR node", ["tools/killtest.ts"], (o) => (o.match(/dispute: chacha20 \(wasm\): ok .*?burnt ([\d.]+ Tgas)/)?.[1] ?? "?") + " for the whole dispute", 600],
    ["The complete moment, on a local NEAR node", ["tools/demo.ts"], (o) => tally(o, /\d+ transactions/), 900],
    ["Copy trade: NEP-413 token_diff on the mainnet intents.near wasm, local node", ["tools/copy-sandbox.ts"], (o) => tally(o, /\d+\/\d+ copy checks passed/), 900],
    ["Attack suite on a local NEAR node, real epochs", ["tools/attack.ts", "--sandbox", "--quiet"], (o) => tally(o, /\d+\/\d+ attack checks passed/), 2400],
  ];
  if (wasmtime) onNode.push(["Attested job under wasmtime (SIMULATED label), OutLayer's yield shape", ["tools/job.ts"], (o) => tally(o, /\d+\/\d+ job checks passed/), 900]);
  if (nodeWhy) {
    for (const [name] of onNode) skip(name, nodeWhy);
  } else {
    await pool(onNode.map(([name, args, detail, secs]) => async () => {
      const x = await tsx(args, secs);
      add(name, x, detail(x.out));
    }), 2);
  }
  if (!wasmtime) skip("Attested job under wasmtime", "no wasmtime on PATH (https://wasmtime.dev)");

  const browserOk = spawnSync("npx", ["tsx", "-e", "import('playwright').then(async (p) => { const b = await p.chromium.launch(); await b.close(); })"], { env: repoEnv, stdio: "ignore", timeout: 60_000 }).status === 0;
  if (browserOk) {
    r = await tsx(["tools/page-test.ts"], 600);
    add("The web app, driven in a headless browser", r, tally(r.out, /\d+\/\d+ page checks passed/));
  } else skip("The web app in a headless browser", "no Chromium: npx playwright install --with-deps chromium");

  if (!MUTATE) skip("Mutation check", "--no-mutate; `npm run mutate` runs it alone, and the last full log is docs/research/mutation-run.txt");
  else if (has("cargo", "near", "--version")) {
    r = await tsx(["tools/mutate.ts"], 7200);
    add("Mutation check: every security-critical line broken, rebuilt, and caught", r, tally(r.out, /\d+\/\d+ mutants caught/));
  } else skip("Mutation check", "needs cargo-near (cargo install cargo-near); the last full log is docs/research/mutation-run.txt");
} else {
  console.log("\nIn `npm run judge:full`, not here: the Rust tests, the suites on a local NEAR node (glibc 2.38+), the web app in Chromium, and every mutant.");
}

table();
process.exit(rows.some((x) => x.ok === false) ? 1 : 0);
