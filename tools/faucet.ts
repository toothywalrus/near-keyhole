// One account from the public testnet faucet; its key goes to the macOS keychain (service near-lab-testnet).
import { KeyPair } from "near-api-js";
import { execFileSync } from "node:child_process";
const id = process.argv[2];
const key = KeyPair.fromRandom("ed25519");
for (let i = 0; i < 4; i++) {
  const res = await fetch("https://helper.nearprotocol.com/account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newAccountId: id, newAccountPublicKey: key.getPublicKey().toString() }) });
  console.log(`faucet ${id}: HTTP ${res.status} ${res.ok ? "" : (await res.text()).slice(0, 200)}`);
  if (res.ok) {
    execFileSync("security", ["add-generic-password", "-U", "-s", "near-lab-testnet", "-a", id, "-w", key.toString()]);
    console.log("key stored in the keychain");
    process.exit(0);
  }
  if (res.status !== 429) break;
  await new Promise((ok) => setTimeout(ok, 45_000));
}
process.exit(1);
