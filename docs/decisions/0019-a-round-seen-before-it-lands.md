# 0019: A round can be seen before it lands, so a live feed leaks a few seconds of its next price

**Context.** A trade is priced at the first oracle round at or after the moment its entry was committed (`0004`), so
that a trader can't know his own price. On a `BorrowedOracle` feed a round's time is its source's `updated_at`
(`oracle.rs`, `on_imported`), which for a Chainlink round is the timestamp of the Ethereum block that carried it.
But that round's answer exists before that block does: the report is signed off-chain and its transaction waits in
Ethereum's mempool, visible to anyone, for up to a block interval (12 s) and sometimes longer. NEAR finalises in
about a second. So a trader who watches the mempool can read the next round's answer, compare it with where the
market has moved since the report was made, and commit an entry on NEAR before the round's timestamp. The entry is
honestly "before the round", and its fill is a price he already knew. Repeated, this is paper PnL without risk,
and an audit finds the figure true, because by the rule it is. Synthetix's first oracle had this problem with
real money; here it inflates a record instead. Found by a cold read on 2026-11-10 (#21); the rule in `0004` and
the price table in `0010` both missed it. The same holds for the mark at an epoch's end.

On a `Recorded` feed the question doesn't arise in this form: the recorder is trusted and the rounds replayed on
testnet are public in `fixtures/chainlink-rounds.json`, which the README already says.

**Decision.** State it as a limit now, and close it in the next contract version. The deployed contract is locked
(`0017`), every trade on it is priced from recorded feeds, and its one borrowed round prices nothing, so no figure
on testnet is affected. The fix for a deployment that prices from a live feed:

- a trade is priced at the first round whose source time is at least `price_delay_secs` after the entry's block
  time, with the delay set at `new` above the source chain's worst inclusion time (60 s for Ethereum is a
  reasonable floor), and `max_round_gap_secs` measured from there;
- the mark at an epoch's end uses the same delay;
- the TypeScript twin, the job and the vectors change with it, since every implementation must agree to the unit.

A delay rather than "the second round after": two rounds can sit in the mempool together, and a time bound can be
reasoned about per source chain.

**Consequences.**

- Until then the README's limits say that on a live feed a trader can know his fill a few seconds ahead, and that
  the bond and the audit don't catch it.
- The delay costs the honest trader nothing on the record except that his recorded fill is later than his real one,
  which is already true of next-round pricing.
- It doesn't remove what `0010` already states: on a borrowed feed, whoever relays chooses which rounds exist.
  Requiring consecutive round ids is the separate fix for that.
