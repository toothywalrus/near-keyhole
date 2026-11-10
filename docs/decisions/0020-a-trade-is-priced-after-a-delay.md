# 0020: A trade is priced at the first round at least `price_delay_secs` after it

**Context.** `0019` stated the limit: on a live feed a round's answer is readable in the source chain's mempool
before the round's own timestamp, so "the first round at or after the entry" can be a price the trader already
knew. The deployed contract is locked and prices nothing from a live feed, so `0019` left the fix to the next
version. This is that version's source. It isn't deployed.

**Decision.**

- `Config.price_delay_secs`, set once at `new`. `price_at` moves the moment forward by it before looking for a
  round, so a trade is priced at the first round stamped at least that long after its entry, and an epoch's mark at
  the first round at least that long after its end. `max_round_gap_secs` is measured from the delayed moment: a
  round later than delay + gap makes the trade void, and "no round came" can be claimed once delay + twice the gap
  has passed.
- `new` requires the posting grace to outlast twice the round gap **and** the delay, or an honest trader could
  lapse while waiting for his price.
- The rule is one line in each implementation and they still agree to the unit: `oracle.rs` (`price_at`),
  `lib/src/client.ts` (`priceOf`), `job/src/main.rs` (`price_of`, and the quiet-feed mark).
- A delay rather than "the second round after": two rounds can wait in the mempool together, and a time bound can be
  reasoned about per source chain. The testnet configuration uses 20 s (its feeds are recorded, so there it shows
  the rule and defends nothing); the mainnet configuration uses 60 s, above Ethereum's usual inclusion time for a
  Chainlink report. Zero keeps the old rule, and the seeded web app and the local test worlds stay at zero, with a
  world of its own for the delayed rule in the attack suite.

Two smaller hardenings ride with it, found in the same read (#21):

- `max_window_epochs` must be 1 to 32 at `new`: a window's `known_mask` has one bit per epoch, and a longer window
  would make every such purchase panic on the shift.
- An attested figure can't be replaced by one from a weaker source: `SimulatedLocal` < `OutLayerStandIn` <
  `OutLayerTee`. Before, the owner's local runner could overwrite an enclave's figure with its own. The label
  stayed truthful, but the stronger evidence was erased.

A holder who took a token by plain transfer and never registered a one-time key still sees that window settle like a
delivered one. That was looked at again and kept: refunding it would let a buyer park money in windows he never
means to read and tie up a trader's bond coverage at no cost. The code and `JUDGES.md` now say so.

**Consequences.**

- A trader's recorded fill is at least the delay later than his real one. Followers who copy see the entry at once,
  as before; only the record waits.
- The delay must be chosen per source chain and can't change after `new`. A reorg deeper than the delay, or a
  report held back longer than it, reopens the window: 60 s is a floor, not a proof.
- It doesn't touch what `0010` states: on a borrowed feed, whoever relays chooses which rounds exist.
- The state layout changed (`Config` has one more field), which `0017` allows: a new version is a new account.
- Tests: the attack suite's "A round seen before it lands" section (a round inside the delay can't price a trade; a
  figure priced at it is slashed; the honest delayed figure stands; void only after delay + twice the gap; `new`
  refuses a grace that doesn't cover the delay), `DOWNGRADE`, and four mutants.
