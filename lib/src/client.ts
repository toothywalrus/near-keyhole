// The parties, in code that runs in Node and in a browser: a trader's agent, a window holder, an auditor. All the crypto is here; a chain
// is whatever implements `Chain` (the local wasm host in vm.ts, the sandbox, testnet).
import { hex, sha256, unhex } from "./bytes.ts";
import { encryptEntry, entryKey, oneTimeKey, openEntry, unwrapNodes, wrapNodes, type Entry, type OneTime } from "./entry.ts";
import { commit, cover, descend, Tree, type NodeId } from "./ggm.ts";
import { Book, MAX_FEEDS, pnlE6 } from "./pnl.ts";

export const DEPTH = 16;
export const NO_SETTLEMENT = new Uint8Array(32);

export type Outcome = { ok: boolean; value?: any; reason?: string; logs: string[]; tx?: string; burntGas: bigint; receiptGas: bigint[] };

export interface Chain {
  call(who: string, method: string, args: Record<string, unknown>, deposit?: bigint, tgas?: bigint): Promise<Outcome>;
  view<T = any>(method: string, args?: Record<string, unknown>): Promise<T>;
  nowMs(): Promise<number>;
  /** Move the chain's clock to at least `ms`: at once on the local host, by waiting on a real node. */
  advanceTo(ms: number): Promise<void>;
}

export const near = (n: number | string): bigint => {
  const [w, f = ""] = String(n).split(".");
  return BigInt(w) * 10n ** 24n + BigInt((f + "0".repeat(24)).slice(0, 24));
};
const STORAGE = near("0.01");

export type Config = {
  slot_secs: number; epoch_slots: number; post_grace_secs: number; delivery_lead_secs: number; delivery_grace_secs: number;
  challenge_secs: number; unbond_secs: number; max_round_gap_secs: number; min_bond: string; min_coverage_bps: number; prover_bps: number; penalty_bps: number;
  max_window_epochs: number; min_dispute: string; audit_bond: string; recorder: string | null;
};
export type Clock = { now_ms: string; genesis_ms: string; slot: string; epoch: number };
export type EntryRec = { seq: string; slot: number; at_ms: string; ct: string; tag: string; head: string };
export type EpochRec = { epoch: number; first_seq: string; entries: number; posted_e6: string | null; posted_ms: string | null; verdict: any; audits_passed: number; covering_sales: number; refused_sales: number; attested: any };
export type Round = { round_id: string; answer_e8: number; t_ms: string; source_updated_at: string };
export type TraderRec = {
  id: number; account: string; handle: string; root: string; registered_ms: string; first_epoch: number; status: any; bond: string; liability: string;
  book_usd_e6: string; floor_bps: number; base_price: string; slope: string; next_seq: string; head: string; next_epoch: number; posted_epochs: number;
  missed_epochs: number; cum_pnl_e6: string; sold: number; buyers: number; late_deliveries: number; refused_epochs: number; burned: string; last_post_ms: string;
};
export type Score = { posted_e6: string; missed: number; refused: number; charge_per_missed_e6: string; score_e6: string };
export type TokenRec = {
  id: number; trader: number; first_epoch: number; last_epoch: number; first_slot: number; last_slot: number; owner: string; price: string;
  buyer_pub: string | null; state: string; bought_ms: string; deliver_by_ms: string; settle_at_ms: string; resale_price: string | null;
  eph: string | null; wrapped: string[]; commits: string[]; disputes_lost: number;
};

/** The index of the first round at or after `at` (binary search over a time-sorted list), or -1. */
export function firstRoundAtOrAfter(rounds: Round[], at: number): number {
  let lo = 0;
  let hi = rounds.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Number(rounds[mid].t_ms) >= at) hi = mid;
    else lo = mid + 1;
  }
  return lo < rounds.length ? lo : -1;
}

