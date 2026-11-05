import { strict as assert } from "node:assert";
import test from "node:test";
import { deflatedSharpe, phi, phiInv, stats } from "../src/dsr.ts";

test("the normal CDF and its inverse agree", () => {
  for (const x of [-3, -1, 0, 0.5, 2.5]) assert.ok(Math.abs(phiInv(phi(x)) - x) < 1e-3);
  assert.ok(Math.abs(phi(1.96) - 0.975) < 1e-3);
});

test("more assumed trials deflate a record; none are needed for noise to look like noise", () => {
  // A record with a decent daily Sharpe: fixed, not random, so the test is deterministic.
  const r = Array.from({ length: 90 }, (_, i) => 0.002 + 0.01 * Math.sin(i * 1.7));
  const one = deflatedSharpe(r, 1)!;
  const ten = deflatedSharpe(r, 10)!;
  const hundred = deflatedSharpe(r, 100)!;
  assert.ok(one > ten && ten > hundred, `${one} ${ten} ${hundred}`);
  assert.ok(one > 0.5);
});

test("too little data says nothing", () => {
  assert.equal(deflatedSharpe([0.1, 0.2], 10), null);
  assert.equal(deflatedSharpe([0.1, 0.1, 0.1, 0.1, 0.1, 0.1], 10), null);
  assert.equal(stats([1, 1, 1]).sharpe, 0);
});

test("a known hand value: PSR for mean/sd = 0.1 over 100 points of a symmetric series", () => {
  const r = Array.from({ length: 100 }, (_, i) => 0.1 + (i % 2 === 0 ? 1 : -1));
  const s = stats(r);
  assert.ok(Math.abs(s.sharpe - 0.1) < 1e-9);
  // kurtosis 1, skew 0: denom = 1, so z = 0.1 * sqrt(99) = 0.995.
  assert.ok(Math.abs(deflatedSharpe(r, 1)! - phi(0.1 * Math.sqrt(99))) < 1e-9);
});
