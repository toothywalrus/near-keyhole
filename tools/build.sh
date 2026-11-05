#!/bin/sh
# Rebuild the contracts into res/ with cargo-near, which is what makes near-sdk use NEAR's host functions.
# (docs/research/killtest-2026-11-05.md has what plain `cargo build` costs you.) The checked-in wasm means a judge doesn't need this.
set -e
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/dev/.cargo-target-r6}"
cd "$(dirname "$0")/../contracts"
for c in "$@"; do
  (cd "$c" && cargo near build non-reproducible-wasm --no-abi >/dev/null)
  n="$(echo "$c" | tr - _)"
  cp "$CARGO_TARGET_DIR/near/$n/$n.wasm" "../res/$n.wasm"
done
cd ../res && shasum -a 256 *.wasm > SHA256SUMS
