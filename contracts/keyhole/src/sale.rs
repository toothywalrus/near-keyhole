//! The key sale: a window token, the escrow, delivery, settlement, and the refunds.
//!
//! The order of a sale:
//!   `buy_window` (payment into escrow, a token with the buyer's one-time key)
//!   `deliver` (from `delivery_lead_secs` before the window; the contract checks the commitments against the trader's root)
//!   `dispute_wrap` / `dispute_entry` (until `settle_at`)
//!   `settle`: the escrow goes to the trader, or back to the holder with a penalty burned from the bond, if the window breached the floor or a figure is missing.
//! Until delivery can begin the token can be resold: no keys exist in anyone's hands, so nothing is left behind (`docs/decisions/0006`).
use crate::types::{checked_add, checked_mul, checked_sub};
use crate::*;
use keyhole_core::ggm;
use x25519_dalek::{PublicKey, StaticSecret};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum TokenState {
    /// Paid, not delivered. Resale is open.
    Pending,
    /// Delivered: resale is closed for good, the challenge is running.
    Delivered,
    /// The escrow went to the trader.
    Closed,
    /// The escrow went back to the holder, by any path.
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct WindowToken {
    pub id: u64,
    pub trader: u32,
    pub first_epoch: u32,
    pub last_epoch: u32,
    pub first_slot: u32,
    pub last_slot: u32,
    pub owner: AccountId,
    pub price: U128,
    /// The holder's one-time x25519 key. `None` after a plain transfer, until the new holder registers one.
    pub buyer_pub: Option<H32>,
    pub state: TokenState,
    pub bought_ms: U64,
    pub deliver_by_ms: U64,
    pub settle_at_ms: U64,
    pub resale_price: Option<U128>,
    /// What the trader delivered, one per cover node, in the cover's order.
    pub eph: Option<H32>,
    pub wrapped: Vec<H32>,
    pub commits: Vec<H32>,
    pub disputes_lost: u32,
}

fn low_order(point: &[u8; 32]) -> bool {
    // A contribution of one of these forces a known shared secret: `was_contributory` is the standard check.
    let secret = StaticSecret::from([0x77u8; 32]);
    !secret.diffie_hellman(&PublicKey::from(*point)).was_contributory()
}

#[near]
impl Keyhole {
    /// What a window costs right now.
    pub fn quote(&self, trader: AccountId, first_epoch: u32, last_epoch: u32) -> U128 {
        let id = self.tid(&trader);
        U128(self.price_of(&self.trader(id), first_epoch, last_epoch))
    }

    /// Buy a window of epochs. Attach at least the quote, plus storage: the rest comes back, so the attachment is also the slippage limit.
    #[payable]
    pub fn buy_window(&mut self, trader: AccountId, first_epoch: u32, last_epoch: u32, buyer_pub: H32) -> u64 {
        let who = env::predecessor_account_id();
        let id = self.tid(&trader);
        let mut t = self.trader(id);
        require!(t.status == TraderStatus::Active, "this trader isn't selling");
        require!(t.bond.0 >= self.config.min_bond.0, "this trader's bond is below the minimum, so he isn't selling");
        require!(who != t.account, "a trader can't buy his own window");
        require!(first_epoch <= last_epoch, "the window is backwards");
        require!(last_epoch - first_epoch < self.config.max_window_epochs, "that window is too long");
        require!(first_epoch >= t.first_epoch, "that window starts before this trader's journal");
        require!(first_epoch <= self.epoch_of_slot(self.current_slot()).saturating_add(self.config.max_window_epochs), "that window is too far ahead");
        require!(!low_order(&buyer_pub.0), "that one-time key is a low-order point");
        self.refuse_known_bad(&t, first_epoch, last_epoch);
        let (first_slot, last_slot) = self.epoch_slots_range(first_epoch, last_epoch);
        let price = self.price_of(&t, first_epoch, last_epoch);
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= price, format!("this window costs {price}"));
        let liability = checked_add(t.liability.0, price);
        let covered = t.bond.0 >= checked_mul(liability / 10_000, self.config.min_coverage_bps as u128);
        require!(covered, "this trader's bond doesn't cover another sale");

        let before = env::storage_usage();
        let now = self.now_ms();
        let start = self.epoch_start_ms(first_epoch);
        let end = self.epoch_start_ms(last_epoch + 1);
        let earliest = start.saturating_sub(self.config.delivery_lead_secs as u64 * 1000);
        let deliver_by = earliest.max(now) + self.config.delivery_grace_secs as u64 * 1000;
        let settle_at = end.max(deliver_by) + self.config.challenge_secs as u64 * 1000;
        let token_id = self.next_token;
        self.next_token += 1;
        self.tokens.insert(
            token_id,
            WindowToken {
                id: token_id,
                trader: id,
                first_epoch,
                last_epoch,
                first_slot,
                last_slot,
                owner: who.clone(),
                price: U128(price),
                buyer_pub: Some(buyer_pub),
                state: TokenState::Pending,
                bought_ms: U64(now),
                deliver_by_ms: U64(deliver_by),
                settle_at_ms: U64(settle_at),
                resale_price: None,
                eph: None,
                wrapped: vec![],
                commits: vec![],
                disputes_lost: 0,
            },
        );
        self.own(&who, token_id);
        let seen_key = env::sha256_array(&[&id.to_le_bytes()[..], who.as_bytes()].concat());
        if self.seen.insert(seen_key) {
            t.buyers += 1;
        }
        t.sold += 1;
        t.liability = U128(liability);
        self.put_trader(t);
        self.obligations = checked_add(self.obligations, price);
        self.flush_all();
        let allowance = (nft::TOKEN_ALLOWANCE_BYTES + nft::TOKEN_ALLOWANCE_PER_EPOCH * (last_epoch - first_epoch + 1) as u64) as u128 * env::storage_byte_cost().as_yoctonear();
        require!(attached >= checked_add(price, allowance), "attach a little more, for storage");
        self.charge_storage(before, attached - price - allowance, &who);
        nft::emit_mint(&who, token_id);
        token_id
    }

    /// The trader hands over the window's cover nodes, wrapped to the holder's one-time key. The contract computes the cover itself and
    /// checks each node's commitment against the trader's root.
    #[payable]
    /// `buyer_pub` is the key these nodes were wrapped to: if the holder's key changed on the way, the delivery is refused, rather than becoming the trader's fault.
    pub fn deliver(&mut self, token_id: u64, buyer_pub: H32, eph: H32, wrapped: Vec<H32>, commits: Vec<H32>, proof: Vec<H32>) {
        let who = env::predecessor_account_id();
        let mut k = self.token(token_id);
        let t = self.trader(k.trader);
        require!(who == t.account, "only this window's trader can deliver");
        require!(matches!(t.status, TraderStatus::Active | TraderStatus::Unbonding { .. }), "this trader can't deliver");
        require!(k.state == TokenState::Pending, "this window isn't waiting for delivery");
        require!(k.buyer_pub.is_some(), "the holder hasn't registered a one-time key");
        require!(k.buyer_pub == Some(buyer_pub), "the holder's one-time key has changed: read it again");
        let now = self.now_ms();
        let start = self.epoch_start_ms(k.first_epoch);
        let earliest = start.saturating_sub(self.config.delivery_lead_secs as u64 * 1000);
        require!(now >= earliest, "too early: until the window is near, the token can still be resold");
        require!(now <= k.deliver_by_ms.0, "too late: the delivery deadline has passed");
        require!(!low_order(&eph.0), "that ephemeral key is a low-order point");
        let nodes = ggm::cover(k.first_slot, k.last_slot, DEPTH).len();
        require!(wrapped.len() == nodes && commits.len() == nodes, format!("this window's cover is {nodes} nodes"));
        let c: Vec<[u8; 32]> = commits.iter().map(|h| h.0).collect();
        let p: Vec<[u8; 32]> = proof.iter().map(|h| h.0).collect();
        require!(ggm::verify_cover::<types::NearHash>(&t.root.0, DEPTH, k.first_slot, k.last_slot, &c, &p), "these commitments don't match the root posted before the sale");
        let before = env::storage_usage();
        k.eph = Some(eph);
        k.wrapped = wrapped;
        k.commits = commits;
        k.state = TokenState::Delivered;
        k.resale_price = None;
        // Somebody can check these epochs now: not when the window was paid for.
        for e in k.first_epoch..=k.last_epoch {
            let mut rec = self.epoch_rec(k.trader, e);
            rec.covering_sales += 1;
            self.epochs.insert(Self::key(k.trader, e as u64), rec);
        }
        self.tokens.insert(token_id, k);
        self.tokens.flush();
        self.epochs.flush();
        self.charge_storage(before, env::attached_deposit().as_yoctonear(), &who);
    }

    /// The holder's refund when the trader never delivered: the whole escrow. The trader's penalty burns: it goes to nobody, so nobody can farm it.
    pub fn claim_undelivered(&mut self, token_id: u64) -> U128 {
        let who = env::predecessor_account_id();
        let k = self.token(token_id);
        require!(k.owner == who, "only the holder can claim");
        require!(k.state == TokenState::Pending, "this window was delivered or closed");
        require!(k.buyer_pub.is_some(), "register a one-time key first: the trader can't deliver to nobody");
        require!(self.now_ms() > k.deliver_by_ms.0, "the trader still has time to deliver");
        U128(self.refund_undelivered(k))
    }

    /// Anyone, after the challenge window. A healthy window: the escrow goes to the trader. A window that lost past the floor or lacks a figure: the escrow goes back to its holder, and
    /// a penalty burns from the bond. A window the trader never delivered goes back to its holder as well, so that nobody has to come back for it.
    pub fn settle(&mut self, token_id: u64) -> String {
        let mut k = self.token(token_id);
        let mut t = self.trader(k.trader);
        require!(!matches!(t.status, TraderStatus::Slashed { .. }), "this trader was slashed: the holder claims a refund instead");
        require!(self.now_ms() >= k.settle_at_ms.0, "the challenge window is still open");
        if k.state == TokenState::Pending && k.buyer_pub.is_some() {
            self.refund_undelivered(k);
            return "refunded".to_string();
        }
        let holder_absent = k.state == TokenState::Pending;
        require!(k.state == TokenState::Delivered || holder_absent, "this window can't be settled");
        let price = k.price.0;
        let breached = self.window_breached(&t, &k);
        t.liability = U128(checked_sub(t.liability.0, price));
        let payee = if breached {
            let penalty = self.penalty_of(price);
            self.burn(&mut t, penalty);
            k.owner.clone()
        } else {
            t.account.clone()
        };
        k.state = if breached { TokenState::Refunded } else { TokenState::Closed };
        self.put_trader(t);
        self.tokens.insert(token_id, k);
        self.move_to_credit(&payee, price);
        (if breached { "refunded" } else { "closed" }).to_string()
    }

    /// The holder of an open window on a slashed trader takes the escrow back, whole.
    pub fn claim_refund(&mut self, token_id: u64) -> U128 {
        let who = env::predecessor_account_id();
        let mut k = self.token(token_id);
        let mut t = self.trader(k.trader);
        require!(k.owner == who, "only the holder can claim");
        require!(matches!(t.status, TraderStatus::Slashed { .. }) && matches!(k.state, TokenState::Pending | TokenState::Delivered), "this window can't claim a refund");
        let price = k.price.0;
        t.liability = U128(checked_sub(t.liability.0, price));
        self.put_trader(t);
        k.state = TokenState::Refunded;
        self.tokens.insert(token_id, k);
        self.move_to_credit(&who, price);
        U128(price)
    }

    /// The holder of a token waiting for delivery registers a new one-time key, after a plain transfer.
    pub fn set_wrap_key(&mut self, token_id: u64, buyer_pub: H32) {
        let who = env::predecessor_account_id();
        let mut k = self.token(token_id);
        require!(k.owner == who, "only the holder can set the key");
        require!(k.state == TokenState::Pending, "keys were already delivered");
        require!(k.buyer_pub.is_none(), "a key is already registered: one purchase, one key");
        require!(!low_order(&buyer_pub.0), "that one-time key is a low-order point");
        let now = self.now_ms();
        let earliest = self.epoch_start_ms(k.first_epoch).saturating_sub(self.config.delivery_lead_secs as u64 * 1000);
        // The trader gets the full delivery grace from when he could first act.
        k.buyer_pub = Some(buyer_pub);
        k.deliver_by_ms = U64(k.deliver_by_ms.0.max(earliest.max(now) + self.config.delivery_grace_secs as u64 * 1000));
        k.settle_at_ms = U64(k.settle_at_ms.0.max(k.deliver_by_ms.0 + self.config.challenge_secs as u64 * 1000));
        self.tokens.insert(token_id, k);
    }

    /// Offer a token nobody has keys for yet, at a price. The buyer's `buy_resale` pays the holder and replaces the one-time key.
    pub fn list_resale(&mut self, token_id: u64, price: Option<U128>) {
        let who = env::predecessor_account_id();
        let mut k = self.token(token_id);
        require!(k.owner == who, "only the holder can list");
        require!(k.state == TokenState::Pending, "keys were already delivered: this window can't be resold");
        require!(self.resale_open(&k), "delivery can begin now: this window can't be resold");
        k.resale_price = price;
        self.tokens.insert(token_id, k);
    }

    #[payable]
    pub fn buy_resale(&mut self, token_id: u64, buyer_pub: H32) -> U128 {
        let who = env::predecessor_account_id();
        let mut k = self.token(token_id);
        require!(k.state == TokenState::Pending, "keys were already delivered: this window can't be resold");
        require!(self.resale_open(&k), "delivery can begin now: this window can't be resold");
        let ask = k.resale_price.unwrap_or_else(|| env::panic_str("this token isn't for sale")).0;
        require!(who != k.owner, "you already hold it");
        require!(!low_order(&buyer_pub.0), "that one-time key is a low-order point");
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= ask, format!("the ask is {ask}"));
        let before = env::storage_usage();
        let seller = k.owner.clone();
        self.disown(&seller, token_id);
        self.own(&who, token_id);
        k.owner = who.clone();
        // The old holder's key dies here: a dispute checks the revealed secret against this one, and only this one.
        k.buyer_pub = Some(buyer_pub);
        k.resale_price = None;
        self.tokens.insert(token_id, k);
        self.credit(&seller, ask);
        self.flush_all();
        self.charge_storage(before, attached - ask, &who);
        nft::nep171_transfer(&seller, &who, token_id);
        U128(ask)
    }
}

