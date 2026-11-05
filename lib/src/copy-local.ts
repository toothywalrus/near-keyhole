// A copy trade that settles in this tab: a real NEP-413 token_diff, signed here, on the real mainnet intents.near wasm running on the local host. The tokens, the solver and the balances
// are local stand-ins, and no mainnet account or money is involved. It's what's cheap to show of copying: a page can decrypt an entry, apply limits, sign, and watch it settle.
import { ed25519 } from "@noble/curves/ed25519.js";
import { near } from "./client.ts";
import { feeOf, nep141, signerFrom, signTokenDiff, type Signer } from "./intents.ts";
import { MiniNear } from "./vm.ts";

const INTENTS = "intents.local";
export const USDC = "usdc.local";
const ASSET_ACCOUNT = ["teth.local", "tbtc.local", "tsol.local"];
const UNIT = 1_000_000n; // the stand-in tokens have 6 decimals

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export type CopyFill = { tx?: string; paid: bigint; received: bigint; assetUnits: bigint; usdcUnits: bigint; side: 1 | -1; price: number; balances: { usdc: number; asset: number } };

export class LocalIntents {
  private vm: MiniNear;
  private you: Signer;
  private solver: Signer;
  private pips = 1n;
  constructor(wasm: BufferSource, sha256: (d: Uint8Array) => Uint8Array, readonly nowMs: number, readonly accountId = "you.local") {
    this.vm = new MiniNear(wasm, INTENTS, nowMs, sha256);
    this.vm.fund(INTENTS, near(100));
    this.vm.ed25519Verify = (sig, msg, pub) => { try { return ed25519.verify(sig, msg, pub); } catch { return false; } };
    this.you = signerFrom(accountId, randomBytes(32));
    this.solver = signerFrom("solver.local", randomBytes(32));
    const ok = (r: { ok: boolean; reason?: string }, what: string) => { if (!r.ok) throw new Error(`${what}: ${r.reason}`); };
    ok(this.vm.call("intents.local", "new", { config: { wnear_id: "wnear.local", fees: { fee: 1, fee_collector: "fees.local" }, roles: {} } }), "new");
    for (const s of [this.you, this.solver]) {
      this.vm.fund(s.accountId, near(10));
      ok(this.vm.call(s.accountId, "add_public_key", { public_key: s.publicKey }, 1n), "add_public_key");
    }
    // A deposit is a token contract calling ft_on_transfer; the stand-in tokens just call it directly.
    const deposit = (token: string, who: string, units: bigint) => ok(this.vm.call(token, "ft_on_transfer", { sender_id: who, amount: (units * UNIT).toString(), msg: "" }), "deposit");
    deposit(USDC, accountId, 1_000_000n);
    deposit(USDC, "solver.local", 10_000_000n);
    for (const a of ASSET_ACCOUNT) {
      deposit(a, accountId, 100_000n);
      deposit(a, "solver.local", 10_000_000n);
    }
  }
  balances(feed: number): { usdc: number; asset: number } {
    const [u, a] = this.vm.view<string[]>("mt_batch_balance_of", { account_id: this.accountId, token_ids: [nep141(USDC), nep141(ASSET_ACCOUNT[feed])] });
    return { usdc: Number(u) / 1e6, asset: Number(a) / 1e6 };
  }
  /** Buy or sell `qty_e8` of a feed's stand-in token at `price`: the follower and the local solver each sign a token_diff, and a relayer executes both. */
  fill(feed: number, qty_e8: bigint, price: number): CopyFill {
    const side: 1 | -1 = qty_e8 > 0n ? 1 : -1;
    const assetUnits = ((qty_e8 < 0n ? -qty_e8 : qty_e8) * UNIT) / 100_000_000n;
    const usdcUnits = BigInt(Math.round((Number(assetUnits) / 1e6) * price * 1e6));
    if (assetUnits === 0n || usdcUnits === 0n) throw new Error("that trade rounds to nothing");
    const tA = nep141(ASSET_ACCOUNT[feed]);
    const tU = nep141(USDC);
    const salt = this.vm.view<string>("current_salt");
    const deadline = this.vm.clockMs + 300_000;
    const yours = side > 0 ? { [tU]: `-${usdcUnits}`, [tA]: `${assetUnits - feeOf(assetUnits, this.pips)}` } : { [tA]: `-${assetUnits}`, [tU]: `${usdcUnits - feeOf(usdcUnits, this.pips)}` };
    const theirs = side > 0 ? { [tU]: `${usdcUnits - feeOf(usdcUnits, this.pips)}`, [tA]: `-${assetUnits}` } : { [tA]: `${assetUnits - feeOf(assetUnits, this.pips)}`, [tU]: `-${usdcUnits}` };
    const a = signTokenDiff(this.you, INTENTS, yours, deadline, salt, randomBytes(15));
    const b = signTokenDiff(this.solver, INTENTS, theirs, deadline, salt, randomBytes(15));
    const before = this.balances(feed);
    const r = this.vm.call("relayer.local", "execute_intents", { signed: [a, b] });
    if (!r.ok) throw new Error(r.reason ?? "execute_intents refused");
    const after = this.balances(feed);
    return { tx: r.tx, assetUnits, usdcUnits, side, price, balances: after, paid: BigInt(Math.round(Math.abs(side > 0 ? before.usdc - after.usdc : before.asset - after.asset) * 1e6)), received: BigInt(Math.round(Math.abs(side > 0 ? after.asset - before.asset : after.usdc - before.usdc) * 1e6)) };
  }
  /** Try to run a signed intent twice: the contract's own refusal. */
  replayRefused(feed: number, qty_e8: bigint, price: number): string {
    const salt = this.vm.view<string>("current_salt");
    const tA = nep141(ASSET_ACCOUNT[feed]);
    const tU = nep141(USDC);
    const a = signTokenDiff(this.you, INTENTS, { [tU]: `-${qty_e8}`, [tA]: `${BigInt(Math.round(price))}` }, this.vm.clockMs + 300_000, salt, randomBytes(15));
    const r = this.vm.call("relayer.local", "execute_intents", { signed: [a] });
    return r.ok ? "accepted" : r.reason ?? "refused";
  }
}
