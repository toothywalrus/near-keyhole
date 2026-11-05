//! Keyhole: sell a provable window into a private trade journal.
//!
//! A trader posts a bond and a Merkle commitment to a GGM key tree, then writes numbered encrypted entries as they
//! happen and posts each epoch's PnL. A buyer pays into escrow for a window of epochs; the trader delivers the tree nodes that
//! cover exactly that window, wrapped to a one-time key the buyer made for this purchase. The contract rules on the sale
//! (`dispute.rs`) and recomputes PnL from opened entries against oracle prices (`audit.rs`). No operator, no TEE.
//!
//! All money moves in two steps: state changes credit an account, and `withdraw` pays it out. So every state change here
//! is synchronous, a failed transfer restores the credit, and `solvency()` can state what the contract owes.
//!
//! Decision records: `docs/decisions/`.
use near_sdk::json_types::{I128, U128, U64};
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, near, require, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise};

pub mod attest;
pub mod audit;
pub mod dispute;
pub mod journal;
pub mod nft;
pub mod oracle;
pub mod sale;
#[cfg(test)]
mod tests;
pub mod types;
pub mod views;

pub use types::{HexBytes, H32};
use types::{checked_add, checked_sub};

/// The depth of every trader's tree: 65,536 slots. At one hour a slot, 7.5 years.
pub const DEPTH: u8 = 16;
pub const MAX_HANDLE: usize = 32;

#[derive(BorshStorageKey)]
#[near]
enum Key {
    TraderIds,
    Traders,
    Entries,
    Epochs,
    Tokens,
    Owned,
    Rounds,
    Audits,
    Credits,
    Seen,
    Runners,
}

/// The contract's timing and money rules, set once at `new`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Config {
    /// Seconds per slot and slots per epoch. An epoch is the unit of PnL and of sale.
    pub slot_secs: u32,
    pub epoch_slots: u32,
    /// After an epoch ends, how long its figure may be posted.
    pub post_grace_secs: u32,
    /// Nodes may be delivered no earlier than this before the window starts. Until then a token can be resold.
    pub delivery_lead_secs: u32,
    /// How long the trader has to deliver.
    pub delivery_grace_secs: u32,
    /// After the window ends, how long the buyer may dispute before the escrow is released.
    pub challenge_secs: u32,
    /// How long after asking to leave a trader's bond stays at risk.
    pub unbond_secs: u32,
    pub min_bond: U128,
    /// A sale must leave the bond at least this share of outstanding sales, in basis points.
    pub min_coverage_bps: u32,
    /// The prover's share of a slashed bond, in basis points. The rest burns: nobody can claim it, so proving yourself a liar through a second account always costs the rest.
    pub prover_bps: u32,
    /// What a refused delivery or a breached window burns from the bond, in basis points of the price. It's burned, never paid out, so that no second account can collect it.
    pub penalty_bps: u32,
    pub max_window_epochs: u32,
    /// The least deposit for a dispute (a dispute also needs at least the window's price).
    pub min_dispute: U128,
    /// The deposit an audit puts at risk.
    pub audit_bond: U128,
    /// A trade whose next round comes later than this is void, and so is one on a feed with no round at all once twice this has passed. So a dead feed can't block an audit, and
    /// a figure can't change later: a late round can't land inside the gap (see `on_imported`).
    pub max_round_gap_secs: u32,
    /// Who may record replayed rounds into `Recorded` feeds. Absent on a deployment with only proven feeds.
    pub recorder: Option<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum TraderStatus {
    Active,
    /// Asked to leave at this time, in ms: no new sales.
    Unbonding { since_ms: U64 },
    Exited,
    /// Caught. Permanent, and shown forever.
    Slashed { reason: String, by: AccountId, at_ms: U64 },
}

