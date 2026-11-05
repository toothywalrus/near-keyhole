//! Tests of the money arithmetic and the clock. The flows are in `tools/attack.ts`, which runs against the real wasm.
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
            catchup_grace_secs: 86400,
            challenge_secs: 7200,
            unbond_secs: 86400,
            min_bond: U128(1),
            min_price: U128(1),
            min_coverage_bps: 0,
            prover_bps: 4000,
            penalty_bps: 5000,
            max_window_epochs: 31,
            min_dispute: U128(1),
            audit_bond: U128(1),
            max_round_gap_secs: 1000,
            recorder: None,
        },
        vec![oracle::FeedInit { symbol: "ETH/USD".into(), source: oracle::FeedSource::Recorded }],
    )
}

proptest! {
    /// The prover's cut is exact and never more than the bond, on any bond.
    #[test]
    fn slash_cut_is_exact(bond in 0u128..u128::MAX / 20_000, bps in 0u32..=10_000) {
        let cut = keyhole_core::mul_div(bond, bps as u128, 10_000).unwrap();
        prop_assert!(cut <= bond);
        if bps == 10_000 { prop_assert_eq!(cut, bond); }
        if bps == 0 { prop_assert_eq!(cut, 0); }
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
