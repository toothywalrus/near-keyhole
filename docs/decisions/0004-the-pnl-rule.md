# 0004: PnL is one rule in exact integers, priced at the next round, with no carry between epochs

**Context.** A fraud proof slashes on a difference of one unit, so the trader's tool, every buyer, the contract and the attested job must get the same number exactly. Drift means honest traders get slashed. And three things about pricing decide whether the number means anything: which price a trade gets, whether a window buyer can recompute without history, and whether a lucky bet can be sized without limit.

**Decision.** `keyhole_core::pnl`, with a TypeScript twin held to it by `fixtures/vectors.json`:

- Quantities and prices have 8 decimals. Cash stays in exact e16 units with no rounding. The published figure is the total rounded down once, to e6.
- **A trade is priced at the first oracle round at or after the moment it was committed,** never the trader's claimed fill. This wasn't in the original design, which said only "against oracle prices". Pricing at the round in force at commit time would hand anyone with a faster feed free money: he could see the market move, write a trade, and get the stale round. Priced this way he can't know his own price when he writes. The cost: followers and the leaderboard see an oracle-priced figure, not the real fill. Real fills are in the entry, and are used only for copy slippage.
- **An epoch stands alone.** No position carries over; at the epoch's end everything is marked at the first round after it, and a position held longer is re-opened by an entry in the next epoch. Without this, a buyer of a seven-day window couldn't audit it, because he can't read the positions before it. The cost: holders write one extra entry a day.
- Windows are whole epochs, so that everything sold can be audited.
- An entry that is malformed, names an unknown feed, has zero size or would take the position past 3× the declared book in one feed is **void**. Posting a figure that counted it is a false figure. So a single huge bet can't manufacture a leaderboard return.
- Every function in the module is total: nothing a trader wrote can make it panic.

**Consequences.** Entries in an epoch's last moments are priced near the mark, and so add almost nothing. An entry's slot must be in the current epoch: a one-slot tolerance doesn't reach across the end, since a trade written after the close could see the mark first.
