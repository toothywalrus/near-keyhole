import { useEffect, useMemo, useRef, useState } from "react";
import { hex, unhex } from "@lib/bytes.ts";
import { DEPTH, firstRoundAtOrAfter, replayEpoch, WindowReader, type EntryRec, type TokenRec, type TraderRec } from "@lib/client.ts";
import { copyQtyLimits } from "./copy.ts";
import { entryKey, isDecoy, openEntry, type Entry, type OneTime } from "@lib/entry.ts";
import { descend, slotsOf, type NodeId } from "@lib/ggm.ts";
import { decideCopy, slippageBps } from "@lib/intents.ts";
import { LocalIntents } from "@lib/copy-local.ts";
import { dryQuote, USDC_NEAR } from "@lib/oneclick.ts";
import { YOU } from "@lib/seed-shared.ts";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { dateOf, FEEDS, lnear, money, timeOf, useStore } from "../../src/store.ts";
import { stepOf, useRun } from "../../src/testnet.ts";
import { Badge, Empty, Icon, Progress, Tx } from "./ui.tsx";

const ASSETS = [{ id: "nep141:eth.omft.near", dec: 18 }, { id: "nep141:btc.omft.near", dec: 8 }, { id: "nep141:sol.omft.near", dec: 9 }];
type Tab = "journal" | "check" | "copy";

export function Window({ id, tab }: { id: number; tab?: string }) {
  const s = useStore();
  const token = Number.isFinite(id) ? s.token(id) : null;
  const t = token ? s.traders().find((x) => x.id === token.trader) : undefined;
  const one = s.oneTime.get(id);
  if (!token || !t) return <Empty title={`No window #${Number.isFinite(id) ? id : "?"}`} action={<a className="btn primary" href="#/">Back to traders</a>}>Reloading the page resets the demo, and windows bought before go with it.</Empty>;
  if (!one) return <Empty title={`Window #${id} is sealed to you`} action={<a className="btn primary" href={`#/t/${t.account.replace(/\.local$/, "")}`}>Buy a window of {t.handle}</a>}>Its one-time key lived in a tab that's gone. Keys never leave the tab that made them, so nobody else can open it either.</Empty>;
  const current: Tab = tab === "check" || tab === "copy" ? tab : "journal";
  return <WindowBody id={id} token={token} t={t} one={one} tab={current} />;
}

function stateBadge(state: string) {
  if (state === "Delivered") return <Badge tone="info">In escrow</Badge>;
  if (state === "Closed") return <Badge tone="neutral">Paid to trader</Badge>;
  if (state === "Refunded") return <Badge tone="ok">Refunded</Badge>;
  return <Badge tone="warn">Awaiting delivery</Badge>;
}

