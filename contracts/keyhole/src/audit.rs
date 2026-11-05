//! The fraud proof for a posted figure. Whoever holds an epoch's entry keys opens them in the contract, in order, in as many
//! transactions as it takes; the contract recomputes the figure from oracle prices with the same code the trader's tool uses
//! (`keyhole_core::pnl`). A difference of one unit slashes. A right figure costs the auditor the deposit, which goes to the trader.
use crate::dispute::Verdict;
use crate::types::checked_add;
use crate::*;
use keyhole_core::entry;
use keyhole_core::pnl::{pnl_e6, Book, MAX_FEEDS};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Audit {
    pub id: u64,
    pub auditor: AccountId,
    pub trader: u32,
    pub epoch: u32,
    pub first_seq: U64,
    pub next_seq: U64,
    pub end_seq: U64,
    pub positions: [i64; MAX_FEEDS],
    pub cash_e16: I128,
    pub applied: u32,
    pub void: u32,
    pub deposit: U128,
}

/// One opened entry: its key, and the index of the round that prices it (the contract checks that this is the right round).
#[near(serializers = [json])]
pub struct Opening {
    pub key: H32,
    pub price_index: u32,
}

#[near]
impl Keyhole {
    /// Start auditing a posted epoch: attach the audit bond and storage.
    #[payable]
    pub fn audit_open(&mut self, trader: AccountId, epoch: u32) -> u64 {
        let who = env::predecessor_account_id();
        let id = self.tid(&trader);
        let t = self.trader(id);
        require!(!matches!(t.status, TraderStatus::Slashed { .. }), "this trader was already slashed");
        let rec = self.epoch_rec(id, epoch);
        require!(rec.posted_e6.is_some(), "that epoch has no figure to audit");
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= self.config.audit_bond.0, "attach the audit bond");
        let before = env::storage_usage();
        let audit = self.next_audit;
        self.next_audit += 1;
        let deposit = self.config.audit_bond.0;
        self.audits.insert(
            audit,
            Audit {
                id: audit,
                auditor: who.clone(),
                trader: id,
                epoch,
                first_seq: rec.first_seq,
                next_seq: rec.first_seq,
                end_seq: U64(rec.first_seq.0 + rec.entries as u64),
                positions: [0; MAX_FEEDS],
                cash_e16: I128(0),
                applied: 0,
                void: 0,
                deposit: U128(deposit),
            },
        );
        self.obligations = checked_add(self.obligations, deposit);
        self.audits.flush();
        self.charge_storage(before, attached - deposit, &who);
        audit
    }

    /// Open the next entries, in order. A key that doesn't match an entry's tag refuses the whole step: nothing is recorded, nothing
    /// is lost, and `dispute_entry` is the proof for a journal that really doesn't open.
    pub fn audit_step(&mut self, audit: u64, openings: Vec<Opening>) -> U64 {
        let who = env::predecessor_account_id();
        let mut a = self.audits.get(&audit).cloned().unwrap_or_else(|| env::panic_str("no such audit"));
        require!(a.auditor == who, "this is someone else's audit");
        let t = self.trader(a.trader);
        let mut book = Book { positions: a.positions, cash_e16: a.cash_e16.0, applied: a.applied, void: a.void };
        for o in openings {
            require!(a.next_seq.0 < a.end_seq.0, "every entry of this epoch is already open");
            let e = self.entries.get(&Self::key(a.trader, a.next_seq.0)).cloned().unwrap_or_else(|| env::panic_str("no such entry"));
            let opened = entry::open::<types::NearHash>(&o.key.0, a.next_seq.0, e.slot, &e.ct.0, &e.tag.0)
                .unwrap_or_else(|| env::panic_str(&format!("entry {}: that key doesn't open it", a.next_seq.0)));
            match opened {
                Some(trade) if (trade.feed as usize) < self.feeds.len() => {
                    match self.price_at(trade.feed, e.at_ms.0, o.price_index) {
                        Some(price) => {
                            book.apply(trade.feed as usize, trade.qty_e8, price, self.feeds.len(), t.book_usd_e6.0 as i128);
                        }
                        None => book.void = book.void.saturating_add(1),
                    }
                }
                _ => book.void = book.void.saturating_add(1),
            }
            a.next_seq = U64(a.next_seq.0 + 1);
        }
        a.positions = book.positions;
        a.cash_e16 = I128(book.cash_e16);
        a.applied = book.applied;
        a.void = book.void;
        let next = a.next_seq;
        self.audits.insert(audit, a);
        next
    }

    /// Give up on an audit that can't finish. Once the trader is slashed, for any reason, the deposit comes back whole. Otherwise half of it goes to the trader, so that leaving keys
    /// on the chain and walking away isn't free. A holder stuck on an entry nobody can open has a proof that pays better: `dispute_entry`.
    pub fn audit_cancel(&mut self, audit: u64) -> U128 {
        let who = env::predecessor_account_id();
        let a = self.audits.get(&audit).cloned().unwrap_or_else(|| env::panic_str("no such audit"));
        require!(a.auditor == who, "this is someone else's audit");
        self.audits.remove(&audit);
        let t = self.trader(a.trader);
        let back = if matches!(t.status, TraderStatus::Slashed { .. }) { a.deposit.0 } else { a.deposit.0 / 2 };
        self.move_to_credit(&who, back);
        self.move_to_credit(&t.account, a.deposit.0 - back);
        U128(back)
    }

    /// Every entry is open: mark what's left at the first round at or after the epoch's end, and compare. `mark_indices` has one element
    /// per feed: the index of that round, or nothing for a feed with no position.
    pub fn audit_conclude(&mut self, audit: u64, mark_indices: Vec<Option<u32>>) -> Verdict {
        let who = env::predecessor_account_id();
        let a = self.audits.get(&audit).cloned().unwrap_or_else(|| env::panic_str("no such audit"));
        require!(a.auditor == who, "this is someone else's audit");
        require!(a.next_seq.0 == a.end_seq.0, "open every entry first");
        let mut t = self.trader(a.trader);
        let end = self.epoch_start_ms(a.epoch + 1);
        let mut marks: [Option<i64>; MAX_FEEDS] = [None; MAX_FEEDS];
        for f in 0..MAX_FEEDS {
            if a.positions[f] != 0 {
                let hint = mark_indices.get(f).copied().flatten().unwrap_or_else(|| env::panic_str("a held position needs its mark"));
                marks[f] = Some(self.mark_at(f as u8, end, hint));
            }
        }
        let book = Book { positions: a.positions, cash_e16: a.cash_e16.0, applied: a.applied, void: a.void };
        let total = book.marked_e16(&marks).unwrap_or_else(|| env::panic_str("the marks overflowed"));
        let recomputed = pnl_e6(total);
        let mut rec = self.epoch_rec(a.trader, a.epoch);
        let posted = rec.posted_e6.expect("audited epochs are posted").0;
        self.audits.remove(&audit);
        if recomputed != posted {
            let detail = format!("epoch {}: posted {posted}, recomputed {recomputed}", a.epoch);
            // Two audits can be open at once: only the first to finish corrects the running total.
            if rec.verdict == EpochVerdict::Unchallenged {
                t.cum_pnl_e6 = I128(t.cum_pnl_e6.0.saturating_sub(posted).saturating_add(recomputed));
                if rec.refused_sales > 0 {
                    t.voided_e6 = I128(t.voided_e6.0.saturating_sub(posted.max(0)).saturating_add(recomputed.max(0)));
                }
            }
            rec.verdict = EpochVerdict::False { recomputed_e6: I128(recomputed) };
            self.epochs.insert(Self::key(a.trader, a.epoch as u64), rec);
            let slashed = self.slash(&mut t, &detail, &who);
            self.put_trader(t);
            self.move_to_credit(&who, a.deposit.0);
            near_sdk::log!("slashed: {detail}");
            Verdict { trader_at_fault: true, detail, slashed_to_prover: U128(slashed), refunded: a.deposit, deposit_lost: U128(0) }
        } else {
            rec.audits_passed = rec.audits_passed.saturating_add(1);
            self.epochs.insert(Self::key(a.trader, a.epoch as u64), rec);
            let account = t.account.clone();
            self.move_to_credit(&account, a.deposit.0);
            let detail = format!("epoch {}: the posted figure {posted} is right", a.epoch);
            near_sdk::log!("dismissed: {detail}");
            Verdict { trader_at_fault: false, detail, slashed_to_prover: U128(0), refunded: U128(0), deposit_lost: a.deposit }
        }
    }
}
