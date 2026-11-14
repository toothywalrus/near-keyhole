# 0024: A feed's first round may be old only if it is older than the contract

**Context.** `on_imported` refuses a round older than `max_round_gap_secs`, so that a figure computed without it
stays right, and it exempted a feed's first round, "since nothing was priced before it". That reason is wrong for a
trade written while the feed was still empty: once the wait is over the trade is void (`price_at`, the claim that
no round follows), a figure posted on that can be audited and found right, and an old first round arriving later
prices the trade after all. The same figure is then false. Reproduced on 2026-11-13 (#21) as a failing check on the
wasm of `60918c1` ("LATE FIRST ROUND"): an honest trader whose figure had passed an audit was slashed by the next
one. `import_round`'s comment said nothing there is on a slashing path; this was.

**Decision.** The exemption holds only for a round stamped before the contract's genesis. No entry is that old, so
such a round can price nothing and mark nothing, and a new deployment can still show its borrowed feed's latest
round however long the oracle has been quiet. A first round stamped after genesis must be fresh like any other.

**Consequences.**

- On a testnet deployment the borrowed oracle's round is usually days old, so it is imported as before. If the
  oracle happens to be updated between the deployment and the import, and more than the round gap before it, that
  import returns `false` and the next fresh round is the first. `tools/demo.ts` does its import at the end of the
  run and reports it either way.
- The deployed contract has the old rule, and its borrowed feed already holds its first round, so nothing there
  can be re-priced this way.
- `oracle.rs` (`on_imported`), one condition. Checks: "LATE FIRST ROUND"; one mutant.