impl Keyhole {
    /// A token moves only before delivery can begin. A trader who has read the holder's key must be able to rely on it, or a resale could turn his honest wrap into a slash.
    pub(crate) fn resale_open(&self, k: &WindowToken) -> bool {
        self.now_ms() < self.epoch_start_ms(k.first_epoch).saturating_sub(self.config.delivery_lead_secs as u64 * 1000)
    }

    /// A refund insures a window against what's still unknown. A window already known to be bad would be free reading: buy it, read it, claim back the price.
    fn refuse_known_bad(&self, t: &Trader, first_epoch: u32, last_epoch: u32) {
        let now = self.now_ms();
        let mut total: i128 = 0;
        let mut complete = true;
        for e in first_epoch..=last_epoch {
            let rec = self.epoch_rec(t.id, e);
            match rec.posted_e6 {
                Some(p) => total = total.saturating_add(p.0),
                None => {
                    require!(now <= self.epoch_start_ms(e + 1) + self.config.post_grace_secs as u64 * 1000, "that window has an epoch with no figure, so its refund is already owed: it isn't for sale");
                    complete = false;
                }
            }
        }
        let floor = (t.book_usd_e6.0 as i128).saturating_mul(t.floor_bps as i128) / 10_000;
        require!(!complete || total >= -floor, "that window is already past its floor, so its refund is already owed: it isn't for sale");
    }

