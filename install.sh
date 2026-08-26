#!/usr/bin/env bash
# Mosaic installer.
#
#   curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
#
# Mosaic is a small distribution over the OpenCode engine, so installing it
# means fetching this repo and letting Bun pull the engine as a dependency —
# there is no separate binary to download or checksum.
set -euo pipefail

REPO="${MOSAIC_REPO:-morriszdweck/mosaic}"
REF="${MOSAIC_REF:-main}"
PREFIX="${MOSAIC_PREFIX:-$HOME/.local/share/mosaic}"
BIN_DIR="${MOSAIC_BIN_DIR:-$HOME/.local/bin}"

die() {
  echo "mosaic: $*" >&2
  exit 1
}

command -v bun >/dev/null 2>&1 || die "Bun is required — install it from https://bun.sh, then re-run this."

install_kimi_webbridge() {
  local binary="$HOME/.kimi-webbridge/bin/kimi-webbridge"
  if [ -x "$binary" ] || command -v kimi-webbridge >/dev/null 2>&1; then
    return
  fi

  command -v curl >/dev/null 2>&1 || die "curl is required to install Kimi WebBridge."
  echo "Installing Kimi WebBridge CLI…"
  curl -fsSL https://cdn.kimi.com/webbridge/install.sh | bash

  if [ ! -x "$binary" ] && ! command -v kimi-webbridge >/dev/null 2>&1; then
    die "Kimi WebBridge installation finished without a kimi-webbridge CLI."
  fi
}

echo "Installing Mosaic…"

if [ -d "$PREFIX/.git" ]; then
  git -C "$PREFIX" fetch --depth 1 origin "$REF" -q
  git -C "$PREFIX" reset --hard "origin/$REF" -q
else
  rm -rf "$PREFIX"
  mkdir -p "$(dirname "$PREFIX")"
  git clone --depth 1 --branch "$REF" -q "https://github.com/${REPO}" "$PREFIX"
fi

# --production would skip the typescript/@types used by `bun run typecheck`,
# which contributors need; the tree is small enough that it is not worth it.
bun install --cwd "$PREFIX" --silent
install_kimi_webbridge

# Swarm mode ships as markdown agents in its own repository. Vendored here
# rather than installed by its own script, which targets ~/.config/opencode —
# the OpenCode install Mosaic keeps out of. A failure here is not fatal:
# everything else works without it.
SWARM_REPO="${MOSAIC_SWARM_REPO:-morriszdweck/opencode-swarm}"
SWARM_DIR="$PREFIX/vendor/swarm"
if [ -d "$SWARM_DIR/.git" ]; then
  git -C "$SWARM_DIR" fetch --depth 1 origin main -q 2>/dev/null && \
    git -C "$SWARM_DIR" reset --hard origin/main -q 2>/dev/null || \
    echo "mosaic: could not update swarm; keeping the existing copy" >&2
else
  mkdir -p "$(dirname "$SWARM_DIR")"
  git clone --depth 1 -q "https://github.com/${SWARM_REPO}" "$SWARM_DIR" 2>/dev/null || \
    echo "mosaic: could not fetch swarm; Swarm mode will be unavailable" >&2
fi

mkdir -p "$BIN_DIR"
ln -sf "$PREFIX/bin/mosaic" "$BIN_DIR/mosaic"
chmod +x "$PREFIX/bin/mosaic"

# The launcher resolves the install relative to itself through the symlink, so
# check that it actually lands somewhere runnable before claiming success.
if ! "$BIN_DIR/mosaic" --version >/dev/null 2>&1; then
  die "installed, but '$BIN_DIR/mosaic' did not run"
fi

echo "✓ $("$BIN_DIR/mosaic" --version)"
echo "  installed to $PREFIX, linked at $BIN_DIR/mosaic"

if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  echo ""
  echo "Add $BIN_DIR to your PATH:"
  echo "  export PATH=\"$BIN_DIR:\$PATH\""
fi

cat <<'EOF'

Get started:
  mosaic providers    # add an API key (any provider you already pay for)
  mosaic              # start the TUI
  mosaic run "..."    # one-shot, no TUI
EOF
