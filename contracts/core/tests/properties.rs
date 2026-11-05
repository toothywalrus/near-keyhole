//! Property tests: a window's nodes read exactly that window and nothing outside it.
use keyhole_core::entry::{self, Entry};
use keyhole_core::ggm::{self, NodeId, Tree};
use keyhole_core::pnl::{pnl_e6, Book, MAX_FEEDS};
use keyhole_core::Hash;
use proptest::prelude::*;
use sha2::Digest;

struct S;
impl Hash for S {
    fn hash(data: &[u8]) -> [u8; 32] {
        sha2::Sha256::digest(data).into()
    }
}

const DEPTH: u8 = 10;

fn tree(seed: u8) -> Tree {
    Tree::build::<S>(&[seed; 32], DEPTH)
}

/// All of the slots a set of nodes can reach by honest descent.
fn reachable(nodes: &[NodeId]) -> Vec<u32> {
    let mut slots: Vec<u32> = Vec::new();
    for n in nodes {
        let (a, b) = n.slots(DEPTH);
        slots.extend(a..=b);
    }
    slots.sort();
    slots
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// The cover's subtrees are exactly `[a, b]`, each slot once, in at most 2·depth nodes.
    #[test]
    fn cover_is_exactly_the_window(x in 0u32..1024, y in 0u32..1024) {
        let (a, b) = (x.min(y), x.max(y));
        let c = ggm::cover(a, b, DEPTH);
        prop_assert!(!c.is_empty());
        prop_assert!(c.len() <= 2 * DEPTH as usize);
        prop_assert_eq!(reachable(&c), (a..=b).collect::<Vec<_>>());
    }

    /// Every leaf inside the window is derivable from the cover and equals the real leaf; no leaf outside is.
    #[test]
    fn nodes_read_the_window_and_nothing_else(x in 0u32..1024, y in 0u32..1024, seed in any::<u8>()) {
        let (a, b) = (x.min(y), x.max(y));
        let t = tree(seed);
        let c = ggm::cover(a, b, DEPTH);
        for slot in 0..1024u32 {
            let got: Vec<_> = c.iter().filter_map(|n| ggm::leaf_from::<S>(&t.nodes[n.level as usize][n.index as usize], *n, DEPTH, slot)).collect();
            if a <= slot && slot <= b {
                prop_assert_eq!(got.len(), 1);
                prop_assert_eq!(got[0], t.nodes[DEPTH as usize][slot as usize]);
            } else {
                prop_assert!(got.is_empty(), "slot {} is outside [{}, {}] but was reached", slot, a, b);
            }
        }
    }

    /// An entry written in a slot outside the window doesn't open with anything the window's nodes can derive,
    /// even by someone ignoring the position rules and hashing downward along every path.
    #[test]
    fn an_entry_past_the_window_does_not_open(x in 0u32..1022, len in 0u32..64, out in 1u32..64, seed in any::<u8>()) {
        let a = x;
        let b = (a + len).min(1022);
        let outside = (b + out).min(1023);
        prop_assume!(outside > b);
        let t = tree(seed);
        let e = Entry { feed: 0, flags: 0, qty_e8: 1, fill_e8: 2, settlement: [0; 32], note: b"x".to_vec() };
        let (ct, tag) = entry::encrypt::<S>(&t.nodes[DEPTH as usize][outside as usize], 7, outside, &e);
        for n in ggm::cover(a, b, DEPTH) {
            let v = t.nodes[n.level as usize][n.index as usize];
            let shift = DEPTH - n.level;
            for path in 0..(1u32 << shift) {
                let leaf = ggm::descend::<S>(&v, n, NodeId { level: DEPTH, index: (n.index << shift) | path }).unwrap();
                prop_assert!(entry::open::<S>(&entry::entry_key::<S>(&leaf, 7), 7, outside, &ct, &tag).is_none());
            }
        }
    }

    /// The commitments of the right nodes verify against the root; any change to a commitment or the proof doesn't.
    #[test]
    fn cover_proofs_verify_and_tampering_fails(x in 0u32..1024, y in 0u32..1024, which in any::<prop::sample::Index>(), bit in 0usize..256) {
        let (a, b) = (x.min(y), x.max(y));
        let t = tree(9);
        let (commits, proof) = t.prove::<S>(a, b);
        prop_assert!(ggm::verify_cover::<S>(&t.root(), DEPTH, a, b, &commits, &proof));

        let mut c2 = commits.clone();
        let i = which.index(c2.len());
        c2[i][bit / 8] ^= 1 << (bit % 8);
        prop_assert!(!ggm::verify_cover::<S>(&t.root(), DEPTH, a, b, &c2, &proof));

        if !proof.is_empty() {
            let mut p2 = proof.clone();
            let j = which.index(p2.len());
            p2[j][bit / 8] ^= 1 << (bit % 8);
            prop_assert!(!ggm::verify_cover::<S>(&t.root(), DEPTH, a, b, &commits, &p2));
            let mut p3 = proof.clone();
            p3.pop();
            prop_assert!(!ggm::verify_cover::<S>(&t.root(), DEPTH, a, b, &commits, &p3));
        }
        let mut p4 = proof.clone();
        p4.push([0u8; 32]);
        prop_assert!(!ggm::verify_cover::<S>(&t.root(), DEPTH, a, b, &commits, &p4));
    }

    /// A proof for one window doesn't verify as a proof for another.
    #[test]
    fn a_proof_is_only_for_its_own_window(x in 0u32..1024, y in 0u32..1024, z in 0u32..1024, w in 0u32..1024) {
        let (a, b) = (x.min(y), x.max(y));
        let (c, d) = (z.min(w), z.max(w));
        prop_assume!((a, b) != (c, d));
        let t = tree(3);
        let (commits, proof) = t.prove::<S>(a, b);
        prop_assert!(!ggm::verify_cover::<S>(&t.root(), DEPTH, c, d, &commits, &proof));
    }

    /// Encoding round-trips; an entry opens with its key and with no other.
    #[test]
    fn entries_round_trip(leaf in any::<[u8; 32]>(), other in any::<[u8; 32]>(), seq in any::<u64>(), slot in any::<u32>(),
                          feed in 0u8..4, qty in any::<i64>(), fill in any::<u64>(), note in prop::collection::vec(any::<u8>(), 0..=75)) {
        prop_assume!(leaf != other);
        let e = Entry { feed, flags: 1, qty_e8: qty, fill_e8: fill, settlement: leaf, note };
        prop_assert_eq!(Entry::parse(&e.encode()), Some(e.clone()));
        let (ct, tag) = entry::encrypt::<S>(&leaf, seq, slot, &e);
        let key = entry::entry_key::<S>(&leaf, seq);
        prop_assert_eq!(entry::open::<S>(&key, seq, slot, &ct, &tag), Some(Some(e)));
        prop_assert_eq!(entry::open::<S>(&entry::entry_key::<S>(&other, seq), seq, slot, &ct, &tag), None);
        prop_assert_eq!(entry::open::<S>(&key, seq.wrapping_add(1), slot, &ct, &tag), None);
        prop_assert_eq!(entry::open::<S>(&key, seq, slot.wrapping_add(1), &ct, &tag), None);
    }

    /// `mul_div` agrees with exact arithmetic where that's checkable, rounds down, and is never wrong near the top of the range.
    #[test]
    fn mul_div_is_exact(a in any::<u128>(), b in any::<u128>(), d in 1u128..) {
        match keyhole_core::mul_div(a, b, d) {
            Some(q) => {
                // Check q * d <= a * b < (q + 1) * d in 256 bits, by comparing (hi, lo) pairs.
                let p = wide(a, b);
                let low = wide(q, d);
                prop_assert!(low <= p);
                if let Some(q1) = q.checked_add(1) {
                    prop_assert!(wide(q1, d) > p);
                }
            }
            None => prop_assert!(wide(a, b).0 >= d),
        }
    }

    /// `parse` never panics on arbitrary bytes.
    #[test]
    fn parse_is_total(p in prop::collection::vec(any::<u8>(), 0..200)) {
        let _ = Entry::parse(&p);
    }

    /// `Book` is total and a void entry changes nothing but the void count.
    #[test]
    fn the_book_never_panics(trades in prop::collection::vec((0usize..6, any::<i64>(), any::<i64>()), 0..60), book in 0i128..1_000_000_000_000_000) {
        let mut b = Book::default();
        for (f, q, p) in trades {
            let before = b.clone();
            if !b.apply(f, q, p, MAX_FEEDS, book) {
                prop_assert_eq!(&before.positions, &b.positions);
                prop_assert_eq!(before.cash_e16, b.cash_e16);
            }
        }
        let _ = b.marked_e16(&[Some(1), Some(1), Some(1), Some(1)]);
    }

    /// Long at p, marked at m: exactly qty * (m - p), with no rounding drift, rounded once at the end.
    #[test]
    fn pnl_is_exact(qty in 1i64..1_000_000_000_000, p in 1i64..10_000_000_000_000, m in 1i64..10_000_000_000_000) {
        let mut b = Book::default();
        prop_assert!(b.apply(0, qty, p, 4, i128::MAX / 100_000_000_000_000));
        let total = b.marked_e16(&[Some(m), None, None, None]).unwrap();
        prop_assert_eq!(total, qty as i128 * (m as i128 - p as i128));
        prop_assert_eq!(pnl_e6(total), (qty as i128 * (m as i128 - p as i128)).div_euclid(10_000_000_000));
    }
}

