// What the real contract on NEAR testnet holds right now, read with view calls only. The rest of the app is a seeded simulation in this tab; this part isn't.
// The contract is open to anyone, so only the accounts of the recorded run are shown by name: a stranger's handle is his own text.
import { useEffect, useState } from "react";
import type { EntryRec, EpochRec, TokenRec, TraderRec } from "@lib/client.ts";
import { Bar, Pill, Tx } from "./bits.tsx";
import { keyCount, type Run, stepOf, view } from "./testnet.ts";

type Solvency = { obligations: string; balance: string; storage_locked: string; slack: string };
type Snapshot = {
  at: number; epoch: number; keys: number; feeBps: number; epochSecs: number; solvency: Solvency; supply: number;
  ours: { role: string; t: TraderRec; epochs: EpochRec[] }[]; others: number; tokens: TokenRec[]; journal: EntryRec[]; journalOf: string;
};

const ROLES: Record<string, string> = { vega: "posts true figures", lucky: "posted a false figure", mallory: "delivered garbage keys" };
const usd = (e6: string | number) => `${Number(e6) < 0 ? "−" : ""}$${Math.abs(Number(e6) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nearOf = (y: string) => (Number(BigInt(y) / 10n ** 21n) / 1000).toFixed(3);
const when = (ms: string | number) => `${new Date(Number(ms)).toISOString().slice(0, 16).replace("T", " ")} UTC`;
const short = (account: string) => account.split(".")[0];

export async function readLive(run: Run): Promise<Snapshot> {
  const C = run.contract;
  const named: [string, string][] = [...Object.entries(run.traders), ...(run.outlayer ? [["enclave", run.outlayer.trader] as [string, string]] : [])];
  const [clock, cfg, solvency, keys, supply, all] = await Promise.all([
    view<{ now_ms: string; epoch: number }>(C, "clock"),
    view<{ fee_bps?: number; slot_secs: number; epoch_slots: number }>(C, "get_config"),
    view<Solvency>(C, "solvency"),
    keyCount(C),
    view<string>(C, "nft_total_supply"),
    view<TraderRec[]>(C, "list_traders", { from: 0, limit: 100 }),
  ]);
  const ours = await Promise.all(named.map(async ([name, account]) => {
    const t = all.find((x) => x.account === account);
    if (!t) return null;
    const from = name === "enclave" ? run.outlayer!.epoch : run.epoch;
    return { role: name === "enclave" ? "its figure was computed in OutLayer's TEE" : ROLES[name] ?? "", t, epochs: await view<EpochRec[]>(C, "get_epochs", { account, from, limit: 1 }) };
  }));
  const n = Math.min(Number(supply), 12);
  const tokens = await Promise.all(Array.from({ length: n }, (_, i) => view<TokenRec>(C, "get_token", { token_id: i + 1 })));
  const journalOf = run.traders.vega;
  const journal = journalOf ? await view<EntryRec[]>(C, "get_entries", { account: journalOf, from: "0", limit: 6 }) : [];
  const kept = ours.filter((x): x is NonNullable<typeof x> => x !== null);
  return { at: Number(clock.now_ms), epoch: clock.epoch, keys, feeBps: cfg.fee_bps ?? 0, epochSecs: cfg.slot_secs * cfg.epoch_slots, solvency, supply: Number(supply), ours: kept, others: all.length - kept.length, tokens, journal, journalOf };
}

export function useLive(run: Run | null | undefined): { live: Snapshot | null; err: string | null; retry: () => void } {
  const [live, setLive] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!run?.contract) return;
    let on = true;
    setErr(null);
    readLive(run).then((x) => { if (on) setLive(x); }, (e) => { if (on) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { on = false; };
  }, [run, attempt]);
  return { live, err, retry: () => setAttempt((n) => n + 1) };
}

/** One line under the board: the real contract's state, or nothing if testnet can't be read just now. */
export function LiveStrip({ run }: { run: Run | null | undefined }) {
  const { live } = useLive(run);
  if (!run || !live) return null;
  const slashed = live.ours.filter((x) => x.t.status?.Slashed).length;
  return (
    <a className="livestrip" href="#/proof">
      <Pill tone="ok">Live</Pill>
      <span>Not a simulation: the same contract on NEAR testnet, read just now. {live.ours.length} traders of the recorded run, <b>{slashed} slashed by the contract</b>, {live.supply} windows sold, {live.keys === 0 ? "no key on the contract's account" : `${live.keys} keys on the contract's account`}.</span>
      <span className="go">See it <span aria-hidden="true">→</span></span>
    </a>
  );
}

