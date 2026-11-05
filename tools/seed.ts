// Builds the web app's starting state: seeded trader journals, generated from REAL recorded Chainlink rounds by simple strategies that only look at past prices, then run
// through the REAL contract wasm on the local host, month by month, at the rounds' real timestamps. The trades never happened: they are labeled SEEDED everywhere.
// Run: npm run seed. Writes web/public/seed/state.json and web/public/seed/meta.json.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hex, sha256, utf8 } from "../lib/src/bytes.ts";
import { buyerKey, DEPTH, near, NO_SETTLEMENT, Prices, Timing, TraderAgent, type Chain, type Outcome, type TokenRec } from "../lib/src/client.ts";
import { type Entry } from "../lib/src/entry.ts";
import { MiniNear } from "../lib/src/vm.ts";
import { demoSeed, PERSONAS, SEED_CONFIG, FEED_INITS, type Persona, CONTRACT, RECORDER, OWNER } from "../lib/src/seed-shared.ts";

const DAYS = Number(process.env.DAYS ?? 46);
const rounds = JSON.parse(readFileSync(new URL("../fixtures/chainlink-rounds.json", import.meta.url), "utf8")).feeds;
const FEED_NAMES = ["ETH/USD", "BTC/USD", "SOL/USD"];
const series: { t: number; p: number; id: string; updated: number }[][] = FEED_NAMES.map((s) => rounds[s].rounds.map((r: [string, string, number]) => ({ t: r[2] * 1000, p: Number(r[1]), id: r[0], updated: r[2] })));
const lastT = Math.max(...series.map((s) => s[s.length - 1].t));
const HOUR = 3600_000;
const start = Math.floor((lastT - DAYS * 86400_000) / 86400_000) * 86400_000;

const vm = new MiniNear(readFileSync(new URL("../res/keyhole.wasm", import.meta.url)), CONTRACT, start, (d) => nobleSha256(d));
vm.fund(CONTRACT, 10n ** 27n);
vm.fund(RECORDER, near(1000));
vm.fund(OWNER, near(1000));
const chain: Chain = {
  call: async (who, method, args, deposit = 0n) => vm.call(who, method, args, deposit) as Outcome,
  view: async (method, args = {}) => vm.view(method, args),
  nowMs: async () => vm.clockMs,
  advanceTo: async (ms) => { if (ms > vm.clockMs) vm.advance(ms - vm.clockMs); },
};
const init = vm.call(OWNER, "new", { owner: OWNER, config: SEED_CONFIG(RECORDER), feeds: FEED_INITS });
if (!init.ok) throw new Error(init.reason);
const timing = await Timing.read(chain);

