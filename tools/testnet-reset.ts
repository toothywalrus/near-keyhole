// Deletes the testnet deployment and everyone in its last run, returning their NEAR to the root, so the demo can run again on a fresh contract.
// Only touches accounts this repo created under the root. Run: npx tsx tools/testnet-reset.ts
import { keyFor } from "./keys.ts";
import { Net } from "./nearkit.ts";
import { CONTRACT, ROOT, RPC } from "./testnet.ts";

const net = new Net(RPC);
const del = async (id: string) => {
  if (!id.endsWith(`.${ROOT}`)) throw new Error(`refusing to delete ${id}`);
  if (!(await net.exists(id))) return;
  try {
    await net.named(id, keyFor(id)).account.deleteAccount(ROOT);
    console.log(`deleted ${id}`);
  } catch (e) {
    console.log(`couldn't delete ${id}: ${String(e).slice(0, 120)}`);
  }
};
const ids = new Set<string>();
const stamps = new Set<string>();
const traders = await net.view<any[]>(CONTRACT, "list_traders", { from: 0, limit: 100 }).catch(() => []);
for (const t of traders) {
  ids.add(t.account);
  const m = t.account.match(/^(?:vega|lucky|mallory)([a-z0-9]*)\./);
  if (m) stamps.add(m[1]);
}
for (const s of stamps) for (const n of ["vega", "lucky", "mallory", "ines", "grif"]) ids.add(`${n}${s}.${ROOT}`);
for (const id of [...ids]) await del(id);
for (const n of ["recorder", "owner"]) await del(`${n}.${ROOT}`);
await del(CONTRACT);
console.log("root balance:", Number(await net.balance(ROOT)) / 1e24);
