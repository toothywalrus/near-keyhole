// A new locked deployment of this tree's contract on NEAR testnet, with the whole run and the contract's own OutLayer path on it, and the repo pointed at it.
// NOT RUN YET: the deployed contract (app.near-keyhole-y4ow.testnet) is the build of a23a06c. A new version goes to a fresh account under a fresh root
// (docs/decisions/0017), which takes about 9 testnet NEAR: one faucet draw, which is the author's call.
//
//   npx tsx tools/faucet.ts <name>.testnet                                  make and fund a fresh root (its key goes to the OS keyring first)
//   KEYHOLE_ROOT=<name>.testnet npx tsx tools/redeploy.ts                   the plan: read-only, sends nothing
//   CONFIRM_TESTNET_DEPLOY=1 KEYHOLE_ROOT=<name>.testnet npx tsx tools/redeploy.ts
//       1. npm run demo -- --testnet   deploy, `new` and lock app.<root> in one transaction; the whole moment on it (about 15 minutes); writes docs/demo/testnet-run.json
//       2. tools/outlayer.ts           the job on FastFS, the epoch's keys as an OutLayer secret, and the contract's own request_attested: the OutLayerTee label
//       3. the record copied to web/public, tools/testnet.ts pointed at the new root, npm run verify against the new contract
// It never touches an existing deployment: it refuses a root that already has an app. account, and the two roots this repo has used.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";

const USED = ["near-keyhole-y4ow.testnet", "keyhole-g1zo8i.testnet"];
const NEED_NEAR = 9;

/** Why this can't go ahead, or null. Pure, so the guards can be tested without a network. */
export function refusal(env: { KEYHOLE_ROOT?: string; CONFIRM_TESTNET_DEPLOY?: string }, facts: { rootExists: boolean; appExists: boolean; hasKey: boolean; balanceNear: number }): string | null {
  const root = env.KEYHOLE_ROOT ?? "";
  if (!root) return "set KEYHOLE_ROOT to a fresh funded testnet account (npx tsx tools/faucet.ts <name>.testnet makes one)";
  if (!root.endsWith(".testnet")) return `${root} isn't a testnet account: this tool is for testnet only`;
  if (USED.includes(root)) return `${root} already carries a deployment, and a locked deployment can't be replaced: use a fresh root`;
  if (!facts.rootExists) return `${root} doesn't exist yet: npx tsx tools/faucet.ts ${root}`;
  if (facts.appExists) return `app.${root} exists already: a new version goes to a fresh account`;
  if (!facts.hasKey) return `no key for ${root} in the OS keyring`;
  if (facts.balanceNear < NEED_NEAR) return `${root} holds ${facts.balanceNear.toFixed(2)} NEAR, and a deployment with its run takes about ${NEED_NEAR}`;
  return null;
}

const here = (p: string) => new URL(p, import.meta.url);
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.env.KEYHOLE_ROOT ?? "";
  const { Net } = await import("./nearkit.ts");
  const { hasKey } = await import("./keys.ts");
  const net = new Net(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
  const rootExists = !!root && (await net.exists(root));
  const facts = { rootExists, appExists: !!root && (await net.exists(`app.${root}`)), hasKey: !!root && hasKey(root), balanceNear: rootExists ? Number((await net.balance(root)) / 10n ** 21n) / 1000 : 0 };
  const why = refusal(process.env, facts);
  if (why) {
    console.error(`refused: ${why}`);
    process.exit(2);
  }
  const wasm = createHashOf(here("../res/keyhole.wasm"));
  console.log(`The plan, for ${root} (${facts.balanceNear.toFixed(2)} NEAR):`);
  console.log(`  1. create app.${root}; deploy res/keyhole.wasm (sha256 ${wasm.slice(0, 16)}…), call new and delete its only key, in one transaction`);
  console.log("  2. the whole moment on it: three traders, a sale, a false figure slashed, garbage keys slashed, a false dispute, a settled sale (about 15 minutes)");
  console.log("  3. the PnL job on FastFS, the epoch's keys as an OutLayer secret, the contract's own request_attested");
  console.log("  4. docs/demo/testnet-run.json and web/public/testnet-run.json rewritten, tools/testnet.ts pointed at the new root, npm run verify");
  if (process.env.CONFIRM_TESTNET_DEPLOY !== "1") {
    console.log("\nNothing was sent. To go ahead: CONFIRM_TESTNET_DEPLOY=1 KEYHOLE_ROOT=" + root + " npx tsx tools/redeploy.ts");
    process.exit(0);
  }
  const step = (what: string, args: string[]) => {
    console.log(`\n== ${what} ==`);
    const r = spawnSync("npx", ["tsx", ...args], { stdio: "inherit", env: process.env, cwd: here("..").pathname });
    if (r.status !== 0) {
      console.error(`\n${what} failed. Nothing after it was run. What exists on chain stays: read docs/demo/testnet-run.json and the output above before running anything again.`);
      process.exit(1);
    }
  };
  step("The deployment and the whole moment", ["tools/demo.ts", "--testnet"]);
  step("OutLayer: the contract's own request", ["tools/outlayer.ts"]);
  copyFileSync(here("../docs/demo/testnet-run.json"), here("../web/public/testnet-run.json"));
  const t = readFileSync(here("./testnet.ts"), "utf8");
  const pointed = t.replace(/process\.env\.KEYHOLE_ROOT \?\? "[^"]+"/, `process.env.KEYHOLE_ROOT ?? "${root}"`);
  if (pointed === t) console.error("tools/testnet.ts wasn't re-pointed: set its ROOT by hand");
  else writeFileSync(here("./testnet.ts"), pointed);
  step("The chain checks, against the new contract", ["tools/verify.ts"]);
  console.log(`\nDone. app.${root} is the deployment now. Still by hand: the contract's address and the transaction tables in README.md, JUDGES.md and docs/deployments.md`);
  console.log("(the steps and their transactions are in docs/demo/testnet-run.json), the fixtures of the page test (fixtures/testnet-views.json), then npm run web:build.");
}

function createHashOf(u: URL): string {
  return createHash("sha256").update(readFileSync(u)).digest("hex");
}
