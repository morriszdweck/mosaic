#!/usr/bin/env bash
# Mosaic installer — detects OS/arch, downloads the matching binary from the
# latest GitHub release, verifies the checksum, installs to ~/.local/bin.
#
#   curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
#
set -euo pipefail

REPO="morriszdweck/mosaic"
INSTALL_DIR="${MOSAIC_INSTALL_DIR:-$HOME/.local/bin}"

detect_target() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *)
      echo "Unsupported OS: $os (Windows: use WSL2 and run this inside it)" >&2
      exit 1
      ;;
  esac
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *)
      echo "Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac
  echo "mosaic-${os}-${arch}"
}

# Verify $1 against the sibling .sha256 file, using whichever checksum tool
# this machine has. Quiet: callers decide what to report.
verify_checksum() {
  local dir="$1" name="$2"
  (
    cd "$dir"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c "$name.sha256"
    else
      shasum -a 256 -c "$name.sha256"
    fi
  ) >/dev/null 2>&1
}

main() {
  local target url checksum_url attempt
  target="$(detect_target)"
  # tmp is deliberately global so the EXIT trap can see it after main returns.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "Installing mosaic ($target)…"

  url="https://github.com/${REPO}/releases/latest/download/${target}"
  checksum_url="${url}.sha256"

  curl -fsSL "$checksum_url" -o "$tmp/$target.sha256"

  # The binary is ~70-90MB and a truncated or CDN-corrupted transfer arrives
  # looking like a complete file, so a bad checksum is a retryable event rather
  # than a fatal one. Re-download a few times before giving up.
  for attempt in 1 2 3; do
    # Save under the release asset name — the checksum file references it.
    if curl -fsSL "$url" -o "$tmp/$target" && verify_checksum "$tmp" "$target"; then
      break
    fi
    if [ "$attempt" -eq 3 ]; then
      echo "" >&2
      echo "Download failed checksum verification after 3 attempts." >&2
      echo "The release checksum is authoritative, so this is most likely a" >&2
      echo "corrupted transfer or a proxy rewriting the response body." >&2
      echo "Retry later, or download manually from:" >&2
      echo "  https://github.com/${REPO}/releases/latest" >&2
      exit 1
    fi
    echo "  checksum mismatch, re-downloading (attempt $((attempt + 1))/3)…" >&2
    rm -f "$tmp/$target"
  done

  chmod +x "$tmp/$target"

  # Catch a binary that verifies but cannot run here (wrong arch, missing
  # loader, quarantine) while we can still say something useful about it.
  if ! "$tmp/$target" --version >/dev/null 2>&1; then
    echo "" >&2
    echo "The downloaded binary did not run on this machine." >&2
    echo "Detected target: $target ($(uname -s) $(uname -m))" >&2
    exit 1
  fi

  mkdir -p "$INSTALL_DIR"
  install -m 0755 "$tmp/$target" "$INSTALL_DIR/mosaic"

  echo "✓ Installed to $INSTALL_DIR/mosaic"
  if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
    echo ""
    echo "Add $INSTALL_DIR to your PATH:"
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
  fi
  echo ""
  echo "Get started:"
  echo "  mosaic login codex     # sign in with ChatGPT (device flow)"
  echo "  mosaic                 # start the TUI"
}

main "$@"
