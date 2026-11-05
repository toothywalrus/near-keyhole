//! Keyhole's pure logic. No near-sdk here: the contract, the attested job and the tests all use this one
//! implementation, and `lib/src/` is its TypeScript twin, held to it by `fixtures/vectors.json`.
//!
//! The hash is a type parameter because the contract must use NEAR's `sha256` host function (cheap) and everything
//! else uses the `sha2` crate. See `docs/decisions/0002` and `0003`.
pub mod entry;
pub mod ggm;
pub mod pnl;

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
