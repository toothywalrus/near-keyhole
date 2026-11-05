//! A journal entry: a fixed 128-byte plaintext (so its size says nothing), encrypted with ChaCha20 under a key of its own, with a
//! committing tag on the chain (`docs/decisions/0003`).
use crate::Hash;

pub const PLAINTEXT_LEN: usize = 128;
pub const NOTE_MAX: usize = 75;
pub const VERSION: u8 = 1;
/// The entry carries a settlement reference (a hash of the signed intent that filled it).
pub const FLAG_SETTLED: u8 = 1;

/// One trade in a journal. Prices are never trusted from here: PnL uses the oracle (`pnl.rs`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub feed: u8,
    pub flags: u8,
    /// Signed, 8 decimals: positive buys, negative sells.
    pub qty_e8: i64,
    /// The trader's own fill, 8 decimals: shown to followers and used for copy slippage, never for PnL.
    pub fill_e8: u64,
    /// SHA-256 of the signed intent, when there is one.
    pub settlement: [u8; 32],
    /// A line of reasoning, at most `NOTE_MAX` bytes of UTF-8.
    pub note: Vec<u8>,
}

impl Entry {
    pub fn encode(&self) -> [u8; PLAINTEXT_LEN] {
        let mut p = [0u8; PLAINTEXT_LEN];
        p[0] = VERSION;
        p[1] = self.feed;
        p[2] = self.flags;
        p[4..12].copy_from_slice(&self.qty_e8.to_le_bytes());
        p[12..20].copy_from_slice(&self.fill_e8.to_le_bytes());
        p[20..52].copy_from_slice(&self.settlement);
        let n = self.note.len().min(NOTE_MAX);
        p[52] = n as u8;
        p[53..53 + n].copy_from_slice(&self.note[..n]);
        p
    }

    /// `None` when the plaintext isn't a well-formed entry. The rule for the PnL replay: such an entry is void.
    pub fn parse(p: &[u8]) -> Option<Entry> {
        if p.len() != PLAINTEXT_LEN || p[0] != VERSION || p[3] != 0 {
            return None;
        }
        let n = p[52] as usize;
        if n > NOTE_MAX || p[53 + n..].iter().any(|b| *b != 0) {
            return None;
        }
        Some(Entry {
            feed: p[1],
            flags: p[2],
            qty_e8: i64::from_le_bytes(p[4..12].try_into().ok()?),
            fill_e8: u64::from_le_bytes(p[12..20].try_into().ok()?),
            settlement: p[20..52].try_into().ok()?,
            note: p[53..53 + n].to_vec(),
        })
    }
}

pub fn entry_key<H: Hash>(leaf: &[u8; 32], seq: u64) -> [u8; 32] {
    H::hash_parts(&[b"keyhole/entry/v1", leaf, &seq.to_le_bytes()])
}

pub fn tag<H: Hash>(key: &[u8; 32], seq: u64, slot: u32, ct: &[u8]) -> [u8; 32] {
    H::hash_parts(&[b"keyhole/tag/v1", key, &seq.to_le_bytes(), &slot.to_le_bytes(), ct])
}

fn qr(s: &mut [u32; 16], a: usize, b: usize, c: usize, d: usize) {
    s[a] = s[a].wrapping_add(s[b]);
    s[d] = (s[d] ^ s[a]).rotate_left(16);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] = (s[b] ^ s[c]).rotate_left(12);
    s[a] = s[a].wrapping_add(s[b]);
    s[d] = (s[d] ^ s[a]).rotate_left(8);
    s[c] = s[c].wrapping_add(s[d]);
    s[b] = (s[b] ^ s[c]).rotate_left(7);
}

/// ChaCha20 per RFC 8439. Encrypting and decrypting are the same operation.
pub fn chacha20_xor(key: &[u8; 32], nonce: &[u8; 12], mut counter: u32, data: &mut [u8]) {
    for chunk in data.chunks_mut(64) {
        let mut init = [0u32; 16];
        init[..4].copy_from_slice(&[0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
        for i in 0..8 {
            init[4 + i] = u32::from_le_bytes([key[i * 4], key[i * 4 + 1], key[i * 4 + 2], key[i * 4 + 3]]);
        }
        init[12] = counter;
        for i in 0..3 {
            init[13 + i] = u32::from_le_bytes([nonce[i * 4], nonce[i * 4 + 1], nonce[i * 4 + 2], nonce[i * 4 + 3]]);
        }
        let mut s = init;
        for _ in 0..10 {
            qr(&mut s, 0, 4, 8, 12);
            qr(&mut s, 1, 5, 9, 13);
            qr(&mut s, 2, 6, 10, 14);
            qr(&mut s, 3, 7, 11, 15);
            qr(&mut s, 0, 5, 10, 15);
            qr(&mut s, 1, 6, 11, 12);
            qr(&mut s, 2, 7, 8, 13);
            qr(&mut s, 3, 4, 9, 14);
        }
        for (i, b) in chunk.iter_mut().enumerate() {
            *b ^= s[i / 4].wrapping_add(init[i / 4]).to_le_bytes()[i % 4];
        }
        counter = counter.wrapping_add(1);
    }
}

/// Encrypt or decrypt an entry under its own key. The fixed nonce is safe because no key is used twice.
pub fn entry_xor(key: &[u8; 32], data: &mut [u8]) {
    chacha20_xor(key, &[0u8; 12], 1, data);
}

pub fn encrypt<H: Hash>(leaf: &[u8; 32], seq: u64, slot: u32, e: &Entry) -> (Vec<u8>, [u8; 32]) {
    let key = entry_key::<H>(leaf, seq);
    let mut ct = e.encode().to_vec();
    entry_xor(&key, &mut ct);
    let t = tag::<H>(&key, seq, slot, &ct);
    (ct, t)
}

/// Decrypt with an entry's key. `None` if the tag doesn't match this key; `Some(None)` if it matches but the plaintext isn't well-formed.
pub fn open<H: Hash>(key: &[u8; 32], seq: u64, slot: u32, ct: &[u8], expected_tag: &[u8; 32]) -> Option<Option<Entry>> {
    if &tag::<H>(key, seq, slot, ct) != expected_tag {
        return None;
    }
    let mut p = ct.to_vec();
    entry_xor(key, &mut p);
    Some(Entry::parse(&p))
}

/// The wrap of a sold node to a buyer's one-time key. One key per sale and the node's position in the nonce, so no stream repeats.
pub fn wrap_key<H: Hash>(shared: &[u8; 32], trader_eph: &[u8; 32], buyer_pub: &[u8; 32], token_id: u64) -> [u8; 32] {
    H::hash_parts(&[b"keyhole/wrap/v1", shared, trader_eph, buyer_pub, &token_id.to_le_bytes()])
}

pub fn wrap_xor(key: &[u8; 32], position: u32, node: &mut [u8; 32]) {
    let mut nonce = [0u8; 12];
    nonce[..4].copy_from_slice(&position.to_le_bytes());
    chacha20_xor(key, &nonce, 1, node);
}
