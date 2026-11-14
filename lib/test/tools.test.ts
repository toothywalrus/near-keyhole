// The tools' own load-bearing pieces: where testnet keys are kept, and how an old transaction is found.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pickBackend, spawnable } from "../../tools/keys.ts";
import { txOutcome } from "../../tools/nearkit.ts";

test("a missing secret-tool is told apart by ENOENT, not by its exit code (it exits 2 when run bare)", () => {
  const exits2 = (() => ({ status: 2, error: undefined })) as any;
  const missing = (() => ({ status: null, error: Object.assign(new Error("spawn secret-tool ENOENT"), { code: "ENOENT" }) })) as any;
  assert.equal(spawnable("secret-tool", exits2), true);
  assert.equal(spawnable("secret-tool", missing), false);
});

test("keys go to the macOS keychain or secret-tool; with neither there is no backend, never a silent in-memory one", () => {
  assert.equal(pickBackend("darwin", {}, () => false), "keychain");
  assert.equal(pickBackend("linux", {}, () => true), "secret-tool");
  assert.equal(pickBackend("linux", {}, () => false), "none");
  assert.equal(pickBackend("win32", {}, () => true), "none");
  assert.equal(pickBackend("linux", { NO_KEYCHAIN: "1" }, () => true), "memory");
});

test("an old transaction is looked up on archival nodes: one node's 'doesn't exist' isn't the last word", async () => {
  const answers: Record<string, unknown> = {
    "https://pruned.example": { jsonrpc: "2.0", error: { cause: { name: "UNKNOWN_TRANSACTION" } } },
    "https://archival.example": { jsonrpc: "2.0", result: { status: { SuccessValue: "" } } },
    "https://failed.example": { jsonrpc: "2.0", result: { status: { Failure: { ActionError: {} } } } },
  };
  const fake = (async (url: string) => ({ status: 200, json: async () => answers[url] })) as any;
  const found = await txOutcome("h", "s", ["https://pruned.example", "https://archival.example"], fake);
  assert.deepEqual(found, { found: true, ok: true, rpc: "https://archival.example" });
  const gone = await txOutcome("h", "s", ["https://pruned.example"], fake);
  assert.equal(gone.found, false);
  assert.equal(gone.why, "UNKNOWN_TRANSACTION");
  const failed = await txOutcome("h", "s", ["https://failed.example"], fake);
  assert.deepEqual([failed.found, failed.ok], [true, false]);
});

// The redeploy tool (tools/redeploy.ts) never touches an existing deployment and sends nothing without a confirmation.
test("a redeploy refuses anything but a fresh, funded testnet root whose key is in the keyring", async () => {
  const { refusal } = await import("../../tools/redeploy.ts");
  const ok = { rootExists: true, appExists: false, hasKey: true, balanceNear: 10 };
  assert.match(refusal({}, ok) ?? "", /KEYHOLE_ROOT/);
  assert.match(refusal({ KEYHOLE_ROOT: "someone.near" }, ok) ?? "", /testnet only/);
  assert.match(refusal({ KEYHOLE_ROOT: "near-keyhole-y4ow.testnet" }, ok) ?? "", /can't be replaced/);
  assert.match(refusal({ KEYHOLE_ROOT: "keyhole-g1zo8i.testnet" }, ok) ?? "", /can't be replaced/);
  assert.match(refusal({ KEYHOLE_ROOT: "fresh.testnet" }, { ...ok, rootExists: false }) ?? "", /doesn't exist/);
  assert.match(refusal({ KEYHOLE_ROOT: "fresh.testnet" }, { ...ok, appExists: true }) ?? "", /exists already/);
  assert.match(refusal({ KEYHOLE_ROOT: "fresh.testnet" }, { ...ok, hasKey: false }) ?? "", /no key/);
  assert.match(refusal({ KEYHOLE_ROOT: "fresh.testnet" }, { ...ok, balanceNear: 3 }) ?? "", /takes about 9/);
  assert.equal(refusal({ KEYHOLE_ROOT: "fresh.testnet" }, ok), null);
});

test("without CONFIRM_TESTNET_DEPLOY=1 the redeploy tool sends nothing: an unknown root is refused before any step", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "tools/redeploy.ts"], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8", timeout: 60_000, env: { ...process.env, KEYHOLE_ROOT: "", CONFIRM_TESTNET_DEPLOY: "", NEAR_RPC: "http://127.0.0.1:9" } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /refused: set KEYHOLE_ROOT/);
});
