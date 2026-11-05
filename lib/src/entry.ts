// Journal entries and wraps: the TypeScript twin of contracts/core/src/entry.rs. See docs/decisions/0003.
import { chacha20 } from "@noble/ciphers/chacha.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { cat, equal, sha256, u32le, u64le, utf8 } from "./bytes.ts";

export const PLAINTEXT_LEN = 128;
export const NOTE_MAX = 75;
export const FLAG_SETTLED = 1;

export type Entry = {
  feed: number;
  flags: number;
  qty_e8: bigint;
  fill_e8: bigint;
  settlement: Uint8Array;
  note: string;
};

const noteBytes = (s: string): Uint8Array => {
  const b = utf8(s);
  if (b.length <= NOTE_MAX) return b;
  // Cut on a character boundary, so a long note never becomes invalid UTF-8.
  let n = NOTE_MAX;
  while (n > 0 && (b[n] & 0xc0) === 0x80) n--;
  return b.slice(0, n);
};

export function encodeEntry(e: Entry): Uint8Array {
  const p = new Uint8Array(PLAINTEXT_LEN);
  const d = new DataView(p.buffer);
  p[0] = 1;
  p[1] = e.feed;
  p[2] = e.flags;
  d.setBigInt64(4, e.qty_e8, true);
  d.setBigUint64(12, e.fill_e8, true);
  p.set(e.settlement, 20);
  const n = noteBytes(e.note);
  p[52] = n.length;
  p.set(n, 53);
  return p;
}

export function parseEntry(p: Uint8Array): Entry | null {
  if (p.length !== PLAINTEXT_LEN || p[0] !== 1 || p[3] !== 0) return null;
  const n = p[52];
  if (n > NOTE_MAX) return null;
  for (let i = 53 + n; i < PLAINTEXT_LEN; i++) if (p[i] !== 0) return null;
  const d = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    feed: p[1],
    flags: p[2],
    qty_e8: d.getBigInt64(4, true),
    fill_e8: d.getBigUint64(12, true),
    settlement: p.slice(20, 52),
    note: new TextDecoder().decode(p.slice(53, 53 + n)),
  };
}

export const entryKey = (leaf: Uint8Array, seq: number | bigint): Uint8Array => sha256(utf8("keyhole/entry/v1"), leaf, u64le(seq));
export const entryTag = (key: Uint8Array, seq: number | bigint, slot: number, ct: Uint8Array): Uint8Array => sha256(utf8("keyhole/tag/v1"), key, u64le(seq), u32le(slot), ct);
const NO_NONCE = new Uint8Array(12);
export const entryXor = (key: Uint8Array, data: Uint8Array): Uint8Array => chacha20(key, NO_NONCE, data, undefined, 1);

export function encryptEntry(leaf: Uint8Array, seq: number | bigint, slot: number, e: Entry): { ct: Uint8Array; tag: Uint8Array } {
  const key = entryKey(leaf, seq);
  const ct = entryXor(key, encodeEntry(e));
  return { ct, tag: entryTag(key, seq, slot, ct) };
}

export type Opened = { ok: true; entry: Entry | null } | { ok: false };

/** Open with an entry's key: `ok: false` if the tag doesn't match; `entry: null` if it does but the plaintext is malformed. */
export function openEntry(key: Uint8Array, seq: number | bigint, slot: number, ct: Uint8Array, tag: Uint8Array): Opened {
  if (!equal(entryTag(key, seq, slot, ct), tag)) return { ok: false };
  return { ok: true, entry: parseEntry(entryXor(key, ct)) };
}

// ---- wrapping sold nodes to a buyer's one-time key ----

export const wrapKey = (shared: Uint8Array, traderEph: Uint8Array, buyerPub: Uint8Array, tokenId: number | bigint): Uint8Array =>
  sha256(utf8("keyhole/wrap/v1"), shared, traderEph, buyerPub, u64le(tokenId));

export const wrapXor = (key: Uint8Array, position: number, node: Uint8Array): Uint8Array =>
  chacha20(key, cat(u32le(position), new Uint8Array(8)), node, undefined, 1);

export type OneTime = { secret: Uint8Array; pub: Uint8Array };
export function oneTimeKey(secret?: Uint8Array): OneTime {
  const s = secret ?? x25519.utils.randomSecretKey();
  return { secret: s, pub: x25519.getPublicKey(s) };
}

/** Trader's side: wrap nodes to the buyer's one-time key with a fresh ephemeral key. */
export function wrapNodes(nodes: Uint8Array[], buyerPub: Uint8Array, tokenId: number | bigint, ephSecret?: Uint8Array): { eph: Uint8Array; wrapped: Uint8Array[] } {
  const e = oneTimeKey(ephSecret);
  const key = wrapKey(x25519.getSharedSecret(e.secret, buyerPub), e.pub, buyerPub, tokenId);
  return { eph: e.pub, wrapped: nodes.map((n, i) => wrapXor(key, i, n)) };
}

/** Buyer's side: unwrap, in the browser, with the one-time secret. */
export function unwrapNodes(wrapped: Uint8Array[], eph: Uint8Array, one: OneTime, tokenId: number | bigint): Uint8Array[] {
  const key = wrapKey(x25519.getSharedSecret(one.secret, eph), eph, one.pub, tokenId);
  return wrapped.map((w, i) => wrapXor(key, i, w));
}
