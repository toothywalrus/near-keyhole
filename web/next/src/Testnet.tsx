import { useLive } from "../../src/Live.tsx";
import { stepOf, useRun, type Run } from "../../src/testnet.ts";
import { Badge, Icon, Stat, Tx } from "./ui.tsx";

const near = (y: string | bigint) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(2);
const usd = (e6: string | number) => { const v = Number(e6) / 1e6; return `${v < 0 ? "−" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const short = (a: string) => a.split(".")[0];

export function Testnet() {
  const run = useRun();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Live on NEAR testnet</p>
          <h1>The same contract, deployed and locked.</h1>
          <p className="muted">Read from the chain as this page loads. No wallet, no keys: view calls only.</p>
        </div>
      </header>
      {run === undefined ? <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Loading…</div>
        : run === null ? <p className="muted">This build has no testnet record.</p>
        : <Body run={run} />}
    </>
  );
}

function Body({ run }: { run: Run }) {
  const { live, err, retry } = useLive(run);
  const C = run.contract;
  const lie = stepOf(run, "lucky posts a LIE");
  const slash = stepOf(run, "audit_conclude");
  const dispute = stepOf(run, "dispute_wrap: secret revealed");
  return (
    <div className="stack">
      <section className="card contract">
        <div>
          <span className="muted small">Contract</span>
          <a className="mono contract-id" href={`https://testnet.nearblocks.io/address/${C}`} target="_blank" rel="noreferrer">{C}<Icon name="external" size={13} /></a>
        </div>
        {live ? <Badge tone={live.keys === 0 ? "ok" : "warn"}>{live.keys === 0 ? "Locked · no access keys" : `${live.keys} access keys`}</Badge> : null}
      </section>

      {err ? <div className="alert warn"><Icon name="alert" /><div>Couldn't read testnet: {err}. <button className="btn sm" onClick={retry}>Retry</button></div></div> : null}
      {!live && !err ? <div className="loading" role="status"><span className="spinner" aria-hidden="true" />Reading the contract…</div> : null}

      {live ? (
        <>
          <div className="stats">
            <Stat label="Balance" value={`${near(live.solvency.balance)} Ⓝ`} sub={`owes ${near(live.solvency.obligations)} Ⓝ`} />
            <Stat label="Windows sold" value={live.supply} />
            <Stat label="Epoch" value={live.epoch} sub={`${live.epochSecs / 60} min each, for the demo`} />
            <Stat label="Fee" value={`${live.feeBps / 100}%`} sub="of a sale that closes" />
          </div>

          <section className="card flush">
            <div className="card-head"><h2>The recorded run</h2></div>
            <table className="table">
              <thead><tr><th>Trader</th><th className="num">PnL</th><th className="num">Bond</th><th>Status</th></tr></thead>
              <tbody>
                {live.ours.map(({ t, epochs }) => {
                  const sl = t.status?.Slashed;
                  const ep = epochs[0];
                  return (
                    <tr key={t.id}>
                      <td><b>{t.handle}</b></td>
                      <td className="num mono">{usd(t.cum_pnl_e6)}</td>
                      <td className="num mono">{near(t.bond)} Ⓝ</td>
                      <td>
                        {sl ? <Badge tone="bad">Slashed</Badge> : t.paused ? <Badge tone="neutral">Paused</Badge> : <Badge tone="ok">Active</Badge>}
                        {sl && !ep?.verdict?.False ? <span className="muted small block">{sl.reason}</span> : null}
                        {ep?.verdict?.False ? <span className="muted small block">posted {usd(ep.posted_e6!)}, recomputed {usd(ep.verdict.False.recomputed_e6)}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      ) : null}

      <section className="card">
        <h2>Key transactions</h2>
        <ul className="txlist">
          {lie ? <li><span>A trader posts a false figure</span><Tx tx={lie.tx!} /></li> : null}
          {slash ? <li><span>A buyer proves it; the contract slashes the bond</span><Tx tx={slash.tx!} /></li> : null}
          {dispute ? <li><span>A bad key delivery is disputed and slashed</span><Tx tx={dispute.tx!} /></li> : null}
        </ul>
        <details className="all-tx">
          <summary>All {run.steps.filter((x) => x.tx).length} transactions of the run</summary>
          <ul className="txlist">
            {run.steps.filter((x) => x.tx).map((x) => <li key={x.tx}><span>{x.what}</span><Tx tx={x.tx!} /></li>)}
          </ul>
        </details>
      </section>
    </div>
  );
}
