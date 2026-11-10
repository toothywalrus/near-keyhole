// One account from the public testnet faucet (no sign-up). Its key goes into the OS keyring (service near-lab-testnet) BEFORE the faucet is asked, and is read
// back and compared, so a funded account can't end up with a key nobody kept. One draw per run: a refusal from the faucet is reported, not retried in a loop.
//   npx tsx tools/faucet.ts --probe              the keyring round-trip only: store, read back and clear a throwaway
//   npx tsx tools/faucet.ts <name>.testnet       one draw
import { KeyPair } from "near-api-js";
import { randomBytes } from "node:crypto";
import { BACKEND, DURABLE, deleteKey, hasKey, keyFor, saveKey } from "./keys.ts";
import { Net } from "./nearkit.ts";

if (!DURABLE) {
  console.error(`refused: no OS keyring here (${BACKEND}), so the new key would be lost when this process exits`);
  process.exit(1);
}
if (process.argv[2] === "--probe") {
  const probe = `keyring-probe-${randomBytes(4).toString("hex")}.invalid`;
  const value = `throwaway-${randomBytes(8).toString("hex")}`;
  let ok = false;
  try {
    saveKey(probe, value);
    ok = keyFor(probe) === value;
  } catch (e) {
    console.error(String(e));
  }
  deleteKey(probe);
  const gone = !hasKey(probe);
  console.log(`keyring (${BACKEND}): store + read back ${ok ? "OK" : "FAILED"}, clear ${gone ? "OK" : "FAILED"}`);
  process.exit(ok && gone ? 0 : 1);
}

const id = process.argv[2];
if (!id?.endsWith(".testnet") || id.split(".").length !== 2) {
  console.error("usage: npx tsx tools/faucet.ts <name>.testnet");
  process.exit(2);
}
const net = new Net(process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com");
if (await net.exists(id)) {
  console.error(`refused: ${id} exists already`);
  process.exit(1);
}
if (hasKey(id)) {
  console.error(`refused: the keyring already holds a key for ${id}; not overwriting it`);
  process.exit(1);
}
const key = KeyPair.fromRandom("ed25519");
try {
  saveKey(id, key.toString());
} catch (e) {
  console.error(`${String((e as Error).message ?? e)}: no draw made`);
  process.exit(1);
}
if (keyFor(id) !== key.toString()) {
  console.error(`refused: the key for ${id} didn't read back from the keyring: no draw made`);
  process.exit(1);
}
console.log(`the key for ${id} is in the keyring (${BACKEND}) and reads back; public key ${key.getPublicKey().toString()}`);
const res = await fetch(process.env.FAUCET ?? "https://helper.nearprotocol.com/account", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.getPublicKey().toString() }),
});
if (!res.ok) {
  console.error(`faucet refused ${id}: HTTP ${res.status} ${(await res.text()).slice(0, 200)} (the unused key stays in the keyring)`);
  process.exit(1);
}
for (let i = 0; i < 30 && !(await net.exists(id)); i++) await new Promise((ok) => setTimeout(ok, 1000));
console.log(`created ${id}: ${Number(await net.balance(id)) / 1e24} NEAR`);
