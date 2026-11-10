// The rules a mainnet deployment would start with. Hour-long epochs, so one complete sale fits in an afternoon; the same 5% fee as everywhere here.
import { near, type Config } from "../lib/src/client.ts";
import { FEE_BPS } from "./world.ts";

export const MAINNET_RPC = process.env.NEAR_MAINNET_RPC ?? "https://rpc.mainnet.fastnear.com";

export const MAINNET_CONFIG = (recorder: string, treasury: string): Config => ({
  slot_secs: 300, epoch_slots: 12, post_grace_secs: 7200, delivery_lead_secs: 600, delivery_grace_secs: 3600, catchup_grace_secs: 3600, min_price: near("0.01").toString(),
  challenge_secs: 7500, unbond_secs: 86400, max_round_gap_secs: 3000, min_bond: near(1).toString(), min_coverage_bps: 5000, prover_bps: 4000,
  penalty_bps: 5000, max_window_epochs: 31, min_dispute: near("0.01").toString(), audit_bond: near("0.1").toString(), recorder, fee_bps: FEE_BPS, treasury,
  // Above Ethereum's worst usual inclusion time for a Chainlink report (docs/decisions/0020).
  price_delay_secs: 60,
});

/** Chainlink's AggregatorV3 proxies on Ethereum mainnet, in the contract's feed order. The recorder replays their latest rounds; the feeds say `Recorded`. */
export const CHAINLINK = [
  { symbol: "ETH/USD", proxy: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419" },
  { symbol: "BTC/USD", proxy: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c" },
  { symbol: "SOL/USD", proxy: "0x4ffC43a60e009B551865A93d232E33Fce9f01507" },
];
