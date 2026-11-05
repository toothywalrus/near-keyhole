// The PnL rule in exact integers: the TypeScript twin of contracts/core/src/pnl.rs. See that file for the rule.
export const MAX_FEEDS = 4;
export const DIV_E10 = 10_000_000_000n;
export const MAX_LEVERAGE = 3n;

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const I128_MIN = -(2n ** 127n);
const I128_MAX = 2n ** 127n - 1n;
const fits128 = (v: bigint) => v >= I128_MIN && v <= I128_MAX;

export class Book {
  positions: bigint[] = new Array(MAX_FEEDS).fill(0n);
  cash_e16 = 0n;
  applied = 0;
  void = 0;

  /** Apply a trade at `price_e8`. Returns false, changing nothing, if the entry is void. */
  apply(feed: number, qty_e8: bigint, price_e8: bigint, feeds: number, book_usd_e6: bigint): boolean {
    const r = this.tryApply(feed, qty_e8, price_e8, feeds, book_usd_e6);
    if (!r) {
      this.void++;
      return false;
    }
    this.positions[feed] = r[0];
    this.cash_e16 = r[1];
    this.applied++;
    return true;
  }

  private tryApply(feed: number, qty: bigint, price: bigint, feeds: number, book: bigint): [bigint, bigint] | null {
    if (feed >= feeds || feed >= MAX_FEEDS || qty === 0n || price <= 0n) return null;
    const pos = this.positions[feed] + qty;
    if (pos < I64_MIN || pos > I64_MAX) return null;
    const limit = book * MAX_LEVERAGE * DIV_E10;
    if (!fits128(limit)) return null;
    const abs = pos < 0n ? -pos : pos;
    if (abs * price > limit) return null;
    const cash = this.cash_e16 - qty * price;
    if (!fits128(cash)) return null;
    return [pos, cash];
  }

  markedE16(marks: (bigint | null)[]): bigint | null {
    let total = this.cash_e16;
    for (let i = 0; i < MAX_FEEDS; i++) {
      if (this.positions[i] !== 0n) {
        const m = marks[i];
        if (m === null || m === undefined) return null;
        total += this.positions[i] * m;
      }
    }
    return total;
  }
}

/** e16 rounded down (toward minus infinity) to e6. */
export function pnlE6(total_e16: bigint): bigint {
  const q = total_e16 / DIV_E10;
  return total_e16 < 0n && q * DIV_E10 !== total_e16 ? q - 1n : q;
}
