// A deployed Keyhole with its cast, on the local wasm host or a sandbox node, so that every scenario runs on either.
import { hex } from "../lib/src/bytes.ts";
import { Timing, near, Prices, type Chain, type Config, TraderAgent, type Outcome } from "../lib/src/client.ts";
import { sha256, utf8 } from "../lib/src/bytes.ts";
import { VmChain, RpcChain, WASM } from "./vmchain.ts";
import { startSandbox, type Sandbox, type Named } from "./nearkit.ts";
import { readFileSync } from "node:fs";

/** Real Chainlink rounds, recorded from Ethereum mainnet. */
export const RECORDED = JSON.parse(readFileSync(new URL("../fixtures/chainlink-rounds.json", import.meta.url), "utf8"));
export const FEEDS = [
  { symbol: "ETH/USD", source: "Recorded" },
  { symbol: "BTC/USD", source: "Recorded" },
  { symbol: "SOL/USD", source: "Recorded" },
];
const seriesOf = (s: string): [string, string, number][] => RECORDED.feeds[s].rounds;

export type World = {
  config: Config;
  kind: "vm" | "sandbox";
  chain: Chain;
  timing: Timing;
  prices: Prices;
  acct(name: string): string;
  fund(name: string, amount: bigint): Promise<string>;
  /** Replay the next real round on every feed, moving the clock forward by at least a millisecond. */
  rounds(): Promise<void>;
  /** Replay one real round with this exact answer. */
  roundAt(feed: number, answer: bigint): Promise<Outcome>;
  stop(): void;
  sb?: Sandbox;
  contract: string;
  recorder: string;
  owner: string;
  /** Where the protocol's fee is credited. */
  treasury: string;
};

/** The protocol's fee in these deployments: 5% of a window sale that closes in the trader's favour (`docs/decisions/0016`). */
export const FEE_BPS = 500;

export const VM_CONFIG = (recorder: string, treasury: string = "treasury.test"): Config => ({
  slot_secs: 3600, epoch_slots: 24, post_grace_secs: 6 * 3600, delivery_lead_secs: 6 * 3600, delivery_grace_secs: 6 * 3600, catchup_grace_secs: 48 * 3600, min_price: near("0.01").toString(),
  challenge_secs: 86400, unbond_secs: 30 * 86400, max_round_gap_secs: 2 * 3600, min_bond: near(1).toString(), min_coverage_bps: 5000, prover_bps: 4000,
  penalty_bps: 5000, max_window_epochs: 31, min_dispute: near("0.01").toString(), audit_bond: near("0.2").toString(), recorder, fee_bps: FEE_BPS, treasury,
});

/** Short epochs for a real node. With no treasury, no fee. */
export const FAST_CONFIG = (recorder: string, treasury: string | null = null): Config => ({
  slot_secs: 4, epoch_slots: 4, post_grace_secs: 14, delivery_lead_secs: 8, delivery_grace_secs: 15, catchup_grace_secs: 15, min_price: near("0.001").toString(),
  challenge_secs: 16, unbond_secs: 4, max_round_gap_secs: 6, min_bond: near(1).toString(), min_coverage_bps: 5000, prover_bps: 4000,
  penalty_bps: 5000, max_window_epochs: 31, min_dispute: near("0.01").toString(), audit_bond: near("0.2").toString(), recorder, fee_bps: treasury ? FEE_BPS : 0, treasury,
});

function mkRounds(w: Pick<World, "chain" | "recorder">) {
  const at = [0, 0, 0];
  const symbols = FEEDS.map((f) => f.symbol);
  return async () => {
    for (let f = 0; f < symbols.length; f++) {
      const rows = seriesOf(symbols[f]);
      const [id, answer, updated] = rows[at[f]++ % rows.length];
      const r = await w.chain.call(w.recorder, "record_round", { feed: f, round_id: String(BigInt(id) & 0xffffffffffffn), answer_e8: Number(answer), source_updated_at: String(updated) }, near("0.002"));
      if (!r.ok) throw new Error(`record_round: ${r.reason}`);
    }
  };
}

