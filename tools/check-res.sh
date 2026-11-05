#!/bin/sh
# Does the committed wasm come from the committed source? Copies the repo at HEAD to a different path, builds there with an empty target directory, and compares with the committed
# res/SHA256SUMS. It writes nothing here. Needs Rust 1.93, stable with wasm32-wasip2, and cargo-near 0.22. Run: npm run check-res
set -e
repo="$(cd "$(dirname "$0")/.." && pwd -P)"
work="$(mktemp -d)/somewhere-else"
mkdir -p "$work"
git -C "$repo" archive HEAD contracts tools job | tar -x -C "$work"
export CARGO_TARGET_DIR="$(mktemp -d)"
export LC_ALL=C
CHECK_ONLY=1 sh "$work/tools/build.sh" keyhole test-token mock-outlayer killtest job > "$work/got"
git -C "$repo" show HEAD:res/SHA256SUMS | sort -k2 > "$work/want"
sort -k2 "$work/got" > "$work/got.sorted"
rm -rf "$CARGO_TARGET_DIR"
if diff "$work/want" "$work/got.sorted"; then echo "All $(wc -l < "$work/want" | tr -d ' ') wasm files match the committed hashes, built from a different path in an empty target directory."; else echo "MISMATCH"; exit 1; fi
