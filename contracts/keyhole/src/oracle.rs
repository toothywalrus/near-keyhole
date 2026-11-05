//! The price table a fraud proof reads. Rounds are appended and never changed, so a slash can't depend on a cross-contract
//! call: a proof reads only this table. A feed has one source, set at `new`, and the view of every round says which:
//!
//! - `Recorded`: real Chainlink rounds replayed by `config.recorder` (sandbox and testnet, where a live feed has few rounds). The recorder is
//!   trusted here, and the label says so.
//! - `BorrowedOracle`: anyone may import the latest round from a near-borrowed-oracle contract, where NEAR's MPC network proved it.
use crate::*;
use near_sdk::serde::Deserialize;
use near_sdk::{ext_contract, Gas, PromiseError};

const GAS_READ: Gas = Gas::from_tgas(10);
const GAS_ON_READ: Gas = Gas::from_tgas(8);
const ROUND_STORAGE_BYTES: u128 = 200;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum FeedSource {
    Recorded,
    BorrowedOracle { oracle: AccountId, pair: String },
}

#[near(serializers = [json])]
pub struct FeedInit {
    pub symbol: String,
    pub source: FeedSource,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Feed {
    pub symbol: String,
    pub source: FeedSource,
    pub rounds: u32,
}

impl Feed {
    pub fn from_init(i: FeedInit) -> Feed {
        Feed { symbol: i.symbol, source: i.source, rounds: 0 }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Round {
    /// Chainlink's round id.
    pub round_id: U64,
    pub answer_e8: i64,
    /// When this round takes effect on this chain, in ms. For `Recorded` feeds it's the replay's clock.
    pub t_ms: U64,
    /// The round's own time at its source, in seconds.
    pub source_updated_at: U64,
}

/// near-borrowed-oracle's `PriceView`, the fields used here.
#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BorrowedPrice {
    pub answer: I128,
    pub round_id: U64,
    pub updated_at: U64,
    pub decimals: u8,
}

#[ext_contract(ext_borrowed)]
#[allow(dead_code)]
trait Borrowed {
    fn latest(&self, pair: String) -> Option<BorrowedPrice>;
}

#[near]
impl Keyhole {
    /// The recorder appends one real round to a `Recorded` feed, paying for its storage. It takes effect now.
    #[payable]
    pub fn record_round(&mut self, feed: u8, round_id: U64, answer_e8: i64, source_updated_at: U64) {
        let who = env::predecessor_account_id();
        require!(self.config.recorder.as_ref() == Some(&who), "only the recorder may record rounds");
        let f = self.feeds.get(feed as usize).unwrap_or_else(|| env::panic_str("no such feed"));
        require!(f.source == FeedSource::Recorded, "this feed isn't a recorded one");
        require!(answer_e8 > 0, "a price is positive");
        let t = self.now_ms();
        let before = env::storage_usage();
        self.push_round(feed, Round { round_id, answer_e8, t_ms: U64(t), source_updated_at });
        self.rounds.flush();
        self.charge_storage(before, env::attached_deposit().as_yoctonear(), &who);
    }

    /// Anyone: import the latest round of a `BorrowedOracle` feed. Nothing here is on any slashing path. The deposit pays for the round's storage.
    #[payable]
    pub fn import_round(&mut self, feed: u8) -> Promise {
        require!(env::attached_deposit().as_yoctonear() >= ROUND_STORAGE_BYTES * env::storage_byte_cost().as_yoctonear(), "attach enough for a round's storage");
        let f = self.feeds.get(feed as usize).unwrap_or_else(|| env::panic_str("no such feed"));
        match &f.source {
            FeedSource::BorrowedOracle { oracle, pair } => ext_borrowed::ext(oracle.clone())
                .with_static_gas(GAS_READ)
                .latest(pair.clone())
                .then(Self::ext(env::current_account_id()).with_static_gas(GAS_ON_READ).on_imported(feed)),
            _ => env::panic_str("this feed isn't a borrowed one"),
        }
    }

    #[private]
    pub fn on_imported(&mut self, feed: u8, #[callback_result] latest: Result<Option<BorrowedPrice>, PromiseError>) -> bool {
        let p = match latest {
            Ok(Some(p)) => p,
            _ => {
                env::log_str("the oracle gave no round");
                return false;
            }
        };
        require!(p.decimals == 8, "only 8-decimal feeds");
        let answer = i64::try_from(p.answer.0).unwrap_or_else(|_| env::panic_str("the oracle's answer doesn't fit"));
        require!(answer > 0, "a price is positive");
        let t = p.updated_at.0.saturating_mul(1000);
        let n = self.feeds[feed as usize].rounds;
        if n > 0 {
            let last = self.rounds.get(&Self::key(feed as u32, n as u64 - 1)).cloned();
            if last.map(|l| l.t_ms.0 >= t).unwrap_or(false) {
                env::log_str("no newer round to import");
                return false;
            }
        }
        self.push_round(feed, Round { round_id: p.round_id, answer_e8: answer, t_ms: U64(t), source_updated_at: p.updated_at });
        true
    }
}

impl Keyhole {
    fn push_round(&mut self, feed: u8, r: Round) {
        let n = self.feeds[feed as usize].rounds;
        if n > 0 {
            let last = self.rounds.get(&Self::key(feed as u32, n as u64 - 1)).expect("round");
            require!(r.t_ms.0 > last.t_ms.0, "rounds only go forward in time");
        }
        self.rounds.insert(Self::key(feed as u32, n as u64), r);
        self.feeds[feed as usize].rounds = n + 1;
    }

    /// The price in force for a moment `at_ms`: the first round at or after it, proven by its index `hint`.
    /// Priced this way a trader can't know the price of a trade when he writes it, however fast his data is (`docs/decisions/0004`).
    pub(crate) fn price_at(&self, feed: u8, at_ms: u64, hint: u32) -> i64 {
        let f = self.feeds.get(feed as usize).unwrap_or_else(|| env::panic_str("no such feed"));
        require!(hint < f.rounds, "no such round yet: a trade is priced at the first round after it");
        let r = self.rounds.get(&Self::key(feed as u32, hint as u64)).expect("round");
        require!(r.t_ms.0 >= at_ms, "wrong price hint: that round is before the trade");
        if hint > 0 {
            let prev = self.rounds.get(&Self::key(feed as u32, hint as u64 - 1)).expect("round");
            require!(prev.t_ms.0 < at_ms, "wrong price hint: an earlier round also follows the trade");
        }
        r.answer_e8
    }
}
