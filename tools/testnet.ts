// A deployment on NEAR testnet: accounts funded from the root the faucet gave, keys in the keychain.
import { KeyPair } from "near-api-js";
import { Timing, near, Prices, type Config } from "../lib/src/client.ts";
import { keyFor, saveKey } from "./keys.ts";
import { Net, type Named } from "./nearkit.ts";
import { FEEDS, RECORDED, type World } from "./world.ts";
import { RpcChain, WASM } from "./vmchain.ts";

export const ROOT = process.env.KEYHOLE_ROOT ?? "keyhole-g1zo8i.testnet";
export const FALLBACK_FUNDER = "nlf-receivables-7mtu.testnet";
export const RPC = process.env.NEAR_RPC ?? "https://test.rpc.fastnear.com";
export const CONTRACT = process.env.KEYHOLE_CONTRACT ?? `app.${ROOT}`;

export const TESTNET_CONFIG = (recorder: string): Config => ({
  slot_secs: 20, epoch_slots: 9, post_grace_secs: 180, delivery_lead_secs: 60, delivery_grace_secs: 180,
  challenge_secs: 240, unbond_secs: 600, max_round_gap_secs: 900, min_bond: near("0.3").toString(), min_coverage_bps: 5000, prover_bps: 4000,
  penalty_bps: 5000, max_window_epochs: 31, min_dispute: near("0.01").toString(), audit_bond: near("0.03").toString(), recorder,
});

function named(net: Net, id: string): Named {
  return net.named(id, keyFor(id));
}

/** An account under the root: reuse it if it exists and we hold its key, else create and fund it. */
export async function ensure(net: Net, root: Named, name: string, nearAmount: string | number): Promise<Named> {
  const id = `${name}.${root.id}`;
  if (await net.exists(id)) return named(net, id);
  const key = KeyPair.fromRandom("ed25519");
  saveKey(id, key.toString());
  await root.account.createAccount({ newAccountId: id, publicKey: key.getPublicKey(), nearToTransfer: BigInt(Math.round(Number(nearAmount) * 1e6)) * 10n ** 18n });
  for (let i = 0; i < 30 && !(await net.exists(id)); i++) await new Promise((ok) => setTimeout(ok, 1000));
  return net.named(id, key.toString());
}

export async function testnetWorld(opts: { fresh?: boolean } = {}): Promise<World & { chain: RpcChain; net: Net; root: Named }> {
  const net = new Net(RPC);
  const root = named(net, ROOT);
  const contract = await ensure(net, root, "app", 4.6);
  for (let i = 0; i < 30 && !(await net.exists(contract.id)); i++) await new Promise((ok) => setTimeout(ok, 1000));
  const code = await net.provider.viewAccount({ accountId: contract.id });
  const recorderA = await ensure(net, root, "recorder", 0.3);
  const ownerA = await ensure(net, root, "owner", 0.25);
  const chain = new RpcChain(net, contract.id);
  chain.defaultTgas = 100n;
  chain.add(contract);
  chain.add(recorderA);
  chain.add(ownerA);
  if (code.code_hash === "11111111111111111111111111111111" || opts.fresh) {
    await net.deploy(contract, WASM);
    const r = await chain.call(ownerA.id, "new", { owner: ownerA.id, config: TESTNET_CONFIG(recorderA.id), feeds: [...FEEDS, { symbol: "ETH/USD (MPC-proven)", source: { BorrowedOracle: { oracle: "oracle.borrowed-oracle-u2hivj.testnet", pair: "ETH/USD" } } }] });
    if (!r.ok) throw new Error(`new: ${r.reason}`);
  }
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  const at = [0, 0, 0];
  const series = FEEDS.map((f) => RECORDED.feeds[f.symbol].rounds as [string, string, number][]);
  // Start the replay from the recent end of the recording, so prices look like today's.
  for (let f = 0; f < 3; f++) at[f] = Math.max(0, series[f].length - 400 + (await chain.view<{ rounds: number }[]>("get_feeds"))[f].rounds);
  return {
    config: timing.config, kind: "sandbox", chain, timing, prices, net, root, contract: contract.id, recorder: recorderA.id, owner: ownerA.id,
    acct: (n: string) => `${n}.${root.id}`,
    fund: async (n: string, amount: bigint) => {
      const a = await ensure(net, root, n, Number(amount / 10n ** 21n) / 1000);
      chain.add(a);
      return a.id;
    },
    rounds: async () => {
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
