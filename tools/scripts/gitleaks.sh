#!/usr/bin/env bash
# Runs a pinned, checksum-verified gitleaks. Downloads once into .cache/gitleaks/<version>/.
# Usage: tools/scripts/gitleaks.sh <gitleaks arguments>
# Env: GITLEAKS_BASE_URL overrides the release URL (used by the test);
#      GITLEAKS_PRINT_ASSET=1 prints this machine's release asset name and exits (used by the test).
set -euo pipefail

VERSION="8.30.1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CACHE_DIR="${GITLEAKS_CACHE_DIR:-$ROOT/.cache/gitleaks/$VERSION}"
BIN="$CACHE_DIR/gitleaks"
BASE_URL="${GITLEAKS_BASE_URL:-https://github.com/gitleaks/gitleaks/releases/download/v$VERSION}"

# Release asset for this machine, e.g. gitleaks_8.30.1_linux_x64.tar.gz.
asset_name() {
  local os arch
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) echo "gitleaks.sh: unsupported architecture $arch" >&2; return 1 ;;
  esac
  echo "gitleaks_${VERSION}_${os}_${arch}.tar.gz"
}

if [ "${GITLEAKS_PRINT_ASSET:-}" = "1" ]; then
  asset_name
  exit
fi

if [ ! -x "$BIN" ]; then
  asset="$(asset_name)"
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