/// A trader's public record: what a stranger reads before buying.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Trader {
    pub id: u32,
    pub account: AccountId,
    pub handle: String,
    /// The Merkle commitment to the key tree, posted before any sale.
    pub root: H32,
    pub registered_ms: U64,
    pub first_epoch: u32,
    pub status: TraderStatus,
    pub bond: U128,
    /// Sum of the prices of tokens that can still claim against the bond.
    pub liability: U128,
    /// The declared book in USD with 6 decimals. Exposure is limited to 3x this per feed (`keyhole_core::pnl`).
    pub book_usd_e6: U128,
    /// How much of the book a window may lose, in basis points, before its buyers can claim a refund.
    pub floor_bps: u32,
    /// The bonding curve, fixed at registration: one epoch costs `base_price + slope * sold`.
    pub base_price: U128,
    pub slope: U128,
    pub next_seq: U64,
    /// The hash chain's head: every entry ever written is bound into it.
    pub head: H32,
    pub next_epoch: u32,
    pub posted_epochs: u32,
    /// Epochs passed over without a figure. Public, and a refund trigger.
    pub missed_epochs: u32,
    pub cum_pnl_e6: I128,
    /// Windows sold, and distinct accounts that bought one.
    pub sold: u32,
    pub buyers: u32,
    pub late_deliveries: u32,
    /// Epochs on which a buyer has been refused delivery. A refusal can hide a false figure, so each counts against the record like a missed epoch.
    pub refused_epochs: u32,
    /// The figures of those epochs, which no longer count on the public record.
    pub voided_e6: I128,
    /// What slashes and penalties have burned from the bond.
    pub burned: U128,
    /// The last figure's time: the bond stays at risk for `unbond_secs` after it, so every figure can be audited against something.
    pub last_post_ms: U64,
}

/// Which attestation path produced a figure. A simulated one can never read as a real one: `kind` is set by the code path.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum AttestKind {
    /// A registered runner ran the wasm job locally: no enclave. Every view says so.
    SimulatedLocal,
    /// The callback of `request_execution` on a contract other than OutLayer's own: a stand-in, in the sandbox. Not an enclave.
    OutLayerStandIn,
    /// The callback from OutLayer's own contract (`outlayer.testnet`, `outlayer.near`). What the enclave ran is pinned by `job_sha256`, which the contract's owner set.
    OutLayerTee,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Attested {
    pub kind: AttestKind,
    /// The account that delivered it: the local runner, or the OutLayer contract. In the sandbox that's a mock, and its name says so.
    pub via: AccountId,
    pub pnl_e6: I128,
    pub job_sha256: String,
    pub at_ms: U64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum EpochVerdict {
    /// Posted, and nobody has proven otherwise.
    Unchallenged,
    /// A false figure, proven: this is what the contract recomputed.
    False { recomputed_e6: I128 },
}

/// An epoch of one trader.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EpochRec {
    pub epoch: u32,
    pub first_seq: U64,
    pub entries: u32,
    pub posted_e6: Option<I128>,
    pub posted_ms: Option<U64>,
    pub verdict: EpochVerdict,
    /// Audits of this epoch that found the figure right.
    pub audits_passed: u32,
    /// Windows whose keys were delivered and not proven garbage: how many people could check this epoch.
    pub covering_sales: u32,
    /// Windows covering this epoch whose buyer was refused delivery: somebody asked to check it, and was stopped.
    pub refused_sales: u32,
    pub attested: Option<Attested>,
}

/// One journal entry on the chain.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct EntryRec {
    pub seq: U64,
    pub slot: u32,
    pub at_ms: U64,
    pub ct: HexBytes,
    pub tag: H32,
    /// The chain's head after this entry.
    pub head: H32,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Keyhole {
    pub(crate) owner: AccountId,
    pub(crate) config: Config,
    pub(crate) genesis_ms: u64,
    pub(crate) trader_ids: LookupMap<AccountId, u32>,
    pub(crate) traders: Vector<Trader>,
    /// (trader id << 32 | seq) -> entry.
    pub(crate) entries: LookupMap<u64, EntryRec>,
    /// (trader id << 32 | epoch) -> epoch.
    pub(crate) epochs: LookupMap<u64, EpochRec>,
    pub(crate) tokens: LookupMap<u64, sale::WindowToken>,
    pub(crate) next_token: u64,
    pub(crate) owned: LookupMap<AccountId, Vec<u64>>,
    pub(crate) feeds: Vec<oracle::Feed>,
    /// (feed << 32 | index) -> round. Append-only, strictly increasing in time.
    pub(crate) rounds: LookupMap<u64, oracle::Round>,
    pub(crate) audits: LookupMap<u64, audit::Audit>,
    pub(crate) next_audit: u64,
    pub(crate) credits: LookupMap<AccountId, u128>,
    pub(crate) seen: LookupSet<[u8; 32]>,
    pub(crate) runners: LookupMap<AccountId, String>,
    pub(crate) outlayer: Option<attest::OutLayerConfig>,
    /// Everything the contract owes: bonds, escrows, credits, deposits at risk.
    pub(crate) obligations: u128,
}

