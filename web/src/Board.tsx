import { useMemo, useState } from "react";
import { Pill, Spark } from "./bits.tsx";
import { TryIt } from "./Guide.tsx";
import { dsrOf, lnear, money, pctStr, rowOf, type Row, TARGET, timeOf, useStore } from "./store.ts";

type Sort = "pnl" | "dsr" | "bond";
const TRIALS = [1, 10, 100];

function statusOf(r: Row) {
  if (r.slashed) return <Pill tone="alarm">Caught lying</Pill>;
  if (r.lapsed) return <Pill tone="warn">Stopped posting</Pill>;
  if (r.refused > 0) return <Pill tone="warn">Refused a buyer</Pill>;
  return null;
}

/** Who caught him, and what the lie cost: said plainly on the board, for good. */
function caughtLine(r: Row, proverPct: number) {
  const sl = r.t.status?.Slashed;
  if (!sl) return null;
  const by = sl.by === "you.local" ? "you" : "a buyer";
  return <span className="caught-by">Proven false by {by}, {timeOf(Number(sl.at_ms))}. It cost him his whole bond: {proverPct}% to the prover, the rest burned.</span>;
}

export function Board() {
  const s = useStore();
  const [trials, setTrials] = useState(10);
  const [sort, setSort] = useState<Sort>("pnl");
  const rows = useMemo(() => s.traders().map(rowOf), [s.version]);
  const sorted = [...rows].sort((a, b) => (sort === "pnl" ? b.pnl - a.pnl : sort === "bond" ? b.bond - a.bond : (dsrOf(b, trials) ?? -1) - (dsrOf(a, trials) ?? -1)));
  const youCaught = rows.find((r) => r.t.status?.Slashed?.by === "you.local");
  const week = (r: Row) => s.v<string>("quote", { trader: r.t.account, first_epoch: r.t.first_epoch, last_epoch: r.t.first_epoch + 6 });
  const target = rows.find((r) => r.handle === TARGET);
  const m = s.moment();
  return (
    <>
      <section className="lede">
        <div className="lede-text">
          <p className="kicker">Private trade journals, sold by the week · bonded PnL</p>
          <h1>{youCaught ? <>You caught {youCaught.t.handle}. The rest may be true.</> : <>One of these numbers is false.</>}</h1>
          <p className="say">
            Each trader below keeps an encrypted journal of every trade and posts a daily PnL with a bond behind it. Nobody can read the journals, so nobody
            can tell which figure is the lie. Buy a week of one and you read exactly that week. If his figures don't add up, prove it: the contract does the
            sum itself and takes the bond.
          </p>
          <p className="aside">A journal is what its trader wrote: a checkable signal record, not a brokerage statement.</p>
        </div>
        <TryIt target={target} price={target && !target.slashed ? week(target) : null} />
      </section>

      <div className="controls">
        <div className="seg" role="group" aria-label="Sort by">
          <span className="seg-label">Sort</span>
          {(["pnl", "dsr", "bond"] as Sort[]).map((k) => <button key={k} className={sort === k ? "on" : ""} aria-pressed={sort === k} onClick={() => setSort(k)}>{k === "pnl" ? "PnL" : k === "dsr" ? "Deflated Sharpe" : "Bond"}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Assume each book is the best of this many journals">
          <span className="seg-label">Assume each book is the best of</span>
          {TRIALS.map((t) => <button key={t} className={trials === t ? "on" : ""} aria-pressed={trials === t} onClick={() => setTrials(t)}>{t}</button>)}
          <span className="seg-label">journals</span>
        </div>
      </div>

      <div className="board" role="table" aria-label="The board: every book, its posted PnL and the bond behind it">
        <div className="brow head" role="row">
          <div role="columnheader">Book</div><div role="columnheader" className="num" title="Posted figures, less a charge for every epoch with no figure or a refused delivery">PnL</div><div role="columnheader" className="spark-col">Curve</div>
          <div role="columnheader" className="num" title="The bond, in NEAR and in dollars at $4.01, and how much of the PnL it stands behind">Bond</div><div role="columnheader" className="num">Age</div><div role="columnheader" className="num">Trades</div><div role="columnheader" className="num">Buyers</div><div role="columnheader" className="num" title="Epochs with a delivered window, so a past buyer can check them. Buyers can be a trader's own accounts">Checkable</div><div role="columnheader" className="num" title="Epochs with no figure, and epochs a buyer was refused">Gaps</div><div role="columnheader" className="num dim" title="Deflated Sharpe: the probability the true Sharpe is above zero, if this book is the best of N. Blank with under 20 days or 12 active days">P(real)</div><div role="columnheader" className="num">7 days</div>
        </div>
        {sorted.map((r) => {
          const d = dsrOf(r, trials);
          const isTarget = r.handle === TARGET && m.step < 4 && !r.slashed;
          return (
            <a className={`brow ${r.slashed ? "caught" : ""} ${isTarget ? "target" : ""}`} role="row" href={`#/t/${r.handle}`} key={r.t.id}>
              <div className="who" role="cell"><b>{r.t.handle}</b>{statusOf(r)}<small>{r.blurb}</small>{caughtLine(r, s.config.prover_bps / 100)}</div>
              <div className={`num big ${r.pnl < 0 ? "loss" : ""}`} role="cell" data-label="PnL"><span className="figure">{money(r.pnl)}</span><small>{r.slashed ? "corrected, unreliable" : r.charged > 0 ? `after ${money(-r.charged)} for gaps` : `${pctStr(r.pct)} of book`}</small></div>
              <div className="spark-col" role="cell"><Spark data={r.cum} width={104} /></div>
              <div className="num bond" role="cell" data-label="Bond">{r.bond.toFixed(0)} Ⓝ<small>{r.bondPctOfPnl !== null ? `≈$${Math.round(r.bondUsd).toLocaleString("en-US")} · ${r.bondPctOfPnl.toFixed(r.bondPctOfPnl < 10 ? 1 : 0)}% of PnL` : `≈$${Math.round(r.bondUsd).toLocaleString("en-US")}`}</small></div>
              <div className="num" role="cell" data-label="Age">{Math.floor(r.ageDays)}d</div>
              <div className="num" role="cell" data-label="Trades">{r.t.next_seq}</div>
              <div className="num" role="cell" data-label="Buyers">{r.t.buyers}</div>
              <div className="num" role="cell" data-label="Checkable">{r.covered}/{r.posted}</div>
              <div className={`num ${r.missed + r.refused > 0 ? "loss" : ""}`} role="cell" data-label="Gaps">{r.missed + r.refused === 0 ? "0" : [r.missed ? `${r.missed} missed` : "", r.refused ? `${r.refused} refused` : ""].filter(Boolean).join(", ")}</div>
              <div className="num dim" role="cell" data-label="P(real)" title={d === null ? "Too few active days to say anything" : ""}>{d === null ? "—" : `${Math.round(d * 100)}%`}</div>
              <div className="num" role="cell" data-label="7 days">{r.slashed ? "—" : `${lnear(week(r))} Ⓝ`}</div>
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
