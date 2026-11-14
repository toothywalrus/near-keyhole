# Deployments: the testnet run, the OutLayer run, and what is prepared for mainnet

The README has the short version. Everything here is re-read from the chain by `npm run verify`.

## On testnet

Contract [`app.keyhole-33232a.testnet`](https://testnet.nearblocks.io/address/app.keyhole-33232a.testnet): this tree's `res/keyhole.wasm` (v2), deployed on 2026-11-14, locked, with no key on the account. Slots are 20 s and epochs 3 minutes, so that the demo runs in minutes. The whole run is in [`docs/demo/testnet-run.json`](docs/demo/testnet-run.json).

| Step | Tgas | Transaction |
|---|---:|---|
| deploy the wasm, `new`, delete the only key: one transaction | | [`9FKDdjNiaj…`](https://testnet.nearblocks.io/txns/9FKDdjNiajrY8ujJY9NrPi1C3vr7ai1YwK4kN3AuehRJ) |
| vega registers: a bond, a root committing to a key tree | 2.67 | [`FPQUZ4MS9W…`](https://testnet.nearblocks.io/txns/FPQUZ4MS9WF8ac2hJUNon9NQ6wgg3JdUThbKmDmRq4yt) |
| lucky registers: a bond, a root committing to a key tree | 2.69 | [`8nvvQeDU2j…`](https://testnet.nearblocks.io/txns/8nvvQeDU2jJRkp4zSxRhwLkhT2HfAxVxsUELHc2LCoeh) |
| mallory registers: a bond, a root committing to a key tree | 2.69 | [`41HmFLYTo6…`](https://testnet.nearblocks.io/txns/41HmFLYTo69PviAATMpFVkspYP58TbozSjoCFfKD6nDt) |
| vega writes: long ETH | 3.71 | [`8E56XY3XpK…`](https://testnet.nearblocks.io/txns/8E56XY3XpKKvymPKmUUhQy8qknUwFrZtK6jsBYaivnhb) |
| lucky writes: a small long | 3.71 | [`7Y6GKQQct2…`](https://testnet.nearblocks.io/txns/7Y6GKQQct2ZxpMriqmmBS9pgYNSKAMmHp3RTEwPPa5Mm) |
| lucky writes: a BTC short | 3.82 | [`3gVRhXw8xQ…`](https://testnet.nearblocks.io/txns/3gVRhXw8xQJwgZ3Ss15viCiWwez1fJj2WMYfZuew5eWe) |
| vega writes: a BTC hedge | 3.82 | [`FrHkbxUmPV…`](https://testnet.nearblocks.io/txns/FrHkbxUmPVD3cC9WjR4duZmUyWsv9TyeasDNx2ozBU7e) |
| vega posts the true figure: $26.35 | 3.44 | [`3uvbu2uwrb…`](https://testnet.nearblocks.io/txns/3uvbu2uwrbAv1quzVq6qD9ydwtMMmVEC2aJT33NJw6Uw) |
| lucky posts a LIE: $25380.47 (truth: $380.47) | 3.44 | [`9ZGBSpuhZD…`](https://testnet.nearblocks.io/txns/9ZGBSpuhZDd4K7oY88vKyaC2MMuTEUh9efkJPUYwWz3U) |
| mallory posts an empty epoch | 3.42 | [`HzaBozzHDH…`](https://testnet.nearblocks.io/txns/HzaBozzHDHZVrYQfcBLUg4YvebZsgYxR5D12JQBPm5ff) |
| vega writes the next day's entry | 3.80 | [`EwoMdQwnSR…`](https://testnet.nearblocks.io/txns/EwoMdQwnSRxKgo4Sb78ShfMU2o61p36P4UBzrfvpViSa) |
| buy epoch 1 of vega's journal, a NEP-171 token | 7.63 | [`7URKYNhLMj…`](https://testnet.nearblocks.io/txns/7URKYNhLMjo4GC2NYy43j8eK7qMDBa9SpGBMURvt68iV) |
| vega delivers: nodes wrapped to her one-time key | 8.42 | [`Y8dTLS8ujb…`](https://testnet.nearblocks.io/txns/Y8dTLS8ujbXyj3ye7opNsFisZUtZfzu4xxRP5s3cJqj) |
| buy epoch 1 of lucky's journal | 7.66 | [`39Yy1HFP9C…`](https://testnet.nearblocks.io/txns/39Yy1HFP9C55ha2AUD1oh5Ay4ffPJDuGmS746gvYjXgX) |
| lucky delivers honestly: the journal itself isn't the lie | 8.43 | [`8oaDKUuzYd…`](https://testnet.nearblocks.io/txns/8oaDKUuzYdLovbHkQJFZcGqL5T8hvnLpmnhUd2uzK5YT) |
| audit_open: the deposit goes at risk | 3.34 | [`Gpywh9izYc…`](https://testnet.nearblocks.io/txns/Gpywh9izYcLZPbc4Mfi2K4PNoEFZiyAnQ9ZJHXWhj1hL) |
| audit_step: 2 entries opened in the contract | 3.12 | [`BHJ1YkNXVt…`](https://testnet.nearblocks.io/txns/BHJ1YkNXVtvcJvLqmjwaj4dt41DYrTarNdFPY8vgCEQ1) |
| audit_conclude: recomputed, compared, slashed | 3.43 | [`EHjL8YaeYK…`](https://testnet.nearblocks.io/txns/EHjL8YaeYKEDyea1Hnsvgt7ZXiz4SVJcarK9UgjDpQA1) |
| claim_refund: the escrow back | 2.95 | [`9AgFXMkZRG…`](https://testnet.nearblocks.io/txns/9AgFXMkZRGMHUouq7v1z9nVQVi7VXtfhJvyydihUrGtU) |
| withdraw | 5.43 | [`HznqH4pFoy…`](https://testnet.nearblocks.io/txns/HznqH4pFoyQK9pzvipc66zA3ALKnYxz2LhEH2GfP67e2) |
| she buys a window of mallory's journal | 7.66 | [`3SsbJT9yGo…`](https://testnet.nearblocks.io/txns/3SsbJT9yGobqqPmsMpB7NVYHNmfAYp398nYipXQp1ZGB) |
| mallory delivers garbage for one node | 8.43 | [`CpxQsVgoKi…`](https://testnet.nearblocks.io/txns/CpxQsVgoKi33j6dhPFzHuR4e6ppBSwU4uHyyYjGbYxHT) |
| dispute_wrap: secret revealed, the contract unwraps and compares | 10.44 | [`6evESEbPAF…`](https://testnet.nearblocks.io/txns/6evESEbPAFRpY9edyPCjWFFWtBq7NKQQq4cAyZFxkgU1) |
| someone else buys vega's window | 7.64 | [`EbNERxuUMY…`](https://testnet.nearblocks.io/txns/EbNERxuUMYMf7WfwzNJstK78THG1i8PAEatMBXpaPVHh) |
| vega delivers honestly | 8.43 | [`6628QNYsG7…`](https://testnet.nearblocks.io/txns/6628QNYsG7qaqPFXN4EdVAS4WpB3pEHn4jsW5xnhXFNG) |
| dispute_wrap with nothing wrong | 10.04 | [`9od6pivrtn…`](https://testnet.nearblocks.io/txns/9od6pivrtnBbuxyRwxzoX5MJRTSeBtqKNbrYdfFBmyiq) |
| the owner registers a local runner | 2.40 | [`6EBde6N8ay…`](https://testnet.nearblocks.io/txns/6EBde6N8ayj9BPkpxcXWrVKBfVsXVsHd7pzsJZKDiYPu) |
| the runner submits the job's output | 3.47 | [`CvC66uYo9m…`](https://testnet.nearblocks.io/txns/CvC66uYo9mgdDvPCVqFjj1MvLtDBmbSLYjEo2Jt5Aygv) |
| settle: the challenge window is over, the escrow is released | 3.12 | [`ACDiUm1GRV…`](https://testnet.nearblocks.io/txns/ACDiUm1GRVtwdrrxqiptQ2pDDwANfLuUS2tfFzMn18Gd) |
| import_round: a real cross-contract read of the proven round | 6.71 | [`B7S1pwqYQa…`](https://testnet.nearblocks.io/txns/B7S1pwqYQaiMdjuXBDUQ6QXyKphRh3GviRQj2ZrBrsbe) |

Run it yourself on your own deploy with `KEYHOLE_ROOT=<your-account>.testnet npm run demo -- --testnet` (a funded root account, its key in the OS keyring: the macOS keychain, or `secret-tool` on Linux; `npx tsx tools/faucet.ts <name>.testnet` makes one from the public faucet).

**The run's journals are sealed.** Each trader's key-tree seed is 32 random bytes kept in the OS keyring of the machine that ran it (`"seeds": "keyring"` in the record), so the entries on chain open only with nodes someone delivered.

**Earlier deployments stay on chain as history.** A locked deployment can't be replaced, so a new version goes to a new account (`docs/decisions/0017`):
- [`app.near-keyhole-y4ow.testnet`](https://testnet.nearblocks.io/address/app.near-keyhole-y4ow.testnet), 2026-11-10, the build of `a23a06c`, locked. Its run's traders used the repo's test seeds (`tools/world.ts`), so anyone who reads this repository can open their journals. Its record is `docs/demo/testnet-run.json` as of commit `a71b4d3`, and its enclave run is below.
- [`app.keyhole-g1zo8i.testnet`](https://testnet.nearblocks.io/address/app.keyhole-g1zo8i.testnet), 2026-11-05, before the fee, with a full-access key. Its run is [`docs/demo/testnet-run-v1-unlocked.json`](docs/demo/testnet-run-v1-unlocked.json).

## The contract's own OutLayer request, on this deployment

`npx tsx tools/outlayer.ts` does this with no sign-up and no API key, paying in testnet NEAR, on a deployment whose root key you hold. On 2026-11-14:

| Step | Transaction |
|---|---|
| The job's wasm (sha256 `9f897626…`, `res/keyhole_pnl_job.wasm`) on FastFS, served at test.fastfs.io and checked by its sha256 (the transaction fails by design: the indexer reads its arguments) | [`Bi3BhQoazz…`](https://testnet.nearblocks.io/txns/Bi3BhQoazzGCmKNsvv5ZBugCfRbbDpDZhnYtudTSFa7P) |
| The contract's owner pins `outlayer.testnet` and the job's sha256 (`set_outlayer`) | [`CkwGUsocmW…`](https://testnet.nearblocks.io/txns/CkwGUsocmWywHotGGMwQCDjLqsCp81j89ZZXJG74FpNa) |
| A trader with no buyers, `oli1c2z`, with a seed from the keyring, writes two entries in epoch 8 and posts $12.35 | |
| The epoch's two tree nodes become an OutLayer secret, usable only with this contract as the caller | [`CNASuoSq6h…`](https://testnet.nearblocks.io/txns/CNASuoSq6hMAL8vZbVH2H1YfvMbHw7DmnhoSs5A9UaEA) |
| `request_attested`: the contract calls `request_execution` and yields. OutLayer accepts it (request 44316) | [`FVPGhXuCWw…`](https://testnet.nearblocks.io/txns/FVPGhXuCWwK1JiAfs4krgUvZ3hfP1DwtEsc8aWeZRcNa) |
| The same again, once | [`4Dg6s9p8eP…`](https://testnet.nearblocks.io/txns/4Dg6s9p8eP57KyYrRqCpVUXjvAoW4JPan1jWZqcnMAH9) |

**What didn't work, and how it shows.** OutLayer accepted both requests (the first locked deployment's was refused on its argument types), and then its worker's run failed: `outlayer.testnet` logged `Execution promise failed: Failed`, refunded the deposit and published no attestation. The contract's callback logged "OutLayer gave no result" and wrote no label, so no epoch here is labeled `OutLayerTee`, and `npm run verify` checks that. A trader-signed request for the same epoch ([`58aRDqYeKN…`](https://testnet.nearblocks.io/txns/58aRDqYeKNukDRWzUQixXCaPG8NiQ5hLyZP9pey4cP5L), request 44357) failed the same way. The job itself isn't the cause as far as anything here can tell: the same wasm, with the same input and the same secret, run locally under `wasmtime run -S http` against this contract over the public RPC, prints `12352646`, the posted figure, to the unit. OutLayer's public API shows no logs for a failed run, and other callers' requests were resolving at the time.

## In OutLayer's TEE, on the previous deployment

On 2026-11-10, on `app.near-keyhole-y4ow.testnet`, with an earlier build of the job (sha256 `5d814c08…`), the trader asked OutLayer himself (`--direct`):

| Step | Transaction |
|---|---|
| The job's wasm on FastFS, served at test.fastfs.io and checked by its sha256 (the transaction fails by design: the indexer reads its arguments) | [`6TSbLfB6bQ…`](https://testnet.nearblocks.io/txns/6TSbLfB6bQWYkFzVzcBjSXwhAZx9gEYMYgRqJLXZRTk6) |
| The contract's owner pins `outlayer.testnet` and the job's sha256 (`set_outlayer`) | [`GZpeciwcmt…`](https://testnet.nearblocks.io/txns/GZpeciwcmtMeKQnCAaVHGs42twpK6Ppx1eUhWKMwFcmy) |
| A trader with no buyers, `oliutl`, writes two entries in epoch 8 and posts $12.35 | |
| The epoch's two tree nodes become an OutLayer secret: encrypted on this machine to the keystore's X25519 key (OutLayer's ECIES v1), bound to the job's sha256 | [`69QxQvacsD…`](https://testnet.nearblocks.io/txns/69QxQvacsDt4qFJ2M4gyB2DTV6tXNYP5pfuSYAKN3Ca3) |
| The job runs in Intel TDX: it reads the journal over HTTP, opens both entries and prints `12352646`, the posted figure, to the unit | [`9yQdrxsicF…`](https://testnet.nearblocks.io/txns/9yQdrxsicFRVf1Ni4kYdkUfcEdnnpatx9pshyos5zWkS) |

The attestation, [`docs/research/outlayer-attestation-request-15448.json`](docs/research/outlayer-attestation-request-15448.json), carries a 5,007-byte TDX quote and binds the job's sha256 (`5d814c08…`, the job as built then), the sha256 of the request's input and that of its output. `npm run verify` recomputed the last two from the transaction on chain while that deployment was current. Checking the quote itself takes OutLayer's verifier, which hasn't been run here: `cargo install --git https://github.com/out-layer/outlayer-verify`, then `outlayer-verify tx 9yQdrxsicFRVf1Ni4kYdkUfcEdnnpatx9pshyos5zWkS --network testnet --api https://testnet-api.outlayer.ai`.

**What didn't work there, and how it shows:** the contract's own path, `request_attested`, failed on that locked deployment ([`9MHogMxp4D…`](https://testnet.nearblocks.io/txns/9MHogMxp4DAfMkaKgx1KaTf2NejpsUVrk7jJsRvuuny6)). It sent OutLayer's resource limits as JSON strings, and `outlayer.testnet` takes numbers. Its callback logged "OutLayer gave no result" and wrote nothing, so no epoch here is labeled `OutLayerTee`, and `npm run verify` checks that. The source is fixed, and the sandbox stand-in now takes OutLayer's own types: the deployed wasm fails `npm run job` and one attack check, the fixed one passes. The fix is in the current deployment.

## The demo's traders after the demo

The run ended on 2026-11-14 and its traders stopped posting. Epochs on this deployment are three minutes long, and the `score` view charges every epoch with no figure once its grace is over (at least 2% of the book each, `docs/decisions/0013`). So `score` for vega, the honest trader, falls further below zero with every epoch, as it would for any trader who walked away: that is the rule working, not a loss she made. Her posted record is `get_trader`'s `cum_pnl_e6` ($26.35), and the web app's Proof page shows that.

The false dispute's window (token 4) was still `Delivered` when the run ended. `settle` can be called by anyone once the challenge window is over, and it was, the same morning: [`8h6RaTYdtu…`](https://testnet.nearblocks.io/txns/8h6RaTYdtuzb3ob5Syohk8ZKVVHCgHCASiJCHRr4PBJX), closed for vega with the 5% fee to the treasury.

The contract is open to anyone, and a trader whose agent is offline can be made to refuse a window (see the limits). So the run's two traders that were still selling, vega and the OutLayer request's trader, paused their sales with `set_paused` once the run was over, which is what that method is for: [`CuQ3PEVBes…`](https://testnet.nearblocks.io/txns/CuQ3PEVBesZTvQ3ZMYef7oHkXSemieg3Xmtj2yszwX9e), [`GWyHRSH4HE…`](https://testnet.nearblocks.io/txns/GWyHRSH4HEf2GvEyTEKPT2WX1EoQzvjGC3MRnUFeNyc9). Both are still `Active`, and anyone can still register as a trader of his own. The previous deployment's run was treated the same way on 2026-11-10.

## Deploying a new version

`tools/redeploy.ts` put this tree's contract on `app.keyhole-33232a.testnet` on 2026-11-14. It puts a build on a fresh account, locked, runs the whole flow and the contract's own OutLayer request there, re-points the repo and runs the chain checks. With no confirmation it only prints its plan; it refuses anything but a fresh funded testnet root, and the roots already used:

```
npx tsx tools/faucet.ts <name>.testnet
KEYHOLE_ROOT=<name>.testnet npx tsx tools/redeploy.ts                              # the plan, read-only
CONFIRM_TESTNET_DEPLOY=1 KEYHOLE_ROOT=<name>.testnet npx tsx tools/redeploy.ts     # about 20 minutes, about 9 testnet NEAR
```

Afterwards: `npx tsx tools/record-views.ts` (the page test's views), `npx tsx tools/deployments-table.ts` (the table above), and the address in the README, JUDGES.md and this file. On 2026-11-14 the OutLayer step stopped the script, so its last steps (copying the record to `web/public`, re-pointing `tools/testnet.ts`, `npm run verify`) were run by hand.

## A deployment of your own

`KEYHOLE_ROOT=<your-account>.testnet npm run demo -- --testnet` runs the whole flow on a fresh locked deployment under a funded root account whose key is in the OS keyring (the macOS keychain, or `secret-tool` on Linux). `npx tsx tools/faucet.ts <name>.testnet` makes such an account from the public faucet. A deployment takes about 9 testnet NEAR, most of it the contract's storage. Running `npx tsx tools/outlayer.ts` after it is what would give an epoch the contract's own `OutLayerTee` label, once OutLayer's worker completes the run (see above).

## Prepared for mainnet, not run

Nothing here has touched mainnet. `tools/mainnet.ts` has the steps, and `deploy`, `sale` and `copy` refuse to run without `CONFIRM_MAINNET=1` (tested in `lib/test/mainnet.test.ts`):

- `KEYHOLE_MAINNET_ROOT=<you>.near npx tsx tools/mainnet.ts plan` is read-only and prints what would happen and what it costs (about 6.5 NEAR, most of it storage).
- `deploy` puts the contract on a fresh account, locked in its first transaction; `sale` does one real window sale end to end (about three hours, for real epochs); `verify` re-reads it.
- `copy` does one real Intents copy of about $1 of USDC.
- `copy/confidential-adapter.ts`, the adapter for confidential trades, needs a user's JWT, an account and real money, and has never been exercised.

Selling trading signals is regulated in many places: take advice before a real sale.
