// Small shared pieces: icons, the mark, badges, stats, the sparkline and the curve, the three-step guide.
import type { ReactNode } from "react";
import type { Row } from "../../src/store.ts";
import { useStore } from "../../src/store.ts";

type IconName = "sun" | "moon" | "arrow" | "lock" | "unlock" | "check" | "x" | "external" | "alert" | "shield" | "key" | "chevron";
const PATHS: Record<IconName, ReactNode> = {
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  alert: <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></>,
  shield: <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3" /></>,
  chevron: <path d="M9 6l6 6-6 6" />,
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/** The mark: a keyhole cut in a rounded plate. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="mark-plate" />
      <path d="M16 7a5.5 5.5 0 0 0-3 10.1L11.6 25h8.8L19 17.1A5.5 5.5 0 0 0 16 7z" className="mark-hole" />
    </svg>
  );
}

export type Tone = "ok" | "bad" | "warn" | "info" | "neutral" | "accent";
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "pos" | "neg" }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ""}`}>{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

export function Tx({ tx, children }: { tx: string; children?: ReactNode }) {
  return (
    <a className="tx" href={`https://testnet.nearblocks.io/txns/${tx}`} target="_blank" rel="noreferrer">
      {children ?? <code>{tx.slice(0, 8)}…</code>}<Icon name="external" size={12} />
    </a>
  );
}

export function Spark({ data, width = 96, height = 28 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const all = [0, ...data];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (i: number) => (i / (data.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const end = data[data.length - 1];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="spark-zero" />
      <path d={d} className={end >= 0 ? "spark-up" : "spark-down"} />
    </svg>
  );
}

/** Cumulative PnL as the contract's record has it: posted, corrected where proven false, every gap charged. A dot marks a figure proven false. */
export function Curve({ r }: { r: Row }) {
  const n = r.cum.length;
  if (n < 2) return <p className="muted small">Too little history to draw.</p>;
  const W = 640, H = 200, P = 8;
  const lo = Math.min(0, ...r.cum), hi = Math.max(0, ...r.cum);
  const y = (v: number) => P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P);
  const x = (i: number) => P + (i / (n - 1)) * (W - 2 * P);
  const line = r.cum.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${y(0).toFixed(1)}L${x(0).toFixed(1)} ${y(0).toFixed(1)}Z`;
  const byEpoch = new Map(r.epochs.map((e) => [e.epoch, e]));
  const up = r.cum[n - 1] >= 0;
  return (
    <svg className="curve" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Cumulative PnL of ${r.t.handle} over ${n} days`}>
      <path d={area} className={up ? "curve-area up" : "curve-area down"} />
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} className="curve-zero" />
      <path d={line} className="curve-line" vectorEffect="non-scaling-stroke" />
      {r.cum.map((v, i) => (byEpoch.get(r.t.first_epoch + i)?.verdict?.False ? <circle key={i} cx={x(i)} cy={y(v)} r="4" className="curve-false" /> : null))}
    </svg>
  );
}

export function statusBadge(r: Row) {
  if (r.slashed) return <Badge tone="bad">Slashed</Badge>;
  if (r.lapsed) return <Badge tone="warn">Stopped posting</Badge>;
  if (r.refused > 0) return <Badge tone="warn">Refused a buyer</Badge>;
  return null;
}

/** The demo in three steps, and where the visitor is in it. */
const STEPS = ["Buy a week", "Read it", "Prove the false figure"];
export function Progress() {
  const s = useStore();
  const m = s.moment();
  const done = [m.bought, m.tried, !!m.caught];
  // Each step's button goes to the page that does it, or, when the visitor is already there, scrolls to the part that does.
  const next = m.step === 1 ? { href: "#/t/lucky-seven", target: "buy", label: "Buy a week" }
    : m.step === 2 ? { href: `#/w/${m.token}`, target: "after", label: "Try the day after" }
    : m.step === 3 ? { href: `#/w/${m.token}/check`, target: "figures", label: "Check the figures" }
    : null;
  const go = (e: { preventDefault(): void }) => {
    const el = next && location.hash === next.href ? document.getElementById(next.target) : null;
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  };
  return (
    <nav className="progress" aria-label="Demo progress">
      <ol>
        {STEPS.map((label, i) => (
          <li key={label} className={done[i] ? "done" : m.step === i + 1 ? "now" : ""} aria-current={m.step === i + 1 ? "step" : undefined}>
            <span className="progress-n">{done[i] ? <Icon name="check" size={12} /> : i + 1}</span>
            <span className="progress-label">{label}</span>
          </li>
        ))}
      </ol>
      {next ? <a className="btn sm primary" href={next.href} onClick={go}>{next.label}<Icon name="arrow" size={14} /></a> : <span className="progress-done"><Icon name="check" size={14} /> You caught {m.caught}</span>}
    </nav>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h1>{title}</h1>
      {children ? <p className="muted">{children}</p> : null}
      {action}
    </div>
  );
}
