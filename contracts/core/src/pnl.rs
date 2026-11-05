//! The PnL rule, in exact integers. The trader's tool, every buyer's check, the contract's fraud proof and the attested job
//! must get the same number to the unit, or honest traders get slashed. So there is one rule:
//!
//! - quantities and prices have 8 decimals, so a notional has 16; cash and marks stay in those exact units with no rounding;
//! - a trade is priced at the first oracle round at or after the moment it was committed (never the trader's claimed fill);
//! - an epoch stands alone: no position carries over. At the epoch's end everything is marked at the first round at
//!   or after the end. A position held longer is re-opened by an entry in the next epoch;
//! - an entry that is malformed, names an unknown feed, has zero size, or would take the position past the book's exposure limit is
//!   void: it changes nothing. Posting a figure that counted it is a false figure;
//! - the posted number is the total divided by 10^10, rounded down, giving USD with 6 decimals.
//!
//! Every function is total: nothing here can panic on anything a trader wrote.

pub const MAX_FEEDS: usize = 4;
/// e16 -> e6.
pub const DIV_E10: i128 = 10_000_000_000;
/// A book may hold at most this multiple of its size in any one feed.
pub const MAX_LEVERAGE: i128 = 3;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Book {
    pub positions: [i64; MAX_FEEDS],
    pub cash_e16: i128,
    /// Entries that counted, and entries that were void.
    pub applied: u32,
    pub void: u32,
}

impl Book {
    /// Apply a trade at `price_e8`. Returns false, changing nothing, if the entry is void.
    pub fn apply(&mut self, feed: usize, qty_e8: i64, price_e8: i64, feeds: usize, book_usd_e6: i128) -> bool {
        match self.try_apply(feed, qty_e8, price_e8, feeds, book_usd_e6) {
            Some((pos, cash)) => {
                self.positions[feed] = pos;
                self.cash_e16 = cash;
                self.applied = self.applied.saturating_add(1);
                true
            }
            None => {
                self.void = self.void.saturating_add(1);
                false
            }
        }
    }

    fn try_apply(&self, feed: usize, qty_e8: i64, price_e8: i64, feeds: usize, book_usd_e6: i128) -> Option<(i64, i128)> {
        if feed >= feeds || feed >= MAX_FEEDS || qty_e8 == 0 || price_e8 <= 0 {
            return None;
        }
        let pos = self.positions[feed].checked_add(qty_e8)?;
        let limit_e16 = book_usd_e6.checked_mul(MAX_LEVERAGE)?.checked_mul(DIV_E10)?;
        let exposure = (pos as i128).checked_abs()?.checked_mul(price_e8 as i128)?;
        if exposure > limit_e16 {
            return None;
        }
        let notional = (qty_e8 as i128).checked_mul(price_e8 as i128)?;
        let cash = self.cash_e16.checked_sub(notional)?;
        Some((pos, cash))
    }

    /// Cash plus every open position marked at `marks_e8`, in e16. `None` only if a held position has no mark, or on overflow.
    pub fn marked_e16(&self, marks_e8: &[Option<i64>; MAX_FEEDS]) -> Option<i128> {
        let mut total = self.cash_e16;
        for (pos, mark) in self.positions.iter().zip(marks_e8.iter()) {
            if *pos != 0 {
                let m = (*mark)?;
                total = total.checked_add((*pos as i128).checked_mul(m as i128)?)?;
            }
        }
        Some(total)
    }
}

/// The published figure: e16 rounded down (toward minus infinity) to e6.
pub fn pnl_e6(total_e16: i128) -> i128 {
    total_e16.div_euclid(DIV_E10)
}
