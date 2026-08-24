#!/usr/bin/env bash
# Mosaic installer — detects OS/arch, downloads the matching binary from the
# latest GitHub release, verifies the checksum, installs to ~/.local/bin.
#
#   curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash
#
set -euo pipefail

REPO="morriszdweck/mosaic"
INSTALL_DIR="${MOSAIC_INSTALL_DIR:-$HOME/.local/bin}"
# Sibling of the bin directory, holding only the binary — the launcher runs the
# binary from here precisely because we know what is (and is not) in it.
LIBEXEC_DIR="${MOSAIC_LIBEXEC_DIR:-$(dirname "$INSTALL_DIR")/libexec/mosaic}"

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

# Write the launcher that gets installed as `mosaic`. Quoted heredoc: nothing
# here is expanded at install time — the script resolves its own location at run
# time so the install stays relocatable.
write_launcher() {
  cat > "$1" <<'LAUNCHER'
#!/bin/sh
# Mosaic launcher.
#
# The binary is a Bun single-file executable, and Bun reads bunfig.toml from the
# current directory at startup and executes whatever its `preload` key names.
# Starting mosaic inside an untrusted repo would therefore run that repo's code
# inside the mosaic process, alongside the provider tokens mosaic has stored.
#
# So: start the binary from a directory holding nothing but the binary, and pass
# the user's real working directory in MOSAIC_CWD. The CLI restores it once Bun
# is past the startup phase that reads bunfig.toml.
set -eu

self="$0"
# Follow symlinks so a linked or shimmed `mosaic` still finds libexec.
while [ -L "$self" ]; do
  link="$(readlink "$self")"
  case "$link" in
    /*) self="$link" ;;
    *) self="$(dirname "$self")/$link" ;;
  esac
done
bindir="$(cd "$(dirname "$self")" && pwd)"

libexec="$bindir/../libexec/mosaic"
binary="$libexec/mosaic-bin"

if [ ! -x "$binary" ]; then
  echo "mosaic: missing binary at $binary" >&2
  echo "Reinstall: curl -fsSL https://raw.githubusercontent.com/morriszdweck/mosaic/main/install.sh | bash" >&2
  exit 1
fi

MOSAIC_CWD="$PWD"
export MOSAIC_CWD

cd "$libexec"
exec "$binary" "$@"
LAUNCHER
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

  # Two-part install: the binary lives in its own libexec directory and a small
  # launcher goes on PATH. See the launcher's own comment for why.
  mkdir -p "$INSTALL_DIR" "$LIBEXEC_DIR"
  install -m 0755 "$tmp/$target" "$LIBEXEC_DIR/mosaic-bin"

  write_launcher "$tmp/launcher"
  install -m 0755 "$tmp/launcher" "$INSTALL_DIR/mosaic"

  # The launcher resolves libexec relative to itself; make sure that actually
  # lands on the binary we just installed before declaring success.
  if ! "$INSTALL_DIR/mosaic" --version >/dev/null 2>&1; then
    echo "" >&2
    echo "Installed, but '$INSTALL_DIR/mosaic' failed to run." >&2
    echo "Expected the binary at: $LIBEXEC_DIR/mosaic-bin" >&2
    exit 1
  fi

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
