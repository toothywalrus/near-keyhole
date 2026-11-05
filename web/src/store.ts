// The local chain: the real contract wasm running in this tab, starting from the seeded state. Everything the app reads comes from the contract's own views, and
// everything it does is a call into that wasm. A subscriber re-renders on each change.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { useEffect, useSyncExternalStore } from "react";
import type { Chain, Config, Clock, EntryRec, EpochRec, Outcome, Round, Score, TokenRec, TraderRec } from "@lib/client.ts";
import { near, Prices, Timing, TraderAgent } from "@lib/client.ts";
import { deflatedSharpe } from "@lib/dsr.ts";
import type { OneTime } from "@lib/entry.ts";
import { demoSeed, NEAR_USD, PERSONAS, YOU, CONTRACT, type Persona } from "@lib/seed-shared.ts";
import { MiniNear } from "@lib/vm.ts";

export type Meta = { generated: string; rounds_recorded: string; wasm_sha256: string; clock_ms: number; personas: { handle: string; display: string; blurb: string }[] };

class Store {
  vm!: MiniNear;
  meta!: Meta;
  ready = false;
  error: string | null = null;
  version = 0;
  private subs = new Set<() => void>();
  agents = new Map<string, TraderAgent>();
  /** One-time keys made in this tab, by token id. They never leave the tab. */
  oneTime = new Map<number, OneTime>();
  chain!: Chain;
  timing!: Timing;
  prices!: Prices;
  subscribe = (f: () => void) => { this.subs.add(f); return () => { this.subs.delete(f); }; };
  snapshot = () => this.version;
  bump() { this.version++; this.subs.forEach((f) => f()); }

  async boot(): Promise<void> {
    try {
      const [wasm, state, meta] = await Promise.all([
        fetch("./keyhole.wasm").then((r) => r.arrayBuffer()),
        fetch("./seed/state.json").then((r) => r.json()),
        fetch("./seed/meta.json").then((r) => r.json()),
      ]);
      this.meta = meta;
      this.vm = new MiniNear(wasm, CONTRACT, state.clockMs, (d) => nobleSha256(d));
      this.vm.restore(state);
      this.vm.fund(YOU, near(50));
      const vm = this.vm;
      this.chain = {
        call: async (who, method, args, deposit = 0n) => { const r = vm.call(who, method, args, deposit) as Outcome; this.bump(); return r; },
        view: async (method, args = {}) => vm.view(method, args),
        nowMs: async () => vm.clockMs,
        advanceTo: async (ms) => { if (ms > vm.clockMs) { vm.advance(ms - vm.clockMs); this.bump(); } },
      };
      this.timing = await Timing.read(this.chain);
      this.prices = new Prices(this.chain);
      await this.prices.load();
      this.ready = true;
    } catch (e) {
      this.error = String(e);
    }
    this.bump();
  }

  v<T = any>(method: string, args: Record<string, unknown> = {}): T { return this.vm.view<T>(method, args); }
  get config(): Config { return this.timing.config; }
  clock(): Clock { return this.v<Clock>("clock"); }
  traders(): TraderRec[] { return this.v<TraderRec[]>("list_traders", { from: 0, limit: 100 }); }
  trader(account: string): TraderRec { return this.v<TraderRec>("get_trader", { account }); }
  epochs(t: TraderRec): EpochRec[] { return this.v<EpochRec[]>("get_epochs", { account: t.account, from: t.first_epoch, limit: 400 }); }
  entries(account: string, from: number, limit: number): EntryRec[] {
    const out: EntryRec[] = [];
    for (let s = from; s < from + limit; s += 200) out.push(...this.v<EntryRec[]>("get_entries", { account, from: String(s), limit: Math.min(200, from + limit - s) }));
    return out;
  }
  token(id: number): TokenRec { return this.v<TokenRec>("get_token", { token_id: id }); }
  rounds(feed: number): Round[] { return this.prices.rounds[feed]; }
  persona(handle: string): Persona | undefined { return PERSONAS.find((p) => p.handle === handle); }
  /** The page plays the trader's agent. Building a depth-16 tree is the slow part, so it happens only when needed. */
  agent(account: string): TraderAgent {
    let a = this.agents.get(account);
    if (!a) {
      a = new TraderAgent(this.chain, account, demoSeed(account.replace(/\.local$/, "")), this.timing);
      this.agents.set(account, a);
    }
    return a;
  }
  balance(): bigint { return this.vm.balance(YOU); }
  credit(): bigint { return BigInt(this.v<string>("credit_of", { account: YOU })); }
  myTokens(): { token_id: string }[] { return this.v("nft_tokens_for_owner", { account_id: YOU }); }
}

