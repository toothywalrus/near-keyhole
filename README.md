# Keyhole: sell a window into your private trades, and prove the PnL first

> **Status (2026-11-05)**
>
> **Real, on NEAR testnet:** the contract [`@@CONTRACT@@`](https://testnet.nearblocks.io/address/@@CONTRACT@@), and one complete run with explorer links: sale, delivery, a false figure proven and slashed by the contract's own recomputation, garbage keys proven and slashed, a false dispute dismissed. A real cross-contract read of a round from near-borrowed-oracle. `npm run verify` re-reads all of it from the chain.
>
> **Real, in a local sandbox:** a NEP-413 `token_diff` copy trade settling on the **mainnet `intents.near` wasm**, with limits and slippage. Live keyless 1Click dry quotes. The attack suite on a real node.
>
> **SIMULATED, and labeled so:**
> - Every journal on the web app's board is **SEEDED**: rule-based strategies run over real recorded Chainlink rounds. The trades never happened, and the page runs on a local chain in your browser.
> - Prices on testnet are real Chainlink rounds **replayed by a trusted recorder**, labeled `Recorded` by the contract's `get_feeds`.
> - The attested PnL job runs **locally under wasmtime, with no enclave**. The contract labels its figures `SimulatedLocal`, and can't label them otherwise.
> - The tokens and solver in the copy sandbox are local stand-ins; only the Intents contract is the real wasm. The 3 bps of copy slippage there is the local solver's spread.
> - `copy/confidential-adapter.ts`, a mainnet confidential adapter, is written against the docs and has **never been exercised**.
>
> **Needs the owner:** a public URL for the job's wasm, to run OutLayer's hosted job (exact command below); anything on mainnet; the post and the submission.
>
> **Built for NEAR HACKATHON**, tracks **privacy**, **defi**, **agents**. A technical demo, not investment advice: selling trading signals is regulated in many places.

## The problem

Illia Polosukhin, Nov 4: *"Private trading where you sell your viewing keys for people to follow/copy trade. NEAR Intents confidential trading is all private, so you can have a social trading app where people sell 'keys' for only select people to see. PnL can be publicly displayed so people can choose to buy in."*

Three things stand in the way. Nobody can check a private trader's PnL before paying. A plain viewing key can't be taken back. And selling a key needs someone to rule when what's delivered is garbage. On top of that, Confidential Intents documents no viewing key (read 2026-11-05), so the key here covers a journal the trader writes, bound to real time.

## What it is, in four pieces

**1. A window key that is mathematics, not access control.** Each entry is encrypted under a leaf of a GGM tree over time slots: a binary hash tree from one secret seed. To sell a window, the trader hands over the few inner nodes that cover it: at most 32, for 65,536 slots. The buyer can read exactly that window, with no revocation, no rotation, no TEE and no online seller.

**2. A key sale with no operator.** The nodes are wrapped to a one-time key the buyer made for this purchase. The contract computes the cover itself and checks each node's commitment against a Merkle root posted before any sale. Payment sits in escrow. If the wrap is garbage, the buyer reveals the one-time secret, and **the contract itself runs x25519 and ChaCha20**, compares, refunds and slashes the bond: 40% to the prover, 20% burned, the rest backing older windows' refunds. A second proof catches a trader who commits to one tree and encrypts with another.

**3. PnL you can trust before you pay.** Entries are committed when written, numbered in a hash chain, with the slot checked against the block's clock. PnL is posted per epoch with a bond behind it. Anyone holding an epoch's keys can open them in the contract, which recomputes the figure in exact integers against oracle prices. One unit of difference slashes. A stranger can trust the public number as far as the bond and the past buyers go, and that's what the board shows.

**4. Copying.** A follower's app decrypts locally, applies its owner's limits, gets a live 1Click dry quote, and in the sandbox executes a real NEP-413 `token_diff` against the mainnet `intents.near` wasm. The trader's fill comes first by construction: an entry is published after the fill.

Window keys are priced on a **bonding curve per trader**. A purchase is a **NEP-171 token**, resellable until delivery can begin. If audited PnL in a sold window falls past the trader's stated floor, or he stops posting, buyers get a **pro-rata refund from the bond**.

## The hard question, answered with numbers

**Can the contract arbitrate the key sale?** Yes. The kill test was run first, on testnet.

| Measured on testnet | Tgas | Of a 300 Tgas transaction |
|---|---:|---:|
| A whole dispute over a wrapped node, in the real contract: x25519 twice, ChaCha20, a commitment | **@@DISPUTE@@** | 3% |
| `deliver`: the cover checked against the Merkle root | @@DELIVER@@ | 2% |
| `audit_step`, in the sandbox: per entry opened and priced | 0.15 | about 1,900 entries in one transaction |
| `audit_conclude` | @@CONCLUDE@@ | 1% |

Details and every step's cost: [`docs/research/killtest-2026-11-05.md`](docs/research/killtest-2026-11-05.md), [`docs/research/gas-audit.json`](docs/research/gas-audit.json). No fallback was needed. A trap on the way: built without `cargo near`, near-sdk quietly compiles SHA-256 into the wasm and panics lose their messages.

**Can a stranger trust the PnL?** As far as the bond and the buyers go, and no further. A false figure is provable by anyone with the keys, to the unit, and costs its trader 60% of his bond at least (40% to the prover, 20% burned). An unchecked figure is only as good as its bond. One account can't prove it isn't the luckiest of ten, and the board says so, next to a deflated Sharpe.

## Do this, see that

From a fresh clone: `npm ci`. Node 20+ is enough for most of it, since the built wasm is in `res/`. Sandbox runs download NEAR's sandbox node once, about 60 MB, for Linux or Apple Silicon. Rust and `cargo-near` are needed only to rebuild; `wasmtime` only for the job; `npx playwright install chromium` only for the page test.

| Do | See |
|---|---|
| `npm run judge` | Everything free in about 3 minutes, ending in a pass/fail table |
| `npm run attack` | @@ATTACKS@@ attack checks on the real wasm, in about 15 seconds. Each states what must be refused: garbage key, false PnL, backdated entry, deleted loser, window overreach, resale replay, and more |
| `npm run attack -- --sandbox` | The attacks on a real local NEAR node: @@SANDBOX@@ checks, minus the ones that need the local host's controls, about 15 minutes |
| `npm run demo` | The complete moment on a real local node, with every transaction's gas |
| `npm run copy` | The copy trade: `token_diff` on the mainnet `intents.near` wasm, limits, measured slippage, refusals, a live dry quote |
| `npm run job` | The attested job under wasmtime reading the chain over HTTP, its figure equal to the contract's to the unit, and OutLayer's shape with real yield/resume against a stand-in |
| `npm run fuzz` | 2,100 random operations, with the whole ledger re-added from views after each and compared to the yocto |
| `npm run mutate` | Needs Rust. Breaks @@MUTANTS@@ security-critical lines one at a time and rebuilds: `@@MUTANTS@@/@@MUTANTS@@ mutants caught`. Last log: [`docs/research/mutation-run.txt`](docs/research/mutation-run.txt) |
| `npm run kani` | Needs Kani. A model-checker proof that the PnL book is total: no input panics, and a void entry changes nothing. Log: [`docs/research/kani-2026-11-05.txt`](docs/research/kani-2026-11-05.txt). The cover and rounding proofs didn't finish in CBMC, so they're covered by an exhaustive test and property tests instead |
| `npm run killtest` | The kill test in a sandbox: a dispute's gas, step by step |
| `npm run gas` | How much of a journal the contract can recompute per transaction |
| `npm run verify` | Re-reads the testnet deployment from the chain: code hash, slashed traders, the hash chain recomputed, feeds' labels |
| `npm test` | The TypeScript twin against the Rust core's vectors, the deflated Sharpe, and that the seeded state is what it says |
| `cd contracts && cargo test --release -p keyhole-core --features sha2` | Property tests: a window's nodes read exactly that window and nothing outside it |
| `npm run web:build`, then serve `web/dist/` | The web app: see below |

### The web app

`web/dist/` is a static build, ready to host. `npx vite preview` from `web/`, or any file server, then open it:

1. **The board.** Seven books. PnL, bond, age, trades, buyers, how many epochs a past buyer could check, and a deflated Sharpe with the number of assumed journals you choose. See that the top number comes with a bond. "One of these numbers is false."
2. **`lucky-seven`.** The public journal is black bars with real ciphertext inside. Buy seven days. A one-time key is made in the tab, and the trader's agent, played by the page, wraps the nodes.
3. **The reader.** The ruler draws what you bought. Entries in the window decrypt. **"Try to open it anyway"** on the next day's entry tries every key your window can derive, and none opens.
4. **Check the figures.** Your tab recomputes each epoch. They don't match. **"Prove it"** runs `audit_open`, `audit_step` and `audit_conclude`. The trader is slashed, 40% of the bond is yours, and the board now says so for good.
5. Tick **"let this trader send garbage"** on another book, buy, and dispute.

All of it runs **the real contract wasm in your tab** on a local chain with no gas metering (`docs/decisions/0007`). Journals are SEEDED, and every page says so. Reloading restarts the chain. "Proof" lists the testnet run and reads the testnet contract live.

Screenshots: [board](docs/demo/board.png), [reader](docs/demo/reader.png), [caught](docs/demo/caught.png). Recording: [`docs/demo/keyhole-demo.mp4`](docs/demo/keyhole-demo.mp4).

## On testnet

Contract [`@@CONTRACT@@`](https://testnet.nearblocks.io/address/@@CONTRACT@@). Slots are 20 s and epochs 3 minutes, so that the demo runs in minutes. The whole run is in [`docs/demo/testnet-run.json`](docs/demo/testnet-run.json).

@@TXTABLE@@

Run it yourself on your own deploy with `npm run demo -- --testnet` (needs a funded account in your keychain).

## What a review found

After the attack suite and the mutants all passed, a separate AI reviewer read the contract cold, and found seven real problems they had missed. The worst let any buyer slash an honest trader. All are fixed and tested: [`docs/research/review-2026-11-05.md`](docs/research/review-2026-11-05.md). Counts here say the checks are load-bearing, not that the checks are complete. **No human has audited this contract.**

## How NEAR is used, concretely

| NEAR piece | What it does here |
|---|---|
| A Rust contract on near-sdk 5.29 | Journal commitments, the sale, both dispute proofs, the fraud proof, slashing, refunds, NEP-171 tokens |
| Wasm gas budget | x25519 and ChaCha20 run inside a transaction, and that's what removes the operator: about 10 Tgas |
| SHA-256 host function | GGM walks, Merkle checks, tags, the hash chain |
| Block time | No backdating: a slot is checked against `block_timestamp`, and a trade's price against the rounds after it |
| Storage staking | Every byte is paid by whoever grew it. Ciphertext on chain means no data availability question |
| Promises and callbacks | `withdraw` restores a credit on failure; `import_round` reads near-borrowed-oracle; `nft_transfer_call`; OutLayer's yield/resume |
| `intents.near` (mainnet wasm, sandbox) | `execute_intents` with NEP-413 `token_diff` signed by the trader, the follower and a solver: replay, expiry, balance and signature refusals exercised |
| 1Click | Live keyless dry quotes. Setting `confidentiality` answers 401 without a user's auth: measured, and asserted by `npm run copy` (`docs/decisions/0011`) |
| near-borrowed-oracle (testnet) | A feed source: MPC-proven Chainlink rounds, read by a real cross-contract call |
| OutLayer | `request_execution` in its current 7-argument shape, a wasm32-wasip2 job pinned by sha256. Exercised against a stand-in; the hosted run is the owner's step |

## Honest limits

- **A buyer can leak** what he read, or the keys themselves. No watermarking is attempted.
- **A dispute publishes.** Revealing the one-time secret makes that sale's nodes public, so a false dispute gives the window away. The griefer loses a deposit of at least the price to the trader, but the leak has no fix short of zero knowledge. An audit publishes one epoch's trades, which is why a trader can't be slashed without them.
- **One account can't prove it isn't one of ten.** Bond, age, trades and the deflated Sharpe price that doubt.
- **A buyer count is only as real as what it costs to fake.** A trader buying from himself pays only gas.
- **Slashing yourself recovers up to 40% of the bond** through a fresh second account, and more with a window that account has held through the challenge period, with its own money in escrow. 20% always burns. So a lie is never free, but it isn't always the full bond (`docs/decisions/0012`).
- **A journal is a signal record.** An entry committed before the outcome is a valid record even if never executed. Only an entry with a settlement reference shows a fill, and real confidential trades live on mainnet, with history invite-only.
- **A figure with no buyers is checked by nobody.** Only its bond stands behind it, unless the attested job has run, and that's SIMULATED until it runs in an enclave.
- **Recorded prices are trusted to the recorder.** A proven feed is only as dense as its relayers: a trader could try to relay only favourable rounds (`docs/decisions/0010`).
- **The window is priced in epochs.** Empty windows are possible: a trader may post a flat figure and write nothing. The buyer can see that in the journal's public count before buying a past window, but not a future one.
- **Testnet and sandbox only.** Nothing here has touched real money.

## Competitors, stated fairly

**NOVA Copy-Trading** ([jcarbonnell/nova-copy-trading](https://github.com/jcarbonnell/nova-copy-trading)) shipped this idea on mainnet on Nov 4, and it's good work: a `JUDGES.md`, mutation tests, a recorded live run with real USDC. We took its `JUDGES.md` and mutation habits as ideas, not its code.

| | NOVA Copy-Trading | Keyhole |
|---|---|---|
| The PnL before you pay | Claimed, with per-entry hashes on chain. The follower checks it after buying | Bonded before you pay. Any past buyer can prove it false on-chain, and the contract recomputes it |
| How access ends | The seller revokes, and NOVA's TEE rotates the group key | No node past the window was ever delivered. Nobody needs to be online |
| Paying and access | Pay, then the seller checks and admits. No escrow yet (its own README says so) | One sale in the contract: escrow, delivery, dispute, refund |
| Where it runs | **Mainnet, real USDC, the real Agent API.** Further along than this | Testnet and a sandbox |
| Copies | Dry quotes, inside owner-signed policies enforced by the Agent API | A real signed `token_diff` against the Intents wasm in a sandbox, plus live dry quotes. Limits are the app's, not a signed policy |
| Trust in the journal | NOVA's TEE and contract for keys | Only the chain, SHA-256 and ChaCha20. x25519 for the wrap |

Others in the field, as of Nov 5 (145 entries, read from the hackathon's API): nobody else found building this exact design. GitHub search misses private repos, and most teams submit late, so that's a floor.

## Libraries and AI code (Q-005)

**Written during the hackathon (from 2026-11-05),** with an AI coding assistant (Claude Code, under the owner's direction): all of this repo's code. No code was written by hand.

**Copied from our own MIT repos and adapted:** `tools/nearkit.ts` and `tools/keys.ts` from near-verdict; `contracts/keyhole/src/nft.rs` and `contracts/mock-outlayer` from near-ghost-duels; `contracts/test-token` from near-circle (which took it from near-crop-cover and near-account-nfts); the wasip2 job's skeleton from near-verdict's `outlayer/`. The 1Click call is from near-lab's `spikes/oneclick-quote`.

**Libraries:** near-sdk and near-contract-standards 5.29, x25519-dalek 2, sha2, proptest (Rust); near-api-js 7, @noble/curves, @noble/hashes, @noble/ciphers, @scure/base, React 19, Vite 8, Newsreader and IBM Plex Mono through Fontsource, Playwright, tsx (TypeScript). `res/intents.near.wasm` is the unmodified mainnet contract, pulled over RPC by `tools/pull-intents.ts` (code hash `BtA1BEFN…`, source at github.com/near/intents). Tools: wasmtime, wasm-opt, cargo-near, ffmpeg.

**Data:** real Chainlink rounds read from Ethereum mainnet by `tools/record-rounds.ts` into `fixtures/chainlink-rounds.json`.

## Needs the owner

1. **OutLayer's hosted job**, after `res/keyhole_pnl_job.wasm` has a public URL:
   ```sh
   # as the contract's owner account, once:
   near call @@CONTRACT@@ set_outlayer '{"outlayer":{"contract":"outlayer.testnet","wasm_url":"<public URL of res/keyhole_pnl_job.wasm>","wasm_hash":"@@JOBHASH@@","max_instructions":"10000000000","max_execution_seconds":"60"}}' --accountId owner.keyhole-g1zo8i.testnet
   # as a trader, with the epoch's nodes as an OutLayer secret named KEYHOLE_NODES:
   near call @@CONTRACT@@ request_attested '{"epoch":<epoch>,"secrets_ref":{"profile":"<yours>","account_id":"<yours>"}}' --accountId <trader> --deposit 0.03 --gas 300000000000000
   ```
2. **The X post** ([`docs/demo/x-post.md`](docs/demo/x-post.md)) and **the submission**.
3. **Hosting**: `web/dist/` is built and ready for near.toothywalrus.dev.
4. **Mainnet**, if ever: `copy/confidential-adapter.ts` needs a user's JWT, an account and real money. Legal advice first: see the first line of this README's limits.

## Layout

- `contracts/core/`: pure logic shared by everything: GGM, Merkle, entries, PnL. `contracts/keyhole/`: the contract. `contracts/killtest/`, `mock-outlayer/`, `test-token/`: measurement and sandbox stand-ins.
- `lib/src/`: the TypeScript twin, the parties (`client.ts`), the local wasm host (`vm.ts`), intents signing, 1Click, the deflated Sharpe.
- `job/`: the wasip2 PnL job. `copy/`: the unexercised mainnet adapter. `tools/`: every command here. `web/`: the app. `res/`: built wasm, with `SHA256SUMS`. `fixtures/`: recorded rounds, cross-language vectors. `docs/decisions/`: why things are this way. `JUDGES.md`: every claim mapped to code, test and command.

## Rebuild

`npm run build -- keyhole test-token mock-outlayer killtest` needs Rust 1.93 (pinned) and `cargo-near`. The job: `cd job && cargo build --release --target wasm32-wasip2` on stable. The wasm in `res/` is what's deployed: `npm run verify` compares the code hash on testnet with it.

MIT licensed.
