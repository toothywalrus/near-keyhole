# 0017: A new deployment goes to a fresh account and is locked in the same transaction that deploys it

**Context.** The first testnet deployment (`app.keyhole-g1zo8i.testnet`) kept a full-access key so the demo could be
replaced. Every judge read that as the gap between "no operator" and what's deployed: whoever holds the key can
replace the code and take the balance. The live contract also lagged the source once the fee existed (`0016`), and
the deployed state layout can't take new fields (CLAUDE.md, "state layout").

**Decision.**

- A new contract version goes to a new account; the old one stays on chain as history and is never touched.
- `tools/testnet.ts` (`deployLocked`) creates the account, then sends ONE transaction signed by it with three actions:
  deploy the wasm, call `new`, delete its only key. Actions in one transaction succeed or fail together, so there is no
  moment with code and a key on the account at once, and a failed `new` leaves the key in place to recover the NEAR.
- The key is stored in the OS keyring (read back) before the account is funded, and cleared once the lock lands.
- `npm run verify` checks the account has no key at all and that the deploy transaction was exactly those three
  actions.

**Consequences.**

- Nobody can change this deployment's code or move its balance except by the contract's own rules. A bug in it stays;
  the fix is another new account.
- The contract's `owner` account keeps its two admin powers, both disclosed: registering local runners for the
  `SimulatedLocal` path, and setting OutLayer's config (which job hash earns `OutLayerTee`, `0009`).
- `tools/testnet-reset.ts` refuses a locked contract.
- The testnet root for this deployment came from the public faucet, one draw, with its key in the keyring
  (`tools/faucet.ts`).
