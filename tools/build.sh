#!/bin/sh
# Rebuild the contracts into res/ with cargo-near, which is what makes near-sdk use NEAR's host functions.
# (docs/research/killtest-2026-11-05.md has what plain `cargo build` costs you.) The checked-in wasm means a judge doesn't need this.
# Usage: sh tools/build.sh keyhole test-token mock-outlayer killtest job; CHECK_ONLY=1 builds and prints hashes without writing res/.
set -e
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$HOME/dev/.cargo-target-r6}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo/contracts"
# Panic messages carry source paths: without this, a build differs by where the clone and the home directory are. cargo-near takes rustflags only through --env.
flags="--remap-path-prefix=$repo=/keyhole --remap-path-prefix=$HOME/.cargo/registry/src=/cargo"
# Never trust a cached core: cargo hashes a path dependency by its path inside the workspace, so a copy of this tree elsewhere shares its cache keys.
touch core/src/*.rs */src/lib.rs
for c in "$@"; do
  if [ "$c" = job ]; then
    (cd "$repo/job" && RUSTFLAGS="$flags" cargo build --release --target wasm32-wasip2 >/dev/null 2>&1)
    n=keyhole_pnl_job
    out="$CARGO_TARGET_DIR/wasm32-wasip2/release/keyhole-pnl-job.wasm"
  else
    (cd "$c" && cargo near build non-reproducible-wasm --no-abi --env "RUSTFLAGS=$flags" >/dev/null 2>&1)
    n="$(echo "$c" | tr - _)"
    out="$CARGO_TARGET_DIR/near/$n/$n.wasm"
  fi
  if [ -n "${CHECK_ONLY:-}" ]; then
    shasum -a 256 "$out" | sed "s#  .*#  $n.wasm#"
  else
    cp "$out" "$repo/res/$n.wasm"
    chmod 644 "$repo/res/$n.wasm"
  fi
done
if [ -z "${CHECK_ONLY:-}" ]; then
  cd "$repo/res" && shasum -a 256 *.wasm | grep -v intents.near > SHA256SUMS
fi
