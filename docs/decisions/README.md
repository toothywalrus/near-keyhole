# Decision records

Short records of *why* a non-obvious choice was made. Format: **Context**, **Decision**, **Consequences**. Numbered
sequentially and never renumbered. A superseded record is struck through in the index, pointing to the new one. One
decision per file.

## Index

| # | Decision |
|---|---|
| [0001](0001-a-repo-of-its-own.md) | Keyhole is its own repo, testnet only; the design comes from near-lab but nothing depends on reading it |
| [0002](0002-the-contract-arbitrates-the-key-sale.md) | The kill test passed (9.50 Tgas), so the contract rules on key sales itself, with two proofs: garbage wrap and a node that opens nothing |
| [0003](0003-chacha20-with-a-committing-sha256-tag.md) | ChaCha20 plus a committing SHA-256 tag, because Poly1305 lets a trader show the buyer one trade and the contract another |