// ---- deterministic randomness: a run can be repeated byte for byte ----
function rng(seed: string) {
  let s = BigInt("0x" + hex(sha256(utf8(seed))).slice(0, 16));
  return () => {
    s = (s * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
    return Number(s >> 40n) / 2 ** 24;
  };
}

// ---- what a strategy can see: the rounds so far ----
const seen: { t: number; p: number }[][] = [[], [], []];
const last = (f: number) => seen[f][seen[f].length - 1]?.p;
const backAt = (f: number, ms: number) => {
  const a = seen[f];
  const target = vm.clockMs - ms;
  for (let i = a.length - 1; i >= 0; i--) if (a[i].t <= target) return a[i].p;
  return a[0]?.p;
};
const ret = (f: number, ms: number) => { const b = backAt(f, ms); return b ? (last(f) - b) / b : 0; };
const usd = (f: number, dollars: number) => BigInt(Math.round((dollars / (last(f) / 1e8)) * 1e8));

type Pos = number[]; // desired dollars per feed
type Decision = { target: Pos; note: string } | null;

/** Each strategy maps the past to the dollars it wants in each feed. */
const STRATEGIES: Record<string, (hour: number, cur: Pos, r: () => number, book: number) => Decision> = {
  // Trend on ETH: hold while the 3-day return is up and the 1-day isn't falling apart.
  trend: (hour, cur, r, book) => {
    if (hour % 6 !== 2) return null;
    const m3 = ret(0, 72 * HOUR); const m1 = ret(0, 24 * HOUR);
    const want = m3 > 0.015 && m1 > -0.01 ? book * 0.9 : m3 < -0.03 && m1 < 0.005 ? -book * 0.5 : 0;
    if (Math.abs(want - cur[0]) < book * 0.1) return null;
    return { target: [want, 0, 0], note: want > 0 ? `3d +${(m3 * 100).toFixed(1)}%: trend long ETH` : want < 0 ? `3d ${(m3 * 100).toFixed(1)}%: short the slide` : "momentum gone: flat" };
  },
  // Fade BTC's sharp intraday moves, out by the day's end.
  fade: (hour, cur, r, book) => {
    const m = ret(1, 6 * HOUR);
    if (cur[1] === 0 && Math.abs(m) > 0.012 && hour % 24 < 20) {
      return { target: [0, m > 0 ? -book * 0.8 : book * 0.8, 0], note: `BTC ${m > 0 ? "+" : ""}${(m * 100).toFixed(1)}% in 6h: fade it` };
    }
    if (cur[1] !== 0 && (Math.abs(m) < 0.003 || hour % 24 >= 22)) return { target: [0, 0, 0], note: hour % 24 >= 22 ? "out before the close" : "reverted: out" };
    return null;
  },
  // ETH against BTC: long the laggard when the ratio stretches.
  pairs: (hour, cur, r, book) => {
    if (hour % 4 !== 1) return null;
    const spread = ret(0, 48 * HOUR) - ret(1, 48 * HOUR);
    if (Math.abs(spread) < 0.012) return cur[0] !== 0 ? { target: [0, 0, 0], note: "ratio back in range: flat" } : null;
    const want = spread > 0 ? [-book * 0.6, book * 0.6, 0] : [book * 0.6, -book * 0.6, 0];
    if (Math.sign(cur[0]) === Math.sign(want[0])) return null;
    return { target: want, note: `ETH/BTC ${spread > 0 ? "stretched up" : "stretched down"} ${(Math.abs(spread) * 100).toFixed(1)}%: long the laggard` };
  },
  // SOL breakouts, sized small, on a slow feed.
  breakout: (hour, cur, r, book) => {
    if (hour % 8 !== 3) return null;
    const m = ret(2, 48 * HOUR);
    const want = m > 0.04 ? book : m < -0.05 ? -book * 0.6 : 0;
    if (Math.abs(want - cur[2]) < book * 0.2) return null;
    return { target: [0, 0, want], note: want > 0 ? `SOL 2d +${(m * 100).toFixed(1)}%: breakout` : want < 0 ? `SOL 2d ${(m * 100).toFixed(1)}%: breakdown` : "no follow-through: out" };
  },
  // A coin flip with conviction: trades a lot, makes nothing, and that's the point of the liar.
  noise: (hour, cur, r, book) => {
    if (hour % 5 !== 0 || r() < 0.45) return null;
    const f = r() < 0.7 ? 0 : 1;
    const side = r() < 0.5 ? 1 : -1;
    const notes = ["this one's obvious", "tape looks heavy", "adding here", "they're trapped", "last chance entry", "size up"];
    const t: Pos = [0, 0, 0];
    t[f] = side * book * (0.5 + r());
    return { target: t, note: notes[Math.floor(r() * notes.length)] };
  },
};

// ---- register everybody ----
const agents = new Map<string, { p: Persona; a: TraderAgent; cur: Pos; rand: () => number; lastEpochPosted: number; quitAt: number; joinAt: number }>();
for (const p of PERSONAS) {
  const account = `${p.handle}.local`;
  vm.fund(account, near(p.bond + 200));
  agents.set(p.handle, { p, a: new TraderAgent(chain, account, demoSeed(p.handle), timing), cur: [0, 0, 0], rand: rng(p.handle), lastEpochPosted: -1, quitAt: p.quitDaysAgo ? lastT - p.quitDaysAgo * 86400_000 : Infinity, joinAt: start + (p.joinDay ?? 0) * 86400_000 });
}

// ---- the replay: every real round at its real time, and each strategy looking only at the past ----
type Ev = { t: number; f: number; id: string; p: number; updated: number };
const events: Ev[] = series.flatMap((s, f) => s.filter((r) => r.t >= start - 4 * 86400_000).map((r) => ({ t: r.t, f, id: r.id, p: r.p, updated: r.updated }))).sort((a, b) => a.t - b.t);
const prior = events.filter((e) => e.t < start);
for (const e of prior) seen[e.f].push({ t: e.t, p: e.p });
const prices = new Prices(chain);

async function writeEntry(x: { p: Persona; a: TraderAgent; cur: Pos; rand: () => number }, target: Pos, note: string, opening: boolean): Promise<void> {
  for (let f = 0; f < 3; f++) {
    const delta = target[f] - x.cur[f];
    if (Math.abs(delta) < 1) continue;
    if (!last(f)) continue;
    const fill = Math.round(last(f) * (1 + (delta > 0 ? 1 : -1) * 0.0004 * (0.5 + x.rand())));
    const e: Entry = { feed: f, flags: 0, qty_e8: usd(f, delta), fill_e8: BigInt(fill), settlement: NO_SETTLEMENT, note: opening ? `carry: ${note}`.slice(0, 75) : note.slice(0, 75) };
    const r = await x.a.write(e);
    if (!r.ok) throw new Error(`${x.p.handle} write: ${r.reason}`);
  }
  x.cur = target.slice();
}

let t = start;
let evAt = prior.length;
const epochOfT = (ms: number) => timing.epochOf(ms);
let epochSeen = epochOfT(start);
for (const x of agents.values()) {
  if (x.joinAt > start) continue;
  const r = await x.a.register(x.p.display, { book_usd: x.p.book, floor_bps: x.p.floorBps, base_price: near(x.p.base), slope: near(x.p.slope), bond: near(x.p.bond) });
  if (!r.ok) throw new Error(`register ${x.p.handle}: ${r.reason}`);
}
const registered = new Set([...agents.values()].filter((x) => x.joinAt <= start).map((x) => x.p.handle));
const pendingPost: { x: typeof agents extends Map<string, infer V> ? V : never; epoch: number }[] = [];

async function pumpRounds(until: number) {
  while (evAt < events.length && events[evAt].t <= until) {
    const e = events[evAt++];
    await chain.advanceTo(e.t);
    const r = vm.call(RECORDER, "record_round", { feed: e.f, round_id: String(BigInt(e.id) & 0xffffffffffffn), answer_e8: e.p, source_updated_at: String(e.updated) }, near("0.002"));
    if (!r.ok && !(r.reason ?? "").includes("forward")) throw new Error(`round: ${r.reason}`);
    seen[e.f].push({ t: e.t, p: e.p });
  }
}

while (t < lastT) {
  t += HOUR;
  await pumpRounds(Math.min(t, lastT));
  await chain.advanceTo(Math.min(t, lastT));
  const hour = Math.round((t - start) / HOUR);
  const epoch = epochOfT(t);
  // Late joiners register when their day comes.
  for (const x of agents.values()) {
    if (!registered.has(x.p.handle) && t >= x.joinAt) {
      const r = await x.a.register(x.p.display, { book_usd: x.p.book, floor_bps: x.p.floorBps, base_price: near(x.p.base), slope: near(x.p.slope), bond: near(x.p.bond) });
      if (!r.ok) throw new Error(`register ${x.p.handle}: ${r.reason}`);
      registered.add(x.p.handle);
    }
  }
  if (epoch !== epochSeen) {
    // A new day. Everyone's positions were marked at yesterday's end. Figures are posted once a round after the end exists; holders re-open.
    for (const x of agents.values()) {
      if (!registered.has(x.p.handle) || t > x.quitAt || epochSeen < epochOfT(x.joinAt)) continue;
      pendingPost.push({ x, epoch: epochSeen });
      if (x.cur.some((c) => c !== 0)) {
        const held = x.cur.slice();
        x.cur = [0, 0, 0];
        await writeEntry(x, held, "re-opened for the new epoch", true);
      }
    }
    epochSeen = epoch;
  }
  // Post yesterday's figures an hour or two in: a round after the end surely exists by then.
  if ((t - timing.epochStart(epochOfT(t))) >= 3 * HOUR && pendingPost.length) {
    await prices.load();
    for (const item of pendingPost.splice(0)) {
      const { x, epoch: ep } = item;
      let fig;
      try {
        fig = await x.a.figure(ep, prices);
      } catch {
        pendingPost.push(item); // A slow feed (SOL has a 24h heartbeat): the round after the end hasn't come yet. Try again next hour.
        continue;
      }
      const falsified = x.p.liesFromDay !== undefined && ep - epochOfT(start) >= x.p.liesFromDay ? fig.pnl_e6 + BigInt(Math.round((x.p.book * x.p.lieBps!) / 10_000 * 1e6)) : fig.pnl_e6;
      const r = await x.a.post(ep, falsified);
      if (!r.ok) throw new Error(`${x.p.handle} post ${ep}: ${r.reason}`);
    }
  }
  for (const x of agents.values()) {
    if (!registered.has(x.p.handle) || t > x.quitAt) continue;
    const d = STRATEGIES[x.p.strategy](hour, x.cur, x.rand, x.p.book);
    if (d) await writeEntry(x, d.target, d.note, false);
  }
}
await pumpRounds(lastT);
await chain.advanceTo(lastT + 1000);

// ---- past buyers: real sales, delivered and settled through the contract ----
const finalEpoch = timing.epochOf(vm.clockMs);
const salesLog: Record<string, number> = {};
let buyerN = 0;
for (const x of agents.values()) {
  const rec = await x.a.record();
  const first = Math.max(rec.first_epoch, finalEpoch - 40);
  for (let i = 0; i < x.p.pastBuyers; i++) {
    const buyer = `reader-${(buyerN++).toString(36)}.local`;
    vm.fund(buyer, near(800));
    const rand = x.rand;
    const lastPosted = rec.next_epoch - 1;
    const one = buyerKey(sha256(utf8(`seed buyer ${buyer}`)));
    let buy: Outcome | null = null;
    // A window already past its floor, or with a missed figure, isn't for sale. Real buyers would pick another.
    for (let tries = 0; tries < 8 && !buy?.ok; tries++) {
      const a = Math.floor(first + rand() * Math.max(lastPosted - first - 6, 1));
      const b = Math.min(a + 6, lastPosted - 1);
      if (b < a) break;
      buy = vm.call(buyer, "buy_window", { trader: x.a.account, first_epoch: a, last_epoch: b, buyer_pub: hex(one.pub) }, near(300)) as Outcome;
      if (!buy.ok && !/isn't for sale/.test(buy.reason ?? "")) throw new Error(`${buyer} buys ${x.p.handle}: ${buy.reason}`);
    }
    if (!buy?.ok) continue;
    const token = vm.view<TokenRec>("get_token", { token_id: buy.value });
    const del = vm.call(x.a.account, "deliver", x.a.delivery(token), near(1));
    if (!del.ok) throw new Error(`${x.p.handle} delivers: ${del.reason}`);
    salesLog[x.p.handle] = (salesLog[x.p.handle] ?? 0) + 1;
  }
}

// ---- one past scandal: a trader caught months of contract-time ago, and shown forever ----
const caught = agents.get("halcyon");
if (caught) {
  await prices.load();
  const rec = await caught.a.record();
  const eps = await chain.view<any[]>("get_epochs", { account: caught.a.account, from: rec.first_epoch, limit: 400 });
  const liar = eps.find((e) => e.posted_e6 !== null && e.entries > 0 && caught.p.liesFromDay !== undefined && e.epoch - epochOfT(start) >= caught.p.liesFromDay);
  if (liar) {
    const honest = await caught.a.figure(liar.epoch, prices);
    const prover = "lena.local";
    vm.fund(prover, near(100));
    const open = vm.call(prover, "audit_open", { trader: caught.a.account, epoch: liar.epoch }, near(3));
    if (!open.ok) throw new Error(open.reason);
    for (let i = 0; i < honest.openings.length; i += 40) {
      const s = vm.call(prover, "audit_step", { audit: open.value, openings: honest.openings.slice(i, i + 40) });
      if (!s.ok) throw new Error(s.reason);
    }
    const v = vm.call(prover, "audit_conclude", { audit: open.value, mark_indices: honest.mark_indices });
    if (!v.ok || !v.value.trader_at_fault) throw new Error(`the seeded audit didn't slash: ${v.reason ?? v.value?.detail}`);
    console.log(`halcyon was caught at epoch ${liar.epoch}: ${v.value.detail}`);
  }
}

const out = new URL("../web/public/seed/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const snapshot = vm.snapshot();
writeFileSync(`${out}state.json`, JSON.stringify(snapshot));
const allRecs = await Promise.all([...agents.values()].map((x) => x.a.record()));
const wasmHash = hex(sha256(new Uint8Array(readFileSync(new URL("../res/keyhole.wasm", import.meta.url)))));
writeFileSync(`${out}meta.json`, JSON.stringify({
  generated: new Date().toISOString(), rounds_recorded: JSON.parse(readFileSync(new URL("../fixtures/chainlink-rounds.json", import.meta.url), "utf8")).recorded,
  days: DAYS, wasm_sha256: wasmHash, clock_ms: vm.clockMs, personas: PERSONAS.map((p) => ({ handle: p.handle, display: p.display, blurb: p.blurb })),
}, null, 1));
console.log(`Seeded ${allRecs.length} traders, ${allRecs.reduce((a, r) => a + Number(r.next_seq), 0)} entries, ${allRecs.reduce((a, r) => a + r.posted_epochs, 0)} figures, ${Object.values(salesLog).reduce((a, b) => a + b, 0)} past sales. Depth ${DEPTH}.`);
for (const r of allRecs) console.log(`  ${r.handle.padEnd(14)} PnL ${(Number(r.cum_pnl_e6) / 1e6).toFixed(0).padStart(8)}  entries ${r.next_seq.padStart(4)}  posted ${String(r.posted_epochs).padStart(3)}  buyers ${r.buyers}  ${JSON.stringify(r.status).slice(0, 30)}`);
const stateSize = JSON.stringify(snapshot).length;
console.log(`state.json is ${(stateSize / 1e6).toFixed(2)} MB`);
