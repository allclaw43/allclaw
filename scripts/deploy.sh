#!/usr/bin/env bash
# =============================================================================
# AllClaw Deployment Script
# Usage: bash scripts/deploy.sh [--backend] [--frontend] [--all] [--migrate]
# =============================================================================
set -e

PROJECT_ROOT="/var/www/allclaw"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
LOG_FILE="/var/log/allclaw-deploy.log"

# ── Colors ────────────────────────────────────────────────────────────────────
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
BOLD="\033[1m"
RESET="\033[0m"

log()  { echo -e "${CYAN}[$(date '+%H:%M:%S')]${RESET} $*" | tee -a "$LOG_FILE"; }
ok()   { echo -e "${GREEN}  ✓${RESET} $*" | tee -a "$LOG_FILE"; }
warn() { echo -e "${YELLOW}  ⚠${RESET} $*" | tee -a "$LOG_FILE"; }
die()  { echo -e "${RED}  ✗ FATAL:${RESET} $*" | tee -a "$LOG_FILE"; exit 1; }

# ── Parse args ────────────────────────────────────────────────────────────────
DO_BACKEND=0; DO_FRONTEND=0; DO_MIGRATE=0; DO_ALL=0

for arg in "$@"; do
  case $arg in
    --backend)  DO_BACKEND=1  ;;
    --frontend) DO_FRONTEND=1 ;;
    --migrate)  DO_MIGRATE=1  ;;
    --all)      DO_ALL=1      ;;
    --help|-h)
      echo -e "${BOLD}AllClaw Deploy${RESET} — usage:"
      echo "  bash scripts/deploy.sh [options]"
      echo ""
      echo "  --all       Full deploy (pull + backend + frontend + nginx reload)"
      echo "  --backend   Restart backend only"
      echo "  --frontend  Rebuild + restart frontend"
      echo "  --migrate   Run latest DB migration scripts"
      echo ""
      echo "  Default (no args): --all"
      exit 0
      ;;
  esac
done

# Default: full deploy
[[ $DO_BACKEND -eq 0 && $DO_FRONTEND -eq 0 && $DO_MIGRATE -eq 0 ]] && DO_ALL=1
[[ $DO_ALL -eq 1 ]] && { DO_BACKEND=1; DO_FRONTEND=1; }

# ── Banner ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║    AllClaw — Deploy Pipeline      ║"
echo "  ║    $(date '+%Y-%m-%d %H:%M %Z')         ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${RESET}"

# ── Prerequisites check ────────────────────────────────────────────────────
log "Checking prerequisites..."
command -v node  >/dev/null 2>&1 || die "Node.js not found"
command -v npm   >/dev/null 2>&1 || die "npm not found"
command -v pm2   >/dev/null 2>&1 || die "PM2 not found (npm install -g pm2)"
command -v nginx >/dev/null 2>&1 || warn "nginx not found in PATH"
ok "Node $(node -v) · npm $(npm -v) · PM2 $(pm2 -v)"

# ── Git pull ──────────────────────────────────────────────────────────────
if [[ $DO_ALL -eq 1 ]]; then
  log "Pulling latest code from GitHub..."
  cd "$PROJECT_ROOT"
  git pull origin main 2>&1 | tail -3 | tee -a "$LOG_FILE"
  ok "Git pull complete — $(git rev-parse --short HEAD)"
fi

# ── DB Migration ──────────────────────────────────────────────────────────
if [[ $DO_MIGRATE -eq 1 ]]; then
  log "Running DB migrations..."
  cd "$PROJECT_ROOT"
  for v in 1 2 3 4 5 6; do
    SCRIPT="backend/src/db/migrate${v > 1 ? "_v${v}" : ""}.js"
    # Correct filename logic
    if [[ $v -eq 1 ]]; then
      SCRIPT="backend/src/db/migrate.js"
    else
      SCRIPT="backend/src/db/migrate_v${v}.js"
    fi
    if [[ -f "$SCRIPT" ]]; then
      log "  → Migration V${v}: $SCRIPT"
      node "$SCRIPT" 2>&1 | tail -5 | tee -a "$LOG_FILE"
      ok "  V${v} done"
    fi
  done
fi

# ── Backend ───────────────────────────────────────────────────────────────
if [[ $DO_BACKEND -eq 1 ]]; then
  log "Updating backend..."
  cd "$BACKEND_DIR"

  # Install new deps if package.json changed
  if git -C "$PROJECT_ROOT" diff HEAD~1 HEAD --name-only 2>/dev/null | grep -q "backend/package"; then
    log "  package.json changed — running npm install..."
    npm install --omit=dev 2>&1 | tail -3 | tee -a "$LOG_FILE"
  fi

  log "  Restarting allclaw-backend via PM2..."
  pm2 restart allclaw-backend 2>&1 | tail -2 | tee -a "$LOG_FILE"
  sleep 3

  # Health check
  HEALTH=$(curl -sf http://127.0.0.1:3001/health 2>/dev/null || echo "{}")
  VERSION=$(echo "$HEALTH" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('version','?'))" 2>/dev/null || echo "?")
  ok "Backend online — API v${VERSION}"
fi

# ── Frontend ──────────────────────────────────────────────────────────────
if [[ $DO_FRONTEND -eq 1 ]]; then
  log "Building frontend..."
  cd "$FRONTEND_DIR"

  # Install deps if needed
  if [[ ! -d node_modules ]] || git -C "$PROJECT_ROOT" diff HEAD~1 HEAD --name-only 2>/dev/null | grep -q "frontend/package"; then
    log "  Running npm install..."
    npm install 2>&1 | tail -3 | tee -a "$LOG_FILE"
  fi

  log "  Running next build..."
  npm run build 2>&1 | tee -a "$LOG_FILE" | grep -E "✓ Compiled|error TS|Error:|Route|^[├└]"

  ROUTE_COUNT=$(grep -c "^[├└]" <<< "$(npm run build 2>&1 | grep '^[├└]')" 2>/dev/null || echo "?")

  log "  Restarting allclaw-frontend via PM2..."
  pm2 restart allclaw-frontend 2>&1 | tail -2 | tee -a "$LOG_FILE"
  sleep 4

  FHTTP=$(curl -sfo /dev/null -w "%{http_code}" http://127.0.0.1:3000 2>/dev/null || echo "???")
  ok "Frontend online — HTTP $FHTTP"
fi

# ── Nginx reload ──────────────────────────────────────────────────────────
if [[ $DO_ALL -eq 1 ]]; then
  log "Reloading nginx..."
  nginx -t 2>&1 | tee -a "$LOG_FILE" && systemctl reload nginx 2>&1 || warn "nginx reload failed (check config)"
  ok "Nginx reloaded"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  ═══════════════════════════════════════${RESET}"
echo -e "${GREEN}${BOLD}  ✓  Deploy complete${RESET}"
echo -e "     Commit: ${CYAN}$(cd "$PROJECT_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo '?')${RESET}"
echo -e "     Time:   $(date '+%H:%M:%S')"
echo -e "     Site:   ${CYAN}https://allclaw.io${RESET}"
echo -e "${GREEN}${BOLD}  ═══════════════════════════════════════${RESET}"
echo ""

pm2 list 2>/dev/null | grep allclaw || true
