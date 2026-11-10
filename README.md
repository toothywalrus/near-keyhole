# Keyhole: sell a window into your private trade journal, with the PnL bonded first

**Keyhole lets a trader sell read access to exactly the days of his encrypted trade journal a buyer paid for, on NEAR: the keys past the window never exist, so nothing has to be revoked. Every PnL figure on the board has a bond behind it, and the contract itself opens the entries, recomputes the figure against oracle prices and slashes a false one, with no operator.**

**Demo:** ‹hosted demo link: the owner adds it› · **Video:** [`docs/demo/keyhole-demo.mp4`](docs/demo/keyhole-demo.mp4) (posted: ‹link›) · **Post:** ‹link› · **Contract:** [`app.near-keyhole-y4ow.testnet`](https://testnet.nearblocks.io/address/app.near-keyhole-y4ow.testnet), locked

## Quick start

1. `git clone https://github.com/toothywalrus/near-keyhole && cd near-keyhole && npm ci`
2. `npm run judge`: about a minute on a 2-CPU box, free, no keys. It ends in the table below.
3. `npm run web`, then open http://localhost:5191: the board. Press **Buy a week of lucky-seven**, read it, try the next day's entry, and **Prove it**. The page walks you through it.

**Prerequisites.** `npm run judge` needs only Node 20 or newer and network access to NEAR testnet's public RPC (`--offline` skips those reads), on any OS. No Rust, no keys, no local node, no browser.
`npm run judge:full` (about 17 minutes, plus 11 for the mutants) also needs: Linux with **glibc 2.38 or newer** (Ubuntu 24.04, Debian 13) or macOS on Apple Silicon, for NEAR's sandbox binary 2.14.0, which it downloads (about 60 MB); **Chromium and its system libraries** (`npx playwright install --with-deps chromium`); **Rust 1.93.0**, pinned by `contracts/rust-toolchain.toml` (rustup installs it), with `cargo-near` 0.22; and `wasmtime` for the job. Anything missing shows as SKIP with the reason, never as FAIL.
**Docker, on any Linux:** `docker run --rm -v "$PWD":/src:ro node:22-bookworm bash -c 'cp -a /src /w && cd /w && rm -rf node_modules && npm ci && npm run judge'`

What `npm run judge` prints at the end (measured from a fresh clone in Debian 12, the image the screeners used, with 2 CPUs and 3 GB: `npm ci` 5 s and `npm run judge` 53 s, **59 s in all**; 2 min 6 s on the same box while other sandboxes kept it busy (load average 10 to 19). On an Apple Silicon Mac it takes about 12 s. Without network the testnet row says SKIP):

```
PASS  Testnet: the deployed contract re-read from the chain (views only)                26/26 chain checks passed
PASS  TypeScript twin = the Rust core's vectors; deflated Sharpe; seeded state; a copy
      trade on the real intents.near wasm; key store; mainnet guards                  tests passed: 24
PASS  Attack suite on the real contract wasm (local host)                             354/354 attack checks passed
PASS  Ledger fuzz: every yocto re-added after each random operation                   614 random operations, books balanced
4 passed, 0 failed, 0 skipped
```

`npm run judge:full` adds these rows (measured on macOS arm64, 17 minutes with `--no-mutate`; the 94 mutants alone took 11 minutes):

```
PASS  Rust core: a window's keys read exactly that window (property tests)          15 passed
PASS  Rust contract: unit and property tests                                        6 passed
PASS  Kill test: a key-sale dispute's gas, on a local NEAR node                     9.27 Tgas for the whole dispute
PASS  Copy trade: NEP-413 token_diff on the mainnet intents.near wasm, local node   22/22 copy checks passed
PASS  The complete moment, on a local NEAR node                                     29 transactions
PASS  Attested job under wasmtime (SIMULATED label), OutLayer's yield shape         17/17 job checks passed
PASS  Attack suite on a local NEAR node, real epochs                                210/210 attack checks passed
PASS  The web app, driven in a headless browser                                     33/33 page checks passed
PASS  Mutation check: every security-critical line broken, rebuilt, and caught     94/94 mutants caught
```

## Status (2026-11-10)

**Real, on NEAR testnet:** the contract [`app.near-keyhole-y4ow.testnet`](https://testnet.nearblocks.io/address/app.near-keyhole-y4ow.testnet), **deployed, initialised and locked in one transaction** ([`2sWeD43DFU…`](https://testnet.nearblocks.io/txns/2sWeD43DFUhifqLKkyKggRi58msT4LXmUJYRpcQqGXXm): deploy the wasm, call `new`, delete the only key), so nobody can change its code or move its NEAR. One complete run with explorer links: sale, delivery, a false figure proven and slashed by the contract's own recomputation, garbage keys proven and slashed, a false dispute dismissed, a sale settled with the protocol's 5% to its treasury, and a real cross-contract read of a round from near-borrowed-oracle. **The PnL job ran in OutLayer's real TEE** (Intel TDX, request 15448): it read a trader's journal over HTTP, opened the epoch with keys held as an OutLayer secret, and printed the figure he had posted, to the unit. Its attestation is committed. `npm run verify` re-reads all of it from the chain, the attestation's input and output hashes included.

**Real, in a local sandbox and in the browser tab:** a NEP-413 `token_diff` copy trade settling on the **mainnet `intents.near` wasm**, with limits and slippage. Live keyless 1Click dry quotes. The attack suite on a real node.

**What it isn't:** a journal is what the trader wrote, not proof of a trade. No public viewing key exists for a real confidential trade, so the key covers this journal. No human has audited the contract. Nothing has touched mainnet.

**SIMULATED, and labeled so:**
- Every journal on the web app's board is **SEEDED**: rule-based strategies run over real recorded Chainlink rounds. The trades never happened, and the page runs on a local chain in your browser.
- Prices on testnet are real Chainlink rounds **replayed by a trusted recorder**, labeled `Recorded` by the contract's `get_feeds`.
- The attested figure on vega's epoch is a local run under wasmtime with **no enclave**, and the contract labels it `SimulatedLocal`. The enclave run above was asked for by the trader directly: the locked contract's own `request_attested` sent OutLayer arguments it refuses (fixed in source since), so **no epoch on testnet is labeled `OutLayerTee`**.
- The tokens and solver in the copy paths, sandbox and in-tab, are local stand-ins; only the Intents contract is the real wasm. The 3 bps of copy slippage there is the local solver's spread.
- `copy/confidential-adapter.ts`, a mainnet confidential adapter, is written against the docs and has **never been exercised**.

**Built for NEAR HACKATHON**, tracks **privacy**, **defi**, **agents**. A technical demo, not investment advice: selling trading signals is regulated in many places.

## The problem

Illia Polosukhin, Nov 4: *"Private trading where you sell your viewing keys for people to follow/copy trade. NEAR Intents confidential trading is all private, so you can have a social trading app where people sell 'keys' for only select people to see. PnL can be publicly displayed so people can choose to buy in."*

Three things stand in the way. Nobody can check a private trader's PnL before paying. A plain viewing key can't be taken back. And selling a key needs someone to rule when what's delivered is garbage. On top of that, Confidential Intents documents no viewing key (read 2026-11-05), so the key here covers a journal the trader writes, bound to real time.

## What it is, in four pieces

**1. A window key that is mathematics, not access control.** Each entry is encrypted under a leaf of a GGM tree over time slots: a binary hash tree from one secret seed. To sell a window, the trader hands over the few inner nodes that cover it: at most 32, for 65,536 slots. The buyer can read exactly that window, with no revocation, no rotation, no TEE and no online seller.

**2. A key sale with no operator.** The nodes are wrapped to a one-time key the buyer made for this purchase. The contract computes the cover itself and checks each node's commitment against a Merkle root posted before any sale. Payment sits in escrow. If the wrap is garbage, the buyer reveals the one-time secret, and **the contract itself runs x25519 and ChaCha20**, compares, refunds and slashes the bond: 40% to the prover, the rest burned. A second proof catches a trader who commits to one tree and encrypts with another.

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

**What it isn't:** a journal is what the trader wrote. It's a checkable *signal record*, not a brokerage statement. A settlement reference is his unverified claim, the contract never reads it, and no public viewing key exists for a real confidential trade (`docs/decisions/0014`).

## The business

**Who pays:** a follower, per window of a trader's journal, at the trader's own bonding-curve price. **Who earns:** the trader, 95% of every sale that closes in his favour; the protocol, **5%** (`fee_bps`, set once per deployment, at most 20%), credited to a treasury account at settlement (`docs/decisions/0016`). A refunded window, a slashed trader and a missed delivery pay no fee, and no fee ever comes from a bond: the protocol earns only when a buyer got what he paid for, so it has no stake in how a dispute ends. A resale between holders pays the fee on its ask.

**Why a buyer pays more here than for a plain viewing key:** the figure he buys on is bonded before he pays and provable after, by him, in the contract; the key can't be revoked or leaked forward, because nothing past the window was ever made; and the escrow comes back whole if the window lapses, breaches its floor or the trader is caught. NOVA's keys are revocable and its PnL is checked after buying.

**Where it stands:** testnet, a 5% fee live in the locked contract and in the seeded app, no revenue. The first real sale and a real copy are prepared for mainnet (`tools/mainnet.ts`) and are the owner's to run. The legal posture of selling signals is open: see the first line of the honest limits.

## Do this, see that

From a fresh clone: `npm ci`. Node 20+ is enough for everything in `npm run judge`, since the built wasm is in `res/`.

| Do | See |
|---|---|
| `npm run judge` | The fast path, about a minute on 2 CPUs: the table above |
| `npm run judge:full` | Everything below that runs on this machine, ending in a table: about 17 minutes, plus 11 for the mutants (`--no-mutate` leaves them out) |
| `npm run attack` | 354 attack checks on the real wasm, in about 2 seconds on a laptop. Each states what must be refused: garbage key, false PnL, backdated entry, deleted loser, window overreach, resale replay, a fee taken from a refund, and more |
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
| `npm run web:build`, then serve `web/dist/` | The web app: see below |

### The web app

`web/dist/` is a static build, ready to host. `npm run web` serves it in development; any file server works for `web/dist/`:

1. **The board.** "One of these numbers is false." Beside it, **Try it: catch a false figure** lists steps 2 to 4 and has one button, **Buy a week of lucky-seven**. Below, seven books: PnL with gaps charged, bond in NEAR and against the PnL, age, trades, buyers, how many epochs a past buyer could check, gaps, and a deflated Sharpe with the number of assumed journals you choose (blank on too few active days). See that the top number comes with a bond.
2. **`lucky-seven`.** The posted PnL, with the bond behind it. The public journal is black lacquer bars with real ciphertext inside. **Buy this week**: a one-time key is made in the tab, and the trader's agent, played by the page, wraps the nodes. From here on, the top of each page shows which of the three steps you're on.
3. **The reader.** The keyhole draws what you bought: a brass window in the lacquered journal, and the nodes that cover exactly it. Entries in the window decrypt. **"Try to open it anyway"** on the next day's entry tries every key your window can derive, and none opens.
4. **Check the figures.** Your tab recomputes each epoch. They don't match. **"Copy it here"** first, if you like: it signs a real intent and settles it on the real `intents.near` wasm in your tab, with a local solver. **"Prove it"** runs `audit_open`, `audit_step` and `audit_conclude`. The trader is slashed: the receipt shows his bond before, 40% to you, the rest burned, and links the same proof on testnet. The board now says so for good.
5. Tick **"let this trader send garbage"** on another book, buy, and dispute.

All of it runs **the real contract wasm in your tab** on a local chain with no gas metering (`docs/decisions/0007`), with the same 5% fee. Journals are SEEDED, and every page says so. Reloading restarts the chain. "Proof" lists the testnet run and reads the testnet contract live.

Screenshots at 1440×900: [the board](docs/screenshots/after/desktop-01-board.png), [a bought window](docs/screenshots/after/desktop-04-bought.png), [the liar caught](docs/screenshots/after/desktop-07-caught.png); at 390×844: [the board](docs/screenshots/after/phone-01-board.png), [caught](docs/screenshots/after/phone-07-caught.png). Every state, errors included, is in [`docs/screenshots/after/`](docs/screenshots/after/) (`npx tsx tools/screens.ts` retakes them). Recording, of the page before its redesign: [`docs/demo/keyhole-demo.mp4`](docs/demo/keyhole-demo.mp4).

## On testnet

Contract [`app.near-keyhole-y4ow.testnet`](https://testnet.nearblocks.io/address/app.near-keyhole-y4ow.testnet): locked, with no key on the account. Slots are 20 s and epochs 3 minutes, so that the demo runs in minutes. The whole run is in [`docs/demo/testnet-run.json`](docs/demo/testnet-run.json).

| Step | Tgas | Transaction |
|---|---:|---|
| deploy the wasm, `new`, delete the only key: one transaction | | [`2sWeD43DFU…`](https://testnet.nearblocks.io/txns/2sWeD43DFUhifqLKkyKggRi58msT4LXmUJYRpcQqGXXm) |
| vega registers: a bond, a root committing to a key tree | 2.67 | [`4NRVvVjmny…`](https://testnet.nearblocks.io/txns/4NRVvVjmnytoJREcb2H1W8saAaXRvD4Y5oWuydqnQNNM) |
| lucky registers: a bond, a root committing to a key tree | 2.69 | [`8mxgVYrpeE…`](https://testnet.nearblocks.io/txns/8mxgVYrpeErV28QuifF993mVvfbNKhrQBLtXwDpmJPQ7) |
| mallory registers: a bond, a root committing to a key tree | 2.69 | [`85Ac3qxcp7…`](https://testnet.nearblocks.io/txns/85Ac3qxcp7ZBL4DxJcNkeEJ8STgygUR61WiT17GhtehV) |
| vega writes: long ETH | 3.71 | [`9WgDfewdy4…`](https://testnet.nearblocks.io/txns/9WgDfewdy4oT6eDcBKjLXdjzmKpygfUHP5zyiJNjahfh) |
| lucky writes: a small long | 3.71 | [`EnhbJSiPTt…`](https://testnet.nearblocks.io/txns/EnhbJSiPTtu3EvCtThTbWrspWtrTxURWwzSQTMFRRcPf) |
| lucky writes: a BTC short | 3.82 | [`7KBYV45TdA…`](https://testnet.nearblocks.io/txns/7KBYV45TdAKcuj7cyHtdnVC2shwun5FHx3pZa8uQWMSF) |
| vega writes: a BTC hedge | 3.82 | [`9rzw7Usa6t…`](https://testnet.nearblocks.io/txns/9rzw7Usa6twBu48zFNE3uYRntUqBw6Q8AtZsBxbRbMRC) |
| vega posts the true figure: $26.35 | 3.44 | [`4CUxQAxmqX…`](https://testnet.nearblocks.io/txns/4CUxQAxmqXTyjXeb6FDStdRAswWHrSFyG9pjbtt4pdk5) |
| lucky posts a LIE: $25380.47 (truth: $380.47) | 3.44 | [`2rQaP4Twov…`](https://testnet.nearblocks.io/txns/2rQaP4TwovhcLjAVNpn8aoMQQfPsx7CJvw9uGDbKkzFA) |
| mallory posts an empty epoch | 3.42 | [`DaDsLtm5sG…`](https://testnet.nearblocks.io/txns/DaDsLtm5sG2yYxtz4Af64ppaDN6VRiUUwNCVG8vf8EoR) |
| vega writes the next day's entry | 3.80 | [`C4M2R2qg26…`](https://testnet.nearblocks.io/txns/C4M2R2qg265g2KrzTdTw6qNnsQXvfN417s8MrYPnvnbR) |
| buy epoch 1 of vega's journal, a NEP-171 token | 7.63 | [`HuDyjtKtwh…`](https://testnet.nearblocks.io/txns/HuDyjtKtwhUUu8budTB6d3uVqUZXLZoP5kL8wydoi5So) |
| vega delivers: nodes wrapped to her one-time key | 8.43 | [`DEEWA3mAfW…`](https://testnet.nearblocks.io/txns/DEEWA3mAfWtxYLPZfwK9oKt6bAUcaWoiFfehZRbViVhp) |
| buy epoch 1 of lucky's journal | 7.66 | [`YNPrR9afF8…`](https://testnet.nearblocks.io/txns/YNPrR9afF86arr4kAaDwUjTqsPgXnSfhLMRNzqVPo9d) |
| lucky delivers honestly: the journal itself isn't the lie | 8.43 | [`9Bvn1kvDQ4…`](https://testnet.nearblocks.io/txns/9Bvn1kvDQ41ALxhhRjXjo3PMk3mEhgR6Mjysski9MDNo) |
| audit_open: the deposit goes at risk | 3.34 | [`AC6KF5oQ39…`](https://testnet.nearblocks.io/txns/AC6KF5oQ3956a4w4ArtFcByUp7TMqg1fgzocZcEQZuqi) |
| audit_step: 2 entries opened in the contract | 3.12 | [`99j4AWm4L9…`](https://testnet.nearblocks.io/txns/99j4AWm4L9ESmCsT6rvPaLXh8ZAoEnP2iMo2X8QGcoxv) |
| audit_conclude: recomputed, compared, slashed | 3.43 | [`HbxTcSjNyo…`](https://testnet.nearblocks.io/txns/HbxTcSjNyoi8tVgyAA5eFsfVymcAD4CCVXaaMvuoD21T) |
| claim_refund: the escrow back | 2.95 | [`AfFxfXabvY…`](https://testnet.nearblocks.io/txns/AfFxfXabvY3pbkmDWW8Tt3mvdE1SWyxebxki65jtbxET) |
| withdraw | 5.43 | [`66w1ftpXsX…`](https://testnet.nearblocks.io/txns/66w1ftpXsX4Y8bWHT9XMzzGERWEuWHGJ5fBiXzbaQGcZ) |
| she buys a window of mallory's journal | 7.66 | [`9mrR2fAA2J…`](https://testnet.nearblocks.io/txns/9mrR2fAA2JtbB7EABvmcq1s1bKFF1UK2aowT8YopqKNF) |
| mallory delivers garbage for one node | 8.43 | [`9Dwj7NReRe…`](https://testnet.nearblocks.io/txns/9Dwj7NReReag9wfvRh1BTSpSLr41Vdne5aXjgYzRYQ7K) |
| dispute_wrap: secret revealed, the contract unwraps and compares | 10.44 | [`3QioDitSjs…`](https://testnet.nearblocks.io/txns/3QioDitSjsRcnxGJ3gQoCXEyYoPrY6B7DKSs15BR9dVQ) |
| someone else buys vega's window | 7.64 | [`ByPYkRrztx…`](https://testnet.nearblocks.io/txns/ByPYkRrztxhqVo4RWgdKhs4YHotvXFP96NCL1v4nmRRM) |
| vega delivers honestly | 8.43 | [`Fw4rv5XYVG…`](https://testnet.nearblocks.io/txns/Fw4rv5XYVGyoqZ7uYQKtp6PYhUVDE4EmUQLdd5jkmNJL) |
| dispute_wrap with nothing wrong | 10.04 | [`3ogk5HR1GK…`](https://testnet.nearblocks.io/txns/3ogk5HR1GKZdUMBmFNP1ZB4z6SUiZTEDrGCW3AxCX7HG) |
| the owner registers a local runner | 2.40 | [`7XAYCSa3j7…`](https://testnet.nearblocks.io/txns/7XAYCSa3j78SqzZN1byZJsVFeibTmaYixxaz3bauktbc) |
| the runner submits the job's output | 3.47 | [`9KuK7RAvzD…`](https://testnet.nearblocks.io/txns/9KuK7RAvzDqb2S4NM4ys9zyKU6EbMgM3qRMQ7Zu2Aiyv) |
| settle: the challenge window is over, the escrow is released | 3.11 | [`J62rNcfv41…`](https://testnet.nearblocks.io/txns/J62rNcfv41rb5KmRzoQBuKNQjJwap6VNe1zmksLgqgj) |
| import_round: a real cross-contract read of the proven round | 6.71 | [`4Hbb4JHrVe…`](https://testnet.nearblocks.io/txns/4Hbb4JHrVejh24NMSJqB4decG3RSjkhYvdrXu8vV5zqi) |

Run it yourself on your own deploy with `KEYHOLE_ROOT=<your-account>.testnet npm run demo -- --testnet` (a funded root account, its key in the OS keyring: the macOS keychain, or `secret-tool` on Linux; `npx tsx tools/faucet.ts <name>.testnet` makes one from the public faucet).

**The first deployment stays on chain as history:** [`app.keyhole-g1zo8i.testnet`](https://testnet.nearblocks.io/address/app.keyhole-g1zo8i.testnet), from 2026-11-05, before the fee, with a full-access key. Its run is [`docs/demo/testnet-run-v1-unlocked.json`](docs/demo/testnet-run-v1-unlocked.json). A new version goes to a new account (`docs/decisions/0017`).

## In OutLayer's TEE, on testnet

`npx tsx tools/outlayer.ts` does this with no sign-up and no API key, paying in testnet NEAR (it needs the deployment's root key in the OS keyring):

| Step | Transaction |
|---|---|
| The job's wasm on FastFS, served at test.fastfs.io and checked by its sha256 (the transaction fails by design: the indexer reads its arguments) | [`6TSbLfB6bQ…`](https://testnet.nearblocks.io/txns/6TSbLfB6bQWYkFzVzcBjSXwhAZx9gEYMYgRqJLXZRTk6) |
| The contract's owner pins `outlayer.testnet` and the job's sha256 (`set_outlayer`) | [`GZpeciwcmt…`](https://testnet.nearblocks.io/txns/GZpeciwcmtMeKQnCAaVHGs42twpK6Ppx1eUhWKMwFcmy) |
| A trader with no buyers, `oliutl`, writes two entries in epoch 8 and posts $12.35 | |
| The epoch's two tree nodes become an OutLayer secret: encrypted on this machine to the keystore's X25519 key (OutLayer's ECIES v1), bound to the job's sha256 | [`69QxQvacsD…`](https://testnet.nearblocks.io/txns/69QxQvacsDt4qFJ2M4gyB2DTV6tXNYP5pfuSYAKN3Ca3) |
| The job runs in Intel TDX: it reads the journal over HTTP, opens both entries and prints `12352646`, the posted figure, to the unit | [`9yQdrxsicF…`](https://testnet.nearblocks.io/txns/9yQdrxsicFRVf1Ni4kYdkUfcEdnnpatx9pshyos5zWkS) |

The attestation, [`docs/research/outlayer-attestation-request-15448.json`](docs/research/outlayer-attestation-request-15448.json), carries a 5,007-byte TDX quote and binds the job's sha256 (`5d814c08…`, which is `res/keyhole_pnl_job.wasm`), the sha256 of the request's input and that of its output. `npm run verify` recomputes the last two from the transaction on chain. Checking the quote itself takes OutLayer's verifier, which isn't run here (owner's step 7).

**What didn't work, and how it shows:** the contract's own path, `request_attested`, failed on this locked deployment ([`9MHogMxp4D…`](https://testnet.nearblocks.io/txns/9MHogMxp4DAfMkaKgx1KaTf2NejpsUVrk7jJsRvuuny6)). It sent OutLayer's resource limits as JSON strings, and `outlayer.testnet` takes numbers. Its callback logged "OutLayer gave no result" and wrote nothing, so no epoch here is labeled `OutLayerTee`, and `npm run verify` checks that. The source is fixed, and the sandbox stand-in now takes OutLayer's own types: the deployed wasm fails `npm run job` and one attack check, the fixed one passes. So the locked contract is the build of `a23a06c`, one fix behind this tree; `npm run verify` checks it against `git show a23a06c:res/keyhole.wasm`.

## What a review found

Three times, after every test passed, a reader with no stake in the design found real bugs: one let any buyer slash an honest trader, another let a trader's second account pull the whole bond out. All are fixed and tested, and what was disputed is said: [`docs/research/review-2026-11-05.md`](docs/research/review-2026-11-05.md). The fee had its own cold read before it shipped: it found no bug in the books, and its three risks (a treasury that is the contract itself, dodging the fee through a resale, the storage a second credit takes) are fixed. Counts here say the checks are load-bearing, not that the checks are complete. **No human has audited this contract.**

## How NEAR is used, concretely

| NEAR piece | What it does here |
|---|---|
| A Rust contract on near-sdk 5.29 | Journal commitments, the sale, both dispute proofs, the fraud proof, slashing, refunds, the fee, NEP-171 tokens |
| Wasm gas budget | x25519 and ChaCha20 run inside a transaction, and that's what removes the operator: about 10 Tgas |
| SHA-256 host function | GGM walks, Merkle checks, tags, the hash chain |
| Block time | No backdating: a slot is checked against `block_timestamp`, and a trade's price against the rounds after it |
| Storage staking | Every byte is paid by whoever grew it. Ciphertext on chain means no data availability question |
| Promises and callbacks | `withdraw` restores a credit on failure; `import_round` reads near-borrowed-oracle; `nft_transfer_call`; OutLayer's yield/resume |
| Access keys | The contract account has none: deployed, initialised and its key deleted in one transaction |
| `intents.near` (mainnet wasm, sandbox) | `execute_intents` with NEP-413 `token_diff` signed by the trader, the follower and a solver: replay, expiry, balance and signature refusals exercised |
| 1Click | Live keyless dry quotes. Setting `confidentiality` answers 401 without a user's auth: measured, and asserted by `npm run copy` (`docs/decisions/0011`) |
| near-borrowed-oracle (testnet) | A feed source: MPC-proven Chainlink rounds, read by a real cross-contract call |
| OutLayer | `request_execution` in its current 7-argument shape, a wasm32-wasip2 job pinned by sha256, the epoch's keys as an encrypted OutLayer secret. **Run for real in OutLayer's TEE on testnet** (request 15448, attestation committed), asked for by the trader. The contract's own yield/resume path runs against a stand-in with OutLayer's argument types; on the locked deployment it failed on the real one, and the source is fixed |

## Honest limits

- **A buyer can leak** what he read, or the keys themselves. No watermarking is attempted.
- **A dispute publishes.** Revealing the one-time secret makes that sale's nodes public, so a false dispute gives the window away. The griefer loses a deposit of at least the price to the trader, but the leak has no fix short of zero knowledge. An audit publishes one epoch's trades, which is why a trader can't be slashed without them.
- **One account can't prove it isn't one of ten.** Bond, age, trades and the deflated Sharpe price that doubt.
- **A buyer count is only as real as what it costs to fake.** A trader buying from himself pays only gas and the 5% fee.
- **Slashing yourself recovers 40% of the bond** through a second account, and no more: the rest burns, and no buyer is paid from a bond. So a proven lie always costs at least 60%, and that is the guarantee, not the whole bond.
- **A trader can refuse a window.** Delivery can't be forced, so a refusal keeps that window's figures from ever being proven false. What it can't do is keep them believed: a refused epoch's gain stops counting (a loss stays), the refusal costs at least 2% of the book per epoch on the record, the escrow goes back, and half the price burns from the bond, once per epoch withheld (`0015`).
- **An offline trader can be made to refuse.** A window that is already over can be bought at any moment, and the trader has `catchup_grace_secs` (48 h in the app, 10 minutes on testnet) to deliver. If his agent is down longer, a stranger can buy windows over past epochs and have them refused, at no cost to himself. It costs the trader what's described above, but no more than once per epoch. `set_paused` stops sales for a planned outage.
- **A publish-then-trade trader isn't caught.** Nothing forces a fill before the entry. Next-round pricing stops him profiting on the record from it, but not from trading against followers.
- **A journal is what a trader wrote.** An entry committed before the outcome is a valid record even if never executed. A settlement reference is his own claim: a random hash is accepted, and the app shows it as "claims a fill (unverified)". Real confidential trades live on mainnet, with history invite-only, and no public viewing key exists.
- **A figure with no buyers is checked by nobody** but its bond, unless the attested job has run on it. On testnet one figure has been computed in OutLayer's TEE, at the trader's request; the contract's `OutLayerTee` label needs a deployment with the `request_attested` fix (owner's step 7).
- **On a live feed, a trader can know his fill a few seconds ahead.** A trade is priced at the first round at or after its entry, and a Chainlink round's answer sits in Ethereum's mempool before the block that stamps it. A trader who watches it can commit an entry on NEAR in between and be filled at a price he already knew. Repeated, that's paper PnL without risk, and an audit finds the figure true. Nothing on testnet is priced this way (every trade there uses recorded feeds), and the contract is locked, so the fix is the next version's: price at a round at least a set delay after the entry (`docs/decisions/0019`).
- **Recorded prices are trusted to the recorder, and on testnet they're public.** The rounds replayed on testnet are in `fixtures/chainlink-rounds.json`, so a trader there can know the next price: the demo's PnL shows the mechanism, not skill. A proven feed is only as dense as its relayers: a trader could try to relay only favourable rounds (`docs/decisions/0010`).
- **The contract is locked, its owner account isn't.** Nobody can change the code or move the contract's NEAR. The `owner` account it was initialised with can still register local runners (their figures are labeled `SimulatedLocal`) and set which job hash OutLayer runs (`set_outlayer`), which decides what `OutLayerTee` means. Both are public views. A bug in the locked contract stays: the fix is a new deployment.
- **`OutLayerTee` trusts the owner's choice of job.** The contract gives that label only to a callback from OutLayer's own account, and pins the wasm hash, but the owner picks the hash. It's public: compare it with a rebuild.
- **The window is priced in epochs.** Empty windows are possible: a trader may post a flat figure and write nothing. The buyer can see the journal's public count before buying a past window, but not a future one.
- **The fee can't change.** It's set at `new`; a different rate is a new deployment. After a window has closed, a later `dispute_entry` slashes the trader but returns no escrow, and the treasury keeps its 5% of that sale, as the trader keeps his 95%.
- **Testnet and sandbox only.** Nothing here has touched real money.

## Competitors, stated fairly

**NOVA Copy-Trading** ([jcarbonnell/nova-copy-trading](https://github.com/jcarbonnell/nova-copy-trading)) shipped this idea on mainnet on Nov 4, and it's good work: a `JUDGES.md`, mutation tests, a recorded live run with real USDC. We took its `JUDGES.md` and mutation habits as ideas, not its code.

| | NOVA Copy-Trading | Keyhole |
|---|---|---|
| The PnL before you pay | Claimed, with per-entry hashes on chain. The follower checks it after buying | Bonded before you pay. Any past buyer can prove it false on-chain, and the contract recomputes it |
| How access ends | The seller revokes, and NOVA's TEE rotates the group key | No node past the window was ever delivered. Nobody needs to be online |
| Paying and access | Pay, then the seller checks and admits. No escrow yet (its own README says so) | One sale in the contract: escrow, delivery, dispute, refund |
| Where it runs | **Mainnet, real USDC, the real Agent API.** Further along than this | Testnet, locked, and a sandbox |
| Copies | Dry quotes, inside owner-signed policies enforced by the Agent API | A real signed `token_diff` against the Intents wasm in a sandbox, plus live dry quotes. Limits are the app's, not a signed policy |
| Trust in the journal | NOVA's TEE and contract for keys | Only the chain, SHA-256 and ChaCha20. x25519 for the wrap |

Others in the field, as of Nov 5 (145 entries, read from the hackathon's API): nobody else found building this exact design. GitHub search misses private repos, and most teams submit late, so that's a floor.

## Libraries and AI code (Q-005)

**Written during the hackathon (from 2026-11-05),** with an AI coding assistant (Claude Code, under the owner's direction): all of this repo's code. No code was written by hand.

**Copied from our own MIT repos and adapted:** `tools/nearkit.ts` and `tools/keys.ts` from near-verdict; `contracts/keyhole/src/nft.rs` and `contracts/mock-outlayer` from near-ghost-duels; `contracts/test-token` from near-circle (which took it from near-crop-cover and near-account-nfts); the wasip2 job's skeleton from near-verdict's `outlayer/`. The 1Click call is from near-lab's `spikes/oneclick-quote`. OutLayer's ECIES and FastFS formats in `tools/outlayer.ts` follow its CLI and dashboard (out-layer/outlayer-cli, out-layer/dashboard, Apache-2.0); no code was copied.

**Libraries:** near-sdk and near-contract-standards 5.29, x25519-dalek 2, sha2, proptest (Rust); near-api-js 7, @noble/curves, @noble/hashes, @noble/ciphers, @scure/base, React 19, Vite 8, Libre Caslon and Spline Sans Mono through Fontsource, Playwright, tsx (TypeScript). `res/intents.near.wasm` is the unmodified mainnet contract, pulled over RPC by `tools/pull-intents.ts` (code hash `BtA1BEFN…`, source at github.com/near/intents). Tools: wasmtime, wasm-opt, cargo-near, ffmpeg.

**Data:** real Chainlink rounds read from Ethereum mainnet by `tools/record-rounds.ts` into `fixtures/chainlink-rounds.json`.

## Needs the owner

Each is prepared; none has been done. One line each:

1. **Hosting:** publish `web/dist/` (a static build with relative paths) at a public URL, put it in this README's first lines and the repo's homepage field: `npm run web:build`, then upload `web/dist/`.
2. **The post and the video:** post the thread in [`docs/demo/x-post.md`](docs/demo/x-post.md) with `docs/demo/keyhole-demo.mp4`, then put both links in the first lines here.
3. **The repo public, and the submission.**
4. **Mainnet, locked, with one real sale:** `KEYHOLE_MAINNET_ROOT=<you>.near npx tsx tools/mainnet.ts plan` (read-only), then `CONFIRM_MAINNET=1 KEYHOLE_MAINNET_ROOT=<you>.near npx tsx tools/mainnet.ts deploy`, then `... sale` (run it again when it says; about three hours), then `npx tsx tools/mainnet.ts verify`. About 6.5 NEAR, most of it the contract's storage. Keys come from the OS keyring under the service `near-mainnet`.
5. **One real Intents copy, about $1:** with 1 USDC on the follower's NEAR account, `CONFIRM_MAINNET=1 KEYHOLE_MAINNET_ROOT=<you>.near npx tsx tools/mainnet.ts copy`. Legal advice first: see the first line of this README's limits.
6. **Confidential trades** (`copy/confidential-adapter.ts`) need a user's JWT, an account and real money (#2).
7. **The contract's own OutLayer path, on a deployment with the fix:** about 9 testnet NEAR (this repo's one faucet draw paid for the current deployment). With a funded testnet account of yours as the root: `KEYHOLE_ROOT=<it> npm run demo -- --testnet && KEYHOLE_ROOT=<it> npx tsx tools/outlayer.ts`. To check the TDX quote of request 15448 yourself: `cargo install --git https://github.com/out-layer/outlayer-verify` and `outlayer-verify tx 9yQdrxsicFRVf1Ni4kYdkUfcEdnnpatx9pshyos5zWkS --network testnet --api https://testnet-api.outlayer.ai`.

## Layout

- `contracts/core/`: pure logic shared by everything: GGM, Merkle, entries, PnL. `contracts/keyhole/`: the contract. `contracts/killtest/`, `mock-outlayer/`, `test-token/`: measurement and sandbox stand-ins.
- `lib/src/`: the TypeScript twin, the parties (`client.ts`), the local wasm host (`vm.ts`), intents signing, 1Click, the deflated Sharpe.
- `job/`: the wasip2 PnL job. `copy/`: the unexercised mainnet adapter. `tools/`: every command here (`judge.ts`, `testnet.ts`, `outlayer.ts`, `mainnet.ts`, `faucet.ts`, ...). `web/`: the app. `res/`: built wasm, with `SHA256SUMS`. `fixtures/`: recorded rounds, cross-language vectors. `docs/decisions/`: why things are this way. `JUDGES.md`: every claim mapped to code, test and command.

## Rebuild

`npm run build -- keyhole test-token mock-outlayer killtest job` needs Rust 1.93 (pinned), stable with `wasm32-wasip2` for the job, and `cargo-near`. The wasm in `res/` is what's deployed: `npm run verify` compares the code hash on testnet with it. `npm run check-res` builds a copy of HEAD at another path, in an empty target directory, and compares with the committed `res/SHA256SUMS`, writing nothing: it passes on macOS arm64 with cargo-near 0.22 and Rust 1.93. Source paths are remapped out of the wasm. Another platform or toolchain may produce different bytes; the docker build in `cargo near build reproducible-wasm` is the way to close that, and it hasn't been set up (#14).

MIT licensed.
