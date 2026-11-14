import { useMemo, useState } from "react";
import { lnear, money, rowOf, TARGET, useStore, type Row } from "../../src/store.ts";
import { Icon, Spark, statusBadge } from "./ui.tsx";

type Sort = "pnl" | "bond" | "buyers";

export function Traders() {
  const s = useStore();
  const [sort, setSort] = useState<Sort>("pnl");
  const rows = useMemo(() => s.traders().map(rowOf), [s.version]);
  const sorted = [...rows].sort((a, b) => (sort === "pnl" ? b.pnl - a.pnl : sort === "bond" ? b.bond - a.bond : b.t.buyers - a.t.buyers));
  const week = (r: Row) => s.v<string>("quote", { trader: r.t.account, first_epoch: r.t.first_epoch, last_epoch: r.t.first_epoch + 6 });
  const m = s.moment();
  const caught = m.caught;

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Encrypted trade journals · bonded PnL</p>
          <h1>Read the trades before you trust the number.</h1>
          <p className="lead">Each trader posts a daily PnL with a bond behind it. Buy a window of their journal to read those days. If a figure is false, prove it and the contract slashes the bond.</p>
        </div>
        <Guide step={m.step} token={m.token} caught={caught} />
      </section>

      <section className="card flush">
        <div className="card-head">
          <h2>Traders</h2>
          <div className="seg" role="group" aria-label="Sort by">
            {(["pnl", "bond", "buyers"] as Sort[]).map((k) => (
              <button key={k} className={sort === k ? "on" : ""} aria-pressed={sort === k} onClick={() => setSort(k)}>{k === "pnl" ? "PnL" : k === "bond" ? "Bond" : "Buyers"}</button>
            ))}
          </div>
        </div>
        <table className="table traders">
          <thead>
            <tr>
              <th>Trader</th>
              <th className="num">PnL</th>
              <th className="hide-sm">Record</th>
              <th className="num">Bond</th>
              <th className="num hide-sm">Buyers</th>
              <th className="num hide-xs">7 days</th>
              <th className="hide-xs" aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.t.id} className={`${r.slashed ? "is-slashed" : ""} ${r.handle === TARGET && m.step === 1 ? "is-target" : ""}`} onClick={() => { location.hash = `#/t/${r.handle}`; }}>
                <td>
                  <a className="who" href={`#/t/${r.handle}`} onClick={(e) => e.stopPropagation()}>{r.t.handle}</a>
                  <span className="who-sub">{statusBadge(r) ?? <span className="muted">{r.blurb}</span>}</span>
                </td>
                <td className={`num mono ${r.pnl < 0 ? "neg" : "pos"}`}>{money(r.pnl)}</td>
                <td className="hide-sm"><Spark data={r.cum} /></td>
                <td className="num mono">{r.bond.toFixed(0)} Ⓝ</td>
                <td className="num mono hide-sm">{r.t.buyers}</td>
                <td className="num mono hide-xs">{r.slashed ? <span className="muted">—</span> : `${lnear(week(r))} Ⓝ`}</td>
                <td className="hide-xs go"><Icon name="chevron" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="footnote">PnL counts every day: a day with no figure, or a window the trader refused to deliver, is charged against it. A journal records what its trader wrote, not proof that a trade happened.</p>
    </>
  );
}

function Guide({ step, token, caught }: { step: number; token?: number; caught?: string }) {
  const items = [
    { title: "Buy a week of lucky-seven", text: "Top of the board. Play money goes into escrow." },
    { title: "Read it", text: "Your keys open those days. The day after stays sealed." },
    { title: "Prove the false figure", text: "The contract recomputes it and slashes the bond." },
  ];
  const cta = step === 1 ? { href: `#/t/${TARGET}`, label: "Start" }
    : step === 2 ? { href: `#/w/${token}`, label: "Continue: read it" }
    : step === 3 ? { href: `#/w/${token}/check`, label: "Continue: check the figures" }
    : { href: `#/t/${caught}`, label: `See ${caught}'s record` };
  return (
    <aside className="card guide" aria-labelledby="guide-h">
      <h2 id="guide-h">{step === 4 ? "You caught a false figure" : "Try it in a minute"}</h2>
      <ol className="guide-steps">
        {items.map((it, i) => (
          <li key={i} className={i + 1 < step ? "done" : i + 1 === step ? "now" : ""}>
            <span className="guide-n">{i + 1 < step ? <Icon name="check" size={13} /> : i + 1}</span>
            <span><b>{it.title}</b><span className="muted">{it.text}</span></span>
          </li>
        ))}
      </ol>
      <a className="btn primary block" href={cta.href}>{cta.label}<Icon name="arrow" size={15} /></a>
      <p className="muted small center">No wallet needed. Runs in this tab.</p>
    </aside>
  );
}
