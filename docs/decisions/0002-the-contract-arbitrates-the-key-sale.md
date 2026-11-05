# 0002: The contract arbitrates the key sale itself

**Context.** Selling a key on-chain is a fair-exchange problem. If the trader delivers garbage, somebody has to rule. The
options were a TEE (NOVA's choice for access, and our design's fallback), a human, or the contract. The contract can only rule
if x25519, a cipher and a Merkle check fit into a transaction. That was the kill test, and it passed: 9.50 Tgas
for a whole dispute transaction on testnet (`docs/research/killtest-2026-11-05.md`), 3% of what a transaction may carry.

**Decision.** There are two dispute proofs, both read from the sale's record in state and never from their arguments, and both end
in a stored verdict rather than a panic, so a losing disputer's deposit can really be taken.

1. `dispute_wrap`: the buyer reveals the one-time secret. The contract checks it against the registered public key, derives the
   wrap key, unwraps a node and compares `H(node)` with the node commitment that `deliver` bound to the trader's pre-sale Merkle
   root. Mismatch: refund and slash. This catches garbage straight away, before any entry exists.
2. `dispute_entry`: the buyer reveals a node that does match its commitment. The contract walks the GGM hashes down to the entry's
   leaf and checks the entry's tag. Mismatch: refund and slash. This is what closes the gap the Merkle check leaves: a trader
   can commit to a "tree" that isn't a real GGM tree, so a node can match its commitment and still derive keys that open nothing.

`deliver` itself checks each cover node's commitment against the Merkle root (a compact proof stream, about 1 Tgas). The
contract computes which nodes form the cover; the trader doesn't get to choose.

We kept the Merkle commitment rather than relying on `dispute_entry` alone, although that alone would be sound: with it, a buyer of a
future window can check the delivery at once, and slash for garbage even if the trader never writes another entry.

**Consequences.**

- A dispute publishes what it reveals. `dispute_wrap` makes every node of that sale readable by everyone, so a false dispute
  leaks the window. The griefing deposit is at least the window's price, so the trader is at least paid twice. The leak itself has no
  fix short of zero knowledge. A buyer can leak the keys anyway, so this adds no new power, only a new way to pay for using it.
- Both proofs are in `contracts/keyhole/src/dispute.rs`.
