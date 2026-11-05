import { useEffect, useMemo, useRef, useState } from "react";
import { hex } from "@lib/bytes.ts";
import { DEPTH, firstRoundAtOrAfter, replayEpoch, WindowReader, type EntryRec, type TokenRec } from "@lib/client.ts";
import { entryKey, openEntry, type Entry } from "@lib/entry.ts";
import { descend, slotsOf, type NodeId } from "@lib/ggm.ts";
import { unhex } from "@lib/bytes.ts";
import { decideCopy } from "@lib/intents.ts";
import { dryQuote, USDC_NEAR } from "@lib/oneclick.ts";
import { YOU } from "@lib/seed-shared.ts";
import { Bar, Glyph, Pill } from "./bits.tsx";
import { dateOf, FEEDS, lnear, money, shortHex, timeOf, useStore } from "./store.ts";

const SHOWN = 7;
const ASSETS = [{ id: "nep141:eth.omft.near", dec: 18 }, { id: "nep141:btc.omft.near", dec: 8 }, { id: "nep141:sol.omft.near", dec: 9 }];

/** The key, drawn: the slots around the window, and the few nodes that cover exactly it. */
function Ruler({ token, nodes }: { token: TokenRec; nodes: NodeId[] }) {
  const pad = Math.max(6, Math.round((token.last_slot - token.first_slot + 1) * 0.12));
  const from = token.first_slot - pad;
  const to = token.last_slot + pad;
  const span = to - from + 1;
  const W = 900;
  const x = (s: number) => ((s - from) / span) * W;
  const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
  const rowH = 22;
  const H = levels.length * rowH + 46;
  return (
    <svg className="ruler" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${nodes.length} nodes cover slots ${token.first_slot} to ${token.last_slot}`}>
      <rect x="0" y={H - 26} width={x(token.first_slot)} height="10" className="out" />
      <rect x={x(token.last_slot + 1)} y={H - 26} width={W - x(token.last_slot + 1)} height="10" className="out" />
      <rect x={x(token.first_slot)} y={H - 26} width={x(token.last_slot + 1) - x(token.first_slot)} height="10" className="in" />
      {nodes.map((n) => {
        const [a, b] = slotsOf(n, DEPTH);
        const row = levels.indexOf(n.level);
        const y = row * rowH + 6;
        return (
          <g key={`${n.level}-${n.index}`}>
            <rect x={x(a)} y={y} width={Math.max(x(b + 1) - x(a) - 1, 2)} height={rowH - 6} className="node" />
            {x(b + 1) - x(a) > 60 ? <text x={x(a) + 5} y={y + 12} className="node-label">L{n.level}/{n.index}</text> : null}
            <line x1={x(a)} x2={x(a)} y1={y + rowH - 6} y2={H - 26} className="drop" />
            <line x1={x(b + 1) - 1} x2={x(b + 1) - 1} y1={y + rowH - 6} y2={H - 26} className="drop" />
          </g>
        );
      })}
      <text x="4" y={H - 4} className="tick">slot {from}</text>
      <text x={W / 2} y={H - 4} textAnchor="middle" className="tick">{token.last_slot - token.first_slot + 1} slots readable; {nodes.length} nodes delivered</text>
      <text x={W - 4} y={H - 4} textAnchor="end" className="tick">slot {to}</text>
    </svg>
  );
}

/** Ciphertext turning into plaintext, one column at a time. It's real: this renders what was just decrypted. */
function Decrypted({ text, ct }: { text: string; ct: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(text.length); return; }
    const t = setInterval(() => setN((v) => { if (v >= text.length) { clearInterval(t); return v; } return v + 2; }), 14);
    return () => clearInterval(t);
  }, [text]);
  return <span className="decrypted">{text.slice(0, n)}<span className="residue">{ct.slice(n, text.length)}</span></span>;
}

function line(e: Entry): string {
  const q = Number(e.qty_e8) / 1e8;
  const asset = FEEDS[e.feed] ?? `feed ${e.feed}`;
  return `${q > 0 ? "BUY " : "SELL"} ${Math.abs(q).toFixed(4)} ${asset} @ ${(Number(e.fill_e8) / 1e8).toFixed(2)}`;
}

export function Reader({ id }: { id: number }) {
  const s = useStore();
  const token = s.token(id);
  const t = s.traders().find((x) => x.id === token?.trader);
  const one = s.oneTime.get(id);
  const [audit, setAudit] = useState<{ epoch: number; lines: string[]; verdict?: any } | null>(null);
  const [dispute, setDispute] = useState<any>(null);
  const [tried, setTried] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [scale, setScale] = useState(0.05);
  const [cap, setCap] = useState(3000);
  const [quote, setQuote] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  if (!token || !t) return <p className="note">No such window. <a href="#/">Back to the board</a>.</p>;
  if (!one) return (
    <div className="panel">
      <h2>Window #{id}, {t.handle}</h2>
      <p>This token's one-time key lived in a tab that's gone: reloading this page restarts the local chain. Keys never leave the tab that made them. <a href="#/">Back to the board</a>.</p>
    </div>
  );

  const delivered = token.state !== "Pending" && !!token.eph;
  const reader = useMemo(() => (delivered ? new WindowReader(token, one) : null), [token.state, id]);
  const verified = reader?.verifyNodes() ?? [];
  const firstBad = verified.findIndex((x) => !x);
  const nodeIds = reader?.nodes.map((n) => n.id) ?? [];

  // The window's entries, a few before and everything after it.
  const entries = useMemo(() => s.entries(t.account, 0, Number(t.next_seq)), [t.next_seq, t.account]);
  const inWindow = entries.filter((e) => e.slot >= token.first_slot && e.slot <= token.last_slot);
  const after = entries.filter((e) => e.slot > token.last_slot).slice(0, 4);
  const before = entries.filter((e) => e.slot < token.first_slot).slice(-2);

  const epochRows = useMemo(() => {
    if (!reader) return [];
    const out: { epoch: number; posted: bigint | null; mine: bigint | null; entries: EntryRec[]; verdict: any; openError?: string }[] = [];
    for (let ep = token.first_epoch; ep <= token.last_epoch; ep++) {
      const rec = s.v<any[]>("get_epochs", { account: t.account, from: ep, limit: 1 })[0];
      const es = rec ? entries.slice(Number(rec.first_seq), Number(rec.first_seq) + rec.entries) : [];
      let mine: bigint | null = null;
      let openError: string | undefined;
      try {
        mine = replayEpoch(es, (x) => reader.key(x)!, s.prices, BigInt(t.book_usd_e6), s.timing.epochStart(ep + 1)).pnl_e6;
      } catch (e) { openError = String((e as Error).message); }
      out.push({ epoch: ep, posted: rec?.posted_e6 ? BigInt(rec.posted_e6) : null, mine, entries: es, verdict: rec?.verdict, openError });
    }
    return out;
  }, [s.version, id, !!reader]);
  const falseRows = epochRows.filter((r) => r.posted !== null && r.mine !== null && r.mine !== r.posted && !r.verdict?.False);
  const totalPosted = epochRows.reduce((a, r) => a + Number(r.posted ?? 0n), 0) / 1e6;
  const totalMine = epochRows.reduce((a, r) => a + Number(r.mine ?? 0n), 0) / 1e6;

  /** Really try: every key this window can derive, against this entry's tag. */
  function tryOpen(e: EntryRec) {
    let tries = 0;
    let opened = false;
    const stack: { id: NodeId; v: Uint8Array }[] = reader!.nodes.map((n) => ({ id: n.id, v: n.value }));
    for (const n of stack) {
      const [a, b] = slotsOf(n.id, DEPTH);
      for (let slot = a; slot <= b; slot++) {
        const leaf = descend(n.v, n.id, { level: DEPTH, index: slot })!;
        tries++;
        if (openEntry(entryKey(leaf, BigInt(e.seq)), BigInt(e.seq), e.slot, unhex(e.ct), unhex(e.tag)).ok) opened = true;
      }
    }
    setTried((m) => ({ ...m, [e.seq]: opened ? "It opened. That would be a bug." : `Tried all ${tries} keys this window can derive, against this entry's tag. None opened. Slot ${e.slot} is outside your window, and no amount of hashing gets from your nodes to its key. Nobody revoked anything. You're offline as far as this goes.` }));
  }

  async function catchLiar(ep: number) {
    const row = epochRows.find((r) => r.epoch === ep)!;
    const lines: string[] = [];
    const say = async (l: string) => { lines.push(l); setAudit({ epoch: ep, lines: [...lines] }); await new Promise((ok) => setTimeout(ok, 400)); };
    const replay = replayEpoch(row.entries, (x) => reader!.key(x)!, s.prices, BigInt(t!.book_usd_e6), s.timing.epochStart(ep + 1));
    await say(`audit_open: ${lnear(s.config.audit_bond)} Ⓝ of yours goes at risk. If the figure is right, the trader keeps it.`);
    const o = await s.chain.call(YOU, "audit_open", { trader: t!.account, epoch: ep }, BigInt(s.config.audit_bond) + 10n ** 22n);
    if (!o.ok) { setMsg(o.reason ?? "refused"); return; }
    await say(`audit_step: you hand the contract ${replay.openings.length} entry keys. For each, it checks the tag, decrypts, and prices the trade at the first oracle round after it was written.`);
    for (let i = 0; i < replay.openings.length; i += 40) {
      const st = await s.chain.call(YOU, "audit_step", { audit: o.value, openings: replay.openings.slice(i, i + 40) });
      if (!st.ok) { setMsg(st.reason ?? "refused"); return; }
    }
    await say("audit_conclude: it marks what's still held at the first round after the epoch's end, and compares.");
    const v = await s.chain.call(YOU, "audit_conclude", { audit: o.value, mark_indices: replay.mark_indices });
    if (!v.ok) { setMsg(v.reason ?? "refused"); return; }
    lines.push(v.value.detail);
    setAudit({ epoch: ep, lines: [...lines], verdict: v.value });
  }

  async function disputeWrap() {
    const v = await s.chain.call(YOU, "dispute_wrap", { token_id: id, one_time_secret: hex(one!.secret), node_index: firstBad }, BigInt(token.price) + 10n ** 21n);
    setDispute(v.ok ? v.value : { detail: v.reason });
  }

  async function claim() {
    const c = await s.chain.call(YOU, "claim_refund", { token_id: id });
    setMsg(c.ok ? `Refund credited: ${lnear(String(c.value))} Ⓝ.` : c.reason ?? "refused");
  }

  async function withdraw() {
    const w = await s.chain.call(YOU, "withdraw", {});
    setMsg(w.ok ? "Paid out to your account." : w.reason ?? "refused");
  }

  async function getQuote(e: EntryRec, entry: Entry) {
    const d = decideCopy(entry.qty_e8, entry.feed, entry.fill_e8, { maxNotionalUsd: cap, feeds: [0, 1, 2], scale, maxSlippageBps: 50 });
    if (!d.copy) { setQuote((q) => ({ ...q, [e.seq]: d.reason })); return; }
    setQuote((q) => ({ ...q, [e.seq]: "asking 1Click…" }));
    try {
      const buy = entry.qty_e8 > 0n;
      const asset = ASSETS[entry.feed];
      const amountIn = buy ? String(Math.round(d.notionalUsd * 1e6)) : String(BigInt(Math.round((Math.abs(Number(d.qty_e8)) / 1e8) * 10 ** Math.min(asset.dec, 12))) * 10n ** BigInt(Math.max(asset.dec - 12, 0)));
      const q = await dryQuote({ from: buy ? USDC_NEAR : asset.id, to: buy ? asset.id : USDC_NEAR, amountIn, slippageBps: 50, recipient: "you.near" });
      setQuote((m) => ({ ...m, [e.seq]: q.ok ? `Live dry quote, now: ${q.amountInUsd ? `$${Number(q.amountInUsd).toFixed(2)} in` : ""} → ${Number(q.amountOutFormatted).toFixed(buy ? 6 : 2)} ${buy ? FEEDS[entry.feed] : "USDC"}, about ${q.timeEstimate}s. Ready to sign; this page signs nothing.` : `1Click said ${q.status}: ${JSON.stringify(q.raw).slice(0, 100)}` }));
    } catch (err) {
      setQuote((m) => ({ ...m, [e.seq]: `Couldn't reach 1Click from this browser (${String(err).slice(0, 60)}). Everything else here is local.` }));
    }
  }

  const refundable = (t.status?.Slashed && (token.state === "Delivered" || token.state === "Pending")) || token.state === "Refundable";

  return (
    <>
      <section className="thead">
        <div>
          <p className="kicker"><a href="#/">The board</a> / <a href={`#/t/${t.account.replace(/\.local$/, "")}`}>{t.handle}</a> / window #{id}</p>
          <h1>{dateOf(s.timing.epochStart(token.first_epoch))} to {dateOf(s.timing.epochStart(token.last_epoch))}</h1>
          <p className="blurb">NEP-171 token #{id}. Paid {lnear(token.price)} Ⓝ, in escrow until {timeOf(Number(token.settle_at_ms))}. State: {token.state}.</p>
        </div>
      </section>

      {firstBad >= 0 && !dispute && token.state === "Delivered" ? (
        <div className="verdict alarm">
          <b>Node {firstBad} doesn't match its commitment.</b> What the trader delivered isn't what he committed to before the sale. Reveal your one-time secret, and the contract unwraps that node and compares for itself. It costs about 9.8 Tgas on a real chain.
          <div><button className="primary danger" onClick={disputeWrap}>Dispute: reveal the one-time secret</button></div>
        </div>
      ) : null}
      {dispute ? (
        <div className={`verdict ${dispute.trader_at_fault ? "ok" : "alarm"}`}>
          <b>{dispute.trader_at_fault ? "The trader is slashed." : "Dismissed."}</b> {dispute.detail}. {dispute.trader_at_fault ? <>Your escrow and deposit are back, with {lnear(dispute.slashed_to_prover)} Ⓝ of the bond.</> : null}
          {s.credit() > 0n ? <div><button className="primary" onClick={withdraw}>Withdraw {lnear(s.credit())} Ⓝ</button></div> : null}
        </div>
      ) : null}

      <section className="drawn">
        <h2><Glyph /> What you bought</h2>
        {reader ? <Ruler token={token} nodes={nodeIds} /> : null}
        <p className="caption">
          {nodeIds.length} tree nodes, unwrapped in this tab with your one-time key. Each commits to the root the trader posted before the sale: {verified.filter(Boolean).length} of {verified.length} check out.
          The hatched slots are the rest of the journal. There's no node for them in your hands, now or later, and nobody needs to be online to keep it that way.
        </p>
      </section>

      <section className="split wide-left">
        <div className="panel">
          <h2>The journal, through your window</h2>
          <ul className="journal">
            {before.map((e) => (
              <li key={e.seq} className="dim">
                <span className="seq">#{e.seq}</span><span className="when">{timeOf(Number(e.at_ms))}</span><Bar ct={e.ct} label="before your window" />
              </li>
            ))}
            {(showAll ? inWindow : inWindow.slice(0, SHOWN)).map((e) => {
              const r = reader?.read(e);
              const entry = r && r.readable ? r.entry : null;
              if (r && !r.readable) return (
                <li key={e.seq}><span className="seq">#{e.seq}</span><span className="when">{timeOf(Number(e.at_ms))}</span><span className="failmsg">{r.why}</span></li>
              );
              const rounds = entry ? s.rounds(entry.feed) : null;
              const idx = entry && rounds ? firstRoundAtOrAfter(rounds, Number(e.at_ms)) : -1;
              return (
                <li key={e.seq} className="open">
                  <span className="seq">#{e.seq}</span>
                  <span className="when">{timeOf(Number(e.at_ms))}</span>
                  <span className="body">
                    <span className="trade"><Decrypted text={entry ? line(entry) : "malformed: void by the PnL rule"} ct={e.ct} /></span>
                    {entry ? <span className="reason">“{entry.note}”{idx >= 0 ? <em> oracle {(rounds![idx].answer_e8 / 1e8).toFixed(2)}</em> : null}</span> : null}
                    {entry ? (
                      <span className="copy-row">
                        <button className="link" onClick={() => getQuote(e, entry)}>Quote a copy</button>
                        {quote[e.seq] ? <span className="note">{quote[e.seq]}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {!showAll && inWindow.length > SHOWN ? <li className="more"><button className="link" onClick={() => setShowAll(true)}>Show the other {inWindow.length - SHOWN} entries in your window</button></li> : null}
            {inWindow.length === 0 ? <li className="note">No entries in this window: the trader didn't trade.</li> : null}
            {after.map((e) => (
              <li key={e.seq} className="past">
                <span className="seq">#{e.seq}</span><span className="when">{timeOf(Number(e.at_ms))}</span>
                <span className="body">
                  <Bar ct={e.ct} label="past your window" />
                  <button className="link" onClick={() => tryOpen(e)}>Try to open it anyway</button>
                  {tried[e.seq] ? <span className="failmsg">{tried[e.seq]}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="stack">
          <section className="panel check">
            <h2>Check the figures</h2>
            <p className="note">Your tab replays each epoch from the entries and the oracle: the same integer arithmetic as the contract.</p>
            <table>
              <thead><tr><th>Epoch</th><th className="num">Posted</th><th className="num">You get</th><th /></tr></thead>
              <tbody>
                {epochRows.map((r) => {
                  const diff = r.posted !== null && r.mine !== null && r.posted !== r.mine;
                  return (
                    <tr key={r.epoch} className={diff ? "bad" : ""}>
                      <td>{dateOf(s.timing.epochStart(r.epoch))}</td>
                      <td className="num">{r.posted === null ? "—" : money(Number(r.posted) / 1e6, 2)}</td>
                      <td className="num">{r.mine === null ? "?" : money(Number(r.mine) / 1e6, 2)}</td>
                      <td className="mark">{r.verdict?.False ? <Pill tone="alarm">proven</Pill> : diff && t.status?.Slashed ? "false" : diff ? <button className="link danger" onClick={() => catchLiar(r.epoch)}>Prove it</button> : r.posted !== null && r.mine !== null ? "✓" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr><td>Window</td><td className="num">{money(totalPosted, 2)}</td><td className="num">{money(totalMine, 2)}</td><td /></tr></tfoot>
            </table>
            {falseRows.length && !t.status?.Slashed ? <p className="verdict alarm"><b>{falseRows.length === epochRows.length ? "Every figure here is false." : `${falseRows.length} of these figures are false.`}</b> The difference is {money(totalPosted - totalMine, 2).replace("+", "")} of PnL that didn't happen. Prove any one of them, and the bond is slashed.</p> : null}
            {audit ? (
              <div className="audit-log">
                <ol className="steps">{audit.lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
                {audit.verdict?.trader_at_fault ? (
                  <p className="verdict ok"><b>Slashed.</b> {lnear(audit.verdict.slashed_to_prover)} Ⓝ of the bond is yours, and your {lnear(s.config.audit_bond)} Ⓝ came back. The board now shows the corrected figure, for good.</p>
                ) : audit.verdict ? <p className="verdict alarm">The figure was right: the deposit went to the trader.</p> : null}
              </div>
            ) : null}
            {refundable && token.state !== "Refunded" ? <button className="primary" onClick={claim}>Claim the refund: escrow, plus a share of the bond</button> : null}
            {s.credit() > 0n ? <button className="primary" onClick={withdraw}>Withdraw {lnear(s.credit())} Ⓝ</button> : null}
            {msg ? <p className="note">{msg}</p> : null}
          </section>

          <section className="panel copy">
            <h2>Your copy limits</h2>
            <p className="note">Applied here, before anything is signed. “Quote a copy” asks 1Click live for a dry quote, keyless. A signed intent runs only in the sandbox (<code>npm run copy</code>) against the real intents.near wasm. Nothing on this page signs anything.</p>
            <label>Scale to your book <input type="range" min="0.01" max="0.5" step="0.01" value={scale} onChange={(e) => setScale(Number(e.target.value))} /> <b>{Math.round(scale * 100)}%</b></label>
            <label>Cap per trade <input type="range" min="100" max="20000" step="100" value={cap} onChange={(e) => setCap(Number(e.target.value))} /> <b>${cap.toLocaleString("en-US")}</b></label>
          </section>
        </div>
      </section>
      <p className="caption">{shortHex(token.eph ?? "")} is the trader's ephemeral key, {shortHex(token.buyer_pub ?? "")} is yours. Both are on the chain, so that a dispute can prove what was sent. Your secret isn't.</p>
    </>
  );
}
