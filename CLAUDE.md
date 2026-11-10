# Instructions for Claude Code

@~/dev/claude-conventions/project-memory-system.md

## What this repo is

**Keyhole:** sell a provable window into a private trade journal on NEAR. A trader commits to a GGM key tree and a bond, writes numbered encrypted entries as they happen, and posts each epoch's PnL. A buyer pays into escrow for a window of epochs and receives the tree nodes covering exactly that window, wrapped to a one-time key. The contract rules on the sale itself (x25519 + ChaCha20 in wasm) and recomputes PnL from opened entries against oracle prices, slashing the bond on a false figure: 40% to the prover, the rest burned, and never a yocto to a buyer. It's a candidate entry for NEAR HACKATHON (tracks privacy, defi, agents), from Illia Polosukhin's Nov 4 idea.

It came out of `toothywalrus/near-lab` (round six, that repo's `0010` and `docs/ideas/keyhole.md`).

## Rules that are load-bearing

1. **This is a hackathon entry, judged partly by AI.** Claude Code and Codex run the README. Every feature must be reachable by "do X, see Y" steps a judge can run for free. Keep `README.md` and `JUDGES.md` true at every commit. `npm run judge` is the fast path a screener must finish: under 3 minutes on a 2-CPU Linux box with only `npm ci` (59 s on the screeners' Debian 12 image with 2 CPUs, 2 min 6 s with the host busy, 2026-11-10), no local node, no Rust, no browser. Everything slower goes in `npm run judge:full` (`0018`).
2. **A simulated attestation must never pass for a real one.** `AttestKind` is set by the code path (`docs/decisions/0009`). Seeded journals are labeled SEEDED on every page.
3. **The owner does every irreversible or outward step himself:** making the repo public, posting on X, the submission, anything on mainnet, signing up anywhere. Prepare these and wait.
4. **Testnet by default. No secrets in git,** not even gitignored files: keys live in the OS keyring (service `near-lab-testnet`: the macOS keychain, or `secret-tool` on Linux) or in environment variables, and `tools/keys.ts` never falls back to keeping one in memory. Mainnet keys use the service `near-mainnet`.
5. **This repo must stand on its own.** Research lives in near-lab (private); nothing here may depend on reading it.
6. **Every implementation of the PnL rule must agree to the unit.** Rust core, TypeScript twin, contract, job: change one and `fixtures/vectors.json` must be regenerated and every check re-run. Rounding drift means honest traders get slashed (`0004`).

## Issue tracking / decision records

This repo follows the GitHub Issues backlog and decision-records system in `@~/dev/claude-conventions/project-memory-system.md`.

Repo-specific specifics:
- Issues live on `toothywalrus/near-keyhole`, via `gh`'s default auth.
- Topic labels: `topic:contract`, `topic:crypto`, `topic:web`, `topic:copy`, `topic:hackathon`.

## Gotchas

- **Build with `cargo near build`** (`npm run build -- keyhole test-token mock-outlayer killtest`). Plain `cargo build` compiles near-sdk without `--cfg near`, so `env::sha256` becomes the `sha2` crate in the wasm and panics lose their messages (`docs/research/killtest-2026-11-05.md`).
- **`res/` is checked in** and `web/public/keyhole.wasm` is copied from it. After changing the contract: `npm run build -- keyhole`, `npm run seed` (the seeded state must match the wasm; a test checks this), `npm run web:build`.
- **Toolchains.** The contracts build on Rust 1.93 (`contracts/rust-toolchain.toml`); the job builds on stable (`wasm32-wasip2` is there).
- **near-sdk's `store` collections write on flush.** `env::storage_usage()` doesn't see their writes until `flush()`, so flush before `charge_storage`, or the call is under-charged. The attack suite's slack check catches this.
- **Sandbox timing.** `npm run attack -- --sandbox` uses real short epochs and takes about 15 minutes; the local host covers the same in seconds. A sandbox transaction takes about 0.4 s with optimistic waits. On testnet `Net.call` waits for FINAL, so reads see the callbacks, and a run takes about 12 minutes.
- **Testnet prepays gas.** 100 Tgas needs about 0.1 NEAR available up front, refunded after. `tools/testnet.ts` defaults to 100 Tgas, which every path fits in.
- **Deployments are locked and can't be replaced.** `tools/testnet.ts` deploys, initialises and deletes the only key in one transaction, to a fresh account (`0017`). A new contract version goes to a new account under a new root (`KEYHOLE_ROOT`); the old one stays as history. The state layout can change freely between versions for that reason.
- **The mutation tool matches source lines exactly.** Change a mutated line and `npm run mutate` says the line is stale.
- **Keep money out of buyers' hands.** Anything paid from a bond to a buyer is a way out of it, since a buyer can be the trader (`0013`). `tools/fuzz.ts` accounts for every yocto of every bond.
- **A shared target dir can hand you a mutant.** Cargo hashes a path dependency by its path inside the workspace, so a copy of this tree shares cache keys with the original. `tools/build.sh` touches the sources first, mutants build in their own target dir, and `npm run check-res` checks `res/` against the committed hashes from an empty one.
- **The reviews in `docs/research/review-2026-11-05.md` found bugs the suite missed.** Passing numbers say the checks are load-bearing, not complete. After a change to the money or the sale, get a cold read.
- **Mutants build in their own target directory** (`tools/mutate.ts`). A shared one would leave a mutant at `near/keyhole/keyhole.wasm`. A clean rebuild of everything in `res/` matched byte for byte on 2026-11-05.
