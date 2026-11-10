# Competitors, stated fairly

**NOVA Copy-Trading** ([jcarbonnell/nova-copy-trading](https://github.com/jcarbonnell/nova-copy-trading)) shipped this idea on mainnet on Nov 4, and it's good work: a `JUDGES.md`, mutation tests, a recorded live run with real USDC. We took its `JUDGES.md` and mutation habits as ideas, not its code.

| | NOVA Copy-Trading | Keyhole |
|---|---|---|
| The PnL before you pay | Claimed, with per-entry hashes on chain. The follower checks it after buying | Bonded before you pay. Any past buyer can prove it false on-chain, and the contract recomputes it |
| How access ends | The seller revokes, and NOVA's TEE rotates the group key | No node past the window was ever delivered. Nobody needs to be online |
| Paying and access | Pay, then the seller checks and admits. No escrow yet (its own README says so) | One sale in the contract: escrow, delivery, dispute, refund |
| Where it runs | **Mainnet, real USDC, the real Agent API.** Further along than this | Testnet, locked, and a sandbox |
| Copies | Dry quotes, inside owner-signed policies enforced by the Agent API | A real signed `token_diff` against the Intents wasm in a sandbox, plus live dry quotes. Limits are the app's, not a signed policy |
| Trust in the journal | NOVA's TEE and contract for keys | Only the chain, SHA-256 and ChaCha20. x25519 for the wrap |

NOVA is the one other build of this idea we know of. The hackathon's field is large and most of it was submitted late, so there may be others we haven't read.