export async function vmWorld(startMs: number = Date.UTC(2026, 7, 25), wasmPath?: string): Promise<World & { chain: VmChain }> {
  const contract = "keyhole.test";
  const chain = new VmChain(contract, startMs, wasmPath);
  const recorder = "recorder.test";
  const owner = "owner.test";
  const treasury = "treasury.test";
  for (const a of [recorder, owner, treasury]) chain.vm.fund(a, near(1000));
  const r = chain.vm.call(owner, "new", { owner, config: VM_CONFIG(recorder, treasury), feeds: FEEDS });
  if (!r.ok) throw new Error(`new: ${r.reason}`);
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  const rounds = mkRounds({ chain, recorder });
  const w = {
    config: timing.config, kind: "vm" as const, chain, timing, prices, contract, recorder, owner, treasury,
    acct: (n: string) => `${n}.test`,
    fund: async (n: string, amount: bigint) => {
      chain.vm.fund(`${n}.test`, amount);
      return `${n}.test`;
    },
    rounds: async () => {
      chain.vm.advance(1000);
      await rounds();
      chain.vm.advance(1000);
    },
    roundAt: async (feed: number, answer: bigint) => {
      chain.vm.advance(1000);
      return chain.call(recorder, "record_round", { feed, round_id: "1", answer_e8: Number(answer), source_updated_at: "1" }, near("0.002"));
    },
    stop: () => {},
  };
  return w;
}

export async function sandboxWorld(config: (recorder: string, treasury: string) => Config = FAST_CONFIG, wasmPath: string = process.env.KEYHOLE_WASM ?? WASM): Promise<World & { chain: RpcChain; sb: Sandbox }> {
  const sb = await startSandbox();
  const c = await sb.net.sub(sb.root, "keyhole", 12);
  await sb.net.deploy(c, wasmPath);
  const chain = new RpcChain(sb.net, c.id);
  const recorderA = await sb.net.sub(sb.root, "recorder", 5);
  const ownerA = await sb.net.sub(sb.root, "owner", 5);
  const treasuryA = await sb.net.sub(sb.root, "treasury", 1);
  chain.add(recorderA);
  chain.add(ownerA);
  chain.add(treasuryA);
  chain.add(c);
  const r = await chain.call(ownerA.id, "new", { owner: ownerA.id, config: config(recorderA.id, treasuryA.id), feeds: FEEDS });
  if (!r.ok) throw new Error(`new: ${r.reason}`);
  const timing = await Timing.read(chain);
  const prices = new Prices(chain);
  const rounds = mkRounds({ chain, recorder: recorderA.id });
  const named = new Map<string, Named>();
  return {
    config: timing.config, kind: "sandbox", chain, timing, prices, sb, contract: c.id, recorder: recorderA.id, owner: ownerA.id, treasury: treasuryA.id,
    acct: (n: string) => `${n}.${sb.root.id}`,
    fund: async (n: string, amount: bigint) => {
      const near_ = Number(amount / 10n ** 21n) / 1000;
      let a = named.get(n);
      if (!a) {
        a = await sb.net.sub(sb.root, n, near_);
        named.set(n, a);
        chain.add(a);
      }
      return a.id;
    },
    rounds,
    roundAt: (feed: number, answer: bigint) => chain.call(recorderA.id, "record_round", { feed, round_id: "1", answer_e8: Number(answer), source_updated_at: "1" }, near("0.002")),
    stop: () => sb.stop(),
  };
}

/** Deterministic test seeds, so a run can be repeated. Never used on anything that holds value. */
export const seedOf = (s: string): Uint8Array => sha256(utf8(`keyhole test seed: ${s}`));
export const hexOf = hex;
export function agent(w: World, account: string, seed: string): TraderAgent {
  return new TraderAgent(w.chain, account, seedOf(seed), w.timing);
}
