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
| [0004](0004-the-pnl-rule.md) | One PnL rule in exact integers: a trade is priced at the first round after it was written, no carry between epochs, over-limit entries void |
| [0005](0005-money-moves-by-credit-and-withdraw.md) | State changes only move numbers, NEAR leaves through `withdraw`, `solvency()` states what's owed, and nobody's storage comes from the contract's balance |
| [0006](0006-resale-only-before-delivery.md) | A window can be resold only until delivery can begin: a re-wrap after delivery would sell it to two people, and a resale during delivery could slash an honest trader |
| [0007](0007-the-real-wasm-in-a-browser.md) | The web app and the fast attack suite run the real wasm on a small JavaScript host, which meters no gas |
| [0008](0008-show-the-doubt-do-not-hide-it.md) | The board prices cherry-picking with a deflated Sharpe and says plainly it can't remove it |
| [0009](0009-attestation-adds-a-label-not-a-slash.md) | The attested path adds a figure labeled by code path, and moves no money |
| [0010](0010-the-price-table.md) | A fraud proof reads a local append-only price table, with each feed's source labeled |
| [0011](0011-confidential-quotes-need-a-user.md) | Live quotes are keyless and carry no `confidentiality` field: measured, it answers 401 without a user's auth |
| [0012](0012-a-slash-splits-three-ways.md) | A slash splits three ways (prover, burn, buyers), and a window bought on its eve shares nothing: a review found a trader could otherwise recover his whole bond through a second account |
