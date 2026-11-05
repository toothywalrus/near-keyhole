# For judges: every claim, its code, its test, the command, the output

Everything here runs from a fresh clone with `npm ci`, free and with no keys, except where a row says otherwise. `npm run judge` runs most of it in about 3 minutes and ends in a table.

| # | Claim | Code | Test | Command | Expected output |
|---|---|---|---|---|---|
| C1 | **The contract can arbitrate a key sale.** A whole dispute (x25519 twice, ChaCha20, a commitment check) fits in about 3% of a transaction | `contracts/keyhole/src/dispute.rs`, `contracts/killtest/` | `tools/killtest.ts`, `tools/demo.ts`; the testnet txs in `docs/research/killtest-2026-11-05.md` and the README | `npm run killtest`; `npm run demo` | `dispute: chacha20 (wasm): ok … whole tx burnt 9.3 Tgas` in the sandbox; `dispute_wrap … about 10 Tgas` |
| C2 | **A window's nodes read exactly that window, and nothing outside it** | `contracts/core/src/ggm.rs`, `lib/src/ggm.ts` | `contracts/core/tests/properties.rs` (`nodes_read_the_window_and_nothing_else`, `cover_is_exactly_the_window`, `an_entry_past_the_window_does_not_open`) | `cd contracts && cargo test --release -p keyhole-core --features sha2` | `15 passed` |
| C3 | **The TypeScript and Rust implementations agree byte for byte:** nodes, proofs, ciphertexts, tags, and PnL at every step | `lib/src/*.ts`, `contracts/core/examples/vectors.rs` | `lib/test/vectors.test.ts` against `fixtures/vectors.json` | `npm test` | all pass |
| C4 | **The entry past the window fails to decrypt, offline, with nobody revoking anything** | `lib/src/client.ts` (`WindowReader`) | `tools/attack.ts` "WINDOW OVERREACH", `tools/page-test.ts` | `npm run attack`; `npm run demo` | `✓ WINDOW OVERREACH: the entry past it fails, offline`; `#2 … DOESN'T DECRYPT` |
| C5 | **A false figure is provable and slashes,** to one unit | `contracts/keyhole/src/audit.rs`, `contracts/core/src/pnl.rs` | `tools/attack.ts` "FALSE PNL", "OFF BY ONE" | `npm run attack` | `✓ FALSE PNL: the contract recomputes the figure and slashes`; `✓ OFF BY ONE: a difference of one unit slashes` |
| C6 | **A true figure survives an audit,** and the auditor pays | `audit.rs` | `tools/attack.ts` "TRUE FIGURE" | `npm run attack` | `✓ TRUE FIGURE: the audit concludes against the auditor` |
| C7 | **Garbage keys are provable and slash;** a false dispute costs the griefer | `dispute.rs` | `tools/attack.ts` "GARBAGE KEY", "FALSE DISPUTE" | `npm run attack` | `✓ GARBAGE KEY: the contract unwraps, compares and slashes`; `✓ FALSE DISPUTE: it ends in a dismissal, not a panic` |
| C8 | **A tree that isn't one is caught:** nodes matching their commitments, journal encrypted with something else | `dispute.rs` (`dispute_entry`) | `tools/attack.ts` "NOT A TREE" | `npm run attack` | `✓ NOT A TREE: the contract walks the node down to the entry and slashes` |
| C9 | **No backdating, no deleted losers** | `contracts/keyhole/src/journal.rs` | `tools/attack.ts` "backdated entry", "deleted loser"; `npm run verify` recomputes a real hash chain | `npm run attack` | `✓ backdated entry: a slot two back is refused`; `✓ deleted loser: skipping a number is refused` |
| C10 | **A trader can't know his own price:** a trade is priced at the first round after it | `contracts/keyhole/src/oracle.rs` (`price_at`) | `tools/attack.ts` price hint checks | `npm run attack` | `✓ audit: a price hint past the first round after the trade is refused` |
| C11 | **Windows are NEP-171 tokens, resellable only before keys exist; resale replay fails** | `contracts/keyhole/src/nft.rs`, `sale.rs` | `tools/attack.ts` "RESALE REPLAY", "RESALE:" | `npm run attack` | `✓ RESALE REPLAY: a wrap to the old key slashes when the new holder disputes` |
| C12 | **Bonding curve per trader, fixed at registration** | `sale.rs` (`price_of`), `journal.rs` | `tools/attack.ts` "too little attached" and each price; `npm run demo` | `npm run demo` | the second buyer's window costs more than the first's |
| C13 | **A floor breach or a lapse returns the whole escrow to the holder, and a penalty burns. No part of a bond reaches a buyer, so a second account can't pull it out** | `sale.rs` (`settle`, `window_breached`, `refund_undelivered`), `lib.rs` (`slash`, `burn`) | `tools/attack.ts` "FLOOR", "LAPSE", "BOND ESCAPE", "SELF-SLASH"; `tools/fuzz.ts`; two mutants | `npm run attack`; `npm run fuzz` | `✓ BOND ESCAPE, refused deliveries: the pair gain nothing`; `✓ SELF-SLASH: the most a trader can recover through a second account is the prover's share`; `Every yocto of every bond is accounted for` |
| C14 | **The contract's books always balance;** nobody's storage is paid from its balance; nothing traps | `lib.rs` (`obligations`, `charge_storage`), `views.rs` (`solvency`) | `tools/fuzz.ts`; the `solvency holds` checks in `tools/attack.ts` | `npm run fuzz` | `The books balanced to the yocto after every operation. Nothing trapped or under/overflowed.` |
| C15 | **Failed promises roll back** | `lib.rs` (`on_withdraw`), `nft.rs` (`nft_resolve_transfer`), `oracle.rs` (`on_imported`) | `tools/attack.ts`, local host section | `npm run attack` | `✓ FAILED TRANSFER: the credit is restored in full` |
| C16 | **The checks are load-bearing:** break any one and a test notices | every line in `tools/mutate.ts` | `tools/mutate.ts`; the last log is `docs/research/mutation-run.txt` | `npm run mutate` (needs Rust; `--quick` for 8) | `75/75 mutants caught` in one pass |
| C17 | **A real NEP-413 `token_diff` copy trade runs on the mainnet `intents.near` wasm,** with limits, and slippage measured from balances: on a real node, and in the browser tab | `lib/src/intents.ts`, `lib/src/copy-local.ts`, `tools/copy-sandbox.ts`, `res/intents.near.wasm` | `tools/copy-sandbox.ts`, `lib/test/copy-local.test.ts`, `tools/page-test.ts` "COPY" | `npm run copy`; `npm test`; `npm run page-test` | `✓ EXECUTED: the follower's copy settles on the mainnet wasm`; `✓ COPY SLIPPAGE … 3.00 bps worse` (the local solver's spread) |
| C18 | **Live 1Click dry quotes, keyless; `confidentiality` needs a user's auth** | `lib/src/oneclick.ts` | `tools/copy-sandbox.ts` | `npm run copy` | `✓ 1Click quotes the copy`; `✓ setting confidentiality needs a user's auth … HTTP 401` |
| C19 | **The attested job gets the contract's figure, to the unit, reading the chain over HTTP.** SIMULATED: no enclave | `job/src/main.rs`, `contracts/keyhole/src/attest.rs` | `tools/job.ts` | `npm run job` (needs wasmtime) | `✓ JOB = TRADER = CONTRACT'S RULE`; `✓ SIMULATED: it is labeled a local run`; `✓ the job runs on exactly the input the contract sent` |
| C20 | **A simulated figure can't pass for a real one:** the code path sets the label, and only OutLayer's own account earns `OutLayerTee`. It still trusts the owner's choice of job hash, which is public | `attest.rs` | `tools/attack.ts`, `tools/job.ts`, two mutants | `npm run attack`; `npm run job` | `✓ SIMULATED: a local run is labeled as one`; `✓ STAND-IN: a callback from anything but OutLayer's own account can't earn the enclave's label` |
| C21 | **OutLayer's production shape works,** with real yield/resume, against a stand-in. Its input carries `rpc`, and the stand-in passes back the job's real stdout. OutLayer's docs say wasip2 jobs can make outbound HTTP calls; the hosted run hasn't been tried | `attest.rs` (`request_attested`, `on_attested`), `contracts/mock-outlayer` | `tools/job.ts` | `npm run job` | `✓ the yield resumes into the contract's callback` |
| C22 | **Deployed on testnet, and the chain says so** | `tools/testnet.ts`, `tools/demo.ts`, `docs/demo/testnet-run.json` | `tools/verify.ts` | `npm run verify` | `N/N chain checks passed`, including `the code on chain is res/keyhole.wasm, byte for byte` |
| C23 | **Reads a real MPC-proven round from near-borrowed-oracle** | `oracle.rs` (`import_round`) | `tools/verify.ts`; the local host's mock in `tools/attack.ts` | `npm run verify` | `✓ the borrowed feed holds a real round` |
| C24 | **The web app runs the real wasm:** board, purchase, a window that fails past its end, catching the liar | `web/src/`, `lib/src/vm.ts` | `tools/page-test.ts`, `lib/test/seed.test.ts` | `npm run page-test` (needs `npx playwright install chromium`) | `N/N page checks passed` |
| C25 | **Seeded data is what it says:** real rounds, honest books' figures exact, the liar's false | `tools/seed.ts` | `lib/test/seed.test.ts` | `npm test` | all pass; `every ETH round in the state is a recorded real round` |
| C27 | **The PnL book is total, for every input** | `contracts/core/src/pnl.rs`, the proof in `contracts/core/src/lib.rs` | Kani | `npm run kani` (needs Kani) | `VERIFICATION:- SUCCESSFUL` |
| C26 | **The deflated Sharpe prices cherry-picking** | `lib/src/dsr.ts` | `lib/test/dsr.test.ts` | `npm test` | all pass |