function tradeLine(e: Entry): string {
  if (isDecoy(e)) return "Decoy · no trade";
  const q = Number(e.qty_e8) / 1e8;
  return `${q > 0 ? "Buy" : "Sell"} ${Math.abs(q).toFixed(4)} ${FEEDS[e.feed] ?? `feed ${e.feed}`} @ ${(Number(e.fill_e8) / 1e8).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function WindowBody({ id, token, t, one, tab }: { id: number; token: TokenRec; t: TraderRec; one: OneTime; tab: Tab }) {
  const s = useStore();
  const handle = t.account.replace(/\.local$/, "");
  const delivered = token.state !== "Pending" && !!token.eph;
  const reader = useMemo(() => (delivered ? new WindowReader(token, one) : null), [token.state, id]);
  const verified = reader?.verifyNodes() ?? [];
  const firstBad = verified.findIndex((x) => !x);
  const entries = useMemo(() => s.entries(t.account, 0, Number(t.next_seq)), [t.next_seq, t.account]);
  const inWindow = entries.filter((e) => e.slot >= token.first_slot && e.slot <= token.last_slot);
  const after = entries.filter((e) => e.slot > token.last_slot).slice(0, 3);

  const rows = useMemo(() => {
    if (!reader) return [];
    const out: { epoch: number; posted: bigint | null; mine: bigint | null; entries: EntryRec[]; verdict: any }[] = [];
    for (let ep = token.first_epoch; ep <= token.last_epoch; ep++) {
      const rec = s.v<any[]>("get_epochs", { account: t.account, from: ep, limit: 1 })[0];
      const es = rec ? entries.slice(Number(rec.first_seq), Number(rec.first_seq) + rec.entries) : [];
      let mine: bigint | null = null;
      try { mine = replayEpoch(es, (x) => reader.key(x)!, s.prices, BigInt(t.book_usd_e6), s.timing.epochStart(ep + 1)).pnl_e6; } catch { mine = null; }
      out.push({ epoch: ep, posted: rec?.posted_e6 != null ? BigInt(rec.posted_e6) : null, mine, entries: es, verdict: rec?.verdict });
    }
    return out;
  }, [s.version, id, !!reader]);
  const falseRows = rows.filter((r) => r.posted !== null && r.mine !== null && r.mine !== r.posted && !r.verdict?.False);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "journal", label: "Journal" },
    { key: "check", label: "Check figures", count: falseRows.length && !t.status?.Slashed ? falseRows.length : undefined },
    { key: "copy", label: "Copy trades" },
  ];

  return (
    <>
      <Progress />
      <div className="crumbs"><a href="#/">Traders</a><Icon name="chevron" size={12} /><a href={`#/t/${handle}`}>{t.handle}</a><Icon name="chevron" size={12} /><span>Window #{id}</span></div>
      <header className="page-head">
        <div>
          <h1>{dateOf(s.timing.epochStart(token.first_epoch))}{token.last_epoch > token.first_epoch ? ` – ${dateOf(s.timing.epochStart(token.last_epoch))}` : ""} {stateBadge(token.state)}</h1>
          <p className="muted">{t.handle}'s journal · paid {lnear(token.price)} Ⓝ{token.state === "Delivered" ? ` · escrow releases ${timeOf(Number(token.settle_at_ms))}` : ""}</p>
        </div>
      </header>

      {firstBad >= 0 ? <BadDelivery id={id} token={token} t={t} one={one} node={firstBad} /> : null}

      {reader ? <Coverage token={token} nodes={reader.nodes.map((n) => n.id)} good={verified} ok={verified.filter(Boolean).length} /> : <div className="alert info"><Icon name="key" /><div>Waiting for the trader to deliver your keys.</div></div>}

      <div className="tabs" role="tablist" aria-label="Window">
        {tabs.map((x) => (
          <a key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? "on" : ""} href={`#/w/${id}${x.key === "journal" ? "" : `/${x.key}`}`}>
            {x.label}{x.count ? <span className="tab-count">{x.count}</span> : null}
          </a>
        ))}
      </div>

      {tab === "journal" ? <Journal id={id} reader={reader} inWindow={inWindow} after={after} /> : null}
      {tab === "check" ? <Check id={id} token={token} t={t} reader={reader} rows={rows} falseRows={falseRows} /> : null}
      {tab === "copy" ? <Copy t={t} reader={reader} inWindow={inWindow} /> : null}
    </>
  );
}

/** The window drawn against the journal: what your keys cover, and the sealed days either side. */
function Coverage({ token, nodes, good, ok }: { token: TokenRec; nodes: NodeId[]; good: boolean[]; ok: number }) {
  const slots = token.last_slot - token.first_slot + 1;
  const pad = Math.max(4, Math.round(slots * 0.25));
  const from = token.first_slot - pad, to = token.last_slot + pad, span = to - from + 1;
  const pct = (sl: number) => ((sl - from) / span) * 100;
  return (
    <section className="card coverage" aria-label="What your keys cover">
      <div className="coverage-text">
        <span className="coverage-title"><Icon name="key" size={15} /> {nodes.length} keys cover {slots} slots</span>
        <span className="muted small">{ok === nodes.length ? "Every key matches the trader's commitment." : `${ok} of ${nodes.length} keys match the commitment.`} Nothing outside the window can be derived from them.</span>
      </div>
      <div className="coverage-bar" aria-hidden="true">
        <div className="coverage-in" style={{ left: `${pct(token.first_slot)}%`, width: `${pct(token.last_slot + 1) - pct(token.first_slot)}%` }}>
          {nodes.map((n, i) => {
            const [a, b] = slotsOf(n, DEPTH);
            return <span key={`${n.level}-${n.index}`} className={`coverage-node ${good[i] === false ? "bad" : ""}`} style={{ left: `${((a - token.first_slot) / slots) * 100}%`, width: `${((b - a + 1) / slots) * 100}%` }} />;
          })}
        </div>
      </div>
      <div className="coverage-legend muted small" aria-hidden="true"><span>sealed</span><span>your window</span><span>sealed</span></div>
    </section>
  );
}

