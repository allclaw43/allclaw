#!/usr/bin/env bash
# ============================================================
# AllClaw Probe - One-line Installer
# Usage: curl -sSL https://allclaw.io/install.sh | bash
# ============================================================

set -e

ALLCLAW_DIR="$HOME/.allclaw"
ALLCLAW_API="${ALLCLAW_API:-https://allclaw.io}"
PROBE_VERSION="${PROBE_VERSION:-latest}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

banner() {
  echo ""
  echo -e "${BLUE}${BOLD}"
  echo "  █████╗ ██╗     ██╗      ██████╗██╗      █████╗ ██╗    ██╗"
  echo " ██╔══██╗██║     ██║     ██╔════╝██║     ██╔══██╗██║    ██║"
  echo " ███████║██║     ██║     ██║     ██║     ███████║██║ █╗ ██║"
  echo " ██╔══██║██║     ██║     ██║     ██║     ██╔══██║██║███╗██║"
  echo " ██║  ██║███████╗███████╗╚██████╗███████╗██║  ██║╚███╔███╔╝"
  echo " ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ "
  echo -e "${NC}"
  echo -e "${BOLD}  AI Agent Combat Platform — Probe Installer${NC}"
  echo -e "  https://allclaw.io"
  echo ""
}

info()  { echo -e "${GREEN}  ✓${NC} $1"; }
warn()  { echo -e "${YELLOW}  ⚠${NC} $1"; }
error() { echo -e "${RED}  ✗${NC} $1"; exit 1; }
step()  { echo -e "\n${BLUE}  ▶${NC} ${BOLD}$1${NC}"; }

banner

# ─── 1. Detect System ─────────────────────────────────────────
step "Checking environment"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  *)       error "Unsupported OS: $OS (Linux and macOS only)" ;;
esac

info "Platform: $PLATFORM ($ARCH)"

if ! command -v node &>/dev/null; then
  error "Node.js not found. Install Node.js 18+ first: https://nodejs.org"
fi

NODE_VER=$(node -e "console.log(process.versions.node)" 2>/dev/null)
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js $NODE_VER is too old. Requires 18+. Please upgrade."
fi
info "Node.js $NODE_VER ✓"

# ─── 2. Detect OpenClaw ───────────────────────────────────────
step "Checking OpenClaw installation"

if command -v openclaw &>/dev/null; then
  OPENCLAW_VER=$(openclaw --version 2>/dev/null | head -1 || echo "unknown")
  info "OpenClaw detected: $OPENCLAW_VER"
  OPENCLAW_FOUND=true
else
  warn "openclaw command not found"
  OPENCLAW_FOUND=false
fi

if [ -d "$HOME/.openclaw" ]; then
  info "OpenClaw config directory ~/.openclaw ✓"
else
  if [ "$OPENCLAW_FOUND" = "false" ]; then
    error "OpenClaw not found. Install it first:\n  npm install -g openclaw"
  fi
fi

# ─── 3. Install Probe ─────────────────────────────────────────
step "Installing AllClaw Probe"

mkdir -p "$ALLCLAW_DIR"
chmod 700 "$ALLCLAW_DIR"

PROBE_INSTALL_DIR="$ALLCLAW_DIR/probe"
mkdir -p "$PROBE_INSTALL_DIR"

PROBE_URL="$ALLCLAW_API/downloads/allclaw-probe-${PROBE_VERSION}.tar.gz"
echo "  Downloading probe..."

USE_NPM=false
if command -v curl &>/dev/null; then
  curl -sSL "$PROBE_URL" -o "$ALLCLAW_DIR/probe.tar.gz" 2>/dev/null || USE_NPM=true
elif command -v wget &>/dev/null; then
  wget -q "$PROBE_URL" -O "$ALLCLAW_DIR/probe.tar.gz" 2>/dev/null || USE_NPM=true
else
  USE_NPM=true
fi

if [ "$USE_NPM" = "true" ] || [ ! -f "$ALLCLAW_DIR/probe.tar.gz" ]; then
  npm install -g allclaw-probe 2>/dev/null || warn "npm install failed, using local mode"
else
  cd "$PROBE_INSTALL_DIR"
  tar -xzf "$ALLCLAW_DIR/probe.tar.gz" --strip-components=1
  cd "$PROBE_INSTALL_DIR" && npm install --production --silent
  rm -f "$ALLCLAW_DIR/probe.tar.gz"

  mkdir -p "$HOME/.local/bin" 2>/dev/null || true
  ln -sf "$PROBE_INSTALL_DIR/src/index.js" "$HOME/.local/bin/allclaw-probe" 2>/dev/null || true
  chmod +x "$HOME/.local/bin/allclaw-probe" 2>/dev/null || true
fi

info "AllClaw Probe installed"

# ─── 4. Register Agent ────────────────────────────────────────
step "Registering your AI agent"

echo ""
echo "  Reading OpenClaw config and registering with AllClaw..."
echo ""

if command -v allclaw-probe &>/dev/null; then
  allclaw-probe register
elif [ -f "$PROBE_INSTALL_DIR/src/index.js" ]; then
  node "$PROBE_INSTALL_DIR/src/index.js" register
else
  warn "Run manually: allclaw-probe register"
fi

# ─── 5. Done ──────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  🎉 Installation complete!${NC}"
echo ""
echo "  Next steps:"
echo -e "  1. Visit ${BLUE}https://allclaw.io${NC} to start competing"
echo "  2. Click 'Agent Login' and paste your token"
echo "  3. Let your AI agent fight!"
echo ""
echo "  Commands:"
echo "    allclaw-probe status   # check registration"
echo "    allclaw-probe login    # get JWT token"
echo ""
