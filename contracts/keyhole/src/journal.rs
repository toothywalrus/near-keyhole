//! Registration, the bond, the numbered hash chain of entries and the epoch figures.
//!
//! The rules that matter: an entry can only be written into the current slot (tolerance: within the same epoch and one slot back),
//! with the next number. A loser can't be deleted, because every number is on the chain, and it can't be backdated, because the slot is
//! checked against the block's clock. `at_ms` is the block's time, not the trader's word.
use crate::types::checked_add;
use crate::*;
use keyhole_core::entry::PLAINTEXT_LEN;

#[near]
impl Keyhole {
    /// Become a trader: post a bond and the root of a key tree. The curve, the book and the floor can't be changed afterwards.
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn register_trader(&mut self, handle: String, root: H32, book_usd_e6: U128, floor_bps: u32, base_price: U128, slope: U128) -> u32 {
        let who = env::predecessor_account_id();
        require!(self.trader_ids.get(&who).is_none(), "already registered");
        require!(!handle.is_empty() && handle.len() <= MAX_HANDLE, "a handle is 1 to 32 bytes");
        require!(book_usd_e6.0 > 0 && book_usd_e6.0 <= 1_000_000_000_000_000, "a book is between $0 and $1B");
        require!(floor_bps > 0 && floor_bps <= 10_000, "floor_bps is in (0, 10000]");
        require!(base_price.0 > 0, "a window can't be free");
        let before = env::storage_usage();
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= self.config.min_bond.0, "attach at least the minimum bond");
        let id = self.traders.len();
        let now = self.now_ms();
        let first_epoch = self.epoch_of_slot(self.current_slot());
        self.trader_ids.insert(who.clone(), id);
        self.traders.push(Trader {
            id,
            account: who.clone(),
            handle,
            root,
            registered_ms: U64(now),
            first_epoch,
            status: TraderStatus::Active,
            bond: U128(0),
            liability: U128(0),
            book_usd_e6,
            floor_bps,
            base_price,
            slope,
            next_seq: U64(0),
            head: H32([0u8; 32]),
            next_epoch: first_epoch,
            posted_epochs: 0,
            missed_epochs: 0,
            cum_pnl_e6: I128(0),
            sold: 0,
            buyers: 0,
            late_deliveries: 0,
            burned: U128(0),
            last_post_ms: U64(now),
        });
        // Whatever isn't needed for storage becomes the bond.
        self.trader_ids.flush();
        self.traders.flush();
        let cost = (env::storage_usage().saturating_sub(before) as u128) * env::storage_byte_cost().as_yoctonear();
        require!(attached >= cost, "attach more for storage");
        let bond = attached - cost;
        require!(bond >= self.config.min_bond.0, format!("the bond would be {bond} after {cost} of storage, below the minimum"));
        let mut t = self.trader(id);
        t.bond = U128(bond);
        self.put_trader(t);
        self.obligations = checked_add(self.obligations, bond);
        id
    }

    #[payable]
    pub fn add_bond(&mut self) {
        let id = self.tid(&env::predecessor_account_id());
        let mut t = self.trader(id);
        require!(t.status == TraderStatus::Active, "only an active trader can add to the bond");
        let amount = env::attached_deposit().as_yoctonear();
        t.bond = U128(checked_add(t.bond.0, amount));
        self.obligations = checked_add(self.obligations, amount);
        self.put_trader(t);
    }

    /// Stop selling. The bond stays at risk for `unbond_secs`, and until every sold window is closed.
    pub fn begin_unbond(&mut self) {
        let id = self.tid(&env::predecessor_account_id());
        let mut t = self.trader(id);
        require!(t.status == TraderStatus::Active, "only an active trader can unbond");
        t.status = TraderStatus::Unbonding { since_ms: U64(self.now_ms()) };
        self.put_trader(t);
    }

    pub fn withdraw_bond(&mut self) -> U128 {
        let who = env::predecessor_account_id();
        let id = self.tid(&who);
        let mut t = self.trader(id);
        match t.status {
            TraderStatus::Unbonding { since_ms } => {
                require!(self.now_ms() >= since_ms.0 + self.config.unbond_secs as u64 * 1000, "the bond is still at risk: the unbonding delay hasn't passed");
            }
            _ => env::panic_str("begin unbonding first"),
        }
        require!(self.now_ms() >= t.last_post_ms.0 + self.config.unbond_secs as u64 * 1000, "the bond is still at risk: the last figure hasn't had its time to be audited");
        require!(t.liability.0 == 0, "sold windows are still open against this bond");
        let amount = t.bond.0;
        t.bond = U128(0);
        t.status = TraderStatus::Exited;
        self.put_trader(t);
        self.move_to_credit(&who, amount);
        U128(amount)
    }

    /// Write the next entry of the caller's journal.
    #[payable]
    pub fn commit_entry(&mut self, seq: U64, slot: u32, ct: HexBytes, tag: H32) -> H32 {
        let who = env::predecessor_account_id();
        let id = self.tid(&who);
        let mut t = self.trader(id);
        require!(matches!(t.status, TraderStatus::Active | TraderStatus::Unbonding { .. }), "this journal is closed");
        require!(seq.0 == t.next_seq.0, format!("entries are numbered with no gaps: the next is {}", t.next_seq.0));
        require!(ct.0.len() == PLAINTEXT_LEN, "an entry is exactly 128 bytes");
        let current = self.current_slot();
        let slot64 = slot as u64;
        require!(slot64 <= current && slot64 + 1 >= current, format!("no backdating: this entry claims slot {slot}, and the clock says slot {current}"));
        require!(current < 1u64 << DEPTH, "this journal's tree is used up");
        let epoch = self.epoch_of_slot(slot64);
        require!(epoch == self.epoch_of_slot(current), "that slot's epoch is over");
        let before = env::storage_usage();
        let at = self.now_ms();
        let head = env::sha256_array(
            &[&b"keyhole/chain/v1"[..], &t.head.0, &seq.0.to_le_bytes(), &slot.to_le_bytes(), &at.to_le_bytes(), &ct.0, &tag.0].concat(),
        );
        let last_slot = if seq.0 == 0 { 0 } else { self.entries.get(&Self::key(id, seq.0 - 1)).map(|e| e.slot).unwrap_or(0) };
        require!(slot >= last_slot, "slots only go forward");
        self.entries.insert(Self::key(id, seq.0), EntryRec { seq, slot, at_ms: U64(at), ct, tag, head: H32(head) });
        let mut rec = self.epoch_rec(id, epoch);
        if rec.entries == 0 {
            rec.first_seq = seq;
        }
        rec.entries = rec.entries.checked_add(1).unwrap_or_else(|| env::panic_str("too many entries in an epoch"));
        self.epochs.insert(Self::key(id, epoch as u64), rec);
        t.next_seq = U64(seq.0 + 1);
        t.head = H32(head);
        self.put_trader(t);
        self.entries.flush();
        self.epochs.flush();
        self.traders.flush();
        self.charge_storage(before, env::attached_deposit().as_yoctonear(), &who);
        H32(head)
    }

    /// Post an ended epoch's figure. Epochs passed over are missed for good.
    #[payable]
    pub fn post_epoch(&mut self, epoch: u32, pnl_e6: I128) {
        let who = env::predecessor_account_id();
        let id = self.tid(&who);
        let mut t = self.trader(id);
        require!(matches!(t.status, TraderStatus::Active | TraderStatus::Unbonding { .. }), "this journal is closed");
        require!(epoch >= t.next_epoch, "that epoch is already posted, or passed over");
        let now = self.now_ms();
        let ended = self.epoch_start_ms(epoch + 1);
        require!(now >= ended, "that epoch hasn't ended");
        require!(now <= ended + self.config.post_grace_secs as u64 * 1000, "too late: that epoch's posting grace is over");
        let before = env::storage_usage();
        let mut rec = self.epoch_rec(id, epoch);
        rec.posted_e6 = Some(pnl_e6);
        rec.posted_ms = Some(U64(now));
        self.epochs.insert(Self::key(id, epoch as u64), rec);
        t.missed_epochs = t.missed_epochs.saturating_add(epoch - t.next_epoch);
        t.next_epoch = epoch + 1;
        t.posted_epochs += 1;
        t.last_post_ms = U64(now);
        t.cum_pnl_e6 = I128(t.cum_pnl_e6.0.checked_add(pnl_e6.0).unwrap_or_else(|| env::panic_str("PnL overflow")));
        self.put_trader(t);
        self.epochs.flush();
        self.traders.flush();
        self.charge_storage(before, env::attached_deposit().as_yoctonear(), &who);
    }
}
