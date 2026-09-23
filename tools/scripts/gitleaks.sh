#!/usr/bin/env bash
# Runs a pinned, checksum-verified gitleaks. Downloads once into .cache/gitleaks/<version>/.
# Usage: tools/scripts/gitleaks.sh <gitleaks arguments>
# Env: GITLEAKS_BASE_URL overrides the release URL (used by the test).
set -euo pipefail

VERSION="8.30.1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="${GITLEAKS_CACHE_DIR:-$ROOT/.cache/gitleaks/$VERSION}"
BIN="$CACHE_DIR/gitleaks"
BASE_URL="${GITLEAKS_BASE_URL:-https://github.com/gitleaks/gitleaks/releases/download/v$VERSION}"

if [ ! -x "$BIN" ]; then
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) echo "gitleaks.sh: unsupported architecture $arch" >&2; exit 1 ;;
  esac
  asset="gitleaks_${VERSION}_${os}_${arch}.tar.gz"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "gitleaks.sh: downloading $asset" >&2
  curl -fsSL "$BASE_URL/$asset" -o "$tmp/$asset"
  curl -fsSL "$BASE_URL/gitleaks_${VERSION}_checksums.txt" -o "$tmp/checksums.txt"
  if ! (cd "$tmp" && grep " $asset\$" checksums.txt | sha256sum -c - >/dev/null); then
    echo "gitleaks.sh: checksum verification FAILED for $asset; refusing to install" >&2
    exit 1
  fi
  mkdir -p "$CACHE_DIR"
  tar -xzf "$tmp/$asset" -C "$CACHE_DIR" gitleaks
fi

exec "$BIN" "$@"
