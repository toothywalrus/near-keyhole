// Signed `token_diff` intents for NEAR Intents, in the real wire format: a NEP-413 message signed with an ed25519 key the account registered on the
// contract. The same code signs for the sandbox's mainnet wasm and would sign for intents.near. (Format read from github.com/near/intents.)
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { cat, hex, sha256, utf8 } from "./bytes.ts";

const NEP413_TAG = 2 ** 31 + 413;
const VERSIONED_NONCE_PREFIX = Uint8Array.of(0x56, 0x28, 0xf6, 0xc6);

export type Signer = { accountId: string; secret: Uint8Array; publicKey: string };

export function signerFrom(accountId: string, secret: Uint8Array): Signer {
  return { accountId, secret, publicKey: `ed25519:${base58.encode(ed25519.getPublicKey(secret))}` };
}

function borshString(s: string): Uint8Array {
  const b = utf8(s);
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, b.length, true);
  return cat(len, b);
}

/** The hash a NEP-413 signature covers. */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, NEP413_TAG, true);
  return sha256(tag, borshString(message), nonce, borshString(recipient), Uint8Array.of(0));
}

/** A versioned nonce: magic || 0 (V1) || salt (4) || deadline ns (i64 LE) || 15 random bytes. */
export function versionedNonce(saltHex: string, deadlineMs: number, random: Uint8Array): Uint8Array {
  const out = new Uint8Array(32);
  out.set(VERSIONED_NONCE_PREFIX, 0);
  out[4] = 0;
  for (let i = 0; i < 4; i++) out[5 + i] = parseInt(saltHex.slice(i * 2, i * 2 + 2), 16);
  new DataView(out.buffer).setBigInt64(9, BigInt(deadlineMs) * 1_000_000n, true);
  out.set(random.slice(0, 15), 17);
  return out;
}

export type TokenDiff = Record<string, string>;
export const nep141 = (account: string) => `nep141:${account}`;

export type SignedIntent = { standard: "nep413"; payload: { message: string; nonce: string; recipient: string }; public_key: string; signature: string };

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export function signTokenDiff(s: Signer, verifyingContract: string, diff: TokenDiff, deadlineMs: number, saltHex: string, random: Uint8Array): SignedIntent {
  const message = JSON.stringify({
    signer_id: s.accountId,
    deadline: new Date(deadlineMs).toISOString(),
    intents: [{ intent: "token_diff", diff }],
  });
  const nonce = versionedNonce(saltHex, deadlineMs, random);
  const sig = ed25519.sign(nep413Hash(message, nonce, verifyingContract), s.secret);
  return { standard: "nep413", payload: { message, nonce: b64(nonce), recipient: verifyingContract }, public_key: s.publicKey, signature: `ed25519:${base58.encode(sig)}` };
}

/** What a journal entry's settlement reference commits to. */
export const settlementRef = (signed: SignedIntent): Uint8Array => sha256(utf8(JSON.stringify(signed)));
export const refHex = (signed: SignedIntent): string => hex(settlementRef(signed));

/** The protocol fee, taken from each negative delta, rounded up: `pips` per 10^6. */
export const feeOf = (amount: bigint, pips: bigint): bigint => (amount * pips + 999_999n) / 1_000_000n;

// ---- a follower's limits ----

export type CopyLimits = {
  /** Trades above this notional are refused outright (the owner's cap). */
  maxNotionalUsd: number;
  feeds: number[];
  /** Follower book / trader book: how trades are scaled. */
  scale: number;
  /** The worst the follower will pay against the trader's fill, in basis points. */
  maxSlippageBps: number;
};

export type Decision = { copy: true; qty_e8: bigint; notionalUsd: number } | { copy: false; reason: string };

export function decideCopy(qty_e8: bigint, feed: number, fill_e8: bigint, l: CopyLimits): Decision {
  if (!l.feeds.includes(feed)) return { copy: false, reason: `feed ${feed} isn't on the owner's list` };
  const q = BigInt(Math.round(Number(qty_e8) * l.scale));
  if (q === 0n) return { copy: false, reason: "that trade scales to nothing" };
  const notional = (Math.abs(Number(q)) / 1e8) * (Number(fill_e8) / 1e8);
  if (notional > l.maxNotionalUsd) return { copy: false, reason: `$${notional.toFixed(2)} is over the owner's $${l.maxNotionalUsd} cap` };
  return { copy: true, qty_e8: q, notionalUsd: notional };
}

/** Basis points the follower paid worse than the trader. Positive is worse. */
export function slippageBps(side: 1 | -1, traderPrice: number, followerPrice: number): number {
  return side * ((followerPrice - traderPrice) / traderPrice) * 10_000;
}
