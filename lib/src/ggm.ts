// GGM window keys: the TypeScript twin of contracts/core/src/ggm.rs, held to it by fixtures/vectors.json.
import { equal, hex, sha256, utf8 } from "./bytes.ts";

const GGM = utf8("keyhole/ggm/v1");
const COMMIT = utf8("keyhole/c/v1");
const MERKLE = utf8("keyhole/m/v1");

export type NodeId = { level: number; index: number };

export const child = (v: Uint8Array, bit: number): Uint8Array => sha256(GGM, Uint8Array.of(bit), v);
export const commit = (v: Uint8Array): Uint8Array => sha256(COMMIT, v);
export const mLeaf = (c: Uint8Array): Uint8Array => sha256(MERKLE, c);
export const mInner = (c: Uint8Array, l: Uint8Array, r: Uint8Array): Uint8Array => sha256(MERKLE, c, l, r);

export function slotsOf(n: NodeId, depth: number): [number, number] {
  const size = 2 ** (depth - n.level);
  return [n.index * size, n.index * size + size - 1];
}

/** The node `to` computed from `value` at `from`, or null if `to` isn't below `from`. */
export function descend(value: Uint8Array, from: NodeId, to: NodeId): Uint8Array | null {
  if (to.level < from.level) return null;
  const shift = to.level - from.level;
  if (Math.floor(to.index / 2 ** shift) !== from.index) return null;
  let v = value;
  for (let i = shift - 1; i >= 0; i--) v = child(v, Math.floor(to.index / 2 ** i) % 2);
  return v;
}

/** The canonical cover of [first, last]: the fewest nodes whose subtrees are exactly that range, left to right. */
export function cover(first: number, last: number, depth: number): NodeId[] {
  const out: NodeId[] = [];
  const rec = (n: NodeId) => {
    const [a, b] = slotsOf(n, depth);
    if (b < first || a > last) return;
    if (first <= a && b <= last) {
      out.push(n);
      return;
    }
    rec({ level: n.level + 1, index: n.index * 2 });
    rec({ level: n.level + 1, index: n.index * 2 + 1 });
  };
  if (first <= last && last < 2 ** depth) rec({ level: 0, index: 0 });
  return out;
}

/** The whole tree of one trader. 2^(depth+1) nodes; at depth 16 about 0.3 s and 8 MB. */
/**
 * The last few trees built, by seed. A whole tree is about 400,000 SHA-256s, and the suites make dozens of traders from one test seed; a tree never
 * changes once built, so they can share it. Only a few are kept: a depth-16 tree is tens of megabytes.
 */
const BUILT = new Map<string, { nodes: Uint8Array[][]; merkle: Uint8Array[][] }>();
const KEEP = 4;

export class Tree {
  readonly nodes: Uint8Array[][];
  readonly merkle: Uint8Array[][];
  constructor(readonly seed: Uint8Array, readonly depth: number) {
    const key = `${depth}:${hex(seed)}`;
    const hit = BUILT.get(key);
    if (hit) {
      BUILT.delete(key);
      BUILT.set(key, hit);
      this.nodes = hit.nodes;
      this.merkle = hit.merkle;
      return;
    }
    this.nodes = [[seed]];
    for (let l = 0; l < depth; l++) {
      const below: Uint8Array[] = new Array(2 ** (l + 1));
      this.nodes[l].forEach((v, i) => {
        below[i * 2] = child(v, 0);
        below[i * 2 + 1] = child(v, 1);
      });
      this.nodes.push(below);
    }
    this.merkle = new Array(depth + 1);
    this.merkle[depth] = this.nodes[depth].map((v) => mLeaf(commit(v)));
    for (let l = depth - 1; l >= 0; l--) {
      this.merkle[l] = this.nodes[l].map((v, i) => mInner(commit(v), this.merkle[l + 1][i * 2], this.merkle[l + 1][i * 2 + 1]));
    }
    BUILT.set(key, { nodes: this.nodes, merkle: this.merkle });
    if (BUILT.size > KEEP) BUILT.delete(BUILT.keys().next().value!);
  }
  get root(): Uint8Array {
    return this.merkle[0][0];
  }
  leaf(slot: number): Uint8Array {
    return this.nodes[this.depth][slot];
  }
  node(n: NodeId): Uint8Array {
    return this.nodes[n.level][n.index];
  }
  /** The commitments and the proof stream the contract's `deliver` wants for [first, last]. */
  prove(first: number, last: number): { commits: Uint8Array[]; proof: Uint8Array[] } {
    const commits: Uint8Array[] = [];
    const proof: Uint8Array[] = [];
    const rec = (n: NodeId) => {
      const [a, b] = slotsOf(n, this.depth);
      if (b < first || a > last) {
        proof.push(this.merkle[n.level][n.index]);
        return;
      }
      if (first <= a && b <= last) {
        commits.push(commit(this.nodes[n.level][n.index]));
        if (n.level !== this.depth) {
          proof.push(this.merkle[n.level + 1][n.index * 2]);
          proof.push(this.merkle[n.level + 1][n.index * 2 + 1]);
        }
        return;
      }
      proof.push(commit(this.nodes[n.level][n.index]));
      rec({ level: n.level + 1, index: n.index * 2 });
      rec({ level: n.level + 1, index: n.index * 2 + 1 });
    };
    rec({ level: 0, index: 0 });
    return { commits, proof };
  }
}

/** The contract's check, for anyone who wants to see it fail before spending gas. */
export function verifyCover(root: Uint8Array, depth: number, first: number, last: number, commits: Uint8Array[], proof: Uint8Array[]): boolean {
  let ci = 0;
  let pi = 0;
  let ok = true;
  const next = () => {
    if (pi >= proof.length) {
      ok = false;
      return new Uint8Array(32);
    }
    return proof[pi++];
  };
  const rec = (n: NodeId): Uint8Array => {
    const [a, b] = slotsOf(n, depth);
    if (b < first || a > last) return next();
    if (first <= a && b <= last) {
      if (ci >= commits.length) {
        ok = false;
        return new Uint8Array(32);
      }
      const c = commits[ci++];
      if (n.level === depth) return mLeaf(c);
      const l = next();
      const r = next();
      return mInner(c, l, r);
    }
    const c = next();
    const l = rec({ level: n.level + 1, index: n.index * 2 });
    const r = rec({ level: n.level + 1, index: n.index * 2 + 1 });
    return mInner(c, l, r);
  };
  if (cover(first, last, depth).length !== commits.length || commits.length === 0) return false;
  const got = rec({ level: 0, index: 0 });
  return ok && ci === commits.length && pi === proof.length && equal(got, root);
}
