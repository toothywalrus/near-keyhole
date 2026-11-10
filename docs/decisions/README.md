# Decision records

Short records of *why* a non-obvious choice was made. Format: **Context**, **Decision**, **Consequences**. Numbered
sequentially and never renumbered. A superseded record is struck through in the index, pointing to the new one. One
decision per file.

## Index

| # | Decision |
|---|---|
| [0001](0001-a-repo-of-its-own.md) | Keyhole is its own repo, testnet only; the design comes from a private research repo of ours, and nothing depends on reading it |
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
| ~~[0012](0012-a-slash-splits-three-ways.md)~~ | ~~A slash splits three ways (prover, burn, buyers)~~: superseded by [0013](0013-no-part-of-a-bond-reaches-a-buyer.md) |
| [0013](0013-no-part-of-a-bond-reaches-a-buyer.md) | No part of a bond ever reaches a buyer: refunds come from escrow, penalties and the rest of a slash burn, and a true loss never touches the bond. Gaps and refused figures count against the public figure |
| [0014](0014-what-is-guaranteed-about-a-journal.md) | A journal is what the trader wrote: a settlement reference is his unverified claim, nothing forces a fill before publishing, and the key covers the journal, not a real confidential trade |
| [0015](0015-what-a-missed-delivery-costs.md) | A refusal costs what it withheld, once per epoch; past windows get a catch-up grace, and traders can pause; only a refused gain stops counting; a known loss can't make a window refundable; the posting grace outlasts an oracle outage |
| [0016](0016-a-fee-on-closed-sales-only.md) | The protocol takes `fee_bps` (5% here, at most 20%) of a window sale that closes for the trader, credited to a treasury; refunds go back whole, and no fee comes from a bond |
| [0017](0017-a-new-deployment-is-locked-in-its-own-first-transaction.md) | A new contract version goes to a fresh account and is deployed, initialised and locked (its only key deleted) in one transaction; the old deployment stays as history |
| [0018](0018-a-fast-judge-path-and-a-full-one.md) | `npm run judge` is the fast path (no node, no Rust, no browser, testnet re-read included); the local-node suites, Rust tests, page test and mutants are in `npm run judge:full` |
| [0019](0019-a-round-seen-before-it-lands.md) | On a live feed a round's answer is visible in the source chain's mempool before its timestamp, so a trader can know a fill a few seconds ahead: stated as a limit now (no testnet figure is priced that way), closed in the next version by pricing at a round at least a set delay after the entry |
| [0020](0020-the-page-reads-the-real-contract-and-holds-no-key.md) | The Proof page reads the deployed testnet contract live with view calls, holds no key and says so; only the recorded run's own accounts are shown by name, since anyone can register a handle on an open contract |
