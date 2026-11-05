//! Keyhole's pure logic. No near-sdk here: the contract, the attested job and the tests all use this one
//! implementation, and `lib/src/` is its TypeScript twin, held to it by `fixtures/vectors.json`.
//!
//! The hash is a type parameter because the contract must use NEAR's `sha256` host function (cheap) and everything
//! else uses the `sha2` crate. See `docs/decisions/0002` and `0003`.
pub mod entry;
pub mod ggm;
pub mod pnl;

/// `a * b / d`, rounded down, through a 256-bit intermediate: amounts in yoctoNEAR overflow u128 when multiplied. `None` if `d` is 0 or
/// the result doesn't fit.
pub fn mul_div(a: u128, b: u128, d: u128) -> Option<u128> {
    if d == 0 {
        return None;
    }
    const MASK: u128 = u64::MAX as u128;
    let (a1, a0) = (a >> 64, a & MASK);
    let (b1, b0) = (b >> 64, b & MASK);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & MASK) + (p10 & MASK);
    let lo = (p00 & MASK) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    if hi >= d {
        return None;
    }
    // Long division, one bit at a time: 128 rounds, and only when it's really a big product.
    if hi == 0 {
        return Some(lo / d);
    }
    let (mut rem, mut quot) = (hi, 0u128);
    for i in (0..128).rev() {
        let top = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        quot <<= 1;
        if top == 1 || rem >= d {
            rem = rem.wrapping_sub(d);
            quot |= 1;
        }
    }
    Some(quot)
}

/// SHA-256, supplied by whoever runs this code.
pub trait Hash {
    fn hash(data: &[u8]) -> [u8; 32];

    /// SHA-256 over the concatenation of `parts`.
    fn hash_parts(parts: &[&[u8]]) -> [u8; 32] {
        let mut v = Vec::with_capacity(parts.iter().map(|p| p.len()).sum());
        for p in parts {
            v.extend_from_slice(p);
        }
        Self::hash(&v)
    }
}

#[cfg(any(feature = "sha2", test))]
pub struct Sha2;

#[cfg(any(feature = "sha2", test))]
impl Hash for Sha2 {
    fn hash(data: &[u8]) -> [u8; 32] {
        use sha2::Digest;
        sha2::Sha256::digest(data).into()
    }
}

/// Proofs for the Kani model checker: `npm run kani`. They hold for every input, not a sample: see `docs/research/kani-2026-11-05.txt`.
#[cfg(kani)]
mod proofs {
    use crate::ggm;
    use crate::pnl::{pnl_e6, Book, DIV_E10, MAX_FEEDS};

    /// Whatever a trader wrote, `apply` doesn't panic, and a void entry changes nothing but the void count.
    #[kani::proof]
    fn apply_is_total_and_void_changes_nothing() {
        let mut b = Book::default();
        b.positions[0] = kani::any();
        b.cash_e16 = kani::any();
        let before = b.clone();
        let feed: usize = kani::any();
        let qty: i64 = kani::any();
        let price: i64 = kani::any();
        let book: i128 = kani::any();
        kani::assume(book >= 0 && book <= 1_000_000_000_000_000);
        kani::assume(feed < MAX_FEEDS + 2);
        if !b.apply(feed, qty, price, MAX_FEEDS, book) {
            assert!(b.positions == before.positions && b.cash_e16 == before.cash_e16);
        } else {
            assert!(qty != 0 && price > 0 && feed < MAX_FEEDS);
        }
    }

    /// The published figure is the floor of the exact total, over the range a book can reach.
    #[kani::proof]
    fn the_figure_is_the_floor() {
        let total: i64 = kani::any();
        let q = pnl_e6(total as i128);
        assert!(q * DIV_E10 <= total as i128);
        assert!(total as i128 - q * DIV_E10 < DIV_E10);
    }

    /// The cover of any window in a small tree is exact: its nodes' subtrees are disjoint, in order, and add up to exactly the window.
    #[kani::proof]
    #[kani::unwind(20)]
    fn the_cover_is_exactly_the_window() {
        const DEPTH: u8 = 3;
        let first: u32 = kani::any();
        let last: u32 = kani::any();
        kani::assume(first <= last && last < 8);
        let nodes = ggm::cover(first, last, DEPTH);
        assert!(!nodes.is_empty() && nodes.len() <= 2 * DEPTH as usize);
        let mut next = first;
        for n in &nodes {
            let (a, b) = n.slots(DEPTH);
            assert!(a == next);
            assert!(b <= last);
            next = b + 1;
        }
        assert!(next == last + 1);
    }
}
