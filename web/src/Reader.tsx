import { useEffect, useMemo, useRef, useState } from "react";
import { hex } from "@lib/bytes.ts";
import { DEPTH, firstRoundAtOrAfter, replayEpoch, WindowReader, type EntryRec, type TokenRec, type TraderRec } from "@lib/client.ts";
import { entryKey, isDecoy, openEntry, type Entry, type OneTime } from "@lib/entry.ts";
import { descend, slotsOf, type NodeId } from "@lib/ggm.ts";
import { unhex } from "@lib/bytes.ts";
import { decideCopy, slippageBps } from "@lib/intents.ts";
import { LocalIntents } from "@lib/copy-local.ts";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2.js";
import { dryQuote, USDC_NEAR } from "@lib/oneclick.ts";
import { YOU } from "@lib/seed-shared.ts";
import { Bar, Glyph, Pill, Tx } from "./bits.tsx";
import { dateOf, FEEDS, lnear, money, shortHex, timeOf, useStore } from "./store.ts";
import { stepOf, useRun } from "./testnet.ts";

const SHOWN = 7;
const ASSETS = [{ id: "nep141:eth.omft.near", dec: 18 }, { id: "nep141:btc.omft.near", dec: 8 }, { id: "nep141:sol.omft.near", dec: 9 }];

/** The keyhole, drawn: the journal's slots in lacquer, the window you bought cut out in brass, and the few nodes that cover exactly it. */
function Ruler({ token, nodes }: { token: TokenRec; nodes: NodeId[] }) {
  const pad = Math.max(6, Math.round((token.last_slot - token.first_slot + 1) * 0.12));
  const from = token.first_slot - pad;
  const to = token.last_slot + pad;
  const span = to - from + 1;
  const W = 900;
  const x = (s: number) => ((s - from) / span) * W;
  const levels = [...new Set(nodes.map((n) => n.level))].sort((a, b) => a - b);
  const rowH = 22;
  const H = levels.length * rowH + 50;
  const band = H - 30;
  return (
    <svg className="ruler" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${nodes.length} nodes cover slots ${token.first_slot} to ${token.last_slot}, and nothing outside them`}>
      <rect x="0" y={band} width={x(token.first_slot)} height="14" className="out" />
      <rect x={x(token.last_slot + 1)} y={band} width={W - x(token.last_slot + 1)} height="14" className="out" />
      <rect x={x(token.first_slot)} y={band} width={x(token.last_slot + 1) - x(token.first_slot)} height="14" className="in" />
      {nodes.map((n) => {
        const [a, b] = slotsOf(n, DEPTH);
        const row = levels.indexOf(n.level);
        const y = row * rowH + 6;
        return (
          <g key={`${n.level}-${n.index}`}>
            <rect x={x(a)} y={y} width={Math.max(x(b + 1) - x(a) - 1, 2)} height={rowH - 6} className="node" />
            {x(b + 1) - x(a) > 60 ? <text x={x(a) + 6} y={y + 12} className="node-label">L{n.level}/{n.index}</text> : null}
            <line x1={x(a)} x2={x(a)} y1={y + rowH - 6} y2={band} className="drop" />
            <line x1={x(b + 1) - 1} x2={x(b + 1) - 1} y1={y + rowH - 6} y2={band} className="drop" />
          </g>
        );
      })}
      <text x="4" y={H - 4} className="tick">sealed · slot {from}</text>
      <text x={(x(token.first_slot) + x(token.last_slot + 1)) / 2} y={H - 4} textAnchor="middle" className="tick on">your window: {token.last_slot - token.first_slot + 1} slots, {nodes.length} nodes</text>
      <text x={W - 4} y={H - 4} textAnchor="end" className="tick">slot {to} · sealed</text>
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
  if (isDecoy(e)) return "DECOY: no trade, void by the PnL rule";
  const q = Number(e.qty_e8) / 1e8;
  const asset = FEEDS[e.feed] ?? `feed ${e.feed}`;
  return `${q > 0 ? "BUY " : "SELL"} ${Math.abs(q).toFixed(4)} ${asset} @ ${(Number(e.fill_e8) / 1e8).toFixed(2)}`;
}

export function Reader({ id }: { id: number }) {
  const s = useStore();
  const token = Number.isFinite(id) ? s.token(id) : null;
  const t = token ? s.traders().find((x) => x.id === token.trader) : undefined;
  const one = s.oneTime.get(id);
  if (!token || !t) return (
    <div className="state failed">
      <h1>No window #{Number.isFinite(id) ? id : "?"} on this chain.</h1>
      <p>Reloading the page restarts the local chain, and the windows bought in it go with it.</p>
      <p><a className="primary" href="#/">Back to the board</a></p>
    </div>
  );
  if (!one) return (
    <div className="state failed">
      <h1>Window #{id} is still sealed to you.</h1>
      <p>It belongs to {t.handle}'s journal, but its one-time key lived in a tab that's gone, and keys never leave the tab that made them. That's the point: nobody else can open it either.</p>
      <p><a className="primary" href={`#/t/${t.account.replace(/\.local$/, "")}`}>Buy a window of {t.handle} here</a></p>
    </div>
  );
  return <Window id={id} token={token} t={t} one={one} />;
}

