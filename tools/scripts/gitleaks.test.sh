#!/usr/bin/env bash
# Tests for gitleaks.sh: install (from the repo cache when present, otherwise download), offline
# reuse, tampered checksum. Runs inside `turbo run test`, so it avoids the network whenever the
# repository cache (.cache/gitleaks/8.30.1) already holds the binary.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$HERE/gitleaks.sh"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
pass() { echo "ok   $1"; }
fail() { echo "FAIL $1" >&2; exit 1; }

# 1. install path: seed from the repository cache if present (no network), else download + verify
if [ -x "$ROOT/.cache/gitleaks/8.30.1/gitleaks" ]; then
  mkdir -p "$work/cache" && cp "$ROOT/.cache/gitleaks/8.30.1/gitleaks" "$work/cache/gitleaks"
fi
out="$(GITLEAKS_CACHE_DIR="$work/cache" "$SCRIPT" version)"
[ "$out" = "8.30.1" ] || fail "expected version 8.30.1, got '$out'"
pass "installs and runs the pinned version"

# 2. cached binary is reused without network
out="$(GITLEAKS_CACHE_DIR="$work/cache" GITLEAKS_BASE_URL="http://127.0.0.1:9/unreachable" "$SCRIPT" version)"
[ "$out" = "8.30.1" ] || fail "cached binary not reused"
pass "reuses the cached binary offline"

# 3. tampered checksum: refuses to install, leaves no binary
mkdir -p "$work/release"
asset="gitleaks_8.30.1_$(uname -s | tr '[:upper:]' '[:lower:]')_x64.tar.gz"
cp "$work/cache/gitleaks" "$work/gitleaks" && (cd "$work" && tar -czf "release/$asset" gitleaks)
echo "0000000000000000000000000000000000000000000000000000000000000000  $asset" > "$work/release/gitleaks_8.30.1_checksums.txt"
if GITLEAKS_CACHE_DIR="$work/cache2" GITLEAKS_BASE_URL="file://$work/release" "$SCRIPT" version 2>"$work/err"; then
  fail "tampered checksum was accepted"
fi
grep -q "checksum verification FAILED" "$work/err" || fail "no checksum error message"
[ ! -e "$work/cache2/gitleaks" ] || fail "binary cached despite failed checksum"
pass "refuses a tampered checksum and caches nothing"
