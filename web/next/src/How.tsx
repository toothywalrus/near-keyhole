import { Icon } from "./ui.tsx";

const PARTS = [
  { icon: "key" as const, title: "Keys that end", text: "Each entry is encrypted under one leaf of a hash tree. A window's keys can derive its own days and nothing else, so access ends without anyone revoking it." },
  { icon: "lock" as const, title: "A sale with no middleman", text: "You pay into escrow with a one-time key. The contract checks the delivered keys against a commitment made before the sale, and can unwrap them itself in a dispute." },
  { icon: "shield" as const, title: "PnL with a bond behind it", text: "Entries are timestamped as they're written. Anyone with a day's keys can make the contract recompute it from oracle prices. One unit off, and the bond is slashed." },
];

const LIMITS = [
  "A journal records what the trader wrote, not proof a trade happened.",
  "A buyer can leak what they read.",
  "One account can't prove it isn't the luckiest of ten.",
  "A lie worth more than the bond can still pay: compare the two.",
  "Prices on testnet are replayed by a trusted recorder.",
  "No human has audited the contract.",
];

export function How() {
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">How it works</p>
          <h1>A track record you can check, sold by the day.</h1>
        </div>
      </header>
      <div className="parts">
        {PARTS.map((p, i) => (
          <section key={p.title} className="card part">
            <span className="part-n">{String(i + 1).padStart(2, "0")}</span>
            <span className="part-icon"><Icon name={p.icon} size={18} /></span>
            <h2>{p.title}</h2>
            <p className="muted">{p.text}</p>
          </section>
        ))}
      </div>
      <section className="card">
        <h2>What it doesn't do</h2>
        <ul className="limits">{LIMITS.map((l) => <li key={l}>{l}</li>)}</ul>
        <p className="muted small">The full list, and the tests behind every claim, are in the <a href="https://github.com/toothywalrus/near-keyhole" target="_blank" rel="noreferrer">repository</a>.</p>
      </section>
      <a className="btn primary" href="#/t/lucky-seven">Try it on lucky-seven<Icon name="arrow" size={15} /></a>
    </>
  );
}
