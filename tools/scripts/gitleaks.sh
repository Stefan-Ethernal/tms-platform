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

# SHA-256 of each release asset, pinned from the v8.30.1 release (not fetched alongside the asset:
# a same-origin checksums.txt would validate a self-consistent fake release just as well).
declare -A GITLEAKS_SHA256=(
  [gitleaks_${VERSION}_linux_x64.tar.gz]="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
  [gitleaks_${VERSION}_linux_arm64.tar.gz]="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
  [gitleaks_${VERSION}_darwin_x64.tar.gz]="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
  [gitleaks_${VERSION}_darwin_arm64.tar.gz]="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
)

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
  expected="${GITLEAKS_SHA256[$asset]:-}"
  if [ -z "$expected" ]; then
    echo "gitleaks.sh: no pinned checksum for $asset; refusing to install" >&2
    exit 1
  fi
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  echo "gitleaks.sh: downloading $asset" >&2
  curl -fsSL "$BASE_URL/$asset" -o "$tmp/$asset"
  actual="$(sha256sum "$tmp/$asset" | cut -d' ' -f1)"
  if [ "$actual" != "$expected" ]; then
    echo "gitleaks.sh: checksum verification FAILED for $asset; refusing to install" >&2
    exit 1
  fi
  mkdir -p "$CACHE_DIR"
  tar -xzf "$tmp/$asset" -C "$CACHE_DIR" gitleaks
fi

exec "$BIN" "$@"