    fn penalty_of(&self, price: u128) -> u128 {
        keyhole_core::mul_div(price, self.config.penalty_bps as u128, 10_000).unwrap_or_else(|| env::panic_str("amount overflow"))
    }

    fn refund_undelivered(&mut self, mut k: WindowToken) -> u128 {
        let mut t = self.trader(k.trader);
        let price = k.price.0;
        let penalty = self.penalty_of(price);
        self.burn(&mut t, penalty);
        t.liability = U128(checked_sub(t.liability.0, price));
        t.late_deliveries = t.late_deliveries.saturating_add(1);
        // A refusal can hide a false figure, since only a holder of the keys can prove one: it goes on the record of every epoch it covers.
        for e in k.first_epoch..=k.last_epoch {
            let mut rec = self.epoch_rec(k.trader, e);
            if rec.refused_sales == 0 {
                t.refused_epochs = t.refused_epochs.saturating_add(1);
            }
            rec.refused_sales = rec.refused_sales.saturating_add(1);
            self.epochs.insert(Self::key(k.trader, e as u64), rec);
        }
        self.put_trader(t);
        let (id, owner) = (k.id, k.owner.clone());
        k.state = TokenState::Refunded;
        self.tokens.insert(id, k);
        self.move_to_credit(&owner, price);
        price
    }

