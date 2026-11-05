// The copy flow the web page drives: a real signed token_diff on the real mainnet intents.near wasm, on the local host.
import { sha256 } from "@noble/hashes/sha2.js";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LocalIntents } from "../src/copy-local.ts";

const wasm = readFileSync(new URL("../../res/intents.near.wasm", import.meta.url));

test("a copied buy settles on the real intents wasm, in the signed amounts", () => {
  const c = new LocalIntents(wasm, (d) => sha256(d), Date.UTC(2026, 10, 5));
  const b0 = c.balances(0);
  const f = c.fill(0, 50_000_000n, 2400);
  const b1 = c.balances(0);
  assert.equal(b0.usdc - b1.usdc, 1200);
  assert.ok(Math.abs(b1.asset - b0.asset - 0.5) < 0.001);
  assert.equal(f.side, 1);
});

test("a copied sell settles too", () => {
  const c = new LocalIntents(wasm, (d) => sha256(d), Date.UTC(2026, 10, 5));
  const b0 = c.balances(1);
  c.fill(1, -1_000_000n, 80_000);
  const b1 = c.balances(1);
  assert.ok(Math.abs(b0.asset - b1.asset - 0.01) < 0.0001);
  assert.ok(Math.abs(b1.usdc - b0.usdc - 800) < 0.01);
});

test("a one-sided diff doesn't balance: the wasm itself refuses it", () => {
  const c = new LocalIntents(wasm, (d) => sha256(d), Date.UTC(2026, 10, 5));
  assert.match(c.replayRefused(0, 100n, 100), /invariant/);
});
