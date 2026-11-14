// Small shared drawings. No chart library: these are a few lines of SVG, in the page's own ink.
import type { ReactNode } from "react";

export function Glyph({ size = 18 }: { size?: number }) {
  return (
    <svg className="glyph" width={size} height={size * 1.3} viewBox="0 0 20 26" aria-hidden="true">
      <path d="M10 1a7 7 0 0 0-3.9 12.8L3.6 25h12.8l-2.5-11.2A7 7 0 0 0 10 1z" fill="currentColor" />
    </svg>
  );
}

/** The brass plate around a keyhole: the mark. */
export function Escutcheon({ size = 28 }: { size?: number }) {
  return (
    <svg className="escutcheon" width={size} height={size * (40 / 28)} viewBox="0 0 28 40" aria-hidden="true">
      <rect className="plate" x="0.5" y="0.5" width="27" height="39" rx="13.5" />
      <rect className="rim" x="2.5" y="2.5" width="23" height="35" rx="11.5" />
      <path className="hole" d="M14 9.5a4.6 4.6 0 0 0-2.6 8.4L9.9 29.5h8.2l-1.5-11.6A4.6 4.6 0 0 0 14 9.5z" />
    </svg>
  );
}

export function Spark({ data, width = 132, height = 34 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <svg width={width} height={height} className="spark" aria-hidden="true" />;
  const all = [0, ...data];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (data.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - lo) / span) * (height - 4);
  const d = data.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const end = data[data.length - 1];
  return (
    <svg width={width} height={height} className="spark" role="img" aria-label={`cumulative PnL, ending ${end.toFixed(0)}`}>
      <line x1="0" x2={width} y1={y(0)} y2={y(0)} className="zero" />
      <path d={d} className={end >= 0 ? "up" : "down"} />
    </svg>
  );
}

export function Pill({ tone, children }: { tone: "alarm" | "warn" | "ok" | "plain"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Fact({ label, children, note }: { label: string; children: ReactNode; note?: string }) {
  return (
    <div className="fact">
      <div className="label">{label}</div>
      <div className="value">{children}</div>
      {note ? <div className="note">{note}</div> : null}
    </div>
  );
}

/** A sealed entry: black lacquer with its real ciphertext inside. */
export function Bar({ ct, label }: { ct: string; label?: string }) {
  return (
    <span className="bar" title="ciphertext, as it is on the chain">
      <svg className="lock" width="9" height="12" viewBox="0 0 20 26" aria-hidden="true"><path d="M10 1a7 7 0 0 0-3.9 12.8L3.6 25h12.8l-2.5-11.2A7 7 0 0 0 10 1z" fill="currentColor" /></svg>
      <span className="cipher">{ct}</span>
      {label ? <span className="bar-label">{label}</span> : null}
    </span>
  );
}

/** A link to a transaction on NEAR testnet's explorer. */
export function Tx({ tx }: { tx: string }) {
  return <a href={`https://testnet.nearblocks.io/txns/${tx}`} target="_blank" rel="noreferrer"><code>{tx.slice(0, 10)}…</code> ↗</a>;
}