    pub(crate) fn token(&self, id: u64) -> WindowToken {
        self.tokens.get(&id).cloned().unwrap_or_else(|| env::panic_str("no such window token"))
    }

    pub(crate) fn flush_all(&mut self) {
        self.tokens.flush();
        self.owned.flush();
        self.epochs.flush();
        self.traders.flush();
        self.credits.flush();
    }

    pub(crate) fn own(&mut self, who: &AccountId, id: u64) {
        let mut v = self.owned.get(who).cloned().unwrap_or_default();
        v.push(id);
        self.owned.insert(who.clone(), v);
    }

    pub(crate) fn disown(&mut self, who: &AccountId, id: u64) {
        let empty = match self.owned.get_mut(who) {
            Some(v) => {
                v.retain(|x| *x != id);
                v.is_empty()
            }
            None => false,
        };
        // No empty lists left behind: a token moving from hand to hand can't grow the state without bound.
        if empty {
            self.owned.remove(who);
        }
    }

    fn price_of(&self, t: &Trader, first_epoch: u32, last_epoch: u32) -> u128 {
        require!(first_epoch <= last_epoch, "the window is backwards");
        let per_epoch = checked_add(t.base_price.0, checked_mul(t.slope.0, t.sold as u128));
        checked_mul(per_epoch, (last_epoch - first_epoch + 1) as u128)
    }

    /// Did this window lose past the floor, or lack a figure?
    pub(crate) fn window_breached(&self, t: &Trader, k: &WindowToken) -> bool {
        let mut total: i128 = 0;
        for e in k.first_epoch..=k.last_epoch {
            let rec = self.epoch_rec(k.trader, e);
            match rec.posted_e6 {
                None => return true,
                Some(p) => {
                    let figure = match rec.verdict {
                        EpochVerdict::False { recomputed_e6 } => recomputed_e6.0,
                        EpochVerdict::Unchallenged => p.0,
                    };
                    total = total.saturating_add(figure);
                }
            }
        }
        let floor = (t.book_usd_e6.0 as i128).saturating_mul(t.floor_bps as i128) / 10_000;
        total < -floor
    }
}
