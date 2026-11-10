#!/usr/bin/env bash
# fetch-engine.sh — Reproducible, pinned checkout of the engine base (WSL/Unix).
#
# Fetches origami-ltd/wasm-revc at the exact commit documented in the technical
# report, plus submodules (notably vendor/librw) at the superproject-recorded
# commits. No floating dependencies. See docs/SOURCES.md.
set -euo pipefail

# --- Pinned identity (do not float) -----------------------------------------
REPO_URL="https://github.com/origami-ltd/wasm-revc"
REPO_COMMIT="acde392e0ba582156fcf516dbaeb73b73adebb3e"
LIBRW_EXPECTED="ac6b902bc0a16950a7ac63ca7b2702e13b598af9"
# ----------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_DIR="${1:-$SCRIPT_DIR/../engine/wasm-revc}"
mkdir -p "$(dirname "$ENGINE_DIR")"

# Force LF line endings so the shell build scripts stay runnable in the Linux
# build container (bash rejects "set -euo pipefail\r"). C++ tolerates CRLF.
if [ ! -d "$ENGINE_DIR/.git" ]; then
  echo "Cloning $REPO_URL ..."
  git clone -c core.autocrlf=false -c core.eol=lf "$REPO_URL" "$ENGINE_DIR"
fi

cd "$ENGINE_DIR"
git config core.autocrlf false
git config core.eol lf
git fetch --tags origin
echo "Checking out pinned commit $REPO_COMMIT ..."
git checkout --detach "$REPO_COMMIT"
echo "Initializing submodules at recorded commits ..."
git -c core.autocrlf=false -c core.eol=lf submodule update --init --recursive

HEAD_SHA="$(git rev-parse HEAD)"
echo "wasm-revc HEAD : $HEAD_SHA"
[ "$HEAD_SHA" = "$REPO_COMMIT" ] || echo "WARNING: HEAD != expected pinned commit!"

if [ -e vendor/librw/.git ]; then
  LIBRW_SHA="$(git -C vendor/librw rev-parse HEAD)"
  echo "librw HEAD     : $LIBRW_SHA"
  [ "$LIBRW_SHA" = "$LIBRW_EXPECTED" ] || echo "WARNING: librw != expected pinned commit!"
else
  echo "WARNING: vendor/librw not found — inspect .gitmodules."
fi

echo
echo "Done. Record any divergence in docs/SOURCES.md."
