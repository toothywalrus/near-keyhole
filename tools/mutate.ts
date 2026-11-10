// Mutation check: break one security-critical line of the contract, rebuild, and show that the attack suite notices. Every mutant must be caught.
//   npm run mutate            all of them (needs Rust and cargo-near; about 10 s each)
//   npm run mutate -- --quick the first 8
// It works on a temporary copy of contracts/ with a target directory of its own, so neither the repo nor anyone's build cache can pick up a mutant.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type M = { name: string; file: string; from: string; to: string };
const K = "keyhole/src/";
const MUTANTS: M[] = [
  { name: "dispute_wrap accepts a secret that isn't the buyer's key", file: `${K}dispute.rs`, from: `require!(PublicKey::from(&secret).as_bytes() == &buyer_pub.0, "that secret isn't this token's one-time key");`, to: "" },
  { name: "dispute_wrap slashes when the node matches, not when it doesn't", file: `${K}dispute.rs`, from: `self.rule(token_id, who, !matches, if matches`, to: `self.rule(token_id, who, matches, if matches` },
  { name: "deliver doesn't check commitments against the root", file: `${K}sale.rs`, from: `require!(ggm::verify_cover::<types::NearHash>(&t.root.0, DEPTH, k.first_slot, k.last_slot, &c, &p), "these commitments don't match the root posted before the sale");`, to: "let _ = (&c, &p);" },
  { name: "commit_entry doesn't check the slot against the clock", file: `${K}journal.rs`, from: `require!(slot64 <= current && slot64 + 1 >= current, format!("no backdating: this entry claims slot {slot}, and the clock says slot {current}"));`, to: "" },
  { name: "commit_entry takes any number", file: `${K}journal.rs`, from: `require!(seq.0 == t.next_seq.0, format!("entries are numbered with no gaps: the next is {}", t.next_seq.0));`, to: "" },
  { name: "the audit accepts a figure one unit off", file: `${K}audit.rs`, from: `if recomputed != posted {`, to: `if (recomputed - posted).abs() > 1 {` },
  { name: "a price hint needn't be the first round after the trade", file: `${K}oracle.rs`, from: `require!(prev.t_ms.0 < at_ms, "wrong price hint: an earlier round also follows the trade");`, to: "" },
  { name: "withdraw doesn't clear the credit", file: `${K}lib.rs`, from: `let amount = self.credits.remove(&who).unwrap_or(0);`, to: `let amount = self.credits.get(&who).copied().unwrap_or(0);` },

  { name: "commit_entry lets an entry into an epoch that's over", file: `${K}journal.rs`, from: `require!(epoch == self.epoch_of_slot(current), "that slot's epoch is over");`, to: "" },
  { name: "post_epoch takes a figure before the epoch ends", file: `${K}journal.rs`, from: `require!(now >= ended, "that epoch hasn't ended");`, to: "" },
  { name: "post_epoch takes a figure after the grace", file: `${K}journal.rs`, from: `require!(now <= ended + self.config.post_grace_secs as u64 * 1000, "too late: that epoch's posting grace is over");`, to: "" },
  { name: "buy_window takes a low-order one-time key", file: `${K}sale.rs`, from: `require!(!low_order(&buyer_pub.0), "that one-time key is a low-order point");\n        self.refuse_known_bad`, to: `self.refuse_known_bad` },
  { name: "deliver takes a low-order ephemeral key", file: `${K}sale.rs`, from: `require!(!low_order(&eph.0), "that ephemeral key is a low-order point");`, to: "" },
  { name: "anyone can deliver", file: `${K}sale.rs`, from: `require!(who == t.account, "only this window's trader can deliver");`, to: "" },
  { name: "delivery before the window is near is allowed", file: `${K}sale.rs`, from: `require!(now >= earliest, "too early: until the window is near, the token can still be resold");`, to: "" },
  { name: "delivery after the deadline is allowed", file: `${K}sale.rs`, from: `require!(now <= k.deliver_by_ms.0, "too late: the delivery deadline has passed");`, to: "" },
  { name: "a bond needn't cover a sale", file: `${K}sale.rs`, from: `require!(covered, "this trader's bond doesn't cover another sale");`, to: "let _ = covered;" },
  { name: "a settled window's escrow can be taken twice", file: `${K}sale.rs`, from: `k.state = if breached { TokenState::Refunded } else { TokenState::Closed };`, to: `` },
  { name: "settle before the challenge window ends", file: `${K}sale.rs`, from: `require!(self.now_ms() >= k.settle_at_ms.0, "the challenge window is still open");`, to: "" },
  { name: "anyone can claim someone's refund", file: `${K}sale.rs`, from: `require!(k.owner == who, "only the holder can claim");\n        require!(matches!(t.status`, to: `require!(matches!(t.status` },
  { name: "a refused delivery pays its penalty to the holder instead of burning it", file: `${K}sale.rs`, from: `self.move_to_credit(&owner, price);\n        price`, to: `self.obligations = checked_add(self.obligations, penalty);\n        self.move_to_credit(&owner, price + penalty);\n        price` },
  { name: "a breached window still pays the trader", file: `${K}sale.rs`, from: `let payee = if breached { k.owner.clone() } else { t.account.clone() };`, to: `let payee = t.account.clone();` },
  { name: "a missing figure burns nothing", file: `${K}sale.rs`, from: `if breach == Breach::MissingFigure {`, to: `if breach == Breach::MissingFigure && false {` },
  { name: "an honest loss past the floor burns the bond", file: `${K}sale.rs`, from: `if breach == Breach::MissingFigure {`, to: `if breach != Breach::None {` },
  { name: "a refused epoch's figure still counts", file: `${K}views.rs`, from: `I128(t.cum_pnl_e6.0.saturating_sub(t.voided_e6.0).saturating_sub(`, to: `I128(t.cum_pnl_e6.0.saturating_sub(` },
  { name: "a figure posted after a refusal still counts", file: `${K}journal.rs`, from: `t.voided_e6 = I128(t.voided_e6.0.saturating_add(pnl_e6.0.max(0)));`, to: "" },
  { name: "a trader below the minimum bond keeps selling", file: `${K}sale.rs`, from: `require!(t.bond.0 >= self.config.min_bond.0, "this trader's bond is below the minimum, so he isn't selling");`, to: "" },
  { name: "a paid window counts as checkable before any keys exist", file: `${K}sale.rs`, from: `self.own(&who, token_id);\n        let seen_key`, to: `self.own(&who, token_id);\n        for e in first_epoch..=last_epoch { let mut rec = self.epoch_rec(id, e); rec.covering_sales += 1; self.epochs.insert(Self::key(id, e as u64), rec); }\n        let seen_key` },
  { name: "a refusal leaves no mark on its epochs", file: `${K}sale.rs`, from: `rec.refused_sales = rec.refused_sales.saturating_add(1);`, to: "" },
  { name: "dispute_entry ends at settlement", file: `${K}dispute.rs`, from: `require!(k.eph.is_some(), "only a delivered window can be disputed");`, to: `require!(k.state == TokenState::Delivered, "only a delivered window can be disputed");` },
  { name: "cancelling an audit returns the whole deposit", file: `${K}audit.rs`, from: `{ a.deposit.0 } else { a.deposit.0 / 2 };`, to: `{ a.deposit.0 } else { a.deposit.0 };` },
  { name: "anyone can cancel someone's audit", file: `${K}audit.rs`, from: `require!(a.auditor == who, "this is someone else's audit");\n        self.audits.remove(&audit);`, to: `self.audits.remove(&audit);` },
  { name: "a missed epoch costs nothing on the record", file: `${K}views.rs`, from: `I128(t.cum_pnl_e6.0.saturating_sub(t.voided_e6.0).saturating_sub(charge.saturating_mul(missed as i128 + t.refused_epochs as i128)))`, to: `I128(t.cum_pnl_e6.0.saturating_sub(t.voided_e6.0))` },
  { name: "silence after the last figure isn't counted", file: `${K}views.rs`, from: `missed = missed.saturating_add(past_grace.saturating_sub(t.next_epoch));`, to: `let _ = past_grace;` },
  { name: "a refused window costs nothing on the record", file: `${K}sale.rs`, from: `t.refused_epochs = t.refused_epochs.saturating_add(1);`, to: "" },
  { name: "every refused window burns again, however often its epochs were refused", file: `${K}sale.rs`, from: `let penalty = keyhole_core::mul_div(self.penalty_of(price), newly_refused, epochs).unwrap_or_else(|| env::panic_str("amount overflow"));`, to: `let penalty = self.penalty_of(price); let _ = (newly_refused, epochs);` },
  { name: "a past window gets the short grace", file: `${K}sale.rs`, from: `let deliver_by = if now >= end {`, to: `let deliver_by = if false {` },
  { name: "a paused trader keeps selling", file: `${K}sale.rs`, from: `require!(!t.paused, "this trader has paused his sales");`, to: "" },
  { name: "a refused loss is voided, laundering it", file: `${K}sale.rs`, from: `t.voided_e6 = I128(t.voided_e6.0.saturating_add(figure.max(0)));`, to: `t.voided_e6 = I128(t.voided_e6.0.saturating_add(figure));` },
  { name: "a near-free price is allowed", file: `${K}journal.rs`, from: `require!(base_price.0 >= self.config.min_price.0 && base_price.0 > 0, "the price per epoch is below the minimum");`, to: `require!(base_price.0 > 0, "the price per epoch is below the minimum");` },
  { name: "a loss known at purchase makes the window refundable", file: `${K}sale.rs`, from: `if k.known_mask & (1 << i) != 0 {\n                continue;\n            }`, to: "" },
  { name: "a grace shorter than an oracle outage is allowed", file: `${K}lib.rs`, from: `require!(config.post_grace_secs as u64 > 2 * config.max_round_gap_secs as u64 + config.price_delay_secs as u64, "the posting grace must outlast twice the round gap and the price delay");`, to: "" },
  { name: "the posting grace needn't outlast the price delay", file: `${K}lib.rs`, from: `> 2 * config.max_round_gap_secs as u64 + config.price_delay_secs as u64, "the posting grace`, to: `> 2 * config.max_round_gap_secs as u64, "the posting grace` },
  { name: "a trade is priced at a round inside the price delay", file: `${K}oracle.rs`, from: `let at_ms = at_ms.saturating_add(self.config.price_delay_secs as u64 * 1000);`, to: "" },
  { name: "a window may be longer than its mask of known epochs", file: `${K}lib.rs`, from: `require!(config.max_window_epochs >= 1 && config.max_window_epochs <= 32, "max_window_epochs is 1 to 32");`, to: "" },
  { name: "a window on a slashed trader can still be bought from its holder", file: `${K}sale.rs`, from: `require!(!matches!(self.trader(k.trader).status, TraderStatus::Slashed { .. }), "this trader was slashed: the window can only be refunded to its holder");\n        let ask`, to: `let ask` },
  { name: "a window on a slashed trader can still be listed", file: `${K}sale.rs`, from: `require!(!matches!(self.trader(k.trader).status, TraderStatus::Slashed { .. }), "this trader was slashed: the window can only be refunded to its holder");\n        k.resale_price = price;`, to: `k.resale_price = price;` },
  { name: "a local run replaces an enclave's figure", file: `${K}attest.rs`, from: `require!(rank(&kind) >= rank(&old.kind), "this epoch already carries a figure from a stronger source");`, to: "let _ = old;" },
  { name: "a stand-in earns the enclave's label", file: `${K}attest.rs`, from: `let kind = if matches!(o.contract.as_str(), "outlayer.testnet" | "outlayer.near") { AttestKind::OutLayerTee } else { AttestKind::OutLayerStandIn };`, to: `let kind = AttestKind::OutLayerTee;` },
  { name: "the floor never triggers", file: `${K}sale.rs`, from: `total < -floor`, to: `total < -floor && false` },
  { name: "a missing figure doesn't count as a breach", file: `${K}sale.rs`, from: `None => return Breach::MissingFigure,`, to: `None => {}` },
  { name: "buy_resale keeps the old holder's key", file: `${K}sale.rs`, from: `k.buyer_pub = Some(buyer_pub);\n        k.resale_price = None;`, to: `let _ = buyer_pub;\n        k.resale_price = None;` },
  { name: "a delivered token can be transferred", file: `${K}nft.rs`, from: `require!(k.state == TokenState::Pending, "keys were already delivered: this window can't be resold");\n        require!(self.resale_open(&k), "delivery can begin now: this window can't be resold");\n        let prev`, to: `let prev` },
  { name: "anyone can transfer a token", file: `${K}nft.rs`, from: `require!(&k.owner == sender, "only the holder can transfer it");`, to: "" },
  { name: "a transfer keeps the old one-time key", file: `${K}nft.rs`, from: `// The old holder's one-time key dies with the transfer.\n        k.buyer_pub = None;`, to: "" },
  { name: "anyone can dispute", file: `${K}dispute.rs`, from: `require!(&k.owner == who, "only the holder can dispute");`, to: "" },
  { name: "a dispute needs no deposit", file: `${K}dispute.rs`, from: `require!(env::attached_deposit().as_yoctonear() >= k.price.0.max(self.config.min_dispute.0), "a dispute's deposit is at least the window's price");`, to: "" },
  { name: "dispute_wrap needs no deposit", file: `${K}dispute.rs`, from: `require!(self.now_ms() < k.settle_at_ms.0, "the challenge window is over");\n        require!(env::attached_deposit().as_yoctonear() >= k.price.0.max(self.config.min_dispute.0), "a dispute's deposit is at least the window's price");`, to: `require!(self.now_ms() < k.settle_at_ms.0, "the challenge window is over");` },
  { name: "anyone can dispute a wrap", file: `${K}dispute.rs`, from: `let k = self.token(token_id);\n        require!(&k.owner == who, "only the holder can dispute");`, to: `let k = self.token(token_id);` },
  { name: "disputes never end", file: `${K}dispute.rs`, from: `require!(self.now_ms() < k.settle_at_ms.0, "the challenge window is over");`, to: "" },
  { name: "dispute_entry takes any node", file: `${K}dispute.rs`, from: `require!(ggm::commit::<types::NearHash>(&node.0) == commit.0, "that isn't the node delivered: its commitment differs");`, to: "let _ = commit;" },
  { name: "dispute_entry slashes when the entry opens", file: `${K}dispute.rs`, from: `self.rule(token_id, who, !opens,`, to: `self.rule(token_id, who, opens,` },
  { name: "anyone can step someone's audit", file: `${K}audit.rs`, from: `require!(a.auditor == who, "this is someone else's audit");\n        let t = self.trader(a.trader);`, to: `let t = self.trader(a.trader);` },
  { name: "an audit concludes with entries unopened", file: `${K}audit.rs`, from: `require!(a.next_seq.0 == a.end_seq.0, "open every entry first");`, to: "" },
  { name: "a price hint can be before the trade", file: `${K}oracle.rs`, from: `require!(r.t_ms.0 >= at_ms, "wrong price hint: that round is before the trade");`, to: "" },
  { name: "a claim that no round follows needn't be true", file: `${K}oracle.rs`, from: `require!(last.t_ms.0 < at_ms, "wrong price hint: a round follows the trade");`, to: "let _ = last;" },
  { name: "a claim that no round follows needn't wait", file: `${K}oracle.rs`, from: `require!(self.now_ms() > at_ms + 2 * gap, "no such round yet: a trade is priced at the first round after it");`, to: "" },
  { name: "a round long after the trade still prices it", file: `${K}oracle.rs`, from: `if r.t_ms.0 > at_ms + gap {\n            return None;\n        }`, to: "" },
  { name: "anyone can record a round", file: `${K}oracle.rs`, from: `require!(self.config.recorder.as_ref() == Some(&who), "only the recorder may record rounds");`, to: "let _ = &who;" },
  { name: "rounds can be rewritten in time", file: `${K}oracle.rs`, from: `require!(r.t_ms.0 > last.t_ms.0, "rounds only go forward in time");`, to: "let _ = last;" },
  { name: "a failed withdrawal loses the money", file: `${K}lib.rs`, from: `self.credit(&who, amount.0);\n        false`, to: `let _ = amount;\n        false` },
  { name: "the prover takes the whole bond", file: `${K}lib.rs`, from: `let cut = keyhole_core::mul_div(t.bond.0, self.config.prover_bps as u128, 10_000).unwrap_or_else(|| env::panic_str("amount overflow"));`, to: `let cut = t.bond.0;` },
  { name: "nothing burns on a slash", file: `${K}lib.rs`, from: `let rest = t.bond.0;\n        self.burn(t, rest);`, to: "" },
  { name: "a number out of range is truncated into another entry's", file: `${K}lib.rs`, from: `require!(n <= u32::MAX as u64, "that number is out of range");\n        ((id as u64) << 32) | n`, to: `((id as u64) << 32) | (n & 0xffff_ffff)` },
  { name: "deliver doesn't check which key it wrapped to", file: `${K}sale.rs`, from: `require!(k.buyer_pub == Some(buyer_pub), "the holder's one-time key has changed: read it again");`, to: `let _ = buyer_pub;` },
  { name: "a token can move while delivery is open", file: `${K}sale.rs`, from: `self.now_ms() < self.epoch_start_ms(k.first_epoch).saturating_sub(self.config.delivery_lead_secs as u64 * 1000)`, to: `self.now_ms() < self.epoch_start_ms(k.first_epoch)` },
  { name: "a window already past its floor can be bought", file: `${K}sale.rs`, from: `require!(!complete || total >= -floor, "that window is already past its floor, so its refund is already owed: it isn't for sale");`, to: `let _ = (complete, total, floor);` },
  { name: "a window with a missed figure can be bought", file: `${K}sale.rs`, from: `require!(now <= self.epoch_start_ms(e + 1) + self.config.post_grace_secs as u64 * 1000, "that window has an epoch with no figure, so its refund is already owed: it isn't for sale");\n`, to: `let _ = now;\n` },
  { name: "a trader can leave right after a late figure", file: `${K}journal.rs`, from: `require!(self.now_ms() >= t.last_post_ms.0 + self.config.unbond_secs as u64 * 1000, "the bond is still at risk: the last figure hasn't had its time to be audited");`, to: "" },
  { name: "a token that comes back keeps its listing", file: `${K}nft.rs`, from: `k.buyer_pub = None;\n        k.resale_price = None;\n        self.tokens.insert(id, k);\n        self.disown(&receiver_id, id);`, to: `k.buyer_pub = None;\n        self.tokens.insert(id, k);\n        self.disown(&receiver_id, id);` },
  { name: "a slashed trader can be slashed again", file: `${K}audit.rs`, from: `require!(!matches!(t.status, TraderStatus::Slashed { .. }), "this trader was already slashed");`, to: "" },
  { name: "a bond leaves before the delay", file: `${K}journal.rs`, from: `require!(self.now_ms() >= since_ms.0 + self.config.unbond_secs as u64 * 1000, "the bond is still at risk: the unbonding delay hasn't passed");`, to: "let _ = since_ms;" },
  { name: "a local runner's figure reads as the enclave's", file: `${K}attest.rs`, from: `self.write_attested(output, AttestKind::SimulatedLocal, env::predecessor_account_id());`, to: `self.write_attested(output, AttestKind::OutLayerTee, env::predecessor_account_id());` },
  { name: "anyone can report an attested figure", file: `${K}attest.rs`, from: `require!(self.runners.contains_key(&env::predecessor_account_id()), "not a registered runner");`, to: "" },
  { name: "buy_window charges no storage", file: `${K}sale.rs`, from: `self.charge_storage(before, attached - price - allowance, &who);`, to: `let _ = (before, allowance);` },
  { name: "record_round charges no storage", file: `${K}oracle.rs`, from: `self.charge_storage(before, env::attached_deposit().as_yoctonear(), &who);`, to: `let _ = before;` },
  { name: "commit_entry charges no storage", file: `${K}journal.rs`, from: `self.charge_storage(before, env::attached_deposit().as_yoctonear(), &who);\n        H32(head)`, to: `let _ = before;\n        H32(head)` },
  { name: "a refunded window pays the protocol a fee", file: `${K}sale.rs`, from: `let fee = if breached { 0 } else { self.fee_of(price) };`, to: `let fee = self.fee_of(price);` },
  { name: "the trader keeps the whole price and the fee comes from nowhere", file: `${K}sale.rs`, from: `self.move_to_credit(&payee, checked_sub(price, fee));`, to: `self.move_to_credit(&payee, price);` },
  { name: "the fee goes to the trader, not the treasury", file: `${K}sale.rs`, from: `self.move_to_credit(&treasury, fee);`, to: `self.move_to_credit(&payee, fee); let _ = treasury;` },
  { name: "the fee rounds up", file: `${K}sale.rs`, from: `keyhole_core::mul_div(price, self.config.fee_bps as u128, 10_000).unwrap_or_else(|| env::panic_str("amount overflow"))\n    }`, to: `keyhole_core::mul_div(price, self.config.fee_bps as u128, 10_000).unwrap_or_else(|| env::panic_str("amount overflow")) + if price * self.config.fee_bps as u128 % 10_000 == 0 { 0 } else { 1 }\n    }` },
  { name: "a resale pays no fee", file: `${K}sale.rs`, from: `let fee = self.fee_of(ask);`, to: `let fee = 0u128; let _ = ask;` },
  { name: "the treasury can be the contract itself", file: `${K}lib.rs`, from: `if c.treasury.as_ref() == Some(contract) {`, to: `if false && c.treasury.as_ref() == Some(contract) {` },
  { name: "OutLayer's resource limits go as strings", file: `${K}attest.rs`, from: `"max_instructions": o.max_instructions.0,`, to: `"max_instructions": o.max_instructions,` },
  { name: "a fee over the cap is allowed", file: `${K}lib.rs`, from: `if c.fee_bps > MAX_FEE_BPS {`, to: `if false {` },
  { name: "a fee with no treasury is allowed", file: `${K}lib.rs`, from: `if c.fee_bps > 0 && c.treasury.is_none() {`, to: `if false {` },
  { name: "the core's descent reaches outside a node's subtree", file: "core/src/ggm.rs", from: `if shift >= 32 || (to.index >> shift) != from.index {`, to: `if shift >= 32 {` },
  { name: "the PnL rounds toward zero instead of down", file: "core/src/pnl.rs", from: `total_e16.div_euclid(DIV_E10)`, to: `total_e16 / DIV_E10` },
  { name: "the exposure limit is gone", file: "core/src/pnl.rs", from: `if exposure > limit_e16 {\n            return None;\n        }`, to: `let _ = (exposure, limit_e16);` },
  { name: "an entry's tag isn't checked when opening", file: "core/src/entry.rs", from: `if &tag::<H>(key, seq, slot, ct) != expected_tag {\n        return None;\n    }`, to: `let _ = (seq, slot, expected_tag);` },
];

