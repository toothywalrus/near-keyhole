import { useEffect, useState } from "react";
import { Escutcheon } from "./bits.tsx";
import { Board } from "./Board.tsx";
import { MomentStrip } from "./Guide.tsx";
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

function Provenance() {
  return (
    <div className="provenance" role="note">
      <b>SEEDED DEMO.</b>
      <span className="wide">The real contract wasm runs in this tab on a local chain. Journals are generated from real Chainlink rounds; the trades never happened. No real money. </span>
      <span className="narrow">The real contract, on a local chain in this tab. The trades never happened; no real money. </span>
      <a href="#/proof"><span className="wide">The same contract on testnet →</span><span className="narrow">On testnet →</span></a>
    </div>
  );
}

function Booting() {
  return (
    <div className="state boot" role="status">
      <Escutcheon size={40} />
      <h1>Opening the ledger</h1>
      <p>Starting the real contract wasm in this tab and loading the seeded journals: about a megabyte, a second or two. No wallet, nothing to install.</p>
    </div>
  );
}

function BootError({ error }: { error: string }) {
  return (
    <div className="state failed" role="alert">
      <h1>The ledger didn't open.</h1>
      <p className="what">{error}</p>
      <p>This page runs the contract itself in your browser, so it needs WebAssembly and about a megabyte of files from this site. Reload to try again. If it fails again, a private window rules out an extension blocking it.</p>
      <p>
        <button className="primary" onClick={() => location.reload()}>Reload</button>
        <a className="link" href="#/proof">Or see the same contract on NEAR testnet</a>
      </p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="state failed">
      <h1>Nothing on this page.</h1>
      <p>The link may be from a tab that's gone: reloading restarts the local chain, and windows bought in it go with it.</p>
      <p><a className="primary" href="#/">Back to the board</a></p>
    </div>
  );
}

export function App() {
  useBoot();
  const s = useStore();
  const route = useHash();
  const parts = route.replace(/^#\//, "").split("/");
  const here = parts[0];
  const clock = s.ready ? s.clock() : null;
  let body;
  if (here === "proof") body = <Proof />;
  else if (s.error) body = <BootError error={s.error} />;
  else if (!s.ready) body = <Booting />;
  else if (here === "") body = <Board />;
  else if (here === "t" && parts[1]) body = <TraderPage handle={parts[1]} key={parts[1]} />;
  else if (here === "read" && parts[1]) body = <Reader id={Number(parts[1])} key={parts[1]} />;
  else if (here === "how") body = <How />;
  else body = <NotFound />;
  return (
    <>
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to the page</a>
      <Provenance />
      <div className="page">
        <header className="mast">
          <a className="logo" href="#/" aria-label="Keyhole, the board"><Escutcheon size={28} /><span>Keyhole</span></a>
          <p className="motto">Sell a window into your private trade journal. The PnL is bonded, and any buyer can prove it false.</p>
          <nav aria-label="Pages">
            <a className={here === "" || here === "t" || here === "read" ? "on" : ""} href="#/" aria-current={here === "" ? "page" : undefined}><span className="wide">The board</span><span className="narrow">Board</span></a>
            <a className={here === "how" ? "on" : ""} href="#/how" aria-current={here === "how" ? "page" : undefined}><span className="wide">How it holds</span><span className="narrow">How</span></a>
            <a className={here === "proof" ? "on" : ""} href="#/proof" aria-current={here === "proof" ? "page" : undefined}>Proof</a>
          </nav>
        </header>
        <div className="dateline">
          {clock ? (
            <>
              <span>{dateOf(Number(clock.now_ms))}, epoch {clock.epoch} <span className="play">· local chain</span></span>
              <span>You hold <b>{lnear(s.balance())}</b> Ⓝ <span className="play">of play money</span>{s.credit() > 0n ? <> + <b>{lnear(s.credit())}</b> to withdraw</> : null}</span>
            </>
          ) : <span>{s.error ? "The local chain isn't running." : "Starting the local chain…"}</span>}
        </div>
        {s.ready && (here === "t" || here === "read") ? <MomentStrip /> : null}
        <main id="main" tabIndex={-1}>{body}</main>
        <footer>
          <p>Built at NEAR HACKATHON. A testnet technical demo, not investment advice: selling trading signals is regulated in many places.{s.ready ? <> Contract wasm sha256 <code>{s.meta.wasm_sha256.slice(0, 16)}…</code></> : null}</p>
        </footer>
      </div>
    </>
  );
}
