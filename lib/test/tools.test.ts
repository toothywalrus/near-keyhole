// The tools' own load-bearing pieces: where testnet keys are kept, and how an old transaction is found.
import { strict as assert } from "node:assert";
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
