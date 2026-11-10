# Keyhole: a paywall for trade signals, with a track record that can't be edited

**A paywall for trade signals where the track record can't be edited after the fact and access ends by mathematics.** A trader keeps an encrypted journal on NEAR, entry by entry as he trades, and posts each day's PnL with a bond behind it. A follower buys a window of days and can read exactly those days: the keys past the window never exist, so nothing has to be revoked. Anyone holding a window's keys can make the contract open the entries, recompute the figure against oracle prices and slash a false one. The sale itself has no operator; who feeds the prices and who can label an attested figure is said below.

**Video:** [`docs/demo/keyhole-demo.mp4`](docs/demo/keyhole-demo.mp4) · **Contract:** [`app.near-keyhole-y4ow.testnet`](https://testnet.nearblocks.io/address/app.near-keyhole-y4ow.testnet), locked · **Every claim, with its test:** [`JUDGES.md`](JUDGES.md)
<!-- LINKS: when the page is hosted and the thread is posted, add one line here: **Demo:** <url> · **Post:** <url> -->

Built for NEAR HACKATHON, tracks **privacy** and **defi**. A testnet technical demo, not investment advice: selling trading signals is regulated in many places.

## Quick start

1. `git clone https://github.com/toothywalrus/near-keyhole && cd near-keyhole && npm ci`
2. `npm run judge`: about 75 s on a 2-CPU box, free, no keys. It ends in the table below.
3. `npm run web`, then open http://localhost:5191: the board. Press **Buy a week of lucky-seven**, read it, try the next day's entry, and **Prove it**. The page walks you through it, in about a minute.

**Prerequisites.** `npm run judge` needs Node 20 or newer and network access to NEAR testnet's public RPC (`--offline` skips those reads), on any OS. No Rust, no keys, no local node, no browser.
`npm run judge:full` (about 17 minutes on an Apple Silicon Mac, plus 11 for the mutants) also needs Linux with **glibc 2.38 or newer** (Ubuntu 24.04, Debian 13) or macOS on Apple Silicon, for NEAR's sandbox binary; **Chromium** (`npx playwright install --with-deps chromium`); **Rust 1.93.0** (pinned; rustup installs it) with `cargo-near` 0.22; and `wasmtime`. Anything missing shows as SKIP with the reason, never as FAIL.
**Docker, on any Linux:** `docker run --rm -v "$PWD":/src:ro node:22-bookworm bash -c 'cp -a /src /w && cd /w && rm -rf node_modules && npm ci && npm run judge'`

What `npm run judge` ends with (measured in Debian 12 with 2 CPUs and 3 GB: 59 to 73 s from a fresh clone, `npm ci` included; about two minutes on a busy host; about 12 s on an Apple Silicon Mac. Without network the testnet row says SKIP):

```
PASS  Testnet: the deployed contract re-read from the chain (views only)        26/26 chain checks passed
PASS  TypeScript twin = the Rust core's vectors; deflated Sharpe; seeded
      state; a copy trade on the real intents.near wasm; key store; guards     tests passed: 24
PASS  Attack suite on the real contract wasm (local host)                       354/354 attack checks passed
PASS  Ledger fuzz: every yocto re-added after each random operation             614 random operations, books balanced
4 passed, 0 failed, 0 skipped, in 69 s
```

(The real rows are one line each and wider.) `npm run judge:full` adds the Rust core's property tests (15), the contract's unit and property tests (6), the kill test, the copy trade (22 checks), the complete moment (29 transactions) and the attack suite (210 checks) on a local NEAR node, the attested job under wasmtime (17 checks), the web app in a headless browser (34 checks) and the mutation check (94 of 94 mutants caught).

## Status (2026-11-10)

**Real, on NEAR testnet.** The contract was **deployed, initialised and locked in one transaction** ([`2sWeD43DFU…`](https://testnet.nearblocks.io/txns/2sWeD43DFUhifqLKkyKggRi58msT4LXmUJYRpcQqGXXm): deploy, `new`, delete the only key), so nobody can change its code or move its NEAR. One complete run is on chain: a sale and delivery, a false figure proven and slashed by the contract's own recomputation, garbage keys proven and slashed, a false dispute dismissed, a sale settled with the protocol's 5% to its treasury, and a cross-contract read of a round from near-borrowed-oracle. **The PnL job also ran in OutLayer's real TEE** (Intel TDX, request 15448) and printed the figure its trader had posted, to the unit; the attestation is committed. `npm run verify` re-reads all of it from the chain. Every transaction: [`docs/deployments.md`](docs/deployments.md).

**Real, in a local sandbox and in the browser tab.** A NEP-413 `token_diff` copy trade settling on the unmodified **mainnet `intents.near` wasm**, with limits and slippage; live keyless 1Click dry quotes; the attack suite on a real node.

**Simulated, and labeled so.**
- Every journal on the web app's board is **SEEDED**: rule-based strategies run over real recorded Chainlink rounds. The trades never happened, and the page runs the contract on a local chain in your browser.
- Prices on testnet are real Chainlink rounds **replayed by a trusted recorder**, labeled `Recorded` by the contract's `get_feeds`.
- The attested figure on vega's epoch is a local run under wasmtime with **no enclave**, labeled `SimulatedLocal` by the contract. The enclave run was asked for by the trader directly, because the locked contract's own `request_attested` sent OutLayer arguments it refuses (fixed in source since). So **no epoch on testnet is labeled `OutLayerTee`**, and the deployed wasm is the build of `a23a06c`, one fix behind this tree.
- The tokens and solver in the copy paths are local stand-ins; only the Intents contract is the real wasm. `copy/confidential-adapter.ts` is written against the docs and has **never been exercised**.

**What it isn't.** A journal is what the trader wrote: a checkable *signal record*, not a brokerage statement and not proof of a trade. Confidential Intents documents no public viewing key (read 2026-11-05), so the key here covers the journal, not a real confidential fill (`docs/decisions/0014`). No human has audited the contract. Nothing has touched mainnet.

## The problem

Illia Polosukhin, Nov 4: *"Private trading where you sell your viewing keys for people to follow/copy trade. NEAR Intents confidential trading is all private, so you can have a social trading app where people sell 'keys' for only select people to see. PnL can be publicly displayed so people can choose to buy in."*

Three things stand in the way. Nobody can check a private trader's PnL before paying. A plain viewing key can't be taken back. And selling a key needs someone to rule when what's delivered is garbage.

## What it is, in four pieces

**1. A window key that is mathematics, not access control.** Each entry is encrypted under a leaf of a GGM tree over time slots: a binary hash tree from one secret seed. To sell a window, the trader hands over the few inner nodes that cover it: at most 32, for 65,536 slots. The buyer can read exactly that window, with no revocation, no rotation, no TEE and no online seller.

**2. A key sale nobody has to referee.** The nodes are wrapped to a one-time key the buyer made for this purchase. The contract computes the cover itself and checks each node's commitment against a Merkle root posted before any sale. Payment sits in escrow. If the wrap is garbage, the buyer reveals the one-time secret, and **the contract itself runs x25519 and ChaCha20**, compares, refunds and slashes the bond: 40% to the prover, the rest burned. A second proof catches a trader who commits to one tree and encrypts with another.

**3. PnL you can trust before you pay.** Entries are committed when written, numbered in a hash chain, with the slot checked against the block's clock. PnL is posted per epoch with a bond behind it. Anyone holding an epoch's keys can open them in the contract, which recomputes the figure in exact integers against oracle prices. One unit of difference slashes. A stranger can trust the public number as far as the bond and the past buyers go, and that's what the board shows.

**4. Copying.** A follower's app decrypts locally and applies its owner's limits. The page then signs a real NEP-413 `token_diff` and settles it **on the real mainnet `intents.near` wasm, in the tab**, with a local solver and test tokens; the sandbox does the same on a real node; and 1Click gives live dry quotes. None of this is a mainnet copy. An honest trader writes the entry after his fill, but nothing forces him to: he could publish first and trade against his followers.

Window keys are priced on a **bonding curve per trader**. A purchase is a **NEP-171 token**, resellable until delivery can begin. If PnL in a sold window falls past the trader's stated floor, or a figure is missing, the holder gets **the whole escrow back**. A missing figure also burns a penalty from the bond; a true loss never does, since strangers could otherwise buy into a drawdown to burn it. No part of a bond ever reaches a buyer, because a buyer can be the trader (`docs/decisions/0013`).

## The hard question, answered with numbers

**Can the contract arbitrate the key sale?** Yes. The kill test was run first, on testnet.

| Measured on testnet | Tgas | Of a 300 Tgas transaction |
|---|---:|---:|
| A whole dispute over a wrapped node, in the real contract: x25519 twice, ChaCha20, a commitment | **10.4** | 3% |
| `deliver`: the cover checked against the Merkle root | 8.4 | 2% |
| `audit_step`, in the sandbox: per entry opened and priced | 0.15 | about 1,900 entries in one transaction |
| `audit_conclude` | 3.4 | 1% |

Details and every step's cost: [`docs/research/killtest-2026-11-05.md`](docs/research/killtest-2026-11-05.md), [`docs/research/gas-audit.json`](docs/research/gas-audit.json). No fallback was needed. A trap on the way: built without `cargo near`, near-sdk quietly compiles SHA-256 into the wasm and panics lose their messages.

**Can a stranger trust the PnL?** As far as the bond and the buyers go, and no further. A false figure is provable by anyone with the keys, to the unit, and costs its trader at least 60% of his bond, whichever account proves it: 40% goes to the prover, the rest burns. A true figure, however bad, can never cost him any of it. So a lie earning more than that can still pay, and the board shows the bond next to the PnL for that reason. A bond leaves only by burning, to a prover, or by `withdraw_bond` after the delay. A figure nobody has the keys to is only as good as its bond. Skipping a losing day doesn't help: each gap costs at least 2% of the book on the shown figure. One account can't prove it isn't the luckiest of ten, and the board says so, next to a deflated Sharpe.

## The business

**Who pays, and for what.** A follower pays per window of a trader's journal, at that trader's bonding-curve price. He pays more here than for a plain viewing key because the figure he buys on is bonded before he pays and provable after, by him, in the contract; because the key can't leak forward, since nothing past the window was ever made; and because the escrow comes back whole if the window lapses, breaches its floor or the trader is caught.

**Who earns.** The trader, 95% of every sale that closes in his favour. The protocol, **5%** (`fee_bps`, set once per deployment, at most 20%), credited to a treasury at settlement (`docs/decisions/0016`). A refunded window, a slashed trader and a missed delivery pay no fee, and no fee ever comes from a bond: the protocol earns only when a buyer got what he paid for, so it has no stake in how a dispute ends.

**Where it stands.** Testnet, the fee live in the locked contract, no users and no revenue. The page is a seeded demo with no wallet path to the testnet contract yet. A first real sale is prepared for mainnet and not run ([`docs/deployments.md`](docs/deployments.md)); the legal posture of selling signals is open. One other team, NOVA, has shipped this idea on mainnet with a different design: [`docs/competitors.md`](docs/competitors.md).

## Do this, see that

From a fresh clone: `npm ci`. Node 20+ is enough for everything in `npm run judge`, since the built wasm is in `res/`.

| Do | See |
|---|---|
| `npm run judge` | The fast path, about 75 s on 2 CPUs: the table above |
| `npm run judge:full` | Everything below that runs on this machine, ending in a table: about 17 minutes, plus 11 for the mutants (`--no-mutate` leaves them out) |
| `npm run attack` | About 30 named attacks, 354 checks, on the real wasm, in about 2 seconds on a laptop. Each states what must be refused: garbage key, false PnL, backdated entry, deleted loser, window overreach, resale replay, a fee taken from a refund, and more |
| `npm run attack -- --sandbox` | The attacks on a real local NEAR node: 210 checks (the rest need the local host's controls: a transfer that fails, a mocked receiver, a long clock), about 15 minutes. Log: [`docs/research/attack-sandbox-run.txt`](docs/research/attack-sandbox-run.txt) |
| `npm run demo` | The complete moment on a real local node, with every transaction's gas: 29 transactions |
| `npm run copy` | The copy trade: `token_diff` on the mainnet `intents.near` wasm, limits, measured slippage, refusals, a live dry quote |
| `npm run job` | The attested job under wasmtime reading the chain over HTTP, its figure equal to the contract's to the unit, and OutLayer's shape with real yield/resume against a stand-in |
| `npm run fuzz` | 2,100 random operations, with the whole ledger re-added from views after each and compared to the yocto, the treasury's fees included |
| `npm run mutate` | Needs Rust and cargo-near. Breaks 94 security-critical lines one at a time and rebuilds: `94/94 mutants caught` in one pass. Log: [`docs/research/mutation-run.txt`](docs/research/mutation-run.txt) |
| `npm run kani` | Needs Kani. A model-checker proof that the PnL book is total: no input panics, and a void entry changes nothing. Log: [`docs/research/kani-2026-11-05.txt`](docs/research/kani-2026-11-05.txt). The cover and rounding proofs didn't finish in CBMC, so they're covered by an exhaustive test and property tests instead |
| `npm run killtest` | The kill test in a sandbox: a dispute's gas, step by step |
| `npm run gas` | How much of a journal the contract can recompute per transaction. About 10 minutes, most of it waiting for a real epoch to end on the node |
| `npm run verify` | Re-reads the testnet deployment from the chain: code hash, no key on the account, the fee, slashed traders, the hash chain recomputed, feeds' labels, OutLayer's attestation recomputed from its transaction, and the run's transactions on an archival node |
| `npm test` | The TypeScript twin against the Rust core's vectors, the deflated Sharpe, the seeded state, the key store and the mainnet guards: 24 tests |
| `cd contracts && cargo test --release -p keyhole-core --features sha2` | Property tests: a window's nodes read exactly that window and nothing outside it (15 tests) |
| `npm run page-test` | Needs Chromium (`npx playwright install --with-deps chromium`). The web app driven through the whole moment in a headless browser: 34 checks |
| `npm run web`, or `npm run web:build` and serve `web/dist/` | The web app: see below |

### The web app

`npm run web` serves it in development; `web/dist/` is the static build, with relative paths, for any file server. It runs **the real contract wasm in your tab** on a local chain with no gas metering (`docs/decisions/0007`). Journals are SEEDED and every page says so. Reloading restarts the chain.

1. **The board.** "One of these numbers is false." **Try it: catch a false figure** lists three steps and has one button, **Buy a week of lucky-seven**. It also says how small his bond is beside his claim: that's why you check. Below, seven books, each with its PnL (gaps charged), its bond in NEAR and against the PnL, age, trades, buyers, checkable epochs, and a deflated Sharpe.
2. **The trader.** The posted PnL with the bond behind it, and a public journal of lacquer bars with real ciphertext inside. **Buy this week** makes a one-time key in the tab, and the trader's side, played by the page, wraps the nodes.
3. **The reader.** The keyhole draws what you bought: a brass window in the lacquered journal, and the tree nodes that cover exactly it. Entries in the window decrypt. **Try to open it anyway** on the next day's entry tries every key your window can derive, and none opens.
4. **Check the figures.** Your tab recomputes each day, and they don't match. **Prove it** runs `audit_open`, `audit_step` and `audit_conclude`: the trader is slashed, and the receipt shows his bond before, 40% to you, the rest burned, and the same proof on testnet. **Copy it here** signs a real intent and settles it on the `intents.near` wasm in the tab, with a local solver.
5. Tick **let this trader send garbage** on another book, buy, and dispute.

Screenshots at 1440×900: [the board](docs/screenshots/after/desktop-01-board.png), [a bought window](docs/screenshots/after/desktop-04-bought.png), [the liar caught](docs/screenshots/after/desktop-07-caught.png); at 390×844: [the board](docs/screenshots/after/phone-01-board.png), [caught](docs/screenshots/after/phone-07-caught.png). Every state, errors included: [`docs/screenshots/after/`](docs/screenshots/after/).

## On testnet

Contract [`app.near-keyhole-y4ow.testnet`](https://testnet.nearblocks.io/address/app.near-keyhole-y4ow.testnet): locked, with no key on the account. Slots are 20 s and epochs 3 minutes, so the run takes minutes. The 30 transactions of the run, the five of the OutLayer run, the failed `request_attested` and how to run it all on a deployment of your own are in [`docs/deployments.md`](docs/deployments.md); the record is [`docs/demo/testnet-run.json`](docs/demo/testnet-run.json).

`npm run verify` (also the first row of `npm run judge`) checks the code hash on chain against `git show a23a06c:res/keyhole.wasm`, the empty key list, the one-transaction deploy, the fee, both slashes, a hash chain recomputed from the entries, the feeds' labels, and the OutLayer attestation's input and output hashes recomputed from its transaction. In a copy without git history it compares the code hash with the one recorded in `testnet-run.json` instead, and says so. Checking the TDX quote itself takes OutLayer's verifier, which hasn't been run here.

The demo's traders stopped posting when the run ended, so the contract's `score` view, which charges every epoch with no figure, now shows them far below zero: the rule working, not a loss (`docs/deployments.md`).

## What a review found

Three times, after every test passed, a cold reader found real bugs: one let any buyer slash an honest trader, another let a trader's second account pull the whole bond out. All are fixed and tested: [`docs/research/review-2026-11-05.md`](docs/research/review-2026-11-05.md). A fourth read, on 2026-11-10, found the oracle limit below. Counts here say the checks are load-bearing, not that they are complete. **No human has audited this contract.**

## How NEAR is used, concretely

| NEAR piece | What it does here |
|---|---|
| A Rust contract on near-sdk 5.29 | Journal commitments, the sale, both dispute proofs, the fraud proof, slashing, refunds, the fee |
| Wasm gas budget | x25519 and ChaCha20 run inside a transaction, and that's what removes the operator: about 10 Tgas |
| SHA-256 host function | GGM walks, Merkle checks, tags, the hash chain |
| Block time | No backdating: a slot is checked against `block_timestamp`, and a trade's price against the rounds after it |
| Storage staking | Every byte is paid by whoever grew it. Ciphertext on chain means no data availability question |
| Promises and callbacks | `withdraw` restores a credit on failure; `import_round` reads near-borrowed-oracle; `nft_transfer_call`; OutLayer's yield/resume |
| NEP-171 | A purchase is a token that is the access right itself: it names the trader and the epochs, carries the buyer's one-time key, can be resold only while no keys exist, and is what a dispute, a refund and a settlement are made against |
| Access keys | The contract account has none: deployed, initialised and its key deleted in one transaction |
| `intents.near` (mainnet wasm, sandbox) | `execute_intents` with NEP-413 `token_diff` signed by the trader, the follower and a solver: replay, expiry, balance and signature refusals exercised |
| 1Click | Live keyless dry quotes. Setting `confidentiality` answers 401 without a user's auth: measured, and asserted by `npm run copy` (`docs/decisions/0011`) |
| near-borrowed-oracle (testnet) | A feed source: MPC-proven Chainlink rounds, read by a real cross-contract call |
| OutLayer | `request_execution` in its current 7-argument shape, a wasm32-wasip2 job pinned by sha256, the epoch's keys as an encrypted OutLayer secret. **Run for real in OutLayer's TEE on testnet** (request 15448, attestation committed), asked for by the trader, not by the contract. The contract's own yield/resume path runs against a stand-in with OutLayer's argument types; on the locked deployment it failed on the real one, and the source is fixed |

## Honest limits

The ones that matter most to a buyer. All of them: [`docs/limits.md`](docs/limits.md).

- **A journal is what a trader wrote.** An entry committed before the outcome is a valid record even if never executed. A settlement reference is his own claim, and the app shows it as "claims a fill (unverified)".
- **A lie can still pay.** A proven false figure costs its trader at least 60% of his bond (40% goes to the prover, even if that's his own second account; the rest burns). A lie that earns more than that is still worth telling, which is why the board shows the bond beside the PnL.
- **On a live feed, a trader can know his fill a few seconds ahead.** A Chainlink round's answer sits in Ethereum's mempool before the block that stamps it, and a trade is priced at the first round at or after its entry. Nothing on testnet is priced this way; the fix is the next version's, a set delay before the pricing round (`docs/decisions/0019`).
- **Recorded prices are trusted to the recorder, and on testnet they're public** (`fixtures/chainlink-rounds.json`), so the demo's PnL shows the mechanism, not skill. On a borrowed feed, whoever relays chooses which rounds exist (`docs/decisions/0010`).
- **One account can't prove it isn't one of ten,** and a buyer count costs only gas and the fee to fake. Bond, age, trades and the deflated Sharpe price that doubt, and don't remove it.
- **A buyer can leak** what he read. **A dispute publishes** that sale's nodes, so a false dispute gives the window away (and costs the griefer his deposit).
- **A trader can refuse a window,** and an offline trader can be made to. It costs him the escrow, half the price burned from the bond, and a charge on the record, once per epoch (`docs/decisions/0015`).
- **A publish-then-trade trader isn't caught.** Nothing forces a fill before the entry.
- **The contract is locked, its owner account isn't.** The `owner` can still register local runners (labeled `SimulatedLocal`) and set which job hash OutLayer runs. A bug in the locked contract stays: the fix is a new deployment.

## Libraries and AI code (Q-005)

**Written during the hackathon (from 2026-11-05),** with an AI coding assistant (Claude Code, under the author's direction): all of this repo's code. No code was written by hand.

**Copied from our own MIT repos and adapted:** `tools/nearkit.ts` and `tools/keys.ts` from near-verdict; `contracts/keyhole/src/nft.rs` and `contracts/mock-outlayer` from near-ghost-duels; `contracts/test-token` from near-circle (which took it from near-crop-cover and near-account-nfts); the wasip2 job's skeleton from near-verdict's `outlayer/`. The 1Click call is from an earlier experiment of ours. OutLayer's ECIES and FastFS formats in `tools/outlayer.ts` follow its CLI and dashboard (out-layer/outlayer-cli, out-layer/dashboard, Apache-2.0); no code was copied.

**Libraries:** near-sdk and near-contract-standards 5.29, x25519-dalek 2, sha2, proptest (Rust); near-api-js 7, @noble/curves, @noble/hashes, @noble/ciphers, @scure/base, React 19, Vite 8, Libre Caslon and Spline Sans Mono through Fontsource, Playwright, tsx (TypeScript). `res/intents.near.wasm` is the unmodified mainnet contract, pulled over RPC by `tools/pull-intents.ts` (code hash `BtA1BEFN…`, source at github.com/near/intents). Tools: wasmtime, wasm-opt, cargo-near, ffmpeg.

**Data:** real Chainlink rounds read from Ethereum mainnet by `tools/record-rounds.ts` into `fixtures/chainlink-rounds.json`.

<!-- OTHER-ENTRY: if the submitter has a second entry in this hackathon, name it here in one line, as the rules ask. -->

## Layout

- `contracts/core/`: pure logic shared by everything (GGM, Merkle, entries, PnL). `contracts/keyhole/`: the contract. `contracts/killtest/`, `mock-outlayer/`, `test-token/`: measurement and sandbox stand-ins.
- `lib/src/`: the TypeScript twin, the parties (`client.ts`), the local wasm host (`vm.ts`), intents signing, 1Click, the deflated Sharpe. `job/`: the wasip2 PnL job. `copy/`: the unexercised mainnet adapter.
- `tools/`: every command here. `web/`: the app. `res/`: built wasm, with `SHA256SUMS`. `fixtures/`: recorded rounds, cross-language vectors. `docs/decisions/`: why things are this way.

## Rebuild

`npm run build -- keyhole test-token mock-outlayer killtest job` needs Rust 1.93 (pinned), stable with `wasm32-wasip2` for the job, and **`cargo-near` 0.22**. `npm run check-res` builds a copy of HEAD in an empty target directory and compares with `res/SHA256SUMS`: it passes on macOS arm64 with exactly that toolchain. Another platform or another `cargo-near` (0.23 was tried) gives the same exported methods and different bytes, so a rebuild elsewhere won't match the committed hash; `cargo near build reproducible-wasm` in Docker is the way to close that, and it isn't set up (#14). The deployed code is checked against git, not against a rebuild.

MIT licensed.
