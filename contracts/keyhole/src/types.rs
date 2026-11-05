//! Value types for state and JSON: bytes travel as hex, amounts and big numbers as strings.
use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::env;
use near_sdk::serde::{de, Deserialize, Deserializer, Serialize, Serializer};

const HEXDIGITS: &[u8; 16] = b"0123456789abcdef";

pub fn to_hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(HEXDIGITS[(x >> 4) as usize] as char);
        s.push(HEXDIGITS[(x & 15) as usize] as char);
    }
    s
}

pub fn from_hex(s: &str) -> Option<Vec<u8>> {
    let b = s.as_bytes();
    if b.len() % 2 != 0 {
        return None;
    }
    let d = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        _ => None,
    };
    b.chunks(2).map(|p| Some(d(p[0])? << 4 | d(p[1])?)).collect()
}

/// 32 bytes, hex in JSON.
#[derive(Clone, Copy, PartialEq, Eq, Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct H32(pub [u8; 32]);

impl Serialize for H32 {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&to_hex(&self.0))
    }
}

impl<'de> Deserialize<'de> for H32 {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = <String as Deserialize>::deserialize(d)?;
        let v = from_hex(&s).filter(|v| v.len() == 32).ok_or_else(|| de::Error::custom("want 32 bytes of lowercase hex"))?;
        let mut a = [0u8; 32];
        a.copy_from_slice(&v);
        Ok(H32(a))
    }
}

/// Bytes of any length, hex in JSON.
#[derive(Clone, PartialEq, Eq, Debug, BorshSerialize, BorshDeserialize)]
#[borsh(crate = "near_sdk::borsh")]
pub struct HexBytes(pub Vec<u8>);

impl Serialize for HexBytes {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&to_hex(&self.0))
    }
}

impl<'de> Deserialize<'de> for HexBytes {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = <String as Deserialize>::deserialize(d)?;
        Ok(HexBytes(from_hex(&s).ok_or_else(|| de::Error::custom("want lowercase hex"))?))
    }
}

/// NEAR's SHA-256 host function: about what hashing in wasm costs, with no hash code in the wasm.
pub struct NearHash;

impl keyhole_core::Hash for NearHash {
    fn hash(data: &[u8]) -> [u8; 32] {
        env::sha256_array(data)
    }
}

pub fn checked_add(a: u128, b: u128) -> u128 {
    a.checked_add(b).unwrap_or_else(|| env::panic_str("amount overflow"))
}

pub fn checked_sub(a: u128, b: u128) -> u128 {
    a.checked_sub(b).unwrap_or_else(|| env::panic_str("amount underflow"))
}

pub fn checked_mul(a: u128, b: u128) -> u128 {
    a.checked_mul(b).unwrap_or_else(|| env::panic_str("amount overflow"))
}
