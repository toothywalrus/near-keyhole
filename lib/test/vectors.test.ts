// The cross-language test: the TypeScript twin must produce every byte and every number the Rust core produces.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hex, unhex } from "../src/bytes.ts";
import { encryptEntry, encodeEntry, entryKey, openEntry, parseEntry, wrapKey, wrapXor } from "../src/entry.ts";
import { cover, descend, Tree, verifyCover } from "../src/ggm.ts";
import { Book, MAX_FEEDS, pnlE6 } from "../src/pnl.ts";

const v = JSON.parse(readFileSync(new URL("../../fixtures/vectors.json", import.meta.url), "utf8"));
const tree = new Tree(unhex(v.seed), v.depth);

test("the tree: same root, same nodes", () => {
  assert.equal(hex(tree.root), v.root);
  assert.equal(hex(tree.nodes[1][0]), v.nodes.level_1_0);
  assert.equal(hex(tree.nodes[1][1]), v.nodes.level_1_1);
  assert.equal(hex(tree.nodes[2][3]), v.nodes.level_2_3);
  assert.equal(hex(tree.leaf(17)), v.nodes.leaf_17);
});

test("covers, commitments and proof streams match byte for byte", () => {
  for (const w of v.windows) {
    const c = cover(w.first, w.last, v.depth);
    assert.deepEqual(c, w.cover.map((n: any) => ({ level: n.level, index: n.index })));
    for (let i = 0; i < c.length; i++) assert.equal(hex(tree.node(c[i])), w.cover[i].value);
    const { commits, proof } = tree.prove(w.first, w.last);
    assert.deepEqual(commits.map(hex), w.commits);
    assert.deepEqual(proof.map(hex), w.proof);
    assert.ok(verifyCover(tree.root, v.depth, w.first, w.last, commits, proof));
  }
});

test("descent from a cover node reaches its leaves and refuses others", () => {
  const n = { level: 3, index: 5 };
  const value = tree.node(n);
  const size = 2 ** (v.depth - 3);
  assert.equal(hex(descend(value, n, { level: v.depth, index: 5 * size })!), hex(tree.leaf(5 * size)));
  assert.equal(hex(descend(value, n, { level: v.depth, index: 6 * size - 1 })!), hex(tree.leaf(6 * size - 1)));
  assert.equal(descend(value, n, { level: v.depth, index: 6 * size }), null);
  assert.equal(descend(value, n, { level: v.depth, index: 5 * size - 1 }), null);
  assert.equal(descend(value, n, { level: 2, index: 2 }), null);
});

test("entries: same plaintext, key, ciphertext and tag", () => {
  for (const e of v.entries) {
    const entry = { feed: e.feed, flags: e.flags, qty_e8: BigInt(e.qty_e8), fill_e8: BigInt(e.fill_e8), settlement: unhex(e.settlement), note: e.note };
    assert.equal(hex(encodeEntry(entry)), e.plaintext);
    const key = entryKey(unhex(e.leaf), e.seq);
    assert.equal(hex(key), e.key);
    const { ct, tag } = encryptEntry(unhex(e.leaf), e.seq, e.slot, entry);
    assert.equal(hex(ct), e.ct);
    assert.equal(hex(tag), e.tag);
    const opened = openEntry(key, e.seq, e.slot, ct, tag);
    assert.ok(opened.ok && opened.entry);
    assert.deepEqual(parseEntry(unhex(e.plaintext)), entry);
    assert.equal(openEntry(key, e.seq + 1, e.slot, ct, tag).ok, false);
    assert.equal(openEntry(new Uint8Array(32), e.seq, e.slot, ct, tag).ok, false);
  }
});

test("wraps: same key, same bytes", () => {
  for (const w of v.wraps) {
    const key = wrapKey(unhex(w.shared), unhex(w.eph), unhex(w.buyer), w.token);
    assert.equal(hex(key), w.key);
    assert.equal(hex(wrapXor(key, w.position, unhex(w.node))), w.wrapped);
  }
});

test("the PnL replay: same positions, same cash at every step, same total, same published figure", () => {
  for (const b of v.books) {
    const book = new Book();
    for (const t of b.trades) {
      assert.equal(book.apply(t.feed, BigInt(t.qty_e8), BigInt(t.price_e8), b.feeds, BigInt(b.book_usd_e6)), t.applied);
      assert.equal(book.cash_e16.toString(), t.cash_e16);
    }
    assert.deepEqual(book.positions.map(String), b.positions);
    assert.equal(book.applied, b.applied);
    assert.equal(book.void, b.void);
    const total = book.markedE16(b.marks_e8.map(BigInt));
    assert.equal(total!.toString(), b.total_e16);
    assert.equal(pnlE6(total!).toString(), b.pnl_e6);
  }
  assert.equal(MAX_FEEDS, 4);
});

test("pnl rounds toward minus infinity, as Rust's div_euclid does for a positive divisor", () => {
  assert.equal(pnlE6(-1n), -1n);
  assert.equal(pnlE6(-10_000_000_000n), -1n);
  assert.equal(pnlE6(-10_000_000_001n), -2n);
  assert.equal(pnlE6(9_999_999_999n), 0n);
});
