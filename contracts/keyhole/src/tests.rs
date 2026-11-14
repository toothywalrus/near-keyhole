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
            fee_bps: 0,
            treasury: None,
            price_delay_secs: 0,
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

fn with_fee(fee_bps: u32, treasury: Option<&str>) -> Config {
    let mut c = contract().config.clone();
    c.fee_bps = fee_bps;
    c.treasury = treasury.map(|t| t.parse().unwrap());
    c
}

fn new_with(config: Config) -> Keyhole {
    Keyhole::new("owner.test".parse().unwrap(), config, vec![oracle::FeedInit { symbol: "ETH/USD".into(), source: oracle::FeedSource::Recorded }])
}

#[test]
fn the_fee_rules() {
    let me: AccountId = "keyhole.test".parse().unwrap();
    assert_eq!(fee_rule(&with_fee(MAX_FEE_BPS + 1, Some("treasury.test")), &me), Some("fee_bps is at most 2000"));
    assert_eq!(fee_rule(&with_fee(MAX_FEE_BPS, Some("treasury.test")), &me), None);
    assert_eq!(fee_rule(&with_fee(500, None), &me), Some("a fee needs a treasury"));
    assert_eq!(fee_rule(&with_fee(0, None), &me), None);
    assert!(fee_rule(&with_fee(500, Some("keyhole.test")), &me).unwrap().starts_with("the treasury can't be the contract"));
}

#[test]
fn no_fee_is_the_default_and_needs_no_treasury() {
    let k = new_with(with_fee(0, None));
    assert_eq!(k.fee_of(1_000_000), 0);
    let json = near_sdk::serde_json::json!({
        "slot_secs": 1, "epoch_slots": 1, "post_grace_secs": 3, "delivery_lead_secs": 1, "delivery_grace_secs": 1, "catchup_grace_secs": 1, "challenge_secs": 4,
        "unbond_secs": 1, "min_bond": "1", "min_price": "1", "min_coverage_bps": 0, "prover_bps": 4000, "penalty_bps": 5000, "max_window_epochs": 31,
        "min_dispute": "1", "audit_bond": "1", "max_round_gap_secs": 1, "recorder": null
    });
    let c: Config = near_sdk::serde_json::from_value(json).unwrap();
    assert_eq!((c.fee_bps, c.treasury), (0, None), "JSON for `new` written before the fee existed still parses, as no fee");
}

proptest! {
    /// The fee and the trader's share add up to the price exactly, the fee rounds down, and it never exceeds the cap.
    #[test]
    fn fee_split_is_exact(price in 0u128..u128::MAX / 20_000, bps in 0u32..=MAX_FEE_BPS) {
        let k = new_with(with_fee(bps, Some("treasury.test")));
        let fee = k.fee_of(price);
        prop_assert!(fee <= price / 5);
        prop_assert_eq!(fee, price * bps as u128 / 10_000, "rounded down, never up");
        prop_assert!(fee * 10_000 <= price * bps as u128 && (fee + 1) * 10_000 > price * bps as u128);
    }
}
