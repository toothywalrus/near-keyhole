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