/** Everything read from the chain for pricing, cached per feed. */
export class Prices {
  rounds: Round[][] = [];
  gapMs = 0;
  nowMs = 0;
  constructor(private chain: Chain) {}
  async load(): Promise<void> {
    const feeds = await this.chain.view<{ rounds: number }[]>("get_feeds");
    const cfg = await this.chain.view<Config>("get_config");
    this.gapMs = cfg.max_round_gap_secs * 1000;
    this.nowMs = await this.chain.nowMs();
    this.rounds = [];
    for (let f = 0; f < feeds.length; f++) {
      const all: Round[] = [];
      for (let from = 0; from < feeds[f].rounds; from += 1000) {
        all.push(...(await this.chain.view<Round[]>("get_rounds", { feed: f, from, limit: 1000 })));
      }
      this.rounds.push(all);
    }
  }
  get feeds(): number {
    return this.rounds.length;
  }
}

/**
 * The contract's price rule: the first round at or after a moment. `price: null` means void: that round came too late, or none came and the wait is over. Before
 * the wait is over with no round, the figure can't be known yet, and this throws. `index` is the hint the contract wants, even when void.
 */
export function priceOf(prices: Prices, feed: number, at: number): { index: number; price: bigint | null } {
  const rounds = prices.rounds[feed];
  const i = firstRoundAtOrAfter(rounds, at);
  if (i < 0) {
    if (prices.nowMs <= at + 2 * prices.gapMs) throw new Error(`no round after ${at} on feed ${feed} yet`);
    return { index: rounds.length, price: null };
  }
  if (Number(rounds[i].t_ms) > at + prices.gapMs) return { index: i, price: null };
  return { index: i, price: BigInt(rounds[i].answer_e8) };
}

/** Replay one epoch with the same rule as the contract. `keyOf` gives an entry's key. */
export type Replay = {
  pnl_e6: bigint;
  openings: { key: string; price_index: number }[];
  mark_indices: (number | null)[];
  trades: { seq: number; slot: number; at_ms: number; entry: Entry | null; priceE8: bigint | null; applied: boolean }[];
  book: Book;
};

export function replayEpoch(entries: EntryRec[], keyOf: (e: EntryRec) => Uint8Array, prices: Prices, book_usd_e6: bigint, epochEndMs: number): Replay {
  const book = new Book();
  const openings: Replay["openings"] = [];
  const trades: Replay["trades"] = [];
  for (const e of entries) {
    const key = keyOf(e);
    const opened = openEntry(key, BigInt(e.seq), e.slot, unhex(e.ct), unhex(e.tag));
    if (!opened.ok) throw new Error(`entry ${e.seq} doesn't open with this key`);
    let priceIndex = 0;
    let priceE8: bigint | null = null;
    let applied = false;
    const t = opened.entry;
    if (t && t.feed < prices.feeds) {
      const q = priceOf(prices, t.feed, Number(e.at_ms));
      priceIndex = q.index;
      priceE8 = q.price;
      if (priceE8 === null) book.void++;
      else applied = book.apply(t.feed, t.qty_e8, priceE8, prices.feeds, book_usd_e6);
    } else {
      book.void++;
    }
    openings.push({ key: hex(key), price_index: priceIndex });
    trades.push({ seq: Number(e.seq), slot: e.slot, at_ms: Number(e.at_ms), entry: t, priceE8, applied });
  }
  const marks: (bigint | null)[] = new Array(MAX_FEEDS).fill(null);
  const mark_indices: (number | null)[] = new Array(MAX_FEEDS).fill(null);
  for (let f = 0; f < MAX_FEEDS; f++) {
    if (book.positions[f] !== 0n) {
      const q = priceOf(prices, f, epochEndMs);
      marks[f] = q.price ?? BigInt(prices.rounds[f][q.index - 1].answer_e8);
      mark_indices[f] = q.index;
    }
  }
  return { pnl_e6: pnlE6(book.markedE16(marks)!), openings, mark_indices, trades, book };
}