function Journal({ id, reader, inWindow, after }: { id: number; reader: WindowReader | null; inWindow: EntryRec[]; after: EntryRec[] }) {
  const s = useStore();
  const [all, setAll] = useState(false);
  const [tried, setTried] = useState<Record<string, number>>({});
  const shown = all ? inWindow : inWindow.slice(0, 8);

  // A real attempt: every key the window can derive, against this entry's tag.
  function tryOpen(e: EntryRec) {
    let tries = 0, opened = false;
    for (const n of reader!.nodes) {
      const [a, b] = slotsOf(n.id, DEPTH);
      for (let slot = a; slot <= b; slot++) {
        const leaf = descend(n.value, n.id, { level: DEPTH, index: slot })!;
        tries++;
        if (openEntry(entryKey(leaf, BigInt(e.seq)), BigInt(e.seq), e.slot, unhex(e.ct), unhex(e.tag)).ok) opened = true;
      }
    }
    setTried((m) => ({ ...m, [e.seq]: opened ? -1 : tries }));
    s.markTried(id);
  }

  if (!reader) return null;
  return (
    <section className="card flush">
      <ul className="entries">
        {shown.map((e) => {
          const r = reader.read(e);
          if (!r.readable) return <li key={e.seq} className="entry"><span className="entry-seq">#{e.seq}</span><span className="entry-when">{timeOf(Number(e.at_ms))}</span><span className="neg">{r.why}</span></li>;
          const en = r.entry;
          if (!en) return <li key={e.seq} className="entry"><span className="entry-seq">#{e.seq}</span><span className="entry-when">{timeOf(Number(e.at_ms))}</span><span className="muted">Malformed entry · void by the PnL rule</span><span /></li>;
          const rounds = s.rounds(en.feed);
          const idx = firstRoundAtOrAfter(rounds, Number(e.at_ms));
          return (
            <li key={e.seq} className="entry open">
              <span className="entry-seq">#{e.seq}</span>
              <span className="entry-when">{timeOf(Number(e.at_ms))}</span>
              <span className="entry-body">
                <span className={`trade ${isDecoy(en) ? "muted" : Number(en.qty_e8) > 0 ? "buy" : "sell"}`}>{tradeLine(en)}</span>
                {!isDecoy(en) && en.note ? <span className="note">“{en.note}”</span> : null}
              </span>
              {!isDecoy(en) && idx >= 0 ? <span className="entry-meta mono muted" title="Priced by the contract at the first oracle round after the entry">oracle {(rounds[idx].answer_e8 / 1e8).toFixed(2)}</span> : <span />}
            </li>
          );
        })}
        {!all && inWindow.length > shown.length ? <li className="entry more"><button className="btn ghost sm" onClick={() => setAll(true)}>Show {inWindow.length - shown.length} more</button></li> : null}
        {inWindow.length === 0 ? <li className="entry more muted">No trades in this window.</li> : null}
      </ul>
      <div className="after" id="after">
        <div className="after-head"><Icon name="lock" size={14} /> After your window</div>
        <ul className="entries">
          {after.map((e, i) => (
            <li key={e.seq} className="entry sealed">
              <span className="entry-seq">#{e.seq}</span>
              <span className="entry-when">{timeOf(Number(e.at_ms))}</span>
              {tried[e.seq] === undefined ? (
                <>
                  <span className="cipher">{e.ct}</span>
                  {i === 0 ? <button className="btn sm" onClick={() => tryOpen(e)}><Icon name="unlock" size={13} />Try to open</button> : <span />}
                </>
              ) : (
                <span className="tried" role="status">{tried[e.seq] < 0 ? <span className="neg">It opened. That would be a bug.</span> : <><Icon name="lock" size={13} /><b>Still sealed.</b> <span className="muted">Tried all {tried[e.seq]} keys your window can derive. None open it, and nobody had to revoke anything.</span></>}</span>
              )}
            </li>
          ))}
          {after.length === 0 ? <li className="entry more muted">Nothing written after your window yet.</li> : null}
        </ul>
      </div>
    </section>
  );
}

