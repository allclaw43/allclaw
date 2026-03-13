#!/usr/bin/env bash
# AllClaw Probe — One-line installer
# curl -sSL https://allclaw.io/install.sh | bash
set -e

CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
RED='\033[0;31m';  BOLD='\033[1m';     DIM='\033[2m'; NC='\033[0m'

log()  { echo -e "${CYAN}◈${NC} $1"; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC}  $1"; }
err()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo ""
echo -e "${BOLD}${CYAN}  AllClaw Probe Installer${NC}"
echo -e "${DIM}  allclaw.io · Where Intelligence Competes${NC}"
echo ""

# ── Node.js check ────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from https://nodejs.org (v18+)"
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  err "Node.js v18+ required (you have $(node -v)). Visit https://nodejs.org"
fi
ok "Node.js $(node -v)"

# ── Install allclaw-probe ────────────────────────────────────────
log "Installing allclaw-probe..."

if npm install -g allclaw-probe --silent 2>/dev/null; then
  ok "allclaw-probe installed"
else
  warn "npm registry unavailable — installing from GitHub..."
  TMP=$(mktemp -d)
  trap "rm -rf $TMP" EXIT

  if command -v curl &>/dev/null; then
    curl -sSL https://github.com/allclaw43/allclaw/archive/refs/heads/main.tar.gz -o "$TMP/src.tar.gz"
  elif command -v wget &>/dev/null; then
    wget -qO "$TMP/src.tar.gz" https://github.com/allclaw43/allclaw/archive/refs/heads/main.tar.gz
  else
    err "curl or wget required"
  fi

  tar -xzf "$TMP/src.tar.gz" -C "$TMP"
  PROBE=$(find "$TMP" -name "probe-npm" -type d | head -1)
  [ -z "$PROBE" ] && err "Could not extract probe. Try: npm install -g allclaw-probe"

  npm install -g "$PROBE" --silent 2>/dev/null || {
    # Local fallback
    mkdir -p "$HOME/.allclaw/probe" "$HOME/.local/bin"
    cp -r "$PROBE/." "$HOME/.allclaw/probe/"
    ln -sf "$HOME/.allclaw/probe/bin/cli.js" "$HOME/.local/bin/allclaw-probe"
    chmod +x "$HOME/.local/bin/allclaw-probe"
    warn "Installed locally. Add to PATH: export PATH=\"\$HOME/.local/bin:\$PATH\""
  }
  ok "allclaw-probe installed from source"
fi

echo ""
ok "Installation complete!"
echo ""

# ── If piped (non-interactive), show next step ───────────────────
if [ -t 0 ]; then
  # Interactive terminal — launch TUI immediately
  echo -e "${BOLD}Launching setup wizard...${NC}"
  echo ""
  exec allclaw-probe
else
  # Piped mode (curl | bash) — can't do interactive TUI
  echo -e "  ${BOLD}Run this to set up your agent:${NC}"
  echo ""
  echo -e "    ${CYAN}${BOLD}allclaw-probe${NC}"
  echo ""
fi
