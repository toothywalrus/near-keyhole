// What the seed generator and the web app agree on. The demo traders' tree seeds are derived from public strings: they're fixtures, so anyone can re-run
// the seeding and check it, and the page can play the trader's agent. They hold no value and exist only on the local host.
import { sha256, utf8 } from "./bytes.ts";
import { near, type Config } from "./client.ts";

export const CONTRACT = "keyhole.local";
export const RECORDER = "recorder.local";
export const OWNER = "owner.local";
export const YOU = "you.local";

export const demoSeed = (handle: string): Uint8Array => sha256(utf8(`keyhole demo journal (public fixture, no value): ${handle}`));

export const SEED_CONFIG = (recorder: string): Config => ({
  slot_secs: 3600, epoch_slots: 24, post_grace_secs: 36 * 3600, delivery_lead_secs: 6 * 3600, delivery_grace_secs: 12 * 3600,
  challenge_secs: 40 * 3600, unbond_secs: 30 * 86400, max_round_gap_secs: 30 * 3600, min_bond: near(5).toString(), min_coverage_bps: 5000, prover_bps: 4000,
  penalty_bps: 5000, max_window_epochs: 31, min_dispute: near("0.1").toString(), audit_bond: near(2).toString(), recorder,
});

export const FEED_INITS = [
  { symbol: "ETH/USD", source: "Recorded" },
  { symbol: "BTC/USD", source: "Recorded" },
  { symbol: "SOL/USD", source: "Recorded" },
];

export type Persona = {
  handle: string;
  display: string;
  blurb: string;
  strategy: "trend" | "fade" | "pairs" | "breakout" | "noise";
  book: number;
  bond: number;
  base: string;
  slope: string;
  floorBps: number;
  pastBuyers: number;
  joinDay?: number;
  quitDaysAgo?: number;
  liesFromDay?: number;
  lieBps?: number;
};

export const PERSONAS: Persona[] = [
  { handle: "lucky-seven", display: "lucky-seven", blurb: "Top of the board. High conviction, very few words.", strategy: "noise", book: 80_000, bond: 25, base: "0.08", slope: "0.01", floorBps: 2000, pastBuyers: 1, joinDay: 12, liesFromDay: 16, lieBps: 45 },
  { handle: "north-sea", display: "north-sea", blurb: "ETH trend, held for days. Long stretches of nothing.", strategy: "trend", book: 150_000, bond: 120, base: "0.2", slope: "0.015", floorBps: 800, pastBuyers: 9 },
  { handle: "ox-and-ember", display: "ox&ember", blurb: "Fades BTC's sharp moves and goes home flat.", strategy: "fade", book: 200_000, bond: 180, base: "0.25", slope: "0.02", floorBps: 500, pastBuyers: 14 },
  { handle: "mistral", display: "mistral", blurb: "ETH against BTC. Doesn't care which way the market goes.", strategy: "pairs", book: 120_000, bond: 90, base: "0.15", slope: "0.01", floorBps: 600, pastBuyers: 6 },
  { handle: "tomo", display: "tomo", blurb: "SOL breakouts on a slow feed. New here, bond to match.", strategy: "breakout", book: 40_000, bond: 15, base: "0.05", slope: "0.005", floorBps: 1500, pastBuyers: 0, joinDay: 30 },
  { handle: "marrow", display: "marrow", blurb: "Was posting daily. Stopped eleven days ago.", strategy: "trend", book: 60_000, bond: 30, base: "0.08", slope: "0.005", floorBps: 800, pastBuyers: 3, quitDaysAgo: 11 },
  { handle: "halcyon", display: "halcyon", blurb: "Looked fine for a month. A buyer did the sum.", strategy: "noise", book: 90_000, bond: 40, base: "0.1", slope: "0.01", floorBps: 1000, pastBuyers: 4, liesFromDay: 18, lieBps: 30, quitDaysAgo: 18 },
];
