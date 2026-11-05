//! The kill test (docs/decisions/0002). One question: can a NEAR contract arbitrate a key sale?
//!
//! A dispute over a wrapped GGM node must, inside the contract:
//!   1. check that the revealed one-time secret really belongs to the buyer's registered public key
//!      (one x25519 base-point multiplication; without it a buyer could reveal any scalar and fake a
//!      "garbage" decryption);
//!   2. derive the wrap key (one x25519 multiplication with the trader's ephemeral key, one SHA-256);
//!   3. decrypt the wrapped node;
//!   4. check it against a Merkle commitment made before the sale.
//!
//! Every method here does exactly that with a different cipher and logs `env::used_gas()` after each
//! step. This is measurement code only: it has no state, holds no value, and is not the product.
use near_sdk::{env, near};
use x25519_dalek::{PublicKey, StaticSecret};

fn hex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    hex::decode_to_slice(s, &mut out).expect("32 bytes of hex");
    out
}

fn mark(what: &str, last: &mut u64) {
    let now = env::used_gas().as_gas();
    env::log_str(&format!("{what}: {:.3} Tgas", (now - *last) as f64 / 1e12));
    *last = now;
}

fn sha(data: &[u8]) -> [u8; 32] {
    env::sha256_array(data)
}

fn cat(parts: &[&[u8]]) -> Vec<u8> {
    let mut v = Vec::with_capacity(parts.iter().map(|p| p.len()).sum());
    for p in parts {
        v.extend_from_slice(p);
    }
    v
}

// ChaCha20 per RFC 8439, in 40 lines: no crate, no Poly1305. For measuring what the wasm pays.
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

fn chacha20_xor(key: &[u8; 32], nonce: &[u8; 12], mut counter: u32, data: &mut [u8]) {
    for chunk in data.chunks_mut(64) {
        let mut init = [0u32; 16];
        init[..4].copy_from_slice(&[0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]);
        for i in 0..8 {
            init[4 + i] = u32::from_le_bytes(key[i * 4..i * 4 + 4].try_into().unwrap());
        }
        init[12] = counter;
        for i in 0..3 {
            init[13 + i] = u32::from_le_bytes(nonce[i * 4..i * 4 + 4].try_into().unwrap());
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
            let w = s[i / 4].wrapping_add(init[i / 4]);
            *b ^= w.to_le_bytes()[i % 4];
        }
        counter = counter.wrapping_add(1);
    }
}

/// SHA-256 in counter mode through the host function: no cipher in the wasm at all.
fn sha_ctr_xor(key: &[u8; 32], label: &[u8], data: &mut [u8]) {
    for (i, chunk) in data.chunks_mut(32).enumerate() {
        let block = sha(&cat(&[b"keyhole/ctr/v1", key, label, &(i as u32).to_le_bytes()]));
        for (b, k) in chunk.iter_mut().zip(block.iter()) {
            *b ^= k;
        }
    }
}

#[derive(Default)]
#[near(contract_state)]
pub struct KillTest {}

#[near]
impl KillTest {
    /// Baseline: the cost of the call itself with nothing done.
    pub fn nothing(&self, _pad: Option<String>) -> u64 {
        env::used_gas().as_gas()
    }

    /// One x25519 multiplication, alone.
    pub fn x25519_once(&self, secret: String, point: String) -> String {
        let mut last = env::used_gas().as_gas();
        let s = StaticSecret::from(hex32(&secret));
        let shared = s.diffie_hellman(&PublicKey::from(hex32(&point)));
        mark("x25519", &mut last);
        hex::encode(shared.as_bytes())
    }

    /// A SHA-256 Merkle path of `path.len()` levels (each level hashes `left || right`).
    pub fn merkle_only(&self, leaf: String, index: u64, path: Vec<String>, root: String) -> bool {
        let mut last = env::used_gas().as_gas();
        let ok = merkle(hex32(&leaf), index, &path) == hex32(&root);
        mark("merkle", &mut last);
        ok
    }

    /// The full dispute with SHA-256-CTR: the cheapest cipher a NEAR contract can run.
    #[allow(clippy::too_many_arguments)]
    pub fn dispute_sha_ctr(&self, one_time_secret: String, buyer_pub: String, trader_eph: String, wrapped: String, node_index: u64, merkle_index: u64, path: Vec<String>, root: String) -> bool {
        let wrap_key = self.steps_key(&one_time_secret, &buyer_pub, &trader_eph);
        let mut last = env::used_gas().as_gas();
        let mut node = hex32(&wrapped);
        sha_ctr_xor(&wrap_key, &node_index.to_le_bytes(), &mut node);
        mark("decrypt (sha-256 ctr)", &mut last);
        self.finish(node, merkle_index, &path, &root, &mut last)
    }