/// a * b as (hi, lo), for the test above.
fn wide(a: u128, b: u128) -> (u128, u128) {
    let m = u64::MAX as u128;
    let (a1, a0, b1, b0) = (a >> 64, a & m, b >> 64, b & m);
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    let mid = (p00 >> 64) + (p01 & m) + (p10 & m);
    ((p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64)), (p00 & m) | (mid << 64))
}

/// Not a sample: every window of a depth-6 tree. Each cover's subtrees are disjoint, in order, and add up to exactly the window.
#[test]
fn every_window_of_a_small_tree_has_an_exact_cover() {
    const D: u8 = 6;
    for first in 0u32..64 {
        for last in first..64 {
            let nodes = ggm::cover(first, last, D);
            assert!(!nodes.is_empty() && nodes.len() <= 2 * D as usize);
            let mut next = first;
            for n in &nodes {
                let (a, b) = n.slots(D);
                assert_eq!(a, next);
                assert!(b <= last);
                next = b + 1;
            }
            assert_eq!(next, last + 1);
        }
    }
}

/// The published figure is the floor of the total, at the edges of the range and either side of every multiple tried.
#[test]
fn the_figure_is_the_floor() {
    for total in [0i128, 1, -1, 9_999_999_999, 10_000_000_000, -9_999_999_999, -10_000_000_000, -10_000_000_001, i64::MAX as i128, i64::MIN as i128, i128::MAX / 2, i128::MIN / 2] {
        let q = pnl_e6(total);
        assert!(q * 10_000_000_000 <= total && total - q * 10_000_000_000 < 10_000_000_000, "{total}");
    }
}

