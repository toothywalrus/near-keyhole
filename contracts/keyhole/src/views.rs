//! Read-only views. Nothing here needs a key, and the web app reads only these.
use crate::*;

const MIN_MISS_BPS: u32 = 200;

#[near(serializers = [json])]
pub struct Clock {
    pub now_ms: U64,
    pub genesis_ms: U64,
    pub slot: U64,
    pub epoch: u32,
}

#[near(serializers = [json])]
pub struct Solvency {
    /// Everything owed: bonds, escrows, credits, deposits at risk.
    pub obligations: U128,
    pub balance: U128,
    /// What the contract's storage locks.
    pub storage_locked: U128,
    /// balance - storage_locked - obligations. Never negative: a property test and the attack suite both hold it to that.
    pub slack: I128,
}

/// The public record, with what's missing counted against it.
#[near(serializers = [json])]
pub struct Score {
    /// The posted figures, corrected where proven false.
    pub posted_e6: I128,
    /// Epochs with no figure, once their grace is over: the ones passed over and the ones since the last post.
    pub missed: u32,
    /// What each one costs: the worse of the trader's own floor and 2% of the book. Otherwise a trader could post his winners and stay silent on his losers.
    pub charge_per_missed_e6: I128,
    /// `posted_e6` less the charges. This is the number to show.
    pub score_e6: I128,
}

#[near]
impl Keyhole {
    pub fn score(&self, account: AccountId) -> Option<Score> {
        let t = self.get_trader(account)?;
        let mut missed = t.missed_epochs;
        if matches!(t.status, TraderStatus::Active | TraderStatus::Unbonding { .. }) {
            let grace = self.config.post_grace_secs as u64 * 1000;
            let epoch_ms = self.config.epoch_slots as u64 * self.config.slot_secs as u64 * 1000;
            let elapsed = self.now_ms().saturating_sub(self.genesis_ms).saturating_sub(grace);
            let past_grace = (elapsed / epoch_ms) as u32; // epochs before this one have ended, with their grace over
            missed = missed.saturating_add(past_grace.saturating_sub(t.next_epoch));
        }
        let charge = t.book_usd_e6.0 as i128 * t.floor_bps.max(MIN_MISS_BPS) as i128 / 10_000;
        Some(Score { posted_e6: t.cum_pnl_e6, missed, charge_per_missed_e6: I128(charge), score_e6: I128(t.cum_pnl_e6.0.saturating_sub(charge.saturating_mul(missed as i128))) })
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn clock(&self) -> Clock {
        let slot = self.current_slot();
        Clock { now_ms: U64(self.now_ms()), genesis_ms: U64(self.genesis_ms), slot: U64(slot), epoch: self.epoch_of_slot(slot) }
    }

    pub fn get_feeds(&self) -> Vec<oracle::Feed> {
        self.feeds.clone()
    }

    pub fn get_rounds(&self, feed: u8, from: u32, limit: u32) -> Vec<oracle::Round> {
        let f = match self.feeds.get(feed as usize) {
            Some(f) => f,
            None => return vec![],
        };
        (from..f.rounds.min(from.saturating_add(limit.min(1000)))).filter_map(|i| self.rounds.get(&Self::key(feed as u32, i as u64)).cloned()).collect()
    }

    pub fn trader_count(&self) -> u32 {
        self.traders.len()
    }

    pub fn get_trader(&self, account: AccountId) -> Option<Trader> {
        self.trader_ids.get(&account).and_then(|id| self.traders.get(*id).cloned())
    }

    pub fn list_traders(&self, from: u32, limit: u32) -> Vec<Trader> {
        (from..self.traders.len().min(from.saturating_add(limit.min(100)))).filter_map(|i| self.traders.get(i).cloned()).collect()
    }

    pub fn get_epochs(&self, account: AccountId, from: u32, limit: u32) -> Vec<EpochRec> {
        let id = match self.trader_ids.get(&account) {
            Some(id) => *id,
            None => return vec![],
        };
        (from..from.saturating_add(limit.min(400))).filter_map(|e| self.epochs.get(&Self::key(id, e as u64)).cloned()).collect()
    }

    pub fn get_entries(&self, account: AccountId, from: U64, limit: u32) -> Vec<EntryRec> {
        let id = match self.trader_ids.get(&account) {
            Some(id) => *id,
            None => return vec![],
        };
        (from.0..from.0.saturating_add(limit.min(200) as u64)).filter_map(|s| self.entries.get(&Self::key(id, s)).cloned()).collect()
    }

    pub fn get_token(&self, token_id: u64) -> Option<sale::WindowToken> {
        self.tokens.get(&token_id).cloned()
    }

    pub fn get_audit(&self, audit: u64) -> Option<audit::Audit> {
        self.audits.get(&audit).cloned()
    }

    pub fn credit_of(&self, account: AccountId) -> U128 {
        U128(self.credits.get(&account).copied().unwrap_or(0))
    }

    pub fn solvency(&self) -> Solvency {
        let balance = env::account_balance().as_yoctonear();
        let storage = env::storage_usage() as u128 * env::storage_byte_cost().as_yoctonear();
        Solvency { obligations: U128(self.obligations), balance: U128(balance), storage_locked: U128(storage), slack: I128(balance as i128 - storage as i128 - self.obligations as i128) }
    }

    pub fn get_outlayer(&self) -> Option<attest::OutLayerConfig> {
        self.outlayer.clone()
    }
}
