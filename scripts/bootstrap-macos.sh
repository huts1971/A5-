#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/.tools"
NODE_VERSION="v24.16.0"
NODE_DIR="$TOOLS/node-$NODE_VERSION-darwin-arm64"
NODE_LINK="$TOOLS/node"
PYTHON_VERSION="3.12.13"
PYTHON_RELEASE="20260610"
PYTHON_ARCHIVE="cpython-${PYTHON_VERSION}+${PYTHON_RELEASE}-aarch64-apple-darwin-install_only.tar.gz"
PYTHON_URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_RELEASE}/cpython-${PYTHON_VERSION}%2B${PYTHON_RELEASE}-aarch64-apple-darwin-install_only.tar.gz"
PYTHON_DIR="$TOOLS/python"
ROOT_PYTHON_TARBALL="$ROOT/$PYTHON_ARCHIVE"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This bootstrap script is for macOS only."
  exit 1
fi

if [[ "$(uname -m)" != "arm64" ]]; then
  echo "This script currently supports Apple Silicon macOS (arm64)."
  echo "Detected: $(uname -m)"
  exit 1
fi

mkdir -p "$TOOLS"

download() {
  local url="$1"
  local output="$2"
  if [[ -f "$output" ]]; then
    if tar -tzf "$output" >/dev/null 2>&1; then
      echo "Using existing download: $output"
      return
    fi
    echo "Resuming incomplete download: $output"
  fi
  echo "Downloading $url"
  curl -fL -C - --retry 5 --retry-delay 3 -o "$output" "$url"
}

echo "[1/6] Preparing local Node.js"
if [[ ! -x "$NODE_LINK/bin/node" ]]; then
  NODE_TARBALL="$TOOLS/node-${NODE_VERSION}-darwin-arm64.tar.gz"
  download "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-arm64.tar.gz" "$NODE_TARBALL"
  rm -rf "$NODE_DIR" "$NODE_LINK"
  tar -xzf "$NODE_TARBALL" -C "$TOOLS"
  ln -s "$(basename "$NODE_DIR")" "$NODE_LINK"
fi
export PATH="$NODE_LINK/bin:$PATH"
"$NODE_LINK/bin/node" --version
"$NODE_LINK/bin/npm" --version

echo "[2/6] Preparing local Python"
if [[ ! -x "$PYTHON_DIR/bin/python3" ]]; then
  PYTHON_TARBALL="$TOOLS/$PYTHON_ARCHIVE"
  if [[ -f "$ROOT_PYTHON_TARBALL" ]] && tar -tzf "$ROOT_PYTHON_TARBALL" >/dev/null 2>&1; then
    echo "Using manually downloaded Python archive: $ROOT_PYTHON_TARBALL"
    cp "$ROOT_PYTHON_TARBALL" "$PYTHON_TARBALL"
  else
    download "$PYTHON_URL" "$PYTHON_TARBALL"
  fi
  rm -rf "$PYTHON_DIR" "$TOOLS/python-extract"
  mkdir -p "$TOOLS/python-extract"
  tar -xzf "$PYTHON_TARBALL" -C "$TOOLS/python-extract"
  if [[ -d "$TOOLS/python-extract/python" ]]; then
    mv "$TOOLS/python-extract/python" "$PYTHON_DIR"
  else
    echo "Could not find extracted python directory."
    exit 1
  fi
  rm -rf "$TOOLS/python-extract"
  xattr -dr com.apple.quarantine "$PYTHON_DIR" >/dev/null 2>&1 || true
  xattr -dr com.apple.provenance "$PYTHON_DIR" >/dev/null 2>&1 || true
fi
"$PYTHON_DIR/bin/python3" --version

echo "[3/6] Preparing backend virtual environment"
cd "$ROOT/backend"
if [[ ! -x ".venv/bin/python" ]]; then
  rm -rf .venv
  "$PYTHON_DIR/bin/python3" -m venv .venv
fi
"$ROOT/backend/.venv/bin/python" -m pip install --upgrade pip
"$ROOT/backend/.venv/bin/python" -m pip install -r requirements-agentic.txt

"$ROOT/backend/.venv/bin/python" "$ROOT/scripts/configure-local.py"

echo "[4/6] Preparing frontend dependencies"
cd "$ROOT/frontend"
"$NODE_LINK/bin/npm" ci

echo "[5/6] Existing frontend configuration preserved"

echo "[6/6] Done"
echo ""
echo "Start development services with:"
echo "  ./scripts/start-dev-macos.sh"
