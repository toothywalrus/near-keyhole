// The one complete moment, as a guide a visitor can follow without the README: buy a week, read it through the keyhole and try
// the day after, then prove the false figure. The board shows it whole; every other page shows where you are in it.
import { Pill } from "./bits.tsx";
import { lnear, money, TARGET, type Moment, type Row, useStore } from "./store.ts";

const STEPS = [
  { short: "Buy a week", long: "Buy a week of a journal" },
  { short: "Read it", long: "Read it, then try the day after" },
  { short: "Prove the lie", long: "Check the figures, prove a false one" },
];

/** Scroll to the part of this page that does the next step, if it's here. */
function goTo(step: number): boolean {
  const el = document.querySelector(`[data-step="${step}"]`);
  if (!el) return false;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  const focusable = el.matches("button, a") ? el : el.querySelector("button, a");
  (focusable as HTMLElement | null)?.focus({ preventScroll: true });
  return true;
}

function where(m: Moment): string {
  if (m.step === 1) return `#/t/${TARGET}`;
  if (m.step === 4) return "#/";
  return `#/read/${m.token}`;
}

export function MomentStrip() {
  const s = useStore();
  const m = s.moment();
  const next = m.step === 1 ? "Pick the days, then buy" : m.step === 2 ? "Try the day after" : m.step === 3 ? "Prove a false figure" : null;
  return (
    <nav className="moment" aria-label="The demo, in three steps">
      <ol>
        {STEPS.map((x, i) => {
          const n = i + 1;
          const done = n === 1 ? m.bought : n === 2 ? m.tried : !!m.caught;
          const now = n === m.step;
          return (
            <li key={n} className={done ? "done" : now ? "now" : ""} aria-current={now ? "step" : undefined}>
              <span className="n" aria-hidden="true">{done ? "✓" : n}</span>
              <span className="label"><span className="long">{x.long}</span><span className="short">{x.short}</span>{done ? <span className="sr"> (done)</span> : null}</span>
            </li>
          );
        })}
      </ol>
      {next ? (
        <a className="go" href={where(m)} onClick={(e) => { if (goTo(m.step)) e.preventDefault(); }}>{next} ↓</a>
      ) : (
        <a className="go" href="#/">Done: you caught {m.caught}. Back to the board</a>
      )}
    </nav>
  );
}

/** The board's first screen: what you can do right now, and the one button that starts it. */
export function TryIt({ target, price }: { target: Row | undefined; price: string | null }) {
  const s = useStore();
  const m = s.moment();
  if (!target) return null;
  const caughtTarget = target.t.status?.Slashed?.by === "you.local";
  const items = [
    <>Buy a week of <b>{target.handle}</b>'s journal. {price ? <>{lnear(price)} Ⓝ of play money goes into escrow.</> : null}</>,
    <>Read it through the keyhole, then try the next day's entry. It stays sealed: nobody revokes anything.</>,
    <>Check his figures against the entries. Prove the false one, and the contract slashes his bond.</>,
  ];
  const done = [m.bought, m.tried, !!m.caught];
  return (
    <aside className="tryit lacquered" aria-labelledby="tryit-h">
      <h2 id="tryit-h">Try it: catch a false figure</h2>
      <p className="sub">About a minute, in this tab. No wallet, nothing to install.</p>
      <ol>
        {items.map((x, i) => (
          <li key={i} className={done[i] ? "done" : ""}><span className="n">{String(i + 1).padStart(2, "0")}</span><span>{x}</span></li>
        ))}
      </ol>
      {caughtTarget ? (
        <>
          <p className="result"><Pill tone="ok">Done</Pill> You caught {target.handle}. His corrected figure is on the board below, for good.</p>
          <a className="brass" href={`#/t/${target.handle}`}>See his record <span aria-hidden="true">→</span></a>
        </>
      ) : m.step === 1 ? (
        <a className="brass" href={`#/t/${target.handle}`} data-step="1">
          <span>Buy a week of {target.handle} <span aria-hidden="true">→</span></span>
          <span className="price">{target.pnl > 0 ? `posted ${money(target.pnl)}` : ""}</span>
        </a>
      ) : (
        <a className="brass" href={where(m)}>
          <span>{m.step === 2 ? "Back to your window" : m.step === 3 ? "Check the figures" : "Back to your window"} <span aria-hidden="true">→</span></span>
        </a>
      )}
      <span className="alt">Or open any book below. <a href="#/how">How it holds</a></span>
    </aside>
  );
}
