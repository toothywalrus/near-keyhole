#!/bin/sh
# Does the committed wasm come from the committed source? Copies the repo at HEAD to a different path, builds there with an empty target directory, and compares with the committed
# res/SHA256SUMS. It writes nothing here. Needs Rust 1.93 and cargo-near 0.22. Run: npm run check-res
set -e
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)/somewhere-else"
mkdir -p "$work"
git -C "$repo" archive HEAD contracts tools job | tar -x -C "$work"
export CARGO_TARGET_DIR="$work/target"
CHECK_ONLY=1 sh "$work/tools/build.sh" keyhole test-token mock-outlayer killtest > "$work/got"
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/rustup/bin:$PATH"
(cd "$work/job" && RUSTFLAGS="--remap-path-prefix=$work=/keyhole --remap-path-prefix=$HOME/.cargo/registry/src=/cargo" cargo build --release --target wasm32-wasip2 >/dev/null 2>&1)
shasum -a 256 "$CARGO_TARGET_DIR/wasm32-wasip2/release/keyhole-pnl-job.wasm" | sed 's#  .*#  keyhole_pnl_job.wasm#' >> "$work/got"
git -C "$repo" show HEAD:res/SHA256SUMS | sort -k2 > "$work/want"
sort -k2 "$work/got" > "$work/got.sorted"
rm -rf "$CARGO_TARGET_DIR"
if diff "$work/want" "$work/got.sorted"; then echo "All $(wc -l < "$work/want" | tr -d ' ') wasm files match the committed hashes, built from a different path in an empty target directory."; else echo "MISMATCH"; exit 1; fi
