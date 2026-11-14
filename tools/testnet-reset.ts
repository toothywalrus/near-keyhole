// Deletes the accounts of a testnet run, returning their NEAR to the root. Only touches accounts this repo created under the root, and never a locked
// contract: with no key on it, nobody can delete it, which is the point. Run: npx tsx tools/testnet-reset.ts
import { keyFor } from "./keys.ts";
import { Net } from "./nearkit.ts";
import { CONTRACT, ROOT, RPC } from "./testnet.ts";

const net = new Net(RPC);
const keys = (await net.provider.viewAccessKeyList({ accountId: CONTRACT } as never).catch(() => ({ keys: [] }))) as unknown as { keys: unknown[] };
if ((await net.exists(CONTRACT)) && keys.keys.length === 0) {
  console.log(`${CONTRACT} is locked (no keys): it stays, as a record. Run the demo again on it with new traders, or deploy a new one under a new root (KEYHOLE_ROOT).`);
  process.exit(0);
}
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
for (const n of ["recorder", "owner", "treasury"]) await del(`${n}.${ROOT}`);
await del(CONTRACT);
console.log("root balance:", Number(await net.balance(ROOT)) / 1e24);
