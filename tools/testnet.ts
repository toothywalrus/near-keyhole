// A deployment on NEAR testnet: accounts funded from a root account the faucet gave, keys in the OS keyring (tools/keys.ts).
// The contract is deployed, initialised and locked in ONE transaction signed by its own account: deploy the wasm, call `new`, delete the only key. After it, nobody
// holds a key to the contract account, so its code can't change and its balance can't move except by the contract's own rules.
import { KeyPair, actions } from "near-api-js";
import { readFileSync } from "node:fs";
import { Timing, near, Prices, type Config } from "../lib/src/client.ts";
import { deleteKey, keyFor, saveKey } from "./keys.ts";
import { Net, type Named } from "./nearkit.ts";
import { FEE_BPS, FEEDS, RECORDED, type World } from "./world.ts";
import { RpcChain, WASM } from "./vmchain.ts";

/** The current deployment's root, made by `tools/faucet.ts` on 2026-11-10. The first deployment (keyhole-g1zo8i.testnet, unlocked) stays on chain as history. */
export const ROOT = process.env.KEYHOLE_ROOT ?? "near-keyhole-y4ow.testnet";
export const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
export const CONTRACT = process.env.KEYHOLE_CONTRACT ?? `app.${ROOT}`;
/** What the contract account is funded with: storage for the code (about 440 KB) and its state. */
const CONTRACT_NEAR = 4.7;
export const BORROWED_FEED = { symbol: "ETH/USD (MPC-proven)", source: { BorrowedOracle: { oracle: "oracle.borrowed-oracle-u2hivj.testnet", pair: "ETH/USD" } } };

export const TESTNET_CONFIG = (recorder: string, treasury: string): Config => ({
  slot_secs: 20, epoch_slots: 9, post_grace_secs: 240, delivery_lead_secs: 60, delivery_grace_secs: 180, catchup_grace_secs: 600, min_price: near("0.005").toString(),
  challenge_secs: 300, unbond_secs: 600, max_round_gap_secs: 80, min_bond: near("0.3").toString(), min_coverage_bps: 5000, prover_bps: 4000,
  penalty_bps: 5000, max_window_epochs: 31, min_dispute: near("0.01").toString(), audit_bond: near("0.03").toString(), recorder, fee_bps: FEE_BPS, treasury,
  // One slot: on testnet the feeds are recorded, so this shows the rule, not a defence (docs/decisions/0020).
  price_delay_secs: 20,
});

function named(net: Net, id: string): Named {
  return net.named(id, keyFor(id));
}

/** An account under the root: reuse it if it exists and we hold its key, else create and fund it. Its key is in the keyring, read back, before it gets a yocto. */
export async function ensure(net: Net, root: Named, name: string, nearAmount: string | number): Promise<Named> {
  const id = `${name}.${root.id}`;
  if (await net.exists(id)) return named(net, id);
  const key = KeyPair.fromRandom("ed25519");
  saveKey(id, key.toString());
  await root.account.createAccount({ newAccountId: id, publicKey: key.getPublicKey(), nearToTransfer: BigInt(Math.round(Number(nearAmount) * 1e6)) * 10n ** 18n });
  for (let i = 0; i < 30 && !(await net.exists(id)); i++) await new Promise((ok) => setTimeout(ok, 1000));
  return net.named(id, key.toString());
}