## The attacks the design named, and where each is

| Attack | Expected refusal | Check in `tools/attack.ts` |
|---|---|---|
| Garbage key | Slash on `dispute_wrap` | `GARBAGE KEY` |
| False PnL | Slash on `audit_conclude` | `FALSE PNL`, `OFF BY ONE` |
| Backdated entry | `no backdating` | `backdated entry` |
| Deleted loser | `entries are numbered with no gaps` | `deleted loser`, `overwriting an entry`; a figure leaving one out is false PNL |
| Window overreach | Doesn't decrypt; `that entry's slot isn't under this node` | `WINDOW OVERREACH`, `dispute_entry: an entry that isn't under the node` |
| Resale replay | `only the holder`, `isn't this token's one-time key`, slash | `RESALE REPLAY` |
| Griefing dispute | Dismissed, and the deposit goes to the trader | `FALSE DISPUTE` |
| Griefing audit | The deposit goes to the trader | `TRUE FIGURE` |
| Forged commitments | `don't match the root posted before the sale` | `forged commitments` |
| Wrong round for a price | `wrong price hint` | `audit: a price hint …` |
| Over-limit size to fake a return | Void entry, and counting it is a false figure | `EXPOSURE` |
| Absent holder locking a bond | `settle` by anyone refunds an undelivered window | `ABSENT HOLDER` |
| A number past 32 bits, to fail an honest tag | `that number is out of range` | `a number that doesn't fit` |
| A resale racing an honest delivery | `the holder's one-time key has changed`, `delivery can begin` | `RESALE RACE` |
| Slashing yourself to recover the bond | 40% at most, whatever the window's age; the rest burns | `SELF-SLASH` |
| Refusing delivery to a second account, to collect a penalty | The penalty burns; the pair gain nothing | `BOND ESCAPE, refused deliveries` |
| Lapsing on purpose, to collect a refund | The escrow goes back to the second account, and a penalty burns | `BOND ESCAPE, a deliberate lapse` |
| Selling below the minimum bond | `below the minimum` | `BOND ESCAPE: once the bond is below the minimum` |
| An entry nobody can open, to block an audit | `dispute_entry` after settlement slashes; `audit_cancel` frees the auditor | `JUNK ENTRY` |
| Posting winners only | Each gap costs at least 2% of the book on the shown figure | `SKIPPED LOSER` |
| Refusing a window to hide a false figure | Can't be stopped: costs half the price, and at least 2% of the book per epoch on the record | `REFUSED` |
| Buying a window already known to be bad, for free reading | `isn't for sale` | `KNOWN BAD` |
| A trade on a dead feed, to block an audit | Void after the wait, and the audit goes on | `DEAD FEED` |
| Leaving just after a late false figure | `the last figure hasn't had its time` | `LATE LIE` |

## What's simulated

The README's status block is the list. A judge can check the labels: the page banner, `get_feeds` (`Recorded`), `get_epochs` (`SimulatedLocal`), and that no account on testnet has the OutLayer path configured (`get_outlayer` returns null). A settlement reference is shown as a claim, because the contract never reads it.

## What these numbers don't say

Twice, AI readers with no stake in the design found real bugs after the suite and the mutants all passed: one let any buyer slash an honest trader, another let a trader's second account pull the bond out: [`docs/research/review-2026-11-05.md`](docs/research/review-2026-11-05.md). All are fixed and tested, and no human has audited this contract.
