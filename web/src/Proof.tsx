import { Tx } from "./bits.tsx";
import { Live } from "./Live.tsx";
import { useRun } from "./testnet.ts";

export function Proof() {
  const run = useRun();
  return (
    <article className="proof">
      <h1>Proof</h1>
      <p className="standfirst">Everything else on this site is a seeded simulation: the real contract, running in your tab on a local chain. This page is the part that isn't. The contract is deployed on NEAR testnet, the same wasm as the one in this tab, and what follows is read from it as you load the page.</p>

      <h2>Live on NEAR testnet</h2>
      {run === undefined ? <p className="note" role="status">Loading the run's record…</p> : run ? <Live run={run} /> : <p className="note">The testnet run's record isn't in this build.</p>}

      <h2>The recorded run, transaction by transaction</h2>
      {run ? (
        <>
          <p>Run {new Date(run.at).toUTCString()}, by this project's own accounts: a sale and delivery, a false figure proven and slashed, garbage keys proven and slashed, a false dispute dismissed, a sale settled. Prices are real Chainlink rounds, replayed by a recorder and labeled that way in the contract's own <code>get_feeds</code> view.</p>
          <div className="table-scroll">
            <table className="txs">
              <thead><tr><th>Step</th><th className="num">Tgas</th><th>Transaction</th></tr></thead>
              <tbody>{run.steps.filter((x) => x.tx).map((x, i) => <tr key={i}><td>{x.what}</td><td className="num">{x.tgas?.toFixed(2)}</td><td><Tx tx={x.tx!} /></td></tr>)}</tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2>The hard question</h2>
      <div className="facts">
        <div className="fact"><div className="label">Whole dispute, testnet</div><div className="value">10 Tgas</div><div className="note">x25519 twice, ChaCha20, a commitment. 3% of a transaction.</div></div>
        <div className="fact"><div className="label">Reading an entry in the contract</div><div className="value">0.15 Tgas</div><div className="note">About 1,900 entries fit in one transaction, and an audit takes as many as it needs. <code>npm run gas</code></div></div>
        <div className="fact"><div className="label">Attack checks</div><div className="value">all pass</div><div className="note"><code>npm run attack</code>, also on a real node with <code>--sandbox</code></div></div>
      </div>

      <h2>Against NOVA Copy-Trading</h2>
      <p>NOVA shipped this idea on mainnet on Nov 4, and it's good work: mutation tests, a claims table, a real recorded run. Where the two designs differ:</p>
      <div className="table-scroll"><table className="vs">
        <thead><tr><th /><th>NOVA Copy-Trading</th><th>Keyhole</th></tr></thead>
        <tbody>
          <tr><td>The PnL before you pay</td><td>Claimed, with entry hashes on chain. Checked by the follower after buying.</td><td>Bonded before you pay. Any past buyer can prove it false on-chain, and the contract recomputes it.</td></tr>
          <tr><td>Access ends by</td><td>The seller revoking, and NOVA's TEE rotating the group key.</td><td>Mathematics: no node past the window was ever delivered. Nobody needs to be online.</td></tr>
          <tr><td>Paying and getting access</td><td>The buyer pays, then the seller checks and admits. No escrow yet.</td><td>One sale in the contract: escrow, delivery, dispute, refund.</td></tr>
          <tr><td>Where it runs</td><td><b>Mainnet, real USDC, real Agent API.</b></td><td>Testnet and a sandbox. The mainnet adapter is written against the docs and unexercised.</td></tr>
          <tr><td>Trading</td><td>Scripted decisions; copies are dry quotes.</td><td>Seeded journals; a real NEP-413 copy against the intents.near wasm, in a sandbox and in this tab, with a local solver; live dry quotes.</td></tr>
          <tr><td>What the journal is</td><td>Agent's own, in NOVA's encrypted store.</td><td>Agent's own, ciphertext on chain. Neither sees a real confidential fill: no public viewing key exists.</td></tr>
        </tbody>
      </table></div>

      <h2>Run it</h2>
      <pre>{`git clone … && cd near-keyhole && npm ci
npm run judge      # free, no keys: about 75 s on 2 CPUs, ends in a pass/fail table
npm run attack     # every attack, against the real wasm
npm run demo       # the complete moment on a local NEAR node, with gas
npm run copy       # the copy trade, against the mainnet intents.near wasm
npm run check-res  # needs Rust: is the committed wasm from the committed source?
npm run verify     # re-read the testnet deployment from the chain`}</pre>
    </article>
  );
}
