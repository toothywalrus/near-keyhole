# 0010: A fraud proof reads a local price table; sources are labeled per feed

**Context.** The design priced PnL from near-borrowed-oracle's MPC-proven rounds, with a recorded feed in the sandbox. near-borrowed-oracle has three rounds on testnet, from October 30, and no way to get fresh ones without relaying through the MPC network. A cross-contract call in a slashing path adds a failure mode to the one transaction that must not fail.

**Decision.** Rounds live in the contract's own append-only table, strictly increasing in time, and a fraud proof reads only that. Each feed has one source, set at `new` and shown by `get_feeds`: `Recorded` (real Chainlink rounds replayed by `config.recorder`, who is trusted, and takes effect at the moment of replay) or `BorrowedOracle` (anyone may import the oracle's latest proven round; the import is a real cross-contract read, not on any slashing path). A deployment with `recorder: null` can't take a recorded round at all. The prover names the round by index and the contract checks it's the right one (two reads), so the proof needs no search.

The testnet deployment has three recorded feeds and one borrowed feed, whose real round is imported to show the path works. Trades there are priced from the recorded feeds, since the borrowed one has no round after any entry.

**Consequences.** On a borrowed feed, the table is only as dense as its relayers: a trader could try to choose which round gets relayed next, by relaying only favourable ones. Anyone else relaying defeats this, and the contract could require consecutive round ids on a feed with reliable relaying. That's a limit of the mainnet design, stated in the README (#3).
