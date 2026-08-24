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

main() {
  local target url checksum_url
  target="$(detect_target)"
  # tmp is deliberately global so the EXIT trap can see it after main returns.
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  echo "Installing mosaic ($target)…"

  url="https://github.com/${REPO}/releases/latest/download/${target}"
  checksum_url="${url}.sha256"

  # Save under the release asset name — the checksum file references it.
  curl -fsSL "$url" -o "$tmp/$target"
  curl -fsSL "$checksum_url" -o "$tmp/$target.sha256"

  # Verify checksum.
  (cd "$tmp" && (sha256sum -c "$target.sha256" 2>/dev/null || shasum -a 256 -c "$target.sha256"))

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