    /// The full dispute with ChaCha20 in wasm.
    #[allow(clippy::too_many_arguments)]
    pub fn dispute_chacha(&self, one_time_secret: String, buyer_pub: String, trader_eph: String, wrapped: String, node_index: u64, merkle_index: u64, path: Vec<String>, root: String) -> bool {
        let wrap_key = self.steps_key(&one_time_secret, &buyer_pub, &trader_eph);
        let mut last = env::used_gas().as_gas();
        let mut node = hex32(&wrapped);
        let mut nonce = [0u8; 12];
        nonce[..8].copy_from_slice(&node_index.to_le_bytes());
        chacha20_xor(&wrap_key, &nonce, 1, &mut node);
        mark("decrypt (chacha20, wasm)", &mut last);
        self.finish(node, merkle_index, &path, &root, &mut last)
    }

    /// The full dispute with the ChaCha20-Poly1305 crate, a standard AEAD. `wrapped` is node + tag.
    #[cfg(feature = "aead")]
    #[allow(clippy::too_many_arguments)]
    pub fn dispute_aead(&self, one_time_secret: String, buyer_pub: String, trader_eph: String, wrapped: String, node_index: u64, merkle_index: u64, path: Vec<String>, root: String) -> bool {
        use chacha20poly1305::aead::AeadInPlace;
        use chacha20poly1305::{ChaCha20Poly1305, KeyInit, Nonce, Tag};
        let wrap_key = self.steps_key(&one_time_secret, &buyer_pub, &trader_eph);
        let mut last = env::used_gas().as_gas();
        let bytes = hex::decode(&wrapped).expect("hex");
        let (ct, tag) = bytes.split_at(32);
        let mut node: [u8; 32] = ct.try_into().unwrap();
        let mut nonce = [0u8; 12];
        nonce[..8].copy_from_slice(&node_index.to_le_bytes());
        let opened = ChaCha20Poly1305::new((&wrap_key).into()).decrypt_in_place_detached(Nonce::from_slice(&nonce), b"", &mut node, Tag::from_slice(tag));
        mark("decrypt (chacha20-poly1305, crate)", &mut last);
        if opened.is_err() {
            return true;
        }
        self.finish(node, merkle_index, &path, &root, &mut last)
    }

    /// How many ChaCha20 blocks and how many SHA-256 CTR blocks a journal-entry decryption costs.
    pub fn entry_cipher(&self, key: String, bytes: u32) -> u64 {
        let k = hex32(&key);
        let mut last = env::used_gas().as_gas();
        let mut a = vec![0u8; bytes as usize];
        chacha20_xor(&k, &[0u8; 12], 1, &mut a);
        mark("chacha20", &mut last);
        let mut b = vec![0u8; bytes as usize];
        sha_ctr_xor(&k, b"x", &mut b);
        mark("sha-256 ctr", &mut last);
        a[0] as u64 + b[0] as u64
    }
}

impl KillTest {
    fn steps_key(&self, one_time_secret: &str, buyer_pub: &str, trader_eph: &str) -> [u8; 32] {
        let mut last = env::used_gas().as_gas();
        env::log_str(&format!("args and setup: {:.3} Tgas", last as f64 / 1e12));
        let secret = StaticSecret::from(hex32(one_time_secret));
        let bp = hex32(buyer_pub);
        let derived = PublicKey::from(&secret);
        mark("x25519 base-point (secret matches key)", &mut last);
        assert_eq!(derived.as_bytes(), &bp, "secret does not match the buyer's key");
        let te = hex32(trader_eph);
        let shared = secret.diffie_hellman(&PublicKey::from(te));
        mark("x25519 dh", &mut last);
        let key = sha(&cat(&[b"keyhole/wrap/v1", shared.as_bytes(), &te, &bp]));
        mark("kdf (sha-256)", &mut last);
        key
    }

    fn finish(&self, node: [u8; 32], merkle_index: u64, path: &[String], root: &str, last: &mut u64) -> bool {
        let leaf = sha(&cat(&[b"keyhole/c/v1", &node]));
        let ok = merkle(leaf, merkle_index, path) == hex32(root);
        mark("node commitment + merkle path", last);
        env::log_str(&format!("total: {:.3} Tgas (matches commitment: {ok})", env::used_gas().as_gas() as f64 / 1e12));
        ok
    }
}

fn merkle(leaf: [u8; 32], mut index: u64, path: &[String]) -> [u8; 32] {
    let mut h = leaf;
    for sib in path {
        let s = hex32(sib);
        h = if index & 1 == 0 { sha(&cat(&[&h, &s])) } else { sha(&cat(&[&s, &h])) };
        index >>= 1;
    }
    h
}
