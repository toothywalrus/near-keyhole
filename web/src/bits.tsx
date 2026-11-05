// Small shared drawings. No chart library: these are a few lines of SVG, in the page's own ink.
import type { ReactNode } from "react";

export function Glyph({ size = 18 }: { size?: number }) {
  return (
    <svg className="glyph" width={size} height={size * 1.3} viewBox="0 0 20 26" aria-hidden="true">
      <path d="M10 1a7 7 0 0 0-3.9 12.8L3.6 25h12.8l-2.5-11.2A7 7 0 0 0 10 1z" fill="currentColor" />
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

/** A locked entry: a redaction bar with its real ciphertext inside. */
export function Bar({ ct, label }: { ct: string; label?: string }) {
  return (
    <span className="bar" title="ciphertext, on the chain">
      <span className="cipher">{ct}</span>
      {label ? <span className="bar-label">{label}</span> : null}
    </span>
  );
}