/** Create the contract account, then deploy, initialise and lock it in one transaction. Refuses an account that already exists. */
export async function deployLocked(net: Net, root: Named, id: string, init: Record<string, unknown>, wasmPath: string = WASM): Promise<string> {
  if (await net.exists(id)) throw new Error(`refused: ${id} exists already; a locked deployment goes to a fresh account`);
  const key = KeyPair.fromRandom("ed25519");
  // Kept until the lock lands: if the batch failed, this key would be the only way back to the account's balance.
  saveKey(id, key.toString());
  await root.account.createAccount({ newAccountId: id, publicKey: key.getPublicKey(), nearToTransfer: BigInt(Math.round(CONTRACT_NEAR * 1e6)) * 10n ** 18n });
  for (let i = 0; i < 30 && !(await net.exists(id)); i++) await new Promise((ok) => setTimeout(ok, 1000));
  const c = net.named(id, key.toString());
  const r = await c.account.signAndSendTransaction({
    receiverId: id,
    actions: [actions.deployContract(readFileSync(wasmPath)), actions.functionCall("new", init, 100n * 10n ** 12n, 0n), actions.deleteKey(key.getPublicKey())],
    waitUntil: "FINAL" as never,
  });
  const out = net.outcome(r);
  if (!out.ok) throw new Error(`deploy + new + lock failed, the key is still in the keyring: ${out.reason}`);
  const keys = (await net.provider.viewAccessKeyList({ accountId: id } as never)) as unknown as { keys: unknown[] };
  if (keys.keys.length !== 0) throw new Error(`${id} still has ${keys.keys.length} key(s) after the lock`);
  deleteKey(id);
  return out.tx!;
}

export async function testnetWorld(): Promise<World & { chain: RpcChain; net: Net; root: Named; deployTx?: string }> {
  const net = new Net(RPC);
  const root = named(net, ROOT);
  const recorderA = await ensure(net, root, "recorder", 0.3);
  const ownerA = await ensure(net, root, "owner", 0.25);
  const treasuryA = await ensure(net, root, "treasury", 0.05);
  const chain = new RpcChain(net, CONTRACT);
  chain.defaultTgas = 100n;
  for (const a of [recorderA, ownerA, treasuryA]) chain.add(a);
  let deployTx: string | undefined;
  if (!(await net.exists(CONTRACT))) {
    deployTx = await deployLocked(net, root, CONTRACT, { owner: ownerA.id, config: TESTNET_CONFIG(recorderA.id, treasuryA.id), feeds: [...FEEDS, BORROWED_FEED] });
    console.log(`deployed, initialised and locked ${CONTRACT} in one transaction: https://testnet.nearblocks.io/txns/${deployTx}`);
  }
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  const at = [0, 0, 0];
  const series = FEEDS.map((f) => RECORDED.feeds[f.symbol].rounds as [string, string, number][]);
  // Start the replay from the recent end of the recording, so prices look like today's.
  for (let f = 0; f < 3; f++) at[f] = Math.max(0, series[f].length - 400 + (await chain.view<{ rounds: number }[]>("get_feeds"))[f].rounds);
  return {
    config: timing.config, kind: "sandbox", chain, timing, prices, net, root, contract: CONTRACT, recorder: recorderA.id, owner: ownerA.id, treasury: treasuryA.id, deployTx,
    acct: (n: string) => `${n}.${root.id}`,
    fund: async (n: string, amount: bigint) => {
      const a = await ensure(net, root, n, Number(amount / 10n ** 21n) / 1000);
      chain.add(a);
      return a.id;
    },
    rounds: async () => {
      // Past the price delay, so that these rounds can price what was written before them.
      const delay = (timing.config.price_delay_secs ?? 0) * 1000;
      if (delay) await new Promise((ok) => setTimeout(ok, delay + 1500));
      for (let f = 0; f < 3; f++) {
        const [id, answer, updated] = series[f][at[f]++ % series[f].length];
        const r = await chain.call(recorderA.id, "record_round", { feed: f, round_id: String(BigInt(id) & 0xffffffffffffn), answer_e8: Number(answer), source_updated_at: String(updated) }, near("0.002"));
        if (!r.ok) throw new Error(`record_round: ${r.reason}`);
      }
    },
    roundAt: (feed: number, answer: bigint) => chain.call(recorderA.id, "record_round", { feed, round_id: "1", answer_e8: Number(answer), source_updated_at: "1" }, near("0.002")),
    stop: () => {},
  };
}
