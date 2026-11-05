#!/bin/sh
# Prove the core's totality property with the Kani model checker. Needs `cargo install --locked kani-verifier && cargo kani setup` (about 1.7 GB).
set -u
export PATH="$HOME/.rustup/toolchains/1.93.0-aarch64-apple-darwin/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:$PATH"
cd "$(dirname "$0")/../contracts/core" || exit 1
for h in proofs::apply_is_total_and_void_changes_nothing; do
  echo "== $h"
  perl -e 'alarm 900; exec @ARGV' -- cargo kani --target-dir "${KANI_TARGET:-/tmp/keyhole-kani}" --harness "$h" 2>&1 | grep -E "^VERIFICATION|Verification Time|Failed Checks|^error"
done
