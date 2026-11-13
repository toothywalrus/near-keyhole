# Deployments: the testnet run, the OutLayer run, and what is prepared for mainnet

The README has the short version. Everything here is re-read from the chain by `npm run verify`.

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

**The run's journals keep no secret.** Its traders (vega, lucky, mallory) used the repo's test seeds for their key trees (`tools/world.ts`), which anyone can recompute from the account names, so their entries on the public chain can be opened by any reader of this repository. The run shows the rules working; it isn't a private journal. The OutLayer run's trader below used a random seed from the keyring, and `tools/demo.ts` does the same on testnet from now on, recording `"seeds": "keyring"` in the run's record.

**The first deployment stays on chain as history:** [`app.keyhole-g1zo8i.testnet`](https://testnet.nearblocks.io/address/app.keyhole-g1zo8i.testnet), from 2026-11-05, before the fee, with a full-access key. Its run is [`docs/demo/testnet-run-v1-unlocked.json`](docs/demo/testnet-run-v1-unlocked.json). A new version goes to a new account (`docs/decisions/0017`).

## In OutLayer's TEE, on testnet

`npx tsx tools/outlayer.ts` does this with no sign-up and no API key, paying in testnet NEAR, on a deployment whose root key you hold:

| Step | Transaction |
|---|---|
| The job's wasm on FastFS, served at test.fastfs.io and checked by its sha256 (the transaction fails by design: the indexer reads its arguments) | [`6TSbLfB6bQ…`](https://testnet.nearblocks.io/txns/6TSbLfB6bQWYkFzVzcBjSXwhAZx9gEYMYgRqJLXZRTk6) |
| The contract's owner pins `outlayer.testnet` and the job's sha256 (`set_outlayer`) | [`GZpeciwcmt…`](https://testnet.nearblocks.io/txns/GZpeciwcmtMeKQnCAaVHGs42twpK6Ppx1eUhWKMwFcmy) |
| A trader with no buyers, `oliutl`, writes two entries in epoch 8 and posts $12.35 | |
| The epoch's two tree nodes become an OutLayer secret: encrypted on this machine to the keystore's X25519 key (OutLayer's ECIES v1), bound to the job's sha256 | [`69QxQvacsD…`](https://testnet.nearblocks.io/txns/69QxQvacsDt4qFJ2M4gyB2DTV6tXNYP5pfuSYAKN3Ca3) |
| The job runs in Intel TDX: it reads the journal over HTTP, opens both entries and prints `12352646`, the posted figure, to the unit | [`9yQdrxsicF…`](https://testnet.nearblocks.io/txns/9yQdrxsicFRVf1Ni4kYdkUfcEdnnpatx9pshyos5zWkS) |

The attestation, [`docs/research/outlayer-attestation-request-15448.json`](docs/research/outlayer-attestation-request-15448.json), carries a 5,007-byte TDX quote and binds the job's sha256 (`5d814c08…`, which is `res/keyhole_pnl_job.wasm`), the sha256 of the request's input and that of its output. `npm run verify` recomputes the last two from the transaction on chain. Checking the quote itself takes OutLayer's verifier, which hasn't been run here: `cargo install --git https://github.com/out-layer/outlayer-verify`, then `outlayer-verify tx 9yQdrxsicFRVf1Ni4kYdkUfcEdnnpatx9pshyos5zWkS --network testnet --api https://testnet-api.outlayer.ai`.

**What didn't work, and how it shows:** the contract's own path, `request_attested`, failed on this locked deployment ([`9MHogMxp4D…`](https://testnet.nearblocks.io/txns/9MHogMxp4DAfMkaKgx1KaTf2NejpsUVrk7jJsRvuuny6)). It sent OutLayer's resource limits as JSON strings, and `outlayer.testnet` takes numbers. Its callback logged "OutLayer gave no result" and wrote nothing, so no epoch here is labeled `OutLayerTee`, and `npm run verify` checks that. The source is fixed, and the sandbox stand-in now takes OutLayer's own types: the deployed wasm fails `npm run job` and one attack check, the fixed one passes. So the locked contract is the build of `a23a06c`, one fix behind this tree; `npm run verify` checks it against `git show a23a06c:res/keyhole.wasm`.

## The demo's traders after the demo

The run above ended on 2026-11-10 and its traders stopped posting. Epochs on this deployment are three minutes long, and the `score` view charges every epoch with no figure once its grace is over (at least 2% of the book each, `docs/decisions/0013`). So `score` for vega, the honest trader, falls further below zero with every epoch, as it would for any trader who walked away: that is the rule working, not a loss she made. Her posted record is `get_trader`'s `cum_pnl_e6` ($26.35), and the web app's Proof page shows that.

The false dispute's window (token 4) was still `Delivered` when the run ended. `settle` can be called by anyone once the challenge window is over, and it was, later the same day: [`6mHkLQka1y…`](https://testnet.nearblocks.io/txns/6mHkLQka1yTNFqj8fqE6hoHXqgNLyrgzq66BVpBpFNik), 3.17 Tgas, closed for vega with the 5% fee to the treasury.

The contract is open to anyone, and a trader whose agent is offline can be made to refuse a window (see the limits). So the run's two traders that were still selling, vega and the enclave run's trader, paused their sales with `set_paused` once the run was over, which is what that method is for: [`BEnxvYtdx1…`](https://testnet.nearblocks.io/txns/BEnxvYtdx1J1UesrJER15hq7RxeYR3NzMh8gvwsvYmwm), [`W5HDYSBhEd…`](https://testnet.nearblocks.io/txns/W5HDYSBhEdywrYLe3HC4dv362x4Kadrh2LuAfPBEsbJ). Both are still `Active`, and anyone can still register as a trader of his own.

## The next version, built and not deployed

This tree's contract is ahead of the deployed one: the `request_attested` fix, the price delay, the attestation rank and the window bound (`docs/decisions/0021`). `tools/redeploy.ts` puts it on a fresh account, locked, runs the whole flow and the contract's own OutLayer request there, re-points the repo and runs the chain checks. With no confirmation it only prints its plan; it refuses anything but a fresh funded testnet root, and the two roots already used:

```
npx tsx tools/faucet.ts <name>.testnet
KEYHOLE_ROOT=<name>.testnet npx tsx tools/redeploy.ts                              # the plan, read-only
CONFIRM_TESTNET_DEPLOY=1 KEYHOLE_ROOT=<name>.testnet npx tsx tools/redeploy.ts     # about 20 minutes, about 9 testnet NEAR
```

## A deployment of your own

`KEYHOLE_ROOT=<your-account>.testnet npm run demo -- --testnet` runs the whole flow on a fresh locked deployment under a funded root account whose key is in the OS keyring (the macOS keychain, or `secret-tool` on Linux). `npx tsx tools/faucet.ts <name>.testnet` makes such an account from the public faucet. A deployment takes about 9 testnet NEAR, most of it the contract's storage. Running `npx tsx tools/outlayer.ts` after it, on a build with the `request_attested` fix (this tree), is what gives an epoch the contract's own `OutLayerTee` label.

## Prepared for mainnet, not run

Nothing here has touched mainnet. `tools/mainnet.ts` has the steps, and `deploy`, `sale` and `copy` refuse to run without `CONFIRM_MAINNET=1` (tested in `lib/test/mainnet.test.ts`):

- `KEYHOLE_MAINNET_ROOT=<you>.near npx tsx tools/mainnet.ts plan` is read-only and prints what would happen and what it costs (about 6.5 NEAR, most of it storage).
- `deploy` puts the contract on a fresh account, locked in its first transaction; `sale` does one real window sale end to end (about three hours, for real epochs); `verify` re-reads it.
- `copy` does one real Intents copy of about $1 of USDC.
- `copy/confidential-adapter.ts`, the adapter for confidential trades, needs a user's JWT, an account and real money, and has never been exercised.

Selling trading signals is regulated in many places: take advice before a real sale.