#[test]
fn mul_div_known_values() {
    assert_eq!(keyhole_core::mul_div(10, 10, 4), Some(25));
    assert_eq!(keyhole_core::mul_div(u128::MAX, u128::MAX, u128::MAX), Some(u128::MAX));
    assert_eq!(keyhole_core::mul_div(u128::MAX, 1, 2), Some(u128::MAX / 2));
    assert_eq!(keyhole_core::mul_div(1, 1, 0), None);
    assert_eq!(keyhole_core::mul_div(u128::MAX, 2, 1), None);
}

#[test]
fn chacha20_rfc8439_vector() {
    // RFC 8439 section 2.4.2.
    let key: [u8; 32] = core::array::from_fn(|i| i as u8);
    let nonce = [0, 0, 0, 0, 0, 0, 0, 0x4a, 0, 0, 0, 0];
    let mut data = b"Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.".to_vec();
    entry::chacha20_xor(&key, &nonce, 1, &mut data);
    assert_eq!(
        hex::encode(data),
        "6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0bf91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d807ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab77937365af90bbf74a35be6b40b8eedf2785e42874d"
    );
}

#[test]
fn depth_16_window_of_a_week_is_small() {
    // A 7-day window of hourly slots at an unaligned start: the sale's whole payload.
    let c = ggm::cover(1000, 1000 + 7 * 24 - 1, 16);
    assert!(c.len() <= 8, "{}", c.len());
    let t = Tree::build::<S>(&[1; 32], 16);
    let (commits, proof) = t.prove::<S>(1000, 1000 + 7 * 24 - 1);
    assert!(ggm::verify_cover::<S>(&t.root(), 16, 1000, 1000 + 7 * 24 - 1, &commits, &proof));
    assert!(proof.len() <= 3 * 16, "proof {}", proof.len());
}
