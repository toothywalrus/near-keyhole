# 0022: The price delay bounds a borrowed feed, not a recorded one

**Context.** `0021` added `price_delay_secs` and said it closes the limit of `0019`. A hostile read on 2026-11-13
(#21) checked that against both kinds of feed. On a `BorrowedOracle` feed it holds: a round's time is its source's
`updated_at`, and `on_imported` refuses a round that isn't newer than the last, so the first round at least the
delay after an entry is a round the source stamped at least that long after it. On a `Recorded` feed it doesn't
follow. `record_round` stamps a round with the moment it is recorded here and takes `round_id` and
`source_updated_at` as the recorder's word, so a recorder that records the source's latest round again, unchanged,
after the delay fills a waiting trade at a price that was public before the entry. A trader who sees the market
above a stale oracle buys, is filled at the stale price, and an audit finds the gain right. The attack suite shows
it ("LIMIT, shown: on a recorded feed…"). The recorder in `tools/mainnet.ts` works exactly this way: each pass
records Chainlink's latest round, new or not. The same holds, more mildly, for a recorder that is merely slow: the
lead a trader has is the source chain's inclusion time plus the recorder's own delay.

**Decision.** Scope the claim, and leave the contract's rule alone.

- The README, `JUDGES.md` (C30) and `docs/limits.md` say the delay bounds a borrowed feed. On a recorded feed it is
  only as good as its recorder, which was already the trust stated for that label (`0010`).
- Not a contract rule ("a recorded round's source time must advance, and be recent"), because the testnet and
  sandbox replays record old rounds with their old source times on purpose, in a loop: that is what `Recorded`
  is for. A deployment that prices real trades should use borrowed feeds, or a recorder that records each source
  round once and promptly.
- `tools/mainnet-config.ts` says this where it sets the delay. The mainnet script's recorder is left as it is: it
  has never run, and its single demo sale isn't a track record.

**Consequences.**

- "A trader can't be priced at a round he could already read" is true of this tree's source for borrowed feeds
  only. Every trade on testnet is priced from recorded feeds, whose rounds are public in the repo anyway.
- A recorder that skips an unchanged round makes a quiet hour void more trades (`max_round_gap_secs`), which is
  the honest outcome there.