#[near]
impl Keyhole {
    #[init]
    pub fn new(owner: AccountId, config: Config, feeds: Vec<oracle::FeedInit>) -> Self {
        require!(config.slot_secs > 0 && config.epoch_slots > 0, "a slot and an epoch can't be empty");
        require!(config.prover_bps <= 10_000, "prover_bps is at most 10000");
        require!(config.max_round_gap_secs > 0, "the round gap can't be zero");
        require!(config.challenge_secs > config.post_grace_secs, "the challenge window must outlast the posting grace, so a missed figure is known before the escrow is released");
        require!(!feeds.is_empty() && feeds.len() <= keyhole_core::pnl::MAX_FEEDS, "1 to 4 feeds");
        let feeds = feeds.into_iter().map(oracle::Feed::from_init).collect();
        Self {
            owner,
            config,
            genesis_ms: env::block_timestamp_ms(),
            trader_ids: LookupMap::new(Key::TraderIds),
            traders: Vector::new(Key::Traders),
            entries: LookupMap::new(Key::Entries),
            epochs: LookupMap::new(Key::Epochs),
            tokens: LookupMap::new(Key::Tokens),
            next_token: 1,
            owned: LookupMap::new(Key::Owned),
            feeds,
            rounds: LookupMap::new(Key::Rounds),
            audits: LookupMap::new(Key::Audits),
            next_audit: 1,
            credits: LookupMap::new(Key::Credits),
            seen: LookupSet::new(Key::Seen),
            runners: LookupMap::new(Key::Runners),
            outlayer: None,
            obligations: 0,
        }
    }

    /// Pay out everything credited to the caller. If the transfer fails, the callback restores the credit.
    pub fn withdraw(&mut self) -> Promise {
        let who = env::predecessor_account_id();
        let amount = self.credits.remove(&who).unwrap_or(0);
        require!(amount > 0, "nothing to withdraw");
        self.obligations = checked_sub(self.obligations, amount);
        Promise::new(who.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(Self::ext(env::current_account_id()).with_static_gas(near_sdk::Gas::from_tgas(5)).on_withdraw(who, U128(amount)))
    }

    #[private]
    pub fn on_withdraw(&mut self, who: AccountId, amount: U128) -> bool {
        if env::promise_results_count() == 1 && matches!(env::promise_result_checked(0, 0), Ok(_)) {
            return true;
        }
        env::log_str(&format!("withdrawal of {} to {who} failed: credit restored", amount.0));
        self.credit(&who, amount.0);
        false
    }
}

impl Keyhole {
    pub(crate) fn now_ms(&self) -> u64 {
        env::block_timestamp_ms()
    }

    pub(crate) fn current_slot(&self) -> u64 {
        (self.now_ms().saturating_sub(self.genesis_ms)) / (self.config.slot_secs as u64 * 1000)
    }

    pub(crate) fn epoch_of_slot(&self, slot: u64) -> u32 {
        (slot / self.config.epoch_slots as u64) as u32
    }

    /// The ms at which an epoch starts. Epoch `e + 1` starting is epoch `e` ending.
    pub(crate) fn epoch_start_ms(&self, epoch: u32) -> u64 {
        self.genesis_ms + epoch as u64 * self.config.epoch_slots as u64 * self.config.slot_secs as u64 * 1000
    }