export const store = new Store();

export function useStore(): Store {
  useSyncExternalStore(store.subscribe, store.snapshot);
  return store;
}

export function useBoot(): void {
  useEffect(() => { if (!store.vm && !store.error) void store.boot(); }, []);
}

// ---- derived numbers ----

export type Row = {
  t: TraderRec; epochs: EpochRec[]; series: number[]; cum: number[]; handle: string; blurb: string; pnl: number; pct: number; ageDays: number;
  posted: number; covered: number; bond: number; slashed: boolean; lapsed: boolean; missed: number; refused: number; returns: number[]; score: Score; bondUsd: number; bondPctOfPnl: number | null; charged: number;
};

export function rowOf(t: TraderRec): Row {
  const eps = store.epochs(t);
  const score = store.v<Score>("score", { account: t.account });
  const charge = Number(score.charge_per_missed_e6) / 1e6;
  const book = Number(t.book_usd_e6) / 1e6;
  const series: number[] = [];
  const cum: number[] = [];
  let c = 0;
  let covered = 0;
  // The public series has a value for every epoch whose grace is over: a figure, or the charge for not having one. Otherwise a trader could post only his winners.
  const byEpoch = new Map(eps.map((e) => [e.epoch, e]));
  const graceOver = Math.floor((store.vm.clockMs - store.timing.genesisMs - store.config.post_grace_secs * 1000) / store.timing.epochMs);
  const lastCounted = t.status?.Slashed || t.status === "Exited" ? t.next_epoch - 1 : Math.max(graceOver - 1, t.next_epoch - 1);
  let postedSeen = 0;
  for (let n = t.first_epoch; n <= lastCounted; n++) {
    const e = byEpoch.get(n);
    let v: number;
    if (e && e.posted_e6 !== null) {
      v = (e.verdict?.False ? Number(e.verdict.False.recomputed_e6) : Number(e.posted_e6)) / 1e6;
      postedSeen++;
      if (e.covering_sales > 0) covered++;
    } else {
      v = -charge;
    }
    if (e && e.refused_sales > 0) v -= charge;
    series.push(v);
    c += v;
    cum.push(c);
  }
  void postedSeen;
  const handleBare = t.account.replace(/\.local$/, "");
  const p = store.persona(handleBare);
  const now = store.vm.clockMs;
  const lastPosted = eps.filter((e) => e.posted_e6 !== null).at(-1);
  const lapsed = !!lastPosted && store.timing.epochOf(now) - lastPosted.epoch > 3;
  const pnl = Number(score.score_e6) / 1e6;
  const bondN = Number(BigInt(t.bond) / 10n ** 20n) / 1e4;
  const bondUsd = bondN * NEAR_USD;
  return {
    t, epochs: eps, series, cum, handle: handleBare, blurb: p?.blurb ?? "", pnl, pct: (pnl * 1e6 / Number(t.book_usd_e6)) * 100, score, bondUsd,
    bondPctOfPnl: pnl > 0 ? (bondUsd / pnl) * 100 : null, charged: (score.missed + score.refused) * charge, refused: score.refused,
    ageDays: (now - Number(t.registered_ms)) / 86400_000, posted: t.posted_epochs, covered, bond: Number(BigInt(t.bond) / 10n ** 20n) / 1e4, slashed: !!t.status?.Slashed, lapsed,
    missed: score.missed, returns: series.map((x) => x / book),
  };
}

export const dsrOf = (r: Row, trials: number): number | null => deflatedSharpe(r.returns, trials);

// ---- formatting ----

export const money = (x: number, digits = 0): string => {
  const s = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${x < 0 ? "−" : "+"}$${s}`;
};
export const lnear = (y: bigint | string, digits = 2): string => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(digits);
export const shortHex = (h: string, n = 8): string => `${h.slice(0, n)}…${h.slice(-4)}`;
export const dateOf = (ms: number): string => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
export const timeOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} ${d.toISOString().slice(11, 16)}`;
};
export const FEEDS = ["ETH", "BTC", "SOL"];
export const pctStr = (x: number): string => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(1)}%`;
