//! The contract rules on a key sale itself: `docs/decisions/0002`, measured in `docs/research/killtest-2026-11-05.md`.
//! Everything checked comes from the sale's record in state. A loser's deposit is really taken, so a dismissed
//! dispute ends in a stored verdict, not a panic. Panics here are only for proofs that don't even apply: a wrong secret, a wrong node.
use crate::sale::TokenState;
use crate::types::checked_add;
use crate::*;
use keyhole_core::{entry, ggm};
use x25519_dalek::{PublicKey, StaticSecret};

#[near(serializers = [json])]
pub struct Verdict {
    /// True: the trader is at fault, the buyer is refunded and the bond is slashed.
    pub trader_at_fault: bool,
    pub detail: String,
    /// The disputer's share of the slashed bond.
    pub slashed_to_prover: U128,
    /// What came back to the disputer, in escrow and deposit, on top of the share.
    pub refunded: U128,
    /// The deposit lost to the trader, if the dispute was wrong.
    pub deposit_lost: U128,
}

#[near]
impl Keyhole {
    /// The nodes delivered are garbage. Reveal the one-time secret: the contract unwraps `node_index` and compares it with the commitment.
    /// It's a one-time key, so revealing it costs nothing else, but it publishes this sale's nodes: a wrong dispute gives the window away.
    #[payable]
    pub fn dispute_wrap(&mut self, token_id: u64, one_time_secret: H32, node_index: u32) -> Verdict {
        let who = env::predecessor_account_id();
        let k = self.disputable(token_id, &who);
        let i = node_index as usize;
        let wrapped = k.wrapped.get(i).unwrap_or_else(|| env::panic_str("no such node in this sale"));
        let buyer_pub = k.buyer_pub.expect("delivered tokens have a key");
        let eph = k.eph.expect("delivered tokens have an ephemeral key");
        let secret = StaticSecret::from(one_time_secret.0);
        require!(PublicKey::from(&secret).as_bytes() == &buyer_pub.0, "that secret isn't this token's one-time key");
        let shared = secret.diffie_hellman(&PublicKey::from(eph.0));
        let key = entry::wrap_key::<types::NearHash>(shared.as_bytes(), &eph.0, &buyer_pub.0, token_id);
        let mut node = wrapped.0;
        entry::wrap_xor(&key, node_index, &mut node);
        let matches = ggm::commit::<types::NearHash>(&node) == k.commits[i].0;
        self.rule(token_id, who, !matches, if matches { "the wrapped node matches its commitment" } else { "the wrapped node doesn't match its commitment" })
    }

    /// A delivered node matches its commitment, but the entry `seq` doesn't open under the key it derives: the tree the trader committed to
    /// isn't the tree he encrypted with. Reveal that one node: the contract walks down from it to the entry's leaf and checks the tag.
    #[payable]
    pub fn dispute_entry(&mut self, token_id: u64, node_index: u32, node: H32, seq: U64) -> Verdict {
        let who = env::predecessor_account_id();
        let k = self.disputable(token_id, &who);
        let i = node_index as usize;
        let commit = k.commits.get(i).unwrap_or_else(|| env::panic_str("no such node in this sale"));
        require!(ggm::commit::<types::NearHash>(&node.0) == commit.0, "that isn't the node delivered: its commitment differs");
        let id = ggm::cover(k.first_slot, k.last_slot, DEPTH)[i];
        let e = self.entries.get(&Self::key(k.trader, seq.0)).unwrap_or_else(|| env::panic_str("no such entry")).clone();
        let leaf = ggm::leaf_from::<types::NearHash>(&node.0, id, DEPTH, e.slot).unwrap_or_else(|| env::panic_str("that entry's slot isn't under this node"));
        let key = entry::entry_key::<types::NearHash>(&leaf, seq.0);
        let opens = entry::tag::<types::NearHash>(&key, seq.0, e.slot, &e.ct.0) == e.tag.0;
        self.rule(token_id, who, !opens, if opens { "the entry opens under the key this node derives" } else { "the entry doesn't open under the key this node derives" })
    }
}

impl Keyhole {
    fn disputable(&self, token_id: u64, who: &AccountId) -> sale::WindowToken {
        let k = self.token(token_id);
        require!(&k.owner == who, "only the holder can dispute");
        require!(k.state == TokenState::Delivered, "only a delivered window can be disputed");
        require!(self.now_ms() < k.settle_at_ms.0, "the challenge window is over");
        require!(env::attached_deposit().as_yoctonear() >= k.price.0.max(self.config.min_dispute.0), "a dispute's deposit is at least the window's price");
        require!(!matches!(self.trader(k.trader).status, TraderStatus::Slashed { .. }), "this trader was already slashed: claim a refund");
        k
    }

    fn rule(&mut self, token_id: u64, who: AccountId, trader_at_fault: bool, detail: &str) -> Verdict {
        let deposit = env::attached_deposit().as_yoctonear();
        let mut k = self.token(token_id);
        let mut t = self.trader(k.trader);
        if trader_at_fault {
            let price = k.price.0;
            let slashed = self.slash(&mut t, detail, &who);
            // The escrow comes back at once. Its claim on the rest of the bond leaves with it, shrinking what other buyers share.
            let from_bond = self.pro_rata(price, t.bond.0, t.liability.0);
            t.bond = U128(t.bond.0 - from_bond);
            t.liability = U128(t.liability.0.saturating_sub(price));
            k.state = TokenState::Refunded;
            self.tokens.insert(token_id, k);
            self.put_trader(t);
            self.move_to_credit(&who, checked_add(price, from_bond));
            self.credit(&who, deposit);
            near_sdk::log!("slashed: {detail}");
            Verdict { trader_at_fault, detail: detail.to_string(), slashed_to_prover: U128(slashed), refunded: U128(checked_add(checked_add(price, from_bond), deposit)), deposit_lost: U128(0) }
        } else {
            k.disputes_lost += 1;
            let account = t.account.clone();
            self.tokens.insert(token_id, k);
            self.credit(&account, deposit);
            near_sdk::log!("dismissed: {detail}");
            Verdict { trader_at_fault, detail: detail.to_string(), slashed_to_prover: U128(0), refunded: U128(0), deposit_lost: U128(deposit) }
        }
    }
}
