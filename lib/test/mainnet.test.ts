// The owner's mainnet steps are guarded: without CONFIRM_MAINNET=1 nothing that writes even starts, and the rules they'd deploy are ones the contract accepts.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { near } from "../src/client.ts";
import { MiniNear } from "../src/vm.ts";
import { MAINNET_CONFIG } from "../../tools/mainnet-config.ts";

const run = (args: string[], env: Record<string, string>) =>
  spawnSync(process.execPath, ["--import", "tsx", "tools/mainnet.ts", ...args], {
    cwd: new URL("../..", import.meta.url).pathname,
    encoding: "utf8",
    timeout: 60_000,
    // An RPC that can't answer: even if a guard failed, nothing could reach mainnet.
    env: { ...process.env, CONFIRM_MAINNET: "", NEAR_MAINNET_RPC: "http://127.0.0.1:9", KEYHOLE_MAINNET_ROOT: "keyhole.near", ...env },
  });

for (const step of ["deploy", "sale", "copy"]) {
  test(`mainnet ${step} refuses without CONFIRM_MAINNET=1`, () => {
    const r = run([step], {});
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /refused: `\w+` sends real mainnet transactions/);
  });
}

test("a mainnet step refuses without the owner's named account", () => {
  const r = run(["deploy"], { CONFIRM_MAINNET: "1", KEYHOLE_MAINNET_ROOT: "" });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /KEYHOLE_MAINNET_ROOT/);
});

test("the mainnet config is one the contract accepts, with the 5% fee", () => {
  const vm = new MiniNear(readFileSync(new URL("../../res/keyhole.wasm", import.meta.url)), "app.keyhole.near", Date.UTC(2026, 10, 10), (d) => nobleSha256(d));
  vm.fund("app.keyhole.near", 10n ** 27n);
  vm.fund("keyhole.near", near(10));
  const r = vm.call("keyhole.near", "new", { owner: "keyhole.near", config: MAINNET_CONFIG("recorder.keyhole.near", "treasury.keyhole.near"), feeds: [{ symbol: "ETH/USD", source: "Recorded" }] });
  assert.ok(r.ok, r.reason);
  assert.equal(vm.view<{ fee_bps: number }>("get_config", {}).fee_bps, 500);
});
