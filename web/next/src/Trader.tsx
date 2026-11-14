import { useMemo, useState } from "react";
import { buyerKey } from "@lib/client.ts";
import { hex } from "@lib/bytes.ts";
import { YOU } from "@lib/seed-shared.ts";
import { dateOf, lnear, money, pctStr, rowOf, timeOf, useStore } from "../../src/store.ts";
import { Curve, Empty, Icon, Progress, Stat, statusBadge } from "./ui.tsx";

export function Trader({ handle }: { handle: string }) {
  const s = useStore();
  const account = `${handle}.local`;
  if (!s.traders().some((x) => x.account === account)) {
    return <Empty title={`No trader called ${handle}`} action={<a className="btn primary" href="#/">Back to traders</a>} />;
  }
  return <TraderBody account={account} handle={handle} />;
}

function TraderBody({ account, handle }: { account: string; handle: string }) {
  const s = useStore();
  const t = s.trader(account);
  const r = useMemo(() => rowOf(t), [s.version, account]);
  const nowEpoch = s.clock().epoch;
  const lastPosted = r.epochs.filter((e) => e.posted_e6 !== null).at(-1)?.epoch ?? nowEpoch - 1;
  const defLast = Math.max(t.first_epoch, lastPosted - 1);
  const [first, setFirst] = useState(Math.max(t.first_epoch, defLast - 6));
  const [last, setLast] = useState(defLast);
  const [badDelivery, setBadDelivery] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const days = useMemo(() => {
    const from = Math.max(t.first_epoch, nowEpoch - 34);
    return Array.from({ length: nowEpoch - from + 1 }, (_, i) => from + i);
  }, [t.first_epoch, nowEpoch]);
  const byEpoch = new Map(r.epochs.map((e) => [e.epoch, e]));
  const price = s.v<string>("quote", { trader: account, first_epoch: first, last_epoch: last });
  const span = last - first + 1;
  const selling = t.status === "Active" && !t.paused;
  const held = [...s.oneTime.keys()].filter((id) => s.token(id)?.trader === t.id);
  const entries = s.entries(account, Math.max(0, Number(t.next_seq) - 5), 5).reverse();
  const maxSpan = s.config.max_window_epochs;

  // First click picks a day; a second click on a later day extends the window to it.
  const pick = (e: number) => {
    setErr(null);
    if (first !== last || e < first) { setFirst(e); setLast(e); }
    else setLast(Math.min(e, first + maxSpan - 1));
  };

  async function buy() {
    setErr(null);
    setBusy("Making a one-time key in this tab…");
    const one = buyerKey();
    const b = await s.chain.call(YOU, "buy_window", { trader: account, first_epoch: first, last_epoch: last, buyer_pub: hex(one.pub) }, BigInt(price) + 5n * 10n ** 22n);
    if (!b.ok) { setBusy(null); setErr(`The contract refused the sale: ${b.reason ?? "no reason given"}. Try a window that has already ended.`); return; }
    const id = Number(b.value);
    s.oneTime.set(id, one);
    setBusy("Paid into escrow. The trader is delivering your keys…");
    const d = await s.agent(account).deliver(id, badDelivery ? { garbage: 0 } : {});
    if (!d.ok) { setBusy(null); setErr(`Delivery failed: ${d.reason ?? "no reason given"}. Your payment stays in escrow and comes back if they don't deliver in time.`); return; }
    location.hash = `#/w/${id}`;
  }

  const sl = t.status?.Slashed;
  return (
    <>
      <Progress />
      <div className="crumbs"><a href="#/">Traders</a><Icon name="chevron" size={12} /><span>{t.handle}</span></div>
      <header className="page-head">
        <div>
          <h1>{t.handle} {statusBadge(r)}</h1>
          <p className="muted">{r.blurb}</p>
        </div>
      </header>

      {sl ? (
        <div className="alert bad" role="note"><Icon name="alert" /><div><b>A figure was proven false.</b> {sl.reason}. Slashed by {sl.by === YOU ? "you" : "a buyer"} on {timeOf(Number(sl.at_ms))}.</div></div>
      ) : null}

      <div className="stats">
        <Stat label="PnL" value={money(r.pnl)} tone={r.pnl < 0 ? "neg" : "pos"} sub={`${pctStr(r.pct)} of a ${money(Number(t.book_usd_e6) / 1e6).slice(1)} book`} />
        <Stat label="Bond" value={`${r.bond.toFixed(r.bond < 100 ? 2 : 0)} Ⓝ`} sub={r.bondPctOfPnl !== null ? `${r.bondPctOfPnl.toFixed(r.bondPctOfPnl < 10 ? 1 : 0)}% of the PnL it backs` : "at risk on every figure"} />
        <Stat label="Buyers" value={t.buyers} sub={`${r.covered} of ${r.posted} days checkable`} />
        <Stat label="Trades" value={t.next_seq} sub={`over ${Math.floor(r.ageDays)} days`} />
        <Stat label="Gaps" value={r.missed + r.refused} sub={r.missed + r.refused ? `${r.missed} missed, ${r.refused} refused` : "none"} />
      </div>

      <div className="cols">
        <div className="col-main">
          <section className="card">
            <div className="card-head"><h2>Record</h2><span className="muted small">Cumulative, gaps charged{r.slashed ? ", false figure corrected" : ""}</span></div>
            <Curve r={r} />
          </section>
          <section className="card">
            <div className="card-head"><h2>Latest entries</h2><span className="muted small"><Icon name="lock" size={13} /> Sealed until you hold a key</span></div>
            <ul className="entries">
              {entries.map((e) => (
                <li key={e.seq} className="entry sealed">
                  <span className="entry-seq">#{e.seq}</span>
                  <span className="entry-when">{timeOf(Number(e.at_ms))}</span>
                  <span className="cipher">{e.ct}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="col-side">
          <section className="card buy" id="buy" aria-labelledby="buy-h">
            <h2 id="buy-h">Buy a window</h2>
            {selling ? (
              <>
                <p className="muted small">Pick a first day, then a last. Green and red show each day's posted figure.</p>
                <div className="cal" role="group" aria-label="Days">
                  {days.map((e) => {
                    const ep = byEpoch.get(e);
                    const v = ep?.posted_e6 != null ? Number(ep.posted_e6) / 1e6 : null;
                    const on = e >= first && e <= last;
                    const future = e >= nowEpoch;
                    const label = `${dateOf(s.timing.epochStart(e))}${v === null ? ", no figure" : `, posted ${money(v)}`}`;
                    return (
                      <button key={e} className={`day ${on ? "on" : ""} ${v === null ? "none" : v >= 0 ? "pos" : "neg"} ${future ? "future" : ""}`} onClick={() => pick(e)} aria-pressed={on} aria-label={label} title={label} disabled={busy !== null}>
                        {dateOf(s.timing.epochStart(e)).split(" ")[0]}
                      </button>
                    );
                  })}
                </div>
                <dl className="summary">
                  <div><dt>Window</dt><dd>{dateOf(s.timing.epochStart(first))}{span > 1 ? ` – ${dateOf(s.timing.epochStart(last))}` : ""} <span className="muted">({span} {span === 1 ? "day" : "days"})</span></dd></div>
                  <div><dt>Price</dt><dd className="mono strong">{lnear(price)} Ⓝ</dd></div>
                </dl>
                <p className="muted small">Held in escrow until the challenge period ends. Refunded if the trader is caught lying or doesn't deliver.</p>
                <button className="btn primary block lg" onClick={buy} disabled={busy !== null}>
                  {busy ? <><span className="spinner" aria-hidden="true" />Buying…</> : <>Buy {span === 7 ? "this week" : `${span} ${span === 1 ? "day" : "days"}`} · {lnear(price)} Ⓝ</>}
                </button>
                {busy ? <p className="muted small" role="status">{busy}</p> : null}
                {err ? <div className="alert bad small" role="alert"><Icon name="alert" /><div>{err}</div></div> : null}
                <details className="demo-opt">
                  <summary>Demo options</summary>
                  <label className="check"><input type="checkbox" checked={badDelivery} onChange={(e) => setBadDelivery(e.target.checked)} /> Make the trader deliver a bad key, so you can dispute it</label>
                </details>
              </>
            ) : (
              <p className="muted">{t.handle} isn't selling{sl ? ": a slashed trader can't sell again" : t.paused ? " right now" : ""}.</p>
            )}
            {held.length ? (
              <div className="held">
                <span className="muted small">Your windows</span>
                {held.map((id) => <a key={id} className="btn sm" href={`#/w/${id}`}><Icon name="key" size={13} />#{id}</a>)}
              </div>
            ) : null}
          </section>
          {r.bondPctOfPnl !== null && r.bondPctOfPnl < 60 && !r.slashed ? (
            <div className="alert warn small"><Icon name="shield" /><div>The bond is small next to the PnL it backs. A lie worth more than the bond could still pay, which is why buyers check.</div></div>
          ) : null}
        </aside>
      </div>
    </>
  );
}
