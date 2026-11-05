// One command, free, no keys, about 4 minutes: everything that can be checked from a fresh clone, ending in a table.
//   npm run judge            the default
//   npm run judge -- --full  also every mutant and the contract's Rust tests (needs Rust and cargo-near; ten more minutes)
// Anything that needs a tool you don't have says "skipped" and why, rather than failing. Sandboxes run in parallel.
import { spawn, spawnSync } from "node:child_process";

const FULL = process.argv.includes("--full");
const repoEnv = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:${process.env.PATH}` };
type Row = { step: string; ok: boolean | null; detail: string; secs: number };
const rows: Row[] = [];
const has = (cmd: string, ...args: string[]) => spawnSync(cmd, args, { env: repoEnv }).status === 0;

function run(cmd: string, args: string[], cwd?: string): Promise<{ code: number; out: string; secs: number }> {
  const started = Date.now();
  return new Promise((ok) => {
    const c = spawn(cmd, args, { env: repoEnv, cwd });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => ok({ code: code ?? 1, out, secs: (Date.now() - started) / 1000 }));
  });
}

const tally = (out: string, re: RegExp) => out.match(re)?.[0] ?? "";
function add(step: string, r: { code: number; out: string; secs: number }, detail: string) {
  rows.push({ step, ok: r.code === 0, detail: r.code === 0 ? detail : `${detail} ${r.out.split("\n").filter((l) => /FAILED|✗|error/.test(l)).slice(0, 2).join(" ").slice(0, 120)}`, secs: r.secs });
  console.log(`${r.code === 0 ? "✓" : "✗"} ${step}: ${detail} (${r.secs.toFixed(0)} s)`);
  if (r.code !== 0) console.log(r.out.split("\n").slice(-25).join("\n"));
}
const skip = (step: string, why: string) => {
  rows.push({ step, ok: null, detail: why, secs: 0 });
  console.log(`- ${step}: skipped, ${why}`);
};

console.log("Keyhole's judge run. Free, no keys, nothing leaves this machine except reads of public APIs (1Click dry quotes).\n");

let r = await run("npx", ["tsx", "--test", "lib/test/vectors.test.ts", "lib/test/dsr.test.ts", "lib/test/seed.test.ts"]);
add("TypeScript: cross-language vectors, deflated Sharpe, seeded state", r, tally(r.out, /pass \d+/));

if (has("cargo", "--version")) {
  r = await run("cargo", ["test", "--release", "-p", "keyhole-core", "--features", "sha2"], "contracts");
  add("Rust core: window keys read exactly their window (property tests)", r, `${r.out.match(/test result: ok\. (\d+) passed/g)?.map((x) => Number(x.match(/\d+/)![0])).reduce((a, b) => a + b, 0) ?? 0} passed`);
} else skip("Rust core property tests", "no cargo on PATH");

r = await run("npx", ["tsx", "tools/attack.ts", "--quiet"]);
add("Attack suite on the real wasm, local host", r, tally(r.out, /\d+\/\d+ attack checks passed/));

r = await run("npx", ["tsx", "tools/fuzz.ts", "300", "2"]);
add("Property fuzz: the whole ledger re-added after every random operation", r, tally(r.out, /\d+ random operations/));

console.log("\nStarting four local NEAR nodes, in parallel. The first run downloads the sandbox binary (about 60 MB) ...\n");
await run("npx", ["tsx", "-e", "import('./tools/nearkit.ts').then((m) => m.sandboxBinary())"]);
const parallel: [string, string[], (o: string) => string][] = [
  ["Kill test: a key-sale dispute's gas, on a real node", ["tools/killtest.ts"], (o) => (o.match(/dispute: chacha20 \(wasm\): ok .*?burnt ([\d.]+ Tgas)/)?.[1] ?? "?") + " for the whole dispute"],
  ["The complete moment, on a real node", ["tools/demo.ts"], (o) => tally(o, /\d+ transactions/)],
  ["Copy trade: NEP-413 token_diff on the mainnet intents.near wasm", ["tools/copy-sandbox.ts"], (o) => tally(o, /\d+\/\d+ copy checks passed/)],
];
const wasmtime = has("wasmtime", "--version");
if (wasmtime) parallel.push(["Attested job under wasmtime (SIMULATED label), OutLayer's yield shape", ["tools/job.ts"], (o) => tally(o, /\d+\/\d+ job checks passed/)]);
const results = await Promise.all(parallel.map(([, args]) => run("npx", ["tsx", ...args])));
parallel.forEach(([name, , detail], i) => add(name, results[i], detail(results[i].out)));
if (!wasmtime) skip("Attested job", "no wasmtime on PATH (brew install wasmtime)");

const browserOk = spawnSync("npx", ["tsx", "-e", "import('playwright').then(async (p) => { const b = await p.chromium.launch(); await b.close(); })"], { env: repoEnv }).status === 0;
if (browserOk) {
  r = await run("npx", ["tsx", "tools/page-test.ts"]);
  add("The web app, driven in a headless browser", r, tally(r.out, /\d+\/\d+ page checks passed/));
} else skip("The web app in a headless browser", "no Chromium: npx playwright install chromium");

if (FULL) {
  r = await run("npx", ["tsx", "tools/mutate.ts"]);
  add("Mutation check: every security-critical line, broken and rebuilt", r, tally(r.out, /\d+\/\d+ mutants caught/));
  r = await run("cargo", ["test", "--release", "-p", "keyhole"], "contracts");
  add("Rust contract: property tests of the money arithmetic", r, tally(r.out, /test result: ok\. \d+ passed/));
} else {
  console.log("\nNot in this run: `npm run mutate` (50 mutants, needs Rust; the last full log is docs/research/mutation-run.txt), `npm run attack -- --sandbox` (the attack suite on a real node, 13 minutes), `npm run verify` (re-reads testnet).");
}

const w = Math.max(...rows.map((x) => x.step.length));
console.log(`\n${"-".repeat(w + 42)}`);
for (const x of rows) console.log(`${x.ok === null ? "SKIP" : x.ok ? "PASS" : "FAIL"}  ${x.step.padEnd(w)}  ${x.detail.slice(0, 40)}`);
console.log("-".repeat(w + 42));
const failed = rows.filter((x) => x.ok === false).length;
console.log(`${rows.filter((x) => x.ok).length} passed, ${failed} failed, ${rows.filter((x) => x.ok === null).length} skipped, in ${Math.round(rows.reduce((a, x) => a + x.secs, 0))} s of work`);
process.exit(failed ? 1 : 0);