type Row = { epoch: number; posted: bigint | null; mine: bigint | null; entries: EntryRec[]; verdict: any };
type Audit = { epoch: number; step: number; verdict?: any; bondBefore: bigint; posted: bigint | null; mine: bigint | null; error?: string };
const AUDIT_STEPS = ["Deposit at risk", "Keys handed to the contract", "Contract recomputes and compares"];

function Check({ id, token, t, reader, rows, falseRows }: { id: number; token: TokenRec; t: TraderRec; reader: WindowReader | null; rows: Row[]; falseRows: Row[] }) {
  const s = useStore();
  const run = useRun();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const pct = s.config.prover_bps / 100;
  const slashed = !!t.status?.Slashed;
  const refundable = slashed && (token.state === "Delivered" || token.state === "Pending");
  const totalPosted = rows.reduce((a, r) => a + Number(r.posted ?? 0n), 0) / 1e6;
  const totalMine = rows.reduce((a, r) => a + Number(r.mine ?? 0n), 0) / 1e6;

  async function prove(ep: number) {
    if (audit && !audit.verdict && !audit.error) return;
    setMsg(null);
    const row = rows.find((r) => r.epoch === ep)!;
    const base = { epoch: ep, bondBefore: BigInt(t.bond), posted: row.posted, mine: row.mine };
    const step = async (n: number) => { setAudit({ ...base, step: n }); await new Promise((ok) => setTimeout(ok, 450)); };
    const fail = (what: string, reason?: string) => setAudit({ ...base, step: 0, error: `${what} was refused: ${reason ?? "no reason given"}. Nothing was slashed.` });
    const replay = replayEpoch(row.entries, (x) => reader!.key(x)!, s.prices, BigInt(t.book_usd_e6), s.timing.epochStart(ep + 1));
    await step(1);
    const o = await s.chain.call(YOU, "audit_open", { trader: t.account, epoch: ep }, BigInt(s.config.audit_bond) + 10n ** 22n);
    if (!o.ok) return fail("audit_open", o.reason);
    await step(2);
    for (let i = 0; i < replay.openings.length; i += 40) {
      const st = await s.chain.call(YOU, "audit_step", { audit: o.value, openings: replay.openings.slice(i, i + 40) });
      if (!st.ok) return fail("audit_step", st.reason);
    }
    await step(3);
    const v = await s.chain.call(YOU, "audit_conclude", { audit: o.value, mark_indices: replay.mark_indices });
    if (!v.ok) return fail("audit_conclude", v.reason);
    setAudit({ ...base, step: 4, verdict: v.value });
  }

  async function claim() {
    const c = await s.chain.call(YOU, "claim_refund", { token_id: id });
    setMsg(c.ok ? { bad: false, text: `${lnear(String(c.value))} Ⓝ refunded to your credit.` } : { bad: true, text: `Refund refused: ${c.reason ?? "no reason given"}.` });
  }
  async function withdraw() {
    const w = await s.chain.call(YOU, "withdraw", {});
    setMsg(w.ok ? { bad: false, text: "Withdrawn to your balance." } : { bad: true, text: `Withdrawal refused: ${w.reason ?? "no reason given"}.` });
  }

  if (!reader) return null;
  const lie = stepOf(run, "lucky posts a LIE");
  const concluded = stepOf(run, "audit_conclude");
  const running = audit && !audit.verdict && !audit.error;
  return (
    <div className="stack">
      {falseRows.length && !slashed ? (
        <div className="alert bad"><Icon name="alert" /><div><b>{falseRows.length === rows.length ? "Every figure in this window is false." : `${falseRows.length} of ${rows.length} figures don't match the trades.`}</b> Prove any one and the contract slashes the whole bond.</div></div>
      ) : rows.length && !falseRows.length && !slashed ? (
        <div className="alert ok"><Icon name="check" /><div><b>Every figure matches the trades.</b> This trader posted what the journal says.</div></div>
      ) : null}

      <section className="card flush" id="figures">
        <table className="table figures">
          <thead><tr><th>Day</th><th className="num">Posted</th><th className="num">From the trades</th><th className="num" aria-label="Result" /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const diff = r.posted !== null && r.mine !== null && r.posted !== r.mine;
              return (
                <tr key={r.epoch} className={diff ? "is-false" : ""}>
                  <td>{dateOf(s.timing.epochStart(r.epoch))}</td>
                  <td className="num mono">{r.posted === null ? "—" : money(Number(r.posted) / 1e6, 2)}</td>
                  <td className="num mono">{r.mine === null ? "—" : money(Number(r.mine) / 1e6, 2)}</td>
                  <td className="num">
                    {r.verdict?.False ? <Badge tone="bad">Proven false</Badge>
                      : diff && slashed ? <Badge tone="bad">False</Badge>
                      : diff ? <button className="btn sm danger" onClick={() => prove(r.epoch)} disabled={!!running}>{running && audit?.epoch === r.epoch ? "Proving…" : "Prove it"}</button>
                      : r.posted !== null && r.mine !== null ? <span className="ok-mark" aria-label="matches"><Icon name="check" size={15} /></span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr><td>Total</td><td className="num mono">{money(totalPosted, 2)}</td><td className="num mono">{money(totalMine, 2)}</td><td /></tr></tfoot>
        </table>
      </section>
      <p className="footnote">Your browser replays each day from the decrypted trades and oracle prices, with the same integer maths as the contract.</p>

      {audit ? (
        <section className="card" aria-live="polite">
          <h2>Proof for {dateOf(s.timing.epochStart(audit.epoch))}</h2>
          <ol className="audit-steps">
            {AUDIT_STEPS.map((label, i) => (
              <li key={label} className={audit.step > i + 1 || audit.verdict ? "done" : audit.step === i + 1 ? "now" : ""}>
                <span className="audit-n">{audit.step > i + 1 || audit.verdict ? <Icon name="check" size={12} /> : i + 1}</span>{label}
              </li>
            ))}
          </ol>
          {audit.error ? <div className="alert bad small"><Icon name="alert" /><div>{audit.error}</div></div> : null}
          {audit.verdict?.trader_at_fault ? (
            <div className="result">
              <div className="result-head"><Badge tone="bad">Slashed</Badge><span>Posted {audit.posted !== null ? money(Number(audit.posted) / 1e6, 2) : "?"}, the trades make {audit.mine !== null ? money(Number(audit.mine) / 1e6, 2) : "?"}.</span></div>
              <dl className="ledger">
                <div><dt>Bond before</dt><dd className="mono">{lnear(String(audit.bondBefore))} Ⓝ</dd></div>
                <div><dt>To you ({pct}%)</dt><dd className="mono pos">+{lnear(audit.verdict.slashed_to_prover)} Ⓝ</dd></div>
                <div><dt>Burned</dt><dd className="mono">{lnear(String(audit.bondBefore - BigInt(audit.verdict.slashed_to_prover)))} Ⓝ</dd></div>
                <div><dt>Your deposit</dt><dd>returned</dd></div>
              </dl>
              {lie && concluded ? <p className="muted small">The same proof ran on NEAR testnet: <Tx tx={lie.tx!}>the false figure</Tx> and <Tx tx={concluded.tx!}>the slash</Tx>.</p> : null}
            </div>
          ) : audit.verdict ? <div className="alert info small"><Icon name="check" /><div>The figure was right. Your deposit went to the trader.</div></div> : null}
        </section>
      ) : null}

      {refundable || s.credit() > 0n || msg ? (
        <section className="card actions-card">
          <div>
            <b>{refundable ? "Your escrow can come back" : s.credit() > 0n ? `${lnear(s.credit())} Ⓝ ready to withdraw` : ""}</b>
            {msg ? <p className={msg.bad ? "neg small" : "muted small"} role={msg.bad ? "alert" : "status"}>{msg.text}</p> : null}
          </div>
          <div className="actions">
            {refundable ? <button className="btn primary" onClick={claim}>Claim refund</button> : null}
            {!refundable && s.credit() > 0n ? <button className="btn primary" onClick={withdraw}>Withdraw {lnear(s.credit())} Ⓝ</button> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function BadDelivery({ id, token, t, one, node }: { id: number; token: TokenRec; t: TraderRec; one: OneTime; node: number }) {
  const s = useStore();
  const run = useRun();
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  async function dispute() {
    setBusy(true);
    const bondBefore = BigInt(t.bond);
    const v = await s.chain.call(YOU, "dispute_wrap", { token_id: id, one_time_secret: hex(one.secret), node_index: node }, BigInt(token.price) + 10n ** 21n);
    setResult(v.ok ? { ...v.value, bondBefore } : { refused: v.reason ?? "no reason given" });
    setBusy(false);
  }
  const wrapped = stepOf(run, "dispute_wrap: secret revealed");
  // Read from the chain, so the outcome stays on the page after the window's state moves on.
  const won = result?.trader_at_fault || (token.state === "Refunded" && t.status?.Slashed?.by === YOU);
  if (won) {
    return (
      <div className="alert ok"><Icon name="check" /><div>
        <b>Dispute won. The trader is slashed.</b> Your payment and deposit are back{result?.slashed_to_prover ? <>, plus {lnear(result.slashed_to_prover)} Ⓝ of the bond</> : <>, plus {s.config.prover_bps / 100}% of the bond</>}.
        {s.credit() > 0n ? <div className="alert-actions"><button className="btn sm" onClick={() => s.chain.call(YOU, "withdraw", {})}>Withdraw {lnear(s.credit())} Ⓝ</button></div> : null}
        {wrapped ? <span className="muted small block">Same ruling on testnet: <Tx tx={wrapped.tx!} /></span> : null}
      </div></div>
    );
  }
  if (token.state !== "Delivered") return null;
  return (
    <div className="alert bad" role="alert"><Icon name="alert" /><div>
      <b>Key {node} doesn't match the trader's commitment.</b> Reveal your one-time secret and the contract checks the delivery itself.
      {result?.refused ? <span className="block neg small">The contract refused the dispute: {result.refused}.</span> : null}
      <div className="alert-actions"><button className="btn danger sm" onClick={dispute} disabled={busy}>{busy ? "Disputing…" : "Dispute delivery"}</button></div>
    </div></div>
  );
}

function Copy({ t, reader, inWindow }: { t: TraderRec; reader: WindowReader | null; inWindow: EntryRec[] }) {
  const s = useStore();
  const [book, setBook] = useState(10_000);
  const [cap, setCap] = useState(15_000);
  const [out, setOut] = useState<Record<string, { bad: boolean; text: string }>>({});
  const chain = useRef<LocalIntents | null>(null);
  useEffect(() => () => { chain.current = null; }, []);
  const theirBook = Number(t.book_usd_e6) / 1e6;
  const { scale, limits } = copyQtyLimits(book, cap, theirBook);
  if (!reader) return null;
  const trades = inWindow.map((e) => ({ e, r: reader.read(e) })).filter((x) => x.r.readable && !!(x.r as any).entry && !isDecoy((x.r as any).entry)).slice(0, 12) as { e: EntryRec; r: { entry: Entry } }[];

  async function copy(e: EntryRec, en: Entry) {
    const d = decideCopy(en.qty_e8, en.feed, en.fill_e8, limits);
    if (!d.copy) { setOut((o) => ({ ...o, [e.seq]: { bad: true, text: `Not copied: ${d.reason}.` } })); return; }
    try {
      chain.current ??= new LocalIntents(await fetch("./intents.near.wasm").then((r) => r.arrayBuffer()), (x) => nobleSha256(x), s.vm.clockMs);
      const rounds = s.rounds(en.feed);
      const side: 1 | -1 = en.qty_e8 > 0n ? 1 : -1;
      const price = (rounds[rounds.length - 1].answer_e8 / 1e8) * (1 + side * 0.0003);
      const f = chain.current.fill(en.feed, d.qty_e8, price);
      const slip = slippageBps(side, Number(en.fill_e8) / 1e8, price);
      setOut((o) => ({ ...o, [e.seq]: { bad: false, text: `Settled at ${price.toFixed(2)} (${Math.abs(slip).toFixed(0)} bps ${slip > 0 ? "worse" : "better"} than the trader). ${side > 0 ? `Paid ${(Number(f.usdcUnits) / 1e6).toFixed(2)} USDC` : `Sold ${(Number(f.assetUnits) / 1e6).toFixed(4)} ${FEEDS[en.feed]}`}.` } }));
    } catch (err) {
      setOut((o) => ({ ...o, [e.seq]: { bad: true, text: `Failed: ${String((err as Error).message).slice(0, 100)}` } }));
    }
  }

  async function quote(e: EntryRec, en: Entry) {
    const d = decideCopy(en.qty_e8, en.feed, en.fill_e8, limits);
    if (!d.copy) { setOut((o) => ({ ...o, [e.seq]: { bad: true, text: `Not copied: ${d.reason}.` } })); return; }
    setOut((o) => ({ ...o, [e.seq]: { bad: false, text: "Asking 1Click…" } }));
    try {
      const buy = en.qty_e8 > 0n, asset = ASSETS[en.feed];
      const amountIn = buy ? String(Math.round(d.notionalUsd * 1e6)) : String(BigInt(Math.round((Math.abs(Number(d.qty_e8)) / 1e8) * 10 ** Math.min(asset.dec, 12))) * 10n ** BigInt(Math.max(asset.dec - 12, 0)));
      const q = await dryQuote({ from: buy ? USDC_NEAR : asset.id, to: buy ? asset.id : USDC_NEAR, amountIn, slippageBps: 50, recipient: "you.near" });
      setOut((o) => ({ ...o, [e.seq]: q.ok ? { bad: false, text: `Live quote: ${q.amountInUsd ? `$${Number(q.amountInUsd).toFixed(2)} → ` : ""}${Number(q.amountOutFormatted).toFixed(buy ? 6 : 2)} ${buy ? FEEDS[en.feed] : "USDC"}, ~${q.timeEstimate}s. Nothing signed.` } : { bad: true, text: `1Click answered ${q.status}.` } }));
    } catch (err) {
      setOut((o) => ({ ...o, [e.seq]: { bad: true, text: `Couldn't reach 1Click (${String(err).slice(0, 60)}).` } }));
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Your limits</h2>
        <div className="sliders">
          <label><span>Your book</span><input type="range" min="1000" max="100000" step="1000" value={book} onChange={(e) => setBook(Number(e.target.value))} /><b className="mono">${book.toLocaleString("en-US")}</b></label>
          <label><span>Max per trade</span><input type="range" min="100" max="30000" step="100" value={cap} onChange={(e) => setCap(Number(e.target.value))} /><b className="mono">${cap.toLocaleString("en-US")}</b></label>
        </div>
        <p className="muted small">Trades are scaled from their {money(theirBook).slice(1)} book to yours ({(scale * 100).toFixed(1)}%) and refused before signing if they exceed your cap.</p>
      </section>
      <section className="card flush">
        <ul className="entries">
          {trades.map(({ e, r }) => (
            <li key={e.seq} className="entry copyrow">
              <span className="entry-when">{timeOf(Number(e.at_ms))}</span>
              <span className={`trade ${Number(r.entry.qty_e8) > 0 ? "buy" : "sell"}`}>{tradeLine(r.entry)}</span>
              <span className="row-actions">
                <button className="btn sm" onClick={() => copy(e, r.entry)}>Copy</button>
                <button className="btn sm ghost" onClick={() => quote(e, r.entry)}>Quote</button>
              </span>
              {out[e.seq] ? <span className={`copy-out small ${out[e.seq].bad ? "neg" : "muted"}`} role="status">{out[e.seq].text}</span> : null}
            </li>
          ))}
          {trades.length === 0 ? <li className="entry more muted">No trades to copy in this window.</li> : null}
        </ul>
      </section>
      <p className="footnote">Copy signs a real NEP-413 intent and settles it on the mainnet intents.near contract running in this tab, against a local solver with test tokens. Quote asks the real 1Click API and signs nothing.</p>
    </div>
  );
}
