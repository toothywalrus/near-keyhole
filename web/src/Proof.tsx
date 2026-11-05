import { useEffect, useState } from "react";
import { Pill } from "./bits.tsx";

type Run = { contract: string; at: string; steps: { what: string; tx?: string; tgas?: number; note?: string }[]; traders: Record<string, string> };
const RPC = "https://test.rpc.fastnear.com";

async function view<T>(contract: string, method: string, args: object): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: btoa(JSON.stringify(args)) } }) });
  const j = await r.json();
  if (j.error || j.result?.error) throw new Error(JSON.stringify(j.error ?? j.result.error).slice(0, 120));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(j.result.result)));
}

export function Proof() {
  const [run, setRun] = useState<Run | null>(null);
  const [live, setLive] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("./testnet-run.json").then((r) => (r.ok ? r.json() : null)).then((j) => {
      setRun(j);
      if (j?.contract) view<any[]>(j.contract, "list_traders", { from: 0, limit: 100 }).then(setLive, (e) => setErr(String(e)));
    }).catch(() => setRun(null));
  }, []);
  return (
    <article className="proof">
      <h1>Proof</h1>
      <p className="standfirst">The tab you're in runs the real wasm on a local chain, with no gas metering. These are the numbers from real chains, and the commands that reproduce them from a fresh clone.</p>

      <h2>The hard question</h2>
      <div className="facts">
        <div className="fact"><div className="label">Whole dispute, testnet</div><div className="value">9.8 Tgas</div><div className="note">x25519 twice, ChaCha20, a commitment. 3% of a transaction.</div></div>
        <div className="fact"><div className="label">Reading an entry in the contract</div><div className="value" id="per-entry">about 1 Tgas</div><div className="note">An audit takes as many transactions as it needs. <code>npm run gas</code></div></div>
        <div className="fact"><div className="label">Attack checks</div><div className="value">all pass</div><div className="note"><code>npm run attack</code>, also on a real node with <code>--sandbox</code></div></div>
      </div>

      <h2>The same flow on NEAR testnet</h2>
      {run ? (
        <>
          <p>Contract <a href={`https://testnet.nearblocks.io/address/${run.contract}`}><code>{run.contract}</code></a>, run {new Date(run.at).toUTCString()}. Prices are real Chainlink rounds, replayed by a recorder and labeled that way in the contract's own <code>get_feeds</code> view.</p>
          {live ? (
            <table className="live">
              <thead><tr><th>Trader, read live</th><th className="num">PnL</th><th className="num">Bond</th><th>Status</th></tr></thead>
              <tbody>{live.map((t) => <tr key={t.id}><td>{t.handle}</td><td className="num">${(Number(t.cum_pnl_e6) / 1e6).toFixed(2)}</td><td className="num">{(Number(BigInt(t.bond) / 10n ** 21n) / 1000).toFixed(3)} Ⓝ</td><td>{t.status?.Slashed ? <Pill tone="alarm">Slashed</Pill> : "Active"}</td></tr>)}</tbody>
            </table>
          ) : err ? <p className="note">Couldn't read testnet just now: {err}</p> : <p className="note">Reading testnet…</p>}
          <table className="txs">
            <thead><tr><th>Step</th><th className="num">Tgas</th><th>Transaction</th></tr></thead>
            <tbody>{run.steps.filter((x) => x.tx).map((x, i) => <tr key={i}><td>{x.what}</td><td className="num">{x.tgas?.toFixed(2)}</td><td><a href={`https://testnet.nearblocks.io/txns/${x.tx}`}><code>{x.tx?.slice(0, 10)}…</code></a></td></tr>)}</tbody>
          </table>
        </>
      ) : <p className="note">The testnet run's record isn't in this build.</p>}

      <h2>Against NOVA Copy-Trading</h2>
      <p>NOVA shipped this idea on mainnet on Nov 4, and it's good work: mutation tests, a claims table, a real recorded run. Where the two designs differ:</p>
      <table className="vs">
        <thead><tr><th /><th>NOVA Copy-Trading</th><th>Keyhole</th></tr></thead>
        <tbody>
          <tr><td>The PnL before you pay</td><td>Claimed, with entry hashes on chain. Checked by the follower after buying.</td><td>Bonded before you pay. Any past buyer can prove it false on-chain, and the contract recomputes it.</td></tr>
          <tr><td>Access ends by</td><td>The seller revoking, and NOVA's TEE rotating the group key.</td><td>Mathematics: no node past the window was ever delivered. Nobody needs to be online.</td></tr>
          <tr><td>Paying and getting access</td><td>The buyer pays, then the seller checks and admits. No escrow yet.</td><td>One sale in the contract: escrow, delivery, dispute, refund.</td></tr>
          <tr><td>Where it runs</td><td><b>Mainnet, real USDC, real Agent API.</b></td><td>Testnet and a sandbox. The mainnet adapter is written against the docs and unexercised.</td></tr>
          <tr><td>Trading</td><td>Scripted decisions; copies are dry quotes.</td><td>Seeded journals; a real NEP-413 copy against the intents.near wasm in a sandbox; live dry quotes.</td></tr>
          <tr><td>What the journal is</td><td>Agent's own, in NOVA's encrypted store.</td><td>Agent's own, ciphertext on chain. Neither sees a real confidential fill: no public viewing key exists.</td></tr>
        </tbody>
      </table>

      <h2>Run it</h2>
      <pre>{`git clone … && cd near-keyhole && npm ci
npm run judge      # everything free, about 5 minutes, ends in a pass/fail table
npm run attack     # every attack, against the real wasm
npm run demo       # the complete moment on a local NEAR node, with gas
npm run copy       # the copy trade, against the mainnet intents.near wasm
npm run verify     # re-read the testnet deployment from the chain`}</pre>
    </article>
  );
}