const QUICK = process.argv.includes("--quick");
const only = process.argv.includes("--only") ? process.argv[process.argv.indexOf("--only") + 1] : null;
const list = only ? MUTANTS.filter((m) => m.name.includes(only)) : QUICK ? MUTANTS.slice(0, 8) : MUTANTS;
const repo = new URL("..", import.meta.url).pathname;
const env = { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:${process.env.PATH}`, CARGO_TARGET_DIR: process.env.KEYHOLE_MUTANT_TARGET ?? join(tmpdir(), "keyhole-mutants-target") };
const work = mkdtempSync(join(tmpdir(), "keyhole-mutants-"));
cpSync(join(repo, "contracts"), join(work, "contracts"), { recursive: true, filter: (s) => !s.includes("/target") });
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

function build(): string {
  execFileSync("cargo", ["near", "build", "non-reproducible-wasm", "--no-abi"], { cwd: join(work, "contracts/keyhole"), env, stdio: ["ignore", "ignore", "pipe"] });
  const out = join(work, "keyhole.wasm");
  cpSync(join(env.CARGO_TARGET_DIR!, "near/keyhole/keyhole.wasm"), out);
  return out;
}

const started = Date.now();
let caught = 0;
const survived: string[] = [];
console.log(`Mutating ${list.length} security-critical lines. The attack suite must notice each.\n`);
for (const m of list) {
  const path = join(work, "contracts", m.file);
  const original = readFileSync(path, "utf8");
  if (!original.includes(m.from)) {
    console.log(`✗ the line for "${m.name}" isn't in ${m.file} any more`);
    survived.push(`${m.name} (stale)`);
    continue;
  }
  writeFileSync(path, original.replace(m.from, m.to));
  let wasm: string;
  try {
    wasm = build();
  } catch (e) {
    console.log(`✗ "${m.name}" doesn't compile: ${String((e as { stderr?: Buffer }).stderr ?? e).split("\n").find((l) => l.includes("error")) ?? ""}`);
    survived.push(`${m.name} (no compile)`);
    writeFileSync(path, original);
    continue;
  }
  const r = spawnSync("npx", ["tsx", "tools/attack.ts", "--quiet"], { cwd: repo, env: { ...process.env, KEYHOLE_WASM: wasm }, encoding: "utf8" });
  writeFileSync(path, original);
  const failed = (r.stdout.match(/FAILED: (.*)/g) ?? []).map((l) => l.replace("FAILED: ", "").split(":").slice(0, 2).join(":"));
  if (r.status !== 0) {
    caught++;
    console.log(`✓ caught: ${m.name.padEnd(62)} by "${(failed[0] ?? "the suite").slice(0, 70)}"${failed.length > 1 ? ` and ${failed.length - 1} more` : ""}`);
  } else {
    survived.push(m.name);
    console.log(`✗ SURVIVED: ${m.name}`);
  }
}
console.log(`\n${caught}/${list.length} mutants caught, in ${((Date.now() - started) / 1000).toFixed(0)} s`);
if (survived.length) console.log(`Survived:\n  ${survived.join("\n  ")}`);
process.exit(survived.length ? 1 : 0);
