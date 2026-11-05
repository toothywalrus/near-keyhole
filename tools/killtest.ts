// The kill test: gas for a real wrapped-node dispute, measured on a chain. Run: npm run killtest [-- testnet]
import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305, chacha20 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { cat, hex, sha256, u32le, u64le, utf8 } from "../lib/src/bytes.ts";
import { startSandbox, Net, type Named, tgas, type CallResult, yocto } from "./nearkit.ts";

const WASM = process.env.KILLTEST_WASM ?? new URL("../res/killtest.wasm", import.meta.url).pathname;
const D = 16; // tree depth: 65,536 slots

// A real GGM tree over 2^16 slots: the wrapped node is one of the window's real cover nodes, its leaf in the Merkle
// tree is H("keyhole/c/v1" || node) and the path is a real 16-level path over all of the tree's leaves.
function ggmChild(v: Uint8Array, bit: number) {
  return sha256(utf8("keyhole/ggm/v1"), Uint8Array.of(bit), v);
}
const seed = sha256(utf8("kill test seed"));
let level: Uint8Array[] = [seed];
for (let i = 0; i < D; i++) level = level.flatMap((v) => [ggmChild(v, 0), ggmChild(v, 1)]);
const leaves = level.map((v) => sha256(utf8("keyhole/c/v1"), v));
const tree: Uint8Array[][] = [leaves];
while (tree[tree.length - 1].length > 1) {
  const below = tree[tree.length - 1];
  const up: Uint8Array[] = [];
  for (let i = 0; i < below.length; i += 2) up.push(sha256(below[i], below[i + 1]));
  tree.push(up);
}
const root = tree[tree.length - 1][0];
const INDEX = 40_123;
const path = tree.slice(0, -1).map((l, d) => hex(l[(INDEX >> d) ^ 1]));
const node = level[INDEX];

// One-time buyer key, trader's ephemeral key: the real exchange.
const buyerSecret = randomBytes(32);
const buyerPub = x25519.getPublicKey(buyerSecret);
const eph = randomBytes(32);
const ephPub = x25519.getPublicKey(eph);
const shared = x25519.getSharedSecret(eph, buyerPub);
const wrapKey = sha256(utf8("keyhole/wrap/v1"), shared, ephPub, buyerPub);
const nodeIndex = 3n;

function ctr(key: Uint8Array, label: Uint8Array, data: Uint8Array) {
  const out = new Uint8Array(data);
  for (let i = 0; i * 32 < out.length; i++) {
    const b = sha256(utf8("keyhole/ctr/v1"), key, label, u32le(i));
    for (let j = 0; j < 32 && i * 32 + j < out.length; j++) out[i * 32 + j] ^= b[j];
  }
  return out;
}
const nonce = cat(u64le(nodeIndex), new Uint8Array(4));
const wrappedCtr = ctr(wrapKey, u64le(nodeIndex), node);
const wrappedChacha = chacha20(wrapKey, nonce, node, undefined, 1);
const wrappedAead = chacha20poly1305(wrapKey, nonce).encrypt(node);

const base = {
  one_time_secret: hex(buyerSecret), buyer_pub: hex(buyerPub), trader_eph: hex(ephPub),
  node_index: Number(nodeIndex), merkle_index: INDEX, path, root: hex(root),
};
const runs: [string, string, Record<string, unknown>][] = [
  ["dispute: sha-256 ctr", "dispute_sha_ctr", { ...base, wrapped: hex(wrappedCtr) }],
  ["dispute: chacha20 (wasm)", "dispute_chacha", { ...base, wrapped: hex(wrappedChacha) }],
  ["dispute: chacha20-poly1305 (crate)", "dispute_aead", { ...base, wrapped: hex(wrappedAead) }],
  ["garbage: sha-256 ctr", "dispute_sha_ctr", { ...base, wrapped: hex(randomBytes(32)) }],
  ["x25519 once", "x25519_once", { secret: hex(buyerSecret), point: hex(ephPub) }],
  ["merkle only (16 levels)", "merkle_only", { leaf: hex(leaves[INDEX]), index: INDEX, path, root: hex(root) }],
  ["entry cipher, 160 bytes", "entry_cipher", { key: hex(wrapKey), bytes: 160 }],
];

async function measure(net: Net, signer: Named, contract: string) {
  const out: Record<string, unknown>[] = [];
  for (const [label, method, args] of runs) {
    if (method === "dispute_aead" && process.env.NO_AEAD) continue;
    const r: CallResult = await net.call(signer, contract, method, args, 0n, 300n);
    console.log(`\n${label}: ${r.ok ? "ok" : "FAILED " + r.reason}  return=${JSON.stringify(r.value)}  whole tx burnt ${tgas(r.burntGas)}${r.tx ? "  tx " + r.tx : ""}`);
    for (const l of r.logs) console.log(`   ${l}`);
    out.push({ label, method, ok: r.ok, value: r.value, burnt_tgas: Number(r.burntGas) / 1e12, tx: r.tx, logs: r.logs });
  }
  return out;
}

const where = process.argv[2] ?? "sandbox";
if (where === "sandbox") {
  const sb = await startSandbox();
  const c = await sb.net.sub(sb.root, "kill", 30);
  await sb.net.deploy(c, WASM);
  const results = await measure(sb.net, c, c.id);
  writeFileSync(process.env.KILLTEST_OUT ?? "/dev/null", JSON.stringify(results, null, 1));
  sb.stop();
  process.exit(0);
} else {
  const net = new Net(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
  const id = process.env.KILLTEST_ACCOUNT!;
  const key = process.env.KILLTEST_KEY!;
  const c = net.named(id, key);
  if (process.env.DEPLOY) await net.deploy(c, WASM);
  const results = await measure(net, c, c.id);
  writeFileSync(process.env.KILLTEST_OUT ?? "/dev/null", JSON.stringify(results, null, 1));
  void yocto;
}
