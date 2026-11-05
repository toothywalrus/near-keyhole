import { useMemo, useState } from "react";
import { buyerKey } from "@lib/client.ts";
import { hex } from "@lib/bytes.ts";
import { Bar, Fact, Pill } from "./bits.tsx";
import { dateOf, dsrOf, lnear, money, pctStr, rowOf, timeOf, useStore, type Row } from "./store.ts";
import { YOU } from "@lib/seed-shared.ts";

function Chart({ r }: { r: Row }) {
  const n = r.cum.length;
  if (n < 2) return <p className="note">Too little history to draw.</p>;
  const W = 900, H = 240, B = 40;
  const lo = Math.min(0, ...r.cum), hi = Math.max(0, ...r.cum);
  const y = (v: number) => H - B - ((v - lo) / (hi - lo || 1)) * (H - B - 10);
  const x = (i: number) => (i / (n - 1)) * (W - 12) + 6;
  const line = r.cum.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const maxBar = Math.max(...r.series.map(Math.abs), 1);
  const byEpoch = new Map(r.epochs.map((e) => [e.epoch, e]));
  const at = (i: number) => byEpoch.get(r.t.first_epoch + i);
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cumulative PnL of ${r.t.handle}, per epoch`}>
      {r.cum.map((_, i) => ((at(i)?.covering_sales ?? 0) > 0 ? <rect key={`c${i}`} x={x(i) - W / n / 2} y="0" width={W / n} height={H - B} className="covered" /> : null))}
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} className="zero" />
      <path d={line} className="curve" />
      {r.cum.map((_, i) => {
        const h = (Math.abs(r.series[i]) / maxBar) * (B - 8);
        const e = at(i);
        const gap = !e || e.posted_e6 === null || e.refused_sales > 0;
        return <rect key={i} x={x(i) - 3} y={H - h - 2} width="6" height={h} className={e?.verdict?.False || gap ? "bar-false" : r.series[i] >= 0 ? "bar-up" : "bar-down"} />;
      })}
    </svg>
  );
}

export function TraderPage({ handle }: { handle: string }) {
  const s = useStore();
  const account = `${handle}.local`;
  const t = s.trader(account);
  const r = useMemo(() => rowOf(t), [s.version, account]);
  const clockEpoch = s.clock().epoch;
  const lastPosted = r.epochs.filter((e) => e.posted_e6 !== null).at(-1)?.epoch ?? clockEpoch - 1;
  const defaultLast = Math.max(t.first_epoch, lastPosted - 1);
  const defaultFirst = Math.max(t.first_epoch, defaultLast - 6);
  const [first, setFirst] = useState(defaultFirst);
  const [last, setLast] = useState(defaultLast);
  const [cheat, setCheat] = useState(false);
  const [busy, setBusy] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const days = useMemo(() => {
    const from = Math.max(t.first_epoch, clockEpoch - 34);
    return Array.from({ length: clockEpoch - from + 1 }, (_, i) => from + i);
  }, [t.first_epoch, clockEpoch]);
  const byEpoch = new Map(r.epochs.map((e) => [e.epoch, e]));
  const quote = s.v<string>("quote", { trader: account, first_epoch: first, last_epoch: last });
  const selling = t.status === "Active";
  const entries = s.entries(account, Math.max(0, Number(t.next_seq) - 6), 6).reverse();

  const pick = (e: number) => {
    if (e < first || first !== last) { setFirst(e); setLast(e); }
    else if (e >= first) setLast(Math.min(e, first + s.config.max_window_epochs - 1));
  };

  async function buy() {
    setErr(null);
    const log: string[] = [];
    const say = async (line: string) => { log.push(line); setBusy([...log]); await new Promise((ok) => setTimeout(ok, 350)); };
    await say("You made a one-time key, in this tab. It goes nowhere.");
    const one = buyerKey();
    const b = await s.chain.call(YOU, "buy_window", { trader: account, first_epoch: first, last_epoch: last, buyer_pub: hex(one.pub) }, BigInt(quote) + 5n * 10n ** 22n);
    if (!b.ok) { setErr(b.reason ?? "refused"); setBusy(null); return; }
    const id = Number(b.value);
    s.oneTime.set(id, one);
    await say(`buy_window: ${lnear(quote)} Ⓝ into escrow. NEP-171 token #${id} is yours.`);
    await say("The trader's agent rebuilds its key tree and wraps the cover nodes to your key…");
    const agent = s.agent(account);
    const d = await agent.deliver(id, cheat ? { garbage: 0 } : {});
    if (!d.ok) { setErr(d.reason ?? "refused"); setBusy(null); return; }
    await say("deliver: the contract computed the cover itself and checked each commitment against the root posted before the sale.");
    location.hash = `#/read/${id}`;
  }

  const d1 = dsrOf(r, 1), d10 = dsrOf(r, 10), d100 = dsrOf(r, 100);
  return (
    <>
      <section className="thead">
        <div>
          <p className="kicker"><a href="#/">The board</a> / {t.handle}</p>
          <h1>{t.handle} {r.slashed ? <Pill tone="alarm">Caught lying</Pill> : r.lapsed ? <Pill tone="warn">Stopped posting</Pill> : null}</h1>
          <p className="blurb">{r.blurb}</p>
        </div>
        <div className={`headline-pnl ${r.pnl < 0 ? "loss" : ""}`}>
          <div>{money(r.pnl)}</div>
          <small>{pctStr(r.pct)} of a {money(Number(t.book_usd_e6) / 1e6).replace("+", "")} declared book, {r.posted} figures{r.charged > 0 ? `, after ${money(-r.charged)} for gaps` : ""}</small>
        </div>
      </section>
      {r.slashed ? <div className="verdict alarm"><b>Proven false.</b> {t.status.Slashed.reason}. Slashed by {t.status.Slashed.by}, {timeOf(Number(t.status.Slashed.at_ms))}. The record stays.</div> : null}

      <Chart r={r} />
      <p className="caption">Cumulative PnL as posted, corrected where proven false, with every gap charged. Bars: each epoch. Shaded: epochs a past buyer holds the keys to, so somebody could have checked them.</p>

      <div className="facts">
        <Fact label="Bond at risk" note={`${s.config.prover_bps / 100}% goes to whoever proves a false figure; the rest burns.`}>{r.bond.toFixed(2)} Ⓝ</Fact>
        <Fact label="Bond against the claim" note={r.bondPctOfPnl !== null && r.bondPctOfPnl < 60 ? "A lie worth more than what it risks can still pay." : "At $4.01 a NEAR, a recorded 1Click quote."}>{`≈$${Math.round(r.bondUsd).toLocaleString("en-US")}`}{r.bondPctOfPnl !== null ? ` / ${r.bondPctOfPnl.toFixed(1)}%` : ""}</Fact>
        <Fact label="In escrow now" note={`A window losing over ${(t.floor_bps / 100).toFixed(1)}% of the book goes back to its buyer, and a penalty burns.`}>{lnear(t.liability)} Ⓝ</Fact>
        <Fact label="Age">{Math.floor(r.ageDays)} days</Fact>
        <Fact label="Trades written" note="Numbered, no gaps, each committed when written.">{t.next_seq}</Fact>
        <Fact label="Past buyers" note={`${r.covered} of ${r.posted} epochs checkable.`}>{t.buyers}</Fact>
        <Fact label="Gaps" note={`Each costs ${money(Number(r.score.charge_per_missed_e6) / 1e6).replace("+", "")} on the record. ${t.late_deliveries} deliveries refused in all.`}>{r.missed} missed, {r.refused} refused</Fact>
        <Fact label="P(real), best of 1 / 10 / 100" note="Deflated Sharpe over the public series.">{[d1, d10, d100].map((d) => (d === null ? "—" : `${Math.round(d * 100)}%`)).join(" / ")}</Fact>
      </div>

      <div className="split">
        <section className="panel buy" aria-label="Buy a window">
          <h2>Buy a window</h2>
          <p className="note">Click a first day, then a last. A window is whole epochs, so it can be audited. Cells show the posted figure.</p>
          <div className="cal">
            {days.map((e) => {
              const ep = byEpoch.get(e);
              const v = ep?.posted_e6 ? Number(ep.posted_e6) / 1e6 : null;
              const inWindow = e >= first && e <= last;
              return (
                <button key={e} className={`day ${inWindow ? "sel" : ""} ${v === null ? "none" : v >= 0 ? "pos" : "neg"}`} onClick={() => pick(e)} aria-pressed={inWindow} title={`epoch ${e}, ${dateOf(s.timing.epochStart(e))}${v === null ? ", no figure" : `: ${money(v)}`}`}>
                  <span>{dateOf(s.timing.epochStart(e)).split(" ")[0]}</span>
                </button>
              );
            })}
          </div>
          <dl className="quote">
            <dt>Window</dt><dd>{dateOf(s.timing.epochStart(first))} to {dateOf(s.timing.epochStart(last))}, {last - first + 1} {last === first ? "epoch" : "epochs"}</dd>
            <dt>On the curve now</dt><dd>sale #{t.sold + 1}: {lnear(t.base_price)} + {lnear(t.slope)} × {t.sold} per epoch</dd>
            <dt>Price</dt><dd className="price">{lnear(quote)} Ⓝ <small>held in escrow until the challenge ends</small></dd>
          </dl>
          {selling ? (
            <>
              <label className="cheat"><input type="checkbox" checked={cheat} onChange={(e) => setCheat(e.target.checked)} /> Demo: let this trader send garbage for one node</label>
              {!busy ? <button className="primary" onClick={buy}>Buy this window</button> : null}
            </>
          ) : <p className="verdict plain">This trader isn't selling.</p>}
          {err ? <p className="verdict alarm">{err}</p> : null}
          {busy ? <ol className="steps">{busy.map((l, i) => <li key={i}>{l}</li>)}</ol> : null}
        </section>

        <section className="panel" aria-label="The journal, as a stranger sees it">
          <h2>The journal, as you see it now</h2>
          <p className="note">Public: that an entry exists, its number, its time and its ciphertext. Nothing else, until you hold a key to its slot.</p>
          <ul className="journal locked">
            {entries.map((e) => (
              <li key={e.seq}>
                <span className="seq">#{e.seq}</span>
                <span className="when">{timeOf(Number(e.at_ms))}</span>
                <Bar ct={e.ct} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
