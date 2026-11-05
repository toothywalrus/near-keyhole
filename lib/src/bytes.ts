// Small byte helpers shared by everything.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export const hex = (b: Uint8Array): string => bytesToHex(b);
export const unhex = (s: string): Uint8Array => hexToBytes(s.replace(/^0x/i, ""));
export const utf8 = (s: string): Uint8Array => utf8ToBytes(s);

export function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export const sha256 = (...parts: Uint8Array[]): Uint8Array => nobleSha256(cat(...parts));

export function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

export function u64le(n: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
}

export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