    pub(crate) fn epoch_slots_range(&self, first_epoch: u32, last_epoch: u32) -> (u32, u32) {
        let first = first_epoch as u64 * self.config.epoch_slots as u64;
        let last = (last_epoch as u64 + 1) * self.config.epoch_slots as u64 - 1;
        require!(last < 1u64 << DEPTH, "that window is past the end of the tree");
        (first as u32, last as u32)
    }

    pub(crate) fn tid(&self, account: &AccountId) -> u32 {
        *self.trader_ids.get(account).unwrap_or_else(|| env::panic_str("not a registered trader"))
    }

    pub(crate) fn trader(&self, id: u32) -> Trader {
        self.traders.get(id).cloned().unwrap_or_else(|| env::panic_str("no such trader"))
    }

    pub(crate) fn put_trader(&mut self, t: Trader) {
        self.traders.replace(t.id, t);
    }

    /// A storage key. A number that doesn't fit is refused, never truncated: a caller could otherwise name one entry by two numbers, and its tag would "fail".
    pub(crate) fn key(id: u32, n: u64) -> u64 {
        require!(n <= u32::MAX as u64, "that number is out of range");
        ((id as u64) << 32) | n
    }

    pub(crate) fn epoch_rec(&self, id: u32, epoch: u32) -> EpochRec {
        self.epochs.get(&Self::key(id, epoch as u64)).cloned().unwrap_or(EpochRec {
            epoch,
            first_seq: U64(0),
            entries: 0,
            posted_e6: None,
            posted_ms: None,
            verdict: EpochVerdict::Unchallenged,
            audits_passed: 0,
            covering_sales: 0,
            refused_sales: 0,
            attested: None,
        })
    }

    pub(crate) fn credit(&mut self, who: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        let c = self.credits.get(who).copied().unwrap_or(0);
        self.credits.insert(who.clone(), checked_add(c, amount));
        self.obligations = checked_add(self.obligations, amount);
    }

    /// Money that was already owed moves to an account's credit: the total owed doesn't change.
    pub(crate) fn move_to_credit(&mut self, who: &AccountId, amount: u128) {
        self.obligations = checked_sub(self.obligations, amount);
        self.credit(who, amount);
    }

    /// Charge `payer` for the storage this call grew by, out of `available`, and return the rest of it right away.
    pub(crate) fn charge_storage(&self, before: u64, available: u128, payer: &AccountId) {
        let grown = env::storage_usage().saturating_sub(before) as u128;
        let cost = types::checked_mul(grown, env::storage_byte_cost().as_yoctonear());
        require!(available >= cost, format!("attach {} yoctoNEAR more for {grown} bytes of storage", cost - available));
        let rest = available - cost;
        if rest > 0 {
            let _ = Promise::new(payer.clone()).transfer(NearToken::from_yoctonear(rest));
        }
    }

    /// Take `amount` from a bond, up to all of it, and burn it: it stops being owed to anyone.
    pub(crate) fn burn(&mut self, t: &mut Trader, amount: u128) {
        let burned = amount.min(t.bond.0);
        t.bond = U128(checked_sub(t.bond.0, burned));
        t.burned = U128(checked_add(t.burned.0, burned));
        self.obligations = checked_sub(self.obligations, burned);
    }

    /// Slash a trader for good: the prover takes its share at once and the rest burns. No part of a bond is ever paid out to a buyer, since a buyer can be the trader's
    /// second account: the only ways out of a bond are this share, burning, and `withdraw_bond` after the delay (`docs/decisions/0013`).
    pub(crate) fn slash(&mut self, t: &mut Trader, reason: &str, prover: &AccountId) -> u128 {
        if matches!(t.status, TraderStatus::Slashed { .. }) {
            return 0;
        }
        let cut = keyhole_core::mul_div(t.bond.0, self.config.prover_bps as u128, 10_000).unwrap_or_else(|| env::panic_str("amount overflow"));
        t.bond = U128(checked_sub(t.bond.0, cut));
        let rest = t.bond.0;
        self.burn(t, rest);
        t.status = TraderStatus::Slashed { reason: reason.to_string(), by: prover.clone(), at_ms: U64(self.now_ms()) };
        self.move_to_credit(prover, cut);
        cut
    }
}
