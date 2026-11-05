import { useEffect, useState } from "react";
import { Glyph } from "./bits.tsx";
import { Board } from "./Board.tsx";
import { How } from "./How.tsx";
import { Proof } from "./Proof.tsx";
import { Reader } from "./Reader.tsx";
import { TraderPage } from "./TraderPage.tsx";
import { dateOf, lnear, useBoot, useStore } from "./store.ts";

function useHash(): string {
  const [h, setH] = useState(location.hash || "#/");
  useEffect(() => {
    const f = () => { setH(location.hash || "#/"); window.scrollTo(0, 0); };
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return h;
}

export function App() {
  useBoot();
  const s = useStore();
  const route = useHash();
  if (s.error) return <div className="page"><p className="boot">The local chain didn't start: {s.error}</p></div>;
  if (!s.ready) return <div className="page"><p className="boot"><Glyph /> Starting the contract in this tab…</p></div>;
  const clock = s.clock();
  const parts = route.replace(/^#\//, "").split("/");
  const here = parts[0];
  return (
    <>
      <div className="provenance">
        <b>SEEDED DEMO.</b> The real contract wasm runs in this tab on a local chain. Journals are generated from real Chainlink rounds; the trades never happened. No real money. <a href="#/proof">The same contract on testnet →</a>
      </div>
      <div className="page">
        <header className="mast">
          <a className="logo" href="#/"><Glyph size={22} /><span>Keyhole</span></a>
          <p className="motto">Sell a window into your private trade journal.<br />The PnL is bonded, and any buyer can prove it false.</p>
          <nav>
            <a className={here === "" ? "on" : ""} href="#/">The board</a>
            <a className={here === "how" ? "on" : ""} href="#/how">How it holds</a>
            <a className={here === "proof" ? "on" : ""} href="#/proof">Proof</a>
          </nav>
          <div className="dateline">
            <span>{dateOf(clock ? Number(clock.now_ms) : 0)}, epoch {clock.epoch}</span>
            <span>You hold <b>{lnear(s.balance())}</b> local Ⓝ{s.credit() > 0n ? <> + <b>{lnear(s.credit())}</b> to withdraw</> : null}</span>
          </div>
        </header>
        <main>
          {here === "" ? <Board /> : null}
          {here === "t" ? <TraderPage handle={parts[1]} key={parts[1]} /> : null}
          {here === "read" ? <Reader id={Number(parts[1])} key={parts[1]} /> : null}
          {here === "how" ? <How /> : null}
          {here === "proof" ? <Proof /> : null}
        </main>
        <footer>
          <p>Built at NEAR HACKATHON. A testnet technical demo, not investment advice: selling trading signals is regulated in many places. Contract wasm sha256 <code>{s.meta.wasm_sha256.slice(0, 16)}…</code></p>
        </footer>
      </div>
    </>
  );
}
