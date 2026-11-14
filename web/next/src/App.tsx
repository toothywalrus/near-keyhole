import { useEffect, useState } from "react";
import { lnear, useBoot, useStore } from "../../src/store.ts";
import { How } from "./How.tsx";
import { Testnet } from "./Testnet.tsx";
import { Trader } from "./Trader.tsx";
import { Traders } from "./Traders.tsx";
import { setTheme, useTheme } from "./theme.ts";
import { Empty, Icon, Mark } from "./ui.tsx";
import { Window } from "./Window.tsx";

function useRoute(): string[] {
  const read = () => (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
  const [r, setR] = useState(read);
  useEffect(() => {
    // A new page starts at the top; a new tab of the same page (a window's Journal, Check, Copy) keeps its place.
    let page = read().slice(0, 2).join("/");
    const f = () => { const next = read(); const p = next.slice(0, 2).join("/"); if (p !== page) window.scrollTo(0, 0); page = p; setR(next); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return r;
}

function ThemeToggle() {
  const t = useTheme();
  const next = t === "dark" ? "light" : "dark";
  return (
    <button className="btn icon ghost" onClick={() => setTheme(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <Icon name={t === "dark" ? "sun" : "moon"} />
    </button>
  );
}

const NAV = [
  { href: "#/", label: "Traders", match: ["", "t", "w"] },
  { href: "#/how", label: "How it works", match: ["how"] },
  { href: "#/testnet", label: "On testnet", match: ["testnet"] },
];

export function App() {
  useBoot();
  const s = useStore();
  const [here, a, b] = useRoute();
  const page = here ?? "";
  let body;
  if (page === "testnet") body = <Testnet />;
  else if (page === "how") body = <How />;
  else if (s.error) body = (
    <Empty title="The demo didn't start" action={<button className="btn primary" onClick={() => location.reload()}>Reload</button>}>
      {s.error}. It runs the contract in your browser and needs WebAssembly; a private window rules out an extension blocking it.
    </Empty>
  );
  else if (!s.ready) body = <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Starting the contract in your browser…</div>;
  else if (page === "") body = <Traders />;
  else if (page === "t" && a) body = <Trader handle={a} key={a} />;
  else if ((page === "w" || page === "read") && a) body = <Window id={Number(a)} tab={b} key={a} />;
  else body = <Empty title="Page not found" action={<a className="btn primary" href="#/">Back to traders</a>} />;

  return (
    <div className="shell">
      <header className="top">
        <div className="top-in">
          <a className="brand" href="#/" aria-label="Keyhole home"><Mark /><span>Keyhole</span></a>
          <nav className="nav" aria-label="Pages">
            {NAV.map((n) => <a key={n.href} href={n.href} className={n.match.includes(page) ? "on" : ""} aria-current={n.match.includes(page) ? "page" : undefined}>{n.label}</a>)}
          </nav>
          <div className="top-right">
            {s.ready ? <span className="wallet" title="Play money on the local chain in this tab"><span className="wallet-dot" aria-hidden="true" />{lnear(s.balance())} Ⓝ</span> : null}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <div className="demo-note">
        <div className="demo-note-in">
          <span><b>Demo.</b> The real contract runs in this tab with play money; reloading resets it.</span>
          {page === "testnet" ? <a href="#/">Back to the demo <Icon name="arrow" size={13} /></a> : <a href="#/testnet">See it live on testnet <Icon name="arrow" size={13} /></a>}
        </div>
      </div>
      <main className="main" id="main">{body}</main>
      <footer className="foot">
        <span>Keyhole · built at NEAR HACKATHON · a testnet demo, not investment advice</span>
        <span><a href="../">Previous design</a> · <a href="https://github.com/toothywalrus/near-keyhole" target="_blank" rel="noreferrer">Source</a></span>
      </footer>
    </div>
  );
}