export async function loadEntries(chain: Chain, account: string, firstSeq: number, count: number): Promise<EntryRec[]> {
  const out: EntryRec[] = [];
  for (let s = firstSeq; s < firstSeq + count; s += 100) out.push(...(await chain.view<EntryRec[]>("get_entries", { account, from: String(s), limit: Math.min(100, firstSeq + count - s) })));
  return out;
}

export class Timing {
  constructor(public config: Config, public genesisMs: number) {}
  static async read(chain: Chain): Promise<Timing> {
    const [config, clock] = await Promise.all([chain.view<Config>("get_config"), chain.view<Clock>("clock")]);
    return new Timing(config, Number(clock.genesis_ms));
  }
  get slotMsOf(): number { return this.slotMs; }
  get epochMs(): number { return this.config.epoch_slots * this.config.slot_secs * 1000; }
  get slotMs(): number { return this.config.slot_secs * 1000; }
  epochStart(e: number): number { return this.genesisMs + e * this.epochMs; }
  epochOf(ms: number): number { return Math.floor((ms - this.genesisMs) / this.epochMs); }
  slotOf(ms: number): number { return Math.floor((ms - this.genesisMs) / this.slotMs); }
  window(first: number, last: number): [number, number] { return [first * this.config.epoch_slots, (last + 1) * this.config.epoch_slots - 1]; }
}

/** A trader's agent: holds the tree seed, writes the journal, posts figures, delivers windows. */
export class TraderAgent {
  tree: Tree;
  constructor(readonly chain: Chain, readonly account: string, seed: Uint8Array, readonly timing: Timing) {
    this.tree = new Tree(seed, DEPTH);
  }
  register(handle: string, opts: { book_usd: number; floor_bps: number; base_price: bigint; slope: bigint; bond: bigint; root?: Uint8Array }): Promise<Outcome> {
    return this.chain.call(this.account, "register_trader", {
      handle, root: hex(opts.root ?? this.tree.root), book_usd_e6: String(opts.book_usd * 1_000_000), floor_bps: opts.floor_bps,
      base_price: opts.base_price.toString(), slope: opts.slope.toString(),
    }, opts.bond);
  }
  async record(): Promise<TraderRec> {
    return (await this.chain.view<TraderRec>("get_trader", { account: this.account }))!;
  }
  /** Encrypt and commit one entry in the current slot. */
  async write(e: Entry, opts: { leafOverride?: Uint8Array; slot?: number; seq?: number } = {}): Promise<Outcome & { seq?: number; slot?: number }> {
    const rec = await this.record();
    const clock = await this.chain.view<Clock>("clock");
    const seq = opts.seq ?? Number(rec.next_seq);
    const slot = opts.slot ?? Number(clock.slot);
    const leaf = opts.leafOverride ?? this.tree.leaf(Math.min(slot, 2 ** DEPTH - 1));
    const { ct, tag } = encryptEntry(leaf, seq, slot, e);
    const r = await this.chain.call(this.account, "commit_entry", { seq: String(seq), slot, ct: hex(ct), tag: hex(tag) }, STORAGE);
    return { ...r, seq, slot };
  }
  keyOf = (e: EntryRec): Uint8Array => entryKey(this.tree.leaf(e.slot), BigInt(e.seq));
  /** The honest figure for an ended epoch. */
  async figure(epoch: number, prices: Prices): Promise<Replay> {
    const rec = await this.record();
    const ep = (await this.chain.view<EpochRec[]>("get_epochs", { account: this.account, from: epoch, limit: 1 }))[0];
    const entries = ep ? await loadEntries(this.chain, this.account, Number(ep.first_seq), ep.entries) : [];
    return replayEpoch(entries, this.keyOf, prices, BigInt(rec.book_usd_e6), this.timing.epochStart(epoch + 1));
  }
  post(epoch: number, pnl_e6: bigint): Promise<Outcome> {
    return this.chain.call(this.account, "post_epoch", { epoch, pnl_e6: pnl_e6.toString() }, STORAGE);
  }
  /** What `deliver` wants: the cover's nodes wrapped to the holder's key, their commitments, the proof stream. */
  delivery(token: TokenRec, opts: { garbage?: number; toKey?: string } = {}): Record<string, unknown> {
    const nodes = cover(token.first_slot, token.last_slot, DEPTH).map((n) => this.tree.node(n));
    const { commits, proof } = this.tree.prove(token.first_slot, token.last_slot);
    const buyerPub = unhex(opts.toKey ?? token.buyer_pub!);
    const { eph, wrapped } = wrapNodes(nodes, buyerPub, token.id);
    if (opts.garbage !== undefined) wrapped[opts.garbage] = sha256(wrapped[opts.garbage]);
    return { token_id: token.id, buyer_pub: token.buyer_pub, eph: hex(eph), wrapped: wrapped.map(hex), commits: commits.map(hex), proof: proof.map(hex) };
  }
  async deliver(tokenId: number, opts: { garbage?: number; toKey?: string } = {}): Promise<Outcome> {
    const token = (await this.chain.view<TokenRec>("get_token", { token_id: tokenId }))!;
    return this.chain.call(this.account, "deliver", this.delivery(token, opts), near("0.05"));
  }
}