export function Live({ run }: { run: Run }) {
  const { live, err, retry } = useLive(run);
  const C = run.contract;
  if (err) {
    return (
      <p className="verdict alarm" role="alert"><b>Couldn't read testnet just now.</b> {err}.
        <span className="what-now">The public RPC may be busy; nothing is wrong with this page or the contract. Every transaction of the recorded run is listed below and on the explorer either way. <button className="link retry" onClick={retry}>Try again</button></span>
      </p>
    );
  }
  if (!live) return <p className="note" role="status">Reading the contract on NEAR testnet…</p>;
  const tokenLine = (k: TokenRec) => live.ours.find((x) => x.t.id === k.trader)?.t.handle ?? "another account";
  return (
    <div className="livebox" aria-live="polite">
      <p className="livehead"><Pill tone="ok">Live</Pill> Read from <a href={`https://testnet.nearblocks.io/address/${C}`} target="_blank" rel="noreferrer"><code>{C}</code> ↗</a> at {when(live.at)}, with view calls only. This page holds no key and signs nothing.</p>
      <div className="facts">
        <div className="fact"><div className="label">Keys on the contract's account</div><div className="value">{live.keys}</div><div className="note">{live.keys === 0 ? "Locked: nobody can change its code or move its NEAR." : "Not locked."}</div></div>
        <div className="fact"><div className="label">It holds, and owes</div><div className="value">{nearOf(live.solvency.balance)} Ⓝ</div><div className="note">Owes {nearOf(live.solvency.obligations)} Ⓝ in bonds, escrows and credits; storage locks {nearOf(live.solvency.storage_locked)} Ⓝ.</div></div>
        <div className="fact"><div className="label">Its clock</div><div className="value">epoch {live.epoch}</div><div className="note">Epochs of {live.epochSecs / 60} minutes here, so that a whole sale fits in a demo. Fee: {live.feeBps / 100}% of a sale that closes for the trader.</div></div>
      </div>

      <h3>The traders of the recorded run</h3>
      <div className="table-scroll">
        <table className="live">
          <thead><tr><th>Trader</th><th className="num">Posted PnL</th><th className="num">Bond now</th><th>What the contract says</th></tr></thead>
          <tbody>
            {live.ours.map(({ role, t, epochs }) => {
              const sl = t.status?.Slashed;
              const ep = epochs[0];
              const falseFig = ep?.verdict?.False;
              return (
                <tr key={t.id} className={sl ? "caught" : ""}>
                  <td><b>{t.handle}</b><small>{role}</small></td>
                  <td className="num">{usd(t.cum_pnl_e6)}</td>
                  <td className="num">{nearOf(t.bond)} Ⓝ{BigInt(t.burned ?? "0") > 0n ? <small>{nearOf(t.burned!)} burned</small> : null}</td>
                  <td>
                    {sl ? <><Pill tone="alarm">Slashed</Pill> <span className="reason">{sl.reason}</span><small>proven by {short(sl.by)}, {when(sl.at_ms)}</small></> : <>Active{t.paused ? <small>sales paused: the run is over and its agent is offline</small> : null}</>}
                    {falseFig && ep?.posted_e6 != null ? <small>epoch {ep.epoch}: posted {usd(ep.posted_e6)}, the contract recomputed {usd(falseFig.recomputed_e6)}</small> : null}
                    {!falseFig && ep?.posted_e6 != null ? <small>epoch {ep.epoch}: posted {usd(ep.posted_e6)}{ep.attested ? `, attested figure ${usd(ep.attested.pnl_e6)} labeled ${ep.attested.kind}` : ""}</small> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {live.others > 0 ? <p className="note">{live.others} other {live.others === 1 ? "account has" : "accounts have"} registered since: the contract is open to anyone. They aren't part of the run, and their names are their own text, so they aren't shown here.</p> : null}

      <h3>The windows sold</h3>
      <div className="table-scroll">
        <table className="live">
          <thead><tr><th>Token</th><th>Window</th><th className="num">Price</th><th>State</th><th>Holder</th></tr></thead>
          <tbody>
            {live.tokens.map((k) => (
              <tr key={k.id}>
                <td>#{k.id}</td>
                <td>{tokenLine(k)}, epoch{k.first_epoch === k.last_epoch ? ` ${k.first_epoch}` : `s ${k.first_epoch} to ${k.last_epoch}`}</td>
                <td className="num">{nearOf(k.price)} Ⓝ</td>
                <td>{k.state === "Refunded" ? "Refunded to its holder" : k.state === "Closed" ? "Closed: paid to the trader" : k.state === "Delivered" ? "Delivered, in escrow" : "Paid, awaiting delivery"}</td>
                <td>{short(k.owner)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {live.supply > live.tokens.length ? <p className="note">The first {live.tokens.length} of {live.supply}.</p> : null}

      {live.journal.length ? (
        <>
          <h3>What the chain holds of {live.ours.find((x) => x.t.account === live.journalOf)?.t.handle ?? "a"}'s journal</h3>
          <ol className="journal locked livejournal">
            {live.journal.map((e) => <li key={e.seq}><span className="seq">#{e.seq}</span><span className="when">{when(e.at_ms).slice(5, 16)}</span><Bar ct={e.ct} label="sealed" /></li>)}
          </ol>
          <p className="note">Ciphertext, a number and the block's time: all anyone without a key can read, on the real chain as in this tab.</p>
        </>
      ) : null}
      <p className="livefoot">
        The slash you can do in this tab happened here for real: {(() => { const lie = stepOf(run, "lucky posts a LIE"); const c = stepOf(run, "audit_conclude"); const d = stepOf(run, "dispute_wrap: secret"); return <>{lie ? <>the false figure <Tx tx={lie.tx!} />, </> : null}{c ? <>the proof <Tx tx={c.tx!} />, </> : null}{d ? <>the garbage-key ruling <Tx tx={d.tx!} />.</> : null}</>; })()} To
        act on this contract yourself you need a testnet account and the command line (<code>npm run demo -- --testnet</code> in the README): this page has no wallet.
      </p>
    </div>
  );
}
