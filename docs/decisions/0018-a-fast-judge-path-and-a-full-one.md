# 0018: `npm run judge` is the fast path a screener can finish; `npm run judge:full` has everything else

**Context.** An AI screener on a 2-CPU Linux box couldn't finish `npm run judge` in its time: the default run
pulled the pinned Rust 1.93 to run the core's property tests, downloaded NEAR's sandbox binary, and started four
local nodes, which need glibc 2.38 and fail on Debian 12 without saying why (#16). The testnet re-read, the one check
that backs the deployment claims, wasn't in the default run at all.

**Decision.**

- `npm run judge` runs only what needs `npm ci` and nothing else: the TypeScript twin and its vectors, the attack suite
  and the ledger fuzz on the real wasm (the local host, `0007`), and `npm run verify` against testnet beside them
  (views only; `--offline`, or no network, makes it a SKIP). The three local steps run side by side, and a trader's key tree is built
  once per seed (it was 70% of the attack suite's time). Measured from a fresh clone in the screeners' Debian 12 image with 2 CPUs:
  59 s, and 2 min 6 s while other sandboxes kept the host busy.
- `npm run judge:full` adds the Rust tests, the suites on a local NEAR node (kill test, demo, copy, job, the attack
  suite with real epochs), the page test in Chromium and every mutant. It checks once whether the sandbox binary can
  run and skips those rows with the reason, runs at most two nodes at once, and gives every step a timeout.
- Every step prints its row the moment it ends, and every suite prints its result before its cleanup, so a run that's
  cut off still shows what it got. SIGINT prints the table so far.

**Consequences.**

- The default run proves less than the full one: nothing in it touches a real node. The attack suite covers the same
  attacks on the local host, and the full run's logs are committed (`docs/research/`).
- The README states the prerequisites per path and a Docker line that runs the fast path on any Linux.
