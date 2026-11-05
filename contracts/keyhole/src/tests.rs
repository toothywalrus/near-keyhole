//! Property tests of the money arithmetic. The flows are in `tools/attack.ts`, which runs against the real wasm.
use crate::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use proptest::prelude::*;

fn contract() -> Keyhole {
    let owner: AccountId = "owner.test".parse().unwrap();
    testing_env!(VMContextBuilder::new().predecessor_account_id(owner.clone()).block_timestamp(1_000_000_000_000).build());
    Keyhole::new(
        owner,
        Config {
            slot_secs: 3600,
            epoch_slots: 24,
            post_grace_secs: 3600,
            delivery_lead_secs: 3600,
            delivery_grace_secs: 3600,
            challenge_secs: 7200,
            unbond_secs: 86400,
            min_bond: U128(1),
            min_coverage_bps: 0,
            prover_bps: 4000,
            burn_bps: 2000,
            late_penalty_bps: 1000,
            max_window_epochs: 31,
            min_dispute: U128(1),
            audit_bond: U128(1),
            max_round_gap_secs: 3600,
            recorder: None,
        },
        vec![oracle::FeedInit { symbol: "ETH/USD".into(), source: oracle::FeedSource::Recorded }],
    )
}

proptest! {
    /// However the claims are ordered, nobody gets more than their price, the total never exceeds the bond, and when the bond covers
    /// everything everybody gets their whole price (to the unit).
    #[test]
    fn pro_rata_never_overdraws(prices in prop::collection::vec(1u128..10_000_000_000_000_000_000_000_000_000_000u128, 1..12), bond in 0u128..1_000_000_000_000_000_000_000_000_000_000_00u128, rev in any::<bool>()) {
        let k = contract();
        let total: u128 = prices.iter().sum();
        let mut order = prices.clone();
        if rev { order.reverse(); }
        let (mut b, mut l, mut paid) = (bond, total, 0u128);
        for p in &order {
            let share = k.pro_rata(*p, b, l);
            prop_assert!(share <= *p);
            prop_assert!(share <= b);
            b -= share;
            l -= *p;
            paid += share;
        }
        prop_assert!(paid <= bond);
        if bond >= total {
            prop_assert_eq!(paid, total);
        }
    }

    /// The fraction stays the same as claims come in: order doesn't change what anyone gets, by more than the rounding.
    #[test]
    fn pro_rata_is_order_independent(a in 1_000_000u128..1_000_000_000_000_000_000_000_000u128, c in 1_000_000u128..1_000_000_000_000_000_000_000_000u128, bond in 1u128..1_000_000_000_000_000_000_000_000u128) {
        let k = contract();
        let first_a = k.pro_rata(a, bond, a + c);
        let then_c = k.pro_rata(c, bond - first_a, c);
        let first_c = k.pro_rata(c, bond, a + c);
        let then_a = k.pro_rata(a, bond - first_c, a);
        // Rounding down loses at most a unit or two.
        let tolerance = 2;
        prop_assert!(first_a.abs_diff(then_a) <= tolerance, "{first_a} vs {then_a}");
        prop_assert!(first_c.abs_diff(then_c) <= tolerance, "{first_c} vs {then_c}");
    }

    /// The cut taken on a slash is exactly the share, with no overflow on any bond, and leaves the rest.
    #[test]
    fn slash_cut_is_exact(bond in 0u128..u128::MAX / 20_000, bps in 0u32..=10_000) {
        let cut = bond / 10_000 * bps as u128 + (bond % 10_000) * bps as u128 / 10_000;
        prop_assert!(cut <= bond);
        prop_assert_eq!(Some(cut), keyhole_core::mul_div(bond, bps as u128, 10_000));
        if bps == 10_000 { prop_assert_eq!(cut, bond); }
    }
}

#[test]
fn hex_round_trips_and_refuses_junk() {
    use crate::types::{from_hex, to_hex};
    assert_eq!(from_hex(&to_hex(&[0, 1, 255])).unwrap(), vec![0, 1, 255]);
    assert!(from_hex("abc").is_none());
    assert!(from_hex("zz").is_none());
    assert!(from_hex("AB").is_none(), "uppercase isn't the form we hash or compare");
}

#[test]
fn clock_arithmetic() {
    let k = contract();
    assert_eq!(k.current_slot(), 0);
    assert_eq!(k.epoch_of_slot(23), 0);
    assert_eq!(k.epoch_of_slot(24), 1);
    assert_eq!(k.epoch_start_ms(1) - k.epoch_start_ms(0), 24 * 3600 * 1000);
    assert_eq!(k.epoch_slots_range(1, 2), (24, 71));
}