/** What a holder can do with what was delivered: all of it locally, with nobody's permission. */
export class WindowReader {
  readonly nodes: { id: NodeId; value: Uint8Array }[];
  constructor(readonly token: TokenRec, one: OneTime) {
    const ids = cover(token.first_slot, token.last_slot, DEPTH);
    const values = unwrapNodes(token.wrapped.map(unhex), unhex(token.eph!), one, token.id);
    this.nodes = ids.map((id, i) => ({ id, value: values[i] }));
  }
  /** Every node's commitment checks out: the delivery is what was committed before the sale. */
  verifyNodes(): boolean[] {
    return this.nodes.map((n, i) => hex(commit(n.value)) === this.token.commits[i]);
  }
  /** The leaf for a slot, or null if the slot is outside the window: there is no such computation. */
  leaf(slot: number): Uint8Array | null {
    for (const n of this.nodes) {
      const l = descend(n.value, n.id, { level: DEPTH, index: slot });
      if (l) return l;
    }
    return null;
  }
  key(e: EntryRec): Uint8Array | null {
    const l = this.leaf(e.slot);
    return l ? entryKey(l, BigInt(e.seq)) : null;
  }
  read(e: EntryRec): { readable: true; entry: Entry | null } | { readable: false; why: string } {
    const key = this.key(e);
    if (!key) return { readable: false, why: `slot ${e.slot} is outside this window: no node here can compute its key` };
    const opened = openEntry(key, BigInt(e.seq), e.slot, unhex(e.ct), unhex(e.tag));
    return opened.ok ? { readable: true, entry: opened.entry } : { readable: false, why: "the tag doesn't match the key this window derives" };
  }
}

export function buyerKey(secret?: Uint8Array): OneTime {
  return oneTimeKey(secret);
}

/** Run a whole audit: open, step in batches, conclude. Every step is a real transaction. */
export async function runAudit(chain: Chain, auditor: string, trader: string, epoch: number, replay: Replay, opts: { batch?: number; bond?: bigint } = {}): Promise<{ audit: number; verdict: Outcome; steps: Outcome[]; opened: Outcome }> {
  const opened = await chain.call(auditor, "audit_open", { trader, epoch }, opts.bond ?? near("0.5"));
  if (!opened.ok) throw new Error(`audit_open: ${opened.reason}`);
  const audit = Number(opened.value);
  const steps: Outcome[] = [];
  const batch = opts.batch ?? 40;
  for (let i = 0; i < replay.openings.length; i += batch) {
    const s = await chain.call(auditor, "audit_step", { audit, openings: replay.openings.slice(i, i + batch) });
    if (!s.ok) throw new Error(`audit_step: ${s.reason}`);
    steps.push(s);
  }
  const verdict = await chain.call(auditor, "audit_conclude", { audit, mark_indices: replay.mark_indices });
  return { audit, verdict, steps, opened };
}
