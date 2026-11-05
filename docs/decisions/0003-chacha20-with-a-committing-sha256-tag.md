# 0003: Entries use ChaCha20 with a committing SHA-256 tag, not ChaCha20-Poly1305

**Context.** The kill test shows the AEAD costs 0.05 Tgas, so gas decides nothing here. But a fraud proof needs more from a tag than
an AEAD gives. Poly1305 is not key-committing: someone who controls the key can build one ciphertext and one tag
that open under two different keys to two different plaintexts ("invisible salamanders"). A trader controls the key. He could then
show a buyer one trade and the contract another.

**Decision.** `ct = ChaCha20(entry_key, nonce = 0, counter = 1, plaintext)` and
`tag = SHA-256("keyhole/tag/v1" || entry_key || seq || slot || ct)`, stored on-chain when the entry is written. Each entry has its own key,
derived from its leaf and its sequence number, so the fixed nonce is safe. Finding a second key for a tag means finding a
SHA-256 collision. Wrapped nodes need no tag at all: their check is the node commitment (`0002`).

The contract carries a 30-line RFC 8439 ChaCha20, checked against the RFC's vector and against `@noble/ciphers`,
instead of the `chacha20` crate, because a contract's wasm costs storage.

**Consequences.** The fraud proof can accept entry keys directly: only the true key matches the tag. An auditor therefore reveals
the keys for one epoch, not a tree node that opens a whole window.
