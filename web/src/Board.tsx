import { useMemo, useState } from "react";
import { Pill, Spark } from "./bits.tsx";
import { dsrOf, lnear, money, pctStr, rowOf, type Row, useStore } from "./store.ts";

type Sort = "pnl" | "dsr" | "bond";
const TRIALS = [1, 10, 100];

function statusOf(r: Row) {
  if (r.slashed) return <Pill tone="alarm">Caught lying</Pill>;
  if (r.lapsed) return <Pill tone="warn">Stopped posting</Pill>;
  if (r.refused > 0) return <Pill tone="warn">Refused a buyer</Pill>;
  return null;
}

export function Board() {
  const s = useStore();
  const [trials, setTrials] = useState(10);
  const [sort, setSort] = useState<Sort>("pnl");
  const rows = useMemo(() => s.traders().map(rowOf), [s.version]);
  const sorted = [...rows].sort((a, b) => (sort === "pnl" ? b.pnl - a.pnl : sort === "bond" ? b.bond - a.bond : (dsrOf(b, trials) ?? -1) - (dsrOf(a, trials) ?? -1)));
  const youCaught = rows.find((r) => r.t.status?.Slashed?.by === "you.local");
  const week = (r: Row) => s.v<string>("quote", { trader: r.t.account, first_epoch: r.t.first_epoch, last_epoch: r.t.first_epoch + 6 });
  return (
    <>
      <section className="lede">
        <h1>{youCaught ? <>You caught {youCaught.t.handle}. The rest may be true.</> : <>One of these numbers is false.</>}</h1>
        <p>
          Every trader here writes an encrypted journal entry as each trade happens, then posts the day's PnL with a bond behind it. Nobody can read the journal, so nobody can tell
          which figure is the lie, until someone who bought a window of it does the sum. Then the contract does it too, and takes the bond.
        </p>
      </section>

      <div className="controls">
        <div className="seg" role="group" aria-label="Sort by">
          <span className="seg-label">Sort</span>
          {(["pnl", "dsr", "bond"] as Sort[]).map((k) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{k === "pnl" ? "PnL" : k === "dsr" ? "Deflated Sharpe" : "Bond"}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Assume each book is the best of this many">
          <span className="seg-label">Assume each book is the best of</span>
          {TRIALS.map((t) => <button key={t} className={trials === t ? "on" : ""} onClick={() => setTrials(t)}>{t}</button>)}
          <span className="seg-label">journals</span>
        </div>
      </div>

      <div className="board" role="table">
        <div className="brow head" role="row">
          <div>Book</div><div className="num" title="Posted figures, less a charge for every epoch with no figure or a refused delivery">PnL</div><div className="spark-col">Curve</div>
          <div className="num" title="The bond, in NEAR and in dollars at $4.01, and how much of the PnL it stands behind">Bond</div><div className="num">Age</div><div className="num">Trades</div><div className="num">Buyers</div><div className="num" title="Epochs with a delivered window, so a past buyer can check them. Buyers can be a trader's own accounts">Checkable</div><div className="num" title="Epochs with no figure, and epochs a buyer was refused">Gaps</div><div className="num dim" title="Deflated Sharpe: the probability the true Sharpe is above zero, if this book is the best of N. Blank with under 20 days or 12 active days">P(real)</div><div className="num">7 days</div>
        </div>
        {sorted.map((r) => {
          const d = dsrOf(r, trials);
          return (
            <a className={`brow ${r.slashed ? "caught" : ""}`} role="row" href={`#/t/${r.handle}`} key={r.t.id}>
              <div className="who"><b>{r.t.handle}</b>{statusOf(r)}<small>{r.blurb}</small></div>
              <div className={`num big ${r.pnl < 0 ? "loss" : ""}`} data-label="PnL"><span className="figure">{money(r.pnl)}</span><small>{r.slashed ? "unreliable" : r.charged > 0 ? `after ${money(-r.charged).replace("−", "−")} for gaps` : `${pctStr(r.pct)} of book`}</small></div>
              <div className="spark-col"><Spark data={r.cum} width={104} /></div>
              <div className="num bond" data-label="Bond">{r.bond.toFixed(0)} Ⓝ<small>{r.bondPctOfPnl !== null ? `≈$${Math.round(r.bondUsd).toLocaleString("en-US")} · ${r.bondPctOfPnl.toFixed(r.bondPctOfPnl < 10 ? 1 : 0)}% of PnL` : `≈$${Math.round(r.bondUsd).toLocaleString("en-US")}`}</small></div>
              <div className="num" data-label="Age">{Math.floor(r.ageDays)}d</div>
              <div className="num" data-label="Trades">{r.t.next_seq}</div>
              <div className="num" data-label="Buyers">{r.t.buyers}</div>
              <div className="num" data-label="Checkable">{r.covered}/{r.posted}</div>
              <div className={`num ${r.missed + r.refused > 0 ? "loss" : ""}`} data-label="Gaps">{r.missed + r.refused === 0 ? "0" : [r.missed ? `${r.missed} missed` : "", r.refused ? `${r.refused} refused` : ""].filter(Boolean).join(", ")}</div>
              <div className="num dim" data-label="P(real)" title={d === null ? "Too few active days to say anything" : ""}>{d === null ? "—" : `${Math.round(d * 100)}%`}</div>
              <div className="num" data-label="7 days">{r.slashed ? "—" : `${lnear(week(r))} Ⓝ`}</div>
            </a>
          );
        })}
      </div>

      <section className="fineprint">
        <p><b>What this table can't tell you.</b> A journal is what its trader wrote: nothing here shows a trade really happened. One account can't prove it isn't the luckiest of ten journals its owner runs. Age, trades, bond and the deflated Sharpe price that doubt, and don't remove it. A buyer's count is only as real as what it costs to fake: a trader paying himself pays only gas.</p>
        <p><b>Reading it.</b> PnL is priced at the first oracle round after each entry was written, never at the trader's own fill. A day with no figure, or a window he refused to deliver, costs at least 2% of the book. Checkable counts the epochs at least one past buyer holds keys to. Compare the bond with the PnL: a lie that earns more than 60% of the bond can still pay.</p>
      </section>
    </>
  );
}