type Audit = { epoch: number; lines: string[]; verdict?: any; bondBefore: bigint; posted: bigint | null; mine: bigint | null };

function Window({ id, token, t, one }: { id: number; token: TokenRec; t: TraderRec; one: OneTime }) {
  const s = useStore();
  const run = useRun();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [proving, setProving] = useState<number | null>(null);
  const [dispute, setDispute] = useState<any>(null);
  const [disputing, setDisputing] = useState(false);
  const [tried, setTried] = useState<Record<string, { opened: boolean; text: string }>>({});
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [myBook, setMyBook] = useState(10_000);
  const [cap, setCap] = useState(15_000);
  const [copied, setCopied] = useState<Record<string, string>>({});
  const copyChain = useRef<LocalIntents | null>(null);
  const [quote, setQuote] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const handle = t.account.replace(/\.local$/, "");
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
  const firstFalse = falseRows[0]?.epoch;

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
    setTried((m) => ({ ...m, [e.seq]: { opened, text: opened ? "It opened. That would be a bug." : `Tried all ${tries} keys this window can derive, against this entry's tag. None opened. Slot ${e.slot} is outside your window, and no amount of hashing gets from your nodes to its key. Nobody revoked anything. You're offline as far as this goes.` } }));
    s.markTried(id);
  }

  async function catchLiar(ep: number) {
    if (proving !== null) return;
    setMsg(null);
    setProving(ep);
    const row = epochRows.find((r) => r.epoch === ep)!;
    const base = { epoch: ep, bondBefore: BigInt(t.bond), posted: row.posted, mine: row.mine };
    const lines: string[] = [];
    const fail = (what: string, reason?: string) => { setMsg({ bad: true, text: `${what} refused: ${reason ?? "no reason given"}. Nothing was slashed. Reload the page to restart the local chain and try again.` }); setProving(null); };
    const say = async (l: string) => { lines.push(l); setAudit({ ...base, lines: [...lines] }); await new Promise((ok) => setTimeout(ok, 400)); };
    const replay = replayEpoch(row.entries, (x) => reader!.key(x)!, s.prices, BigInt(t.book_usd_e6), s.timing.epochStart(ep + 1));
    await say(`audit_open: ${lnear(s.config.audit_bond)} Ⓝ of yours goes at risk. If the figure is right, the trader keeps it.`);
    const o = await s.chain.call(YOU, "audit_open", { trader: t.account, epoch: ep }, BigInt(s.config.audit_bond) + 10n ** 22n);
    if (!o.ok) return fail("audit_open", o.reason);
    await say(`audit_step: you hand the contract ${replay.openings.length} entry keys. For each, it checks the tag, decrypts, and prices the trade at the first oracle round after it was written.`);
    for (let i = 0; i < replay.openings.length; i += 40) {
      const st = await s.chain.call(YOU, "audit_step", { audit: o.value, openings: replay.openings.slice(i, i + 40) });
      if (!st.ok) return fail("audit_step", st.reason);
    }
    await say("audit_conclude: it marks what's still held at the first round after the epoch's end, and compares.");
    const v = await s.chain.call(YOU, "audit_conclude", { audit: o.value, mark_indices: replay.mark_indices });
    if (!v.ok) return fail("audit_conclude", v.reason);
    lines.push(v.value.detail);
    setAudit({ ...base, lines: [...lines], verdict: v.value });
    setProving(null);
  }

  async function disputeWrap() {
    setDisputing(true);
    const bondBefore = BigInt(t.bond);
    const v = await s.chain.call(YOU, "dispute_wrap", { token_id: id, one_time_secret: hex(one.secret), node_index: firstBad }, BigInt(token.price) + 10n ** 21n);
    setDispute(v.ok ? { ...v.value, bondBefore } : { detail: `The contract refused the dispute: ${v.reason ?? "no reason given"}`, refused: true });
    setDisputing(false);
  }

  async function claim() {
    const c = await s.chain.call(YOU, "claim_refund", { token_id: id });
    setMsg(c.ok ? { bad: false, text: `Refund credited: ${lnear(String(c.value))} Ⓝ. Withdraw it to your balance.` } : { bad: true, text: `The refund was refused: ${c.reason ?? "no reason given"}.` });
  }

  async function withdraw() {
    const w = await s.chain.call(YOU, "withdraw", {});
    setMsg(w.ok ? { bad: false, text: "Paid out to your account: see the balance at the top." } : { bad: true, text: `The withdrawal was refused: ${w.reason ?? "no reason given"}.` });
  }

  const scale = Math.min(myBook / (Number(t.book_usd_e6) / 1e6), 1);
  const limits = { maxNotionalUsd: cap, feeds: [0, 1, 2], scale, maxSlippageBps: 50 };

  /** Sign and settle in this tab: a real NEP-413 token_diff on the real intents.near wasm, against a local solver. */
  async function copyHere(e: EntryRec, entry: Entry) {
    const d = decideCopy(entry.qty_e8, entry.feed, entry.fill_e8, limits);
    if (!d.copy) { setCopied((c) => ({ ...c, [e.seq]: `Refused before signing: ${d.reason}.` })); return; }
    try {
      if (!copyChain.current) {
        const wasm = await fetch("./intents.near.wasm").then((r) => r.arrayBuffer());
        copyChain.current = new LocalIntents(wasm, (x) => nobleSha256(x), s.vm.clockMs);
      }
      const rounds = s.rounds(entry.feed);
      const oracle = rounds[rounds.length - 1].answer_e8 / 1e8;
      const side: 1 | -1 = entry.qty_e8 > 0n ? 1 : -1;
      const price = oracle * (1 + side * 0.0003); // the local solver's spread on today's last round
      const f = copyChain.current.fill(entry.feed, d.qty_e8, price);
      const fill = Number(entry.fill_e8) / 1e8;
      const age = Math.round((s.vm.clockMs - Number(e.at_ms)) / 86400_000);
      setCopied((c) => ({ ...c, [e.seq]: `Signed here and settled on the real intents.near wasm, in this tab, with a local solver and test tokens: ${side > 0 ? "paid" : "sold"} ${side > 0 ? `${(Number(f.usdcUnits) / 1e6).toFixed(2)} USDC` : `${(Number(f.assetUnits) / 1e6).toFixed(4)} ${FEEDS[entry.feed]}`} at ${price.toFixed(2)}. Against his ${fill.toFixed(2)}, ${age} days ago: ${Math.abs(slippageBps(side, fill, price)).toFixed(0)} bps ${slippageBps(side, fill, price) > 0 ? "worse" : "better"}. You hold ${f.balances.usdc.toFixed(2)} USDC, ${f.balances.asset.toFixed(4)} ${FEEDS[entry.feed]} on it. Nothing left this tab.` }));
    } catch (err) {
      setCopied((c) => ({ ...c, [e.seq]: `Refused: ${String((err as Error).message).slice(0, 100)}` }));
    }
  }

  async function getQuote(e: EntryRec, entry: Entry) {
    const d = decideCopy(entry.qty_e8, entry.feed, entry.fill_e8, limits);
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

  const refundable = t.status?.Slashed && (token.state === "Delivered" || token.state === "Pending");
  const lie = stepOf(run, "lucky posts a LIE");
  const concluded = stepOf(run, "audit_conclude");
  const wrapped = stepOf(run, "dispute_wrap: secret revealed");
  const pct = s.config.prover_bps / 100;

  return (
    <>
      <section className="thead">
        <div>
          <p className="kicker"><a href="#/">The board</a> / <a href={`#/t/${handle}`}>{t.handle}</a> / window #{id}</p>
          <h1>{dateOf(s.timing.epochStart(token.first_epoch))} to {dateOf(s.timing.epochStart(token.last_epoch))}</h1>
          <p className="blurb">Your window into {t.handle}'s journal: NEP-171 token #{id}. Paid {lnear(token.price)} Ⓝ{token.state === "Refunded" ? ", and the escrow is yours again" : token.state === "Closed" ? ", released to the trader" : `, in escrow until ${timeOf(Number(token.settle_at_ms))}`}. State: {token.state}.</p>
        </div>
      </section>

      {firstBad >= 0 && !dispute && token.state === "Delivered" ? (
        <div className="verdict alarm" role="alert">
          <b>Node {firstBad} doesn't match its commitment.</b> What the trader delivered isn't what he committed to before the sale. Reveal your one-time secret, and the contract unwraps that node and compares for itself. It costs about 10 Tgas on a real chain.
          <div><button className="primary danger" onClick={disputeWrap} disabled={disputing}>{disputing ? "Disputing…" : "Dispute: reveal the one-time secret"}</button></div>
        </div>
      ) : null}
      {dispute ? (
        <div className={`verdict ${dispute.trader_at_fault ? "ok" : "alarm"}`} role="status">
          {dispute.trader_at_fault ? <span className="stamp">Bad delivery</span> : null}
          <b>{dispute.trader_at_fault ? "The trader is slashed." : dispute.refused ? "Not disputed." : "Dismissed."}</b> {dispute.detail}.{" "}
          {dispute.trader_at_fault ? <>Your escrow and deposit are back, with {lnear(dispute.slashed_to_prover)} Ⓝ of the bond: {pct}% of the {lnear(String(dispute.bondBefore))} Ⓝ he had. The rest burned.</> : null}
          {s.credit() > 0n ? <div><button className="primary" onClick={withdraw}>Withdraw {lnear(s.credit())} Ⓝ</button></div> : null}
          {dispute.trader_at_fault && wrapped ? <span className="onchain">The same ruling on NEAR testnet, for real: {wrapped.what}, {wrapped.tgas?.toFixed(2)} Tgas, <Tx tx={wrapped.tx!} /></span> : null}
        </div>
      ) : null}

      <section className="drawn" aria-labelledby="keyhole-h">
        <h2 id="keyhole-h"><Glyph /> Through the keyhole</h2>
        {reader ? <Ruler token={token} nodes={nodeIds} /> : <p className="note">The trader hasn't delivered yet. When he does, the nodes covering your window appear here.</p>}
        {reader ? <p className="legend" aria-hidden="true"><span>sealed</span><b>your window: {token.last_slot - token.first_slot + 1} slots, {nodeIds.length} nodes</b><span>sealed</span></p> : null}
        <p className="caption">
          {nodeIds.length} tree nodes, unwrapped in this tab with your one-time key. Each commits to the root the trader posted before the sale: {verified.filter(Boolean).length} of {verified.length} check out.
          The lacquered slots are the rest of the journal. There's no node for them in your hands, now or later, and nobody needs to be online to keep it that way.
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
                <li key={e.seq}><span className="seq">#{e.seq}</span><span className="when">{timeOf(Number(e.at_ms))}</span><span className="failmsg bad">{r.why}</span></li>
              );
              const rounds = entry ? s.rounds(entry.feed) : null;
              const idx = entry && rounds ? firstRoundAtOrAfter(rounds, Number(e.at_ms)) : -1;
              return (
                <li key={e.seq} className="open">
                  <span className="seq">#{e.seq}</span>
                  <span className="when">{timeOf(Number(e.at_ms))}</span>
                  <span className="body">
                    <span className="trade"><Decrypted text={entry ? line(entry) : "malformed: void by the PnL rule"} ct={e.ct} /></span>
                    {entry && !isDecoy(entry) ? <span className="reason">“{entry.note}”{idx >= 0 ? <em> oracle {(rounds![idx].answer_e8 / 1e8).toFixed(2)}</em> : null}<em title="What a trader wrote, not proof of a trade. A settlement reference is his own claim: the contract never reads it."> {entry.flags & 1 ? "claims a fill (unverified)" : "signal record"}</em></span> : null}
                    {entry && !isDecoy(entry) ? (
                      <span className="copy-row">
                        <button className="link" onClick={() => copyHere(e, entry)}>Copy it here</button>
                        <button className="link" onClick={() => getQuote(e, entry)}>Live 1Click quote</button>
                        {copied[e.seq] ? <span className="copy-fill">{copied[e.seq]}</span> : null}
                        {quote[e.seq] ? <span className="note">{quote[e.seq]}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
            {!showAll && inWindow.length > SHOWN ? <li className="more"><button className="link" onClick={() => setShowAll(true)}>Show the other {inWindow.length - SHOWN} entries in your window</button></li> : null}
            {inWindow.length === 0 ? <li className="more note">No entries in this window: the trader didn't trade.</li> : null}
            {after.map((e, i) => (
              <li key={e.seq} className="past">
                <span className="seq">#{e.seq}</span><span className="when">{timeOf(Number(e.at_ms))}</span>
                <span className="body">
                  <Bar ct={e.ct} label="past your window" />
                  {reader && !tried[e.seq] ? <button className="try" onClick={() => tryOpen(e)} data-step={i === 0 ? "2" : undefined}>Try to open it anyway</button> : null}
                  {tried[e.seq] ? <span className={`failmsg ${tried[e.seq].opened ? "bad" : ""}`} role="status">{tried[e.seq].opened ? null : <b>Still sealed. </b>}{tried[e.seq].text}</span> : null}
                </span>
              </li>
            ))}
            {reader && after.length === 0 ? <li className="more note">Nothing written after your window yet. When there is, it will be sealed to you.</li> : null}
          </ul>
        </div>

        <div className="stack">
          <section className="panel check" aria-labelledby="check-h">
            <h2 id="check-h">Check the figures</h2>
            <p className="note">Your tab replays each epoch from the entries and the oracle: the same integer arithmetic as the contract.</p>
            {reader ? (
              <div className="table-scroll">
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
                          <td className="mark">{r.verdict?.False ? <Pill tone="alarm">proven</Pill> : diff && t.status?.Slashed ? "false" : diff ? <button className="prove" onClick={() => catchLiar(r.epoch)} disabled={proving !== null} data-step={r.epoch === firstFalse ? "3" : undefined}>{proving === r.epoch ? "Proving…" : "Prove it"}</button> : r.posted !== null && r.mine !== null ? <span aria-label="matches">✓</span> : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr><td>Window</td><td className="num">{money(totalPosted, 2)}</td><td className="num">{money(totalMine, 2)}</td><td /></tr></tfoot>
                </table>
              </div>
            ) : <p className="note">Nothing to check until the keys arrive.</p>}
            {falseRows.length && !t.status?.Slashed ? <p className="verdict alarm"><b>{falseRows.length === epochRows.length ? "Every day's figure here is false." : `${falseRows.length} of these daily figures are false.`}</b> His number on the board is the sum of figures like these, and in your window alone it's {money(totalPosted - totalMine, 2).replace("+", "")} of PnL that didn't happen. One false day is enough: prove any one, and the contract recomputes it and slashes his whole bond.</p> : null}
            {reader && !falseRows.length && !t.status?.Slashed && epochRows.length ? <p className="verdict plain"><b>Every figure in your window adds up.</b> This trader posted what his entries say. That's what a bond is for.</p> : null}
            {audit ? (
              <div className="audit-log" aria-live="polite">
                <ol className={`steps ${audit.verdict ? "done" : ""}`}>{audit.lines.map((l, i) => <li key={i}>{l}</li>)}</ol>
                {audit.verdict?.trader_at_fault ? (
                  <div className="verdict ok">
                    <span className="stamp">Proven false</span>
                    <p style={{ margin: 0 }}><b>Slashed.</b> {t.handle} posted {audit.posted !== null ? money(Number(audit.posted) / 1e6, 2) : "a figure"} for {dateOf(s.timing.epochStart(audit.epoch))}. His own entries, priced at the oracle by the contract, make {audit.mine !== null ? money(Number(audit.mine) / 1e6, 2) : "something else"}.</p>
                    <dl className="costs">
                      <dt>His bond, before</dt><dd>{lnear(String(audit.bondBefore))} Ⓝ</dd>
                      <dt>To you, the prover ({pct}%)</dt><dd>{lnear(audit.verdict.slashed_to_prover)} Ⓝ</dd>
                      <dt>Burned</dt><dd>{lnear(String(audit.bondBefore - BigInt(audit.verdict.slashed_to_prover)))} Ⓝ</dd>
                      <dt className="total">Your {lnear(s.config.audit_bond)} Ⓝ deposit</dt><dd className="total">back</dd>
                    </dl>
                    <span className="what-now">The board now shows the corrected figure, for good. {refundable ? "Your escrow for this window comes back too: claim it below." : ""}</span>
                    {lie && concluded ? <span className="onchain">The same proof on NEAR testnet, for real: {lie.what} <Tx tx={lie.tx!} />, then {concluded.what}, {concluded.tgas?.toFixed(2)} Tgas, <Tx tx={concluded.tx!} /></span> : null}
                  </div>
                ) : audit.verdict ? <p className="verdict alarm"><b>The figure was right.</b> Your deposit went to the trader: he posted what his entries say.</p> : null}
              </div>
            ) : null}
            {refundable ? <button className="primary" onClick={claim}>Claim your escrow back</button> : null}
            {s.credit() > 0n ? <button className="primary" onClick={withdraw}>Withdraw {lnear(s.credit())} Ⓝ</button> : null}
            {msg ? <p className={msg.bad ? "verdict alarm" : "note"} role={msg.bad ? "alert" : "status"}>{msg.text}</p> : null}
          </section>

          <section className="panel copy" aria-labelledby="copy-h">
            <h2 id="copy-h">Your copy limits</h2>
            <p className="note">A trade is scaled from his book to yours, and refused before anything is signed if it's over your cap. “Copy it here” signs a real NEP-413 intent in this tab and settles it on the real intents.near wasm running here: a local solver, test tokens, no mainnet. “Live 1Click quote” asks the real API for a dry quote, signing nothing.</p>
            <label>Your book <input type="range" min="1000" max="100000" step="1000" value={myBook} onChange={(e) => setMyBook(Number(e.target.value))} /> <b>${myBook.toLocaleString("en-US")}</b></label>
            <label>Cap per trade <input type="range" min="100" max="30000" step="100" value={cap} onChange={(e) => setCap(Number(e.target.value))} /> <b>${cap.toLocaleString("en-US")}</b></label>
            <p className="copy-limits-note">He trades a {money(Number(t.book_usd_e6) / 1e6).replace("+", "")} book, so you copy at {(scale * 100).toFixed(1)}%. His size can reach 3× his book in one feed: at this scale that's {money(3 * myBook).replace("+", "")}, so your cap refuses his biggest trades. That's the cap working.</p>
            <p className="copy-limits-note">An entry is what he wrote, when he wrote it. Nothing forces him to fill before publishing: a trader could publish first and trade against his followers.</p>
          </section>
        </div>
      </section>
      <p className="caption keys">{shortHex(token.eph ?? "")} is the trader's ephemeral key, {shortHex(token.buyer_pub ?? "")} is yours. Both are on the chain, so that a dispute can prove what was sent. Your secret isn't.</p>
    </>
  );
}
