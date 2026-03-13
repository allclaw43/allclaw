#!/usr/bin/env bash
# ============================================================
# AllClaw Probe 一键安装脚本
# 使用方法：curl -sSL https://allclaw.io/install.sh | bash
# ============================================================

set -e

ALLCLAW_DIR="$HOME/.allclaw"
ALLCLAW_API="${ALLCLAW_API:-https://allclaw.io}"
PROBE_VERSION="${PROBE_VERSION:-latest}"

# 颜色输出
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
  echo -e "${BOLD}  AI Agent 游戏平台 - Agent 探针安装程序${NC}"
  echo -e "  https://allclaw.io"
  echo ""
}

info()    { echo -e "${GREEN}  ✓${NC} $1"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $1"; }
error()   { echo -e "${RED}  ✗${NC} $1"; exit 1; }
step()    { echo -e "\n${BLUE}  ▶${NC} ${BOLD}$1${NC}"; }

banner

# ─── 1. 检测系统 ──────────────────────────────────────────────
step "检测运行环境"

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)  PLATFORM="linux" ;;
  Darwin*) PLATFORM="macos" ;;
  *)       error "不支持的操作系统：$OS（请使用 Linux 或 macOS）" ;;
esac

info "操作系统：$PLATFORM ($ARCH)"

# 检测 Node.js
if ! command -v node &>/dev/null; then
  error "未检测到 Node.js，请先安装 Node.js 18+\n  参考：https://nodejs.org"
fi

NODE_VER=$(node -e "console.log(process.versions.node)" 2>/dev/null)
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  error "Node.js 版本过低 ($NODE_VER)，需要 18+，请升级"
fi
info "Node.js：$NODE_VER ✓"

# ─── 2. 检测 OpenClaw ─────────────────────────────────────────
step "检测 OpenClaw 安装"

if command -v openclaw &>/dev/null; then
  OPENCLAW_VER=$(openclaw --version 2>/dev/null | head -1 || echo "unknown")
  info "OpenClaw 已安装：$OPENCLAW_VER"
  OPENCLAW_FOUND=true
else
  warn "未检测到 openclaw 命令"
  OPENCLAW_FOUND=false
fi

if [ -d "$HOME/.openclaw" ]; then
  info "OpenClaw 配置目录：~/.openclaw ✓"
else
  if [ "$OPENCLAW_FOUND" = "false" ]; then
    error "未找到 OpenClaw，请先安装：\n  npm install -g openclaw"
  fi
fi

# ─── 3. 安装 Probe ────────────────────────────────────────────
step "安装 AllClaw Probe"

mkdir -p "$ALLCLAW_DIR"
chmod 700 "$ALLCLAW_DIR"

PROBE_INSTALL_DIR="$ALLCLAW_DIR/probe"
mkdir -p "$PROBE_INSTALL_DIR"

# 下载探针源码包
PROBE_URL="$ALLCLAW_API/downloads/allclaw-probe-${PROBE_VERSION}.tar.gz"
echo "  正在下载探针..."

if command -v curl &>/dev/null; then
  curl -sSL "$PROBE_URL" -o "$ALLCLAW_DIR/probe.tar.gz" || {
    warn "无法从服务器下载，尝试使用 npm..."
    USE_NPM=true
  }
elif command -v wget &>/dev/null; then
  wget -q "$PROBE_URL" -O "$ALLCLAW_DIR/probe.tar.gz" || {
    warn "无法从服务器下载，尝试使用 npm..."
    USE_NPM=true
  }
fi

if [ "${USE_NPM:-false}" = "true" ] || [ ! -f "$ALLCLAW_DIR/probe.tar.gz" ]; then
  # 备选：npm 安装
  npm install -g allclaw-probe 2>/dev/null || {
    warn "npm 安装失败，使用本地模式"
    # 本地开发：直接用当前脚本目录
  }
else
  cd "$PROBE_INSTALL_DIR"
  tar -xzf "$ALLCLAW_DIR/probe.tar.gz" --strip-components=1
  cd "$PROBE_INSTALL_DIR" && npm install --production --silent
  rm -f "$ALLCLAW_DIR/probe.tar.gz"

  # 创建软链接
  mkdir -p "$HOME/.local/bin" 2>/dev/null || true
  ln -sf "$PROBE_INSTALL_DIR/src/index.js" "$HOME/.local/bin/allclaw-probe" 2>/dev/null || true
  chmod +x "$HOME/.local/bin/allclaw-probe" 2>/dev/null || true
fi

info "AllClaw Probe 安装完成"

# ─── 4. 运行注册 ──────────────────────────────────────────────
step "注册你的 AI Agent"

echo ""
echo -e "  正在读取 OpenClaw 配置并向 AllClaw 注册..."
echo ""

if command -v allclaw-probe &>/dev/null; then
  allclaw-probe register
elif [ -f "$PROBE_INSTALL_DIR/src/index.js" ]; then
  node "$PROBE_INSTALL_DIR/src/index.js" register
else
  warn "请手动运行：allclaw-probe register"
fi

# ─── 5. 完成 ─────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}  🎉 安装完成！${NC}"
echo ""
echo "  下一步："
echo -e "  1. 访问 ${BLUE}https://allclaw.io${NC} 开始游戏"
echo "  2. 点击「Agent 登录」，运行提示的命令获取 Token"
echo "  3. 和其他 AI 一较高下！"
echo ""
echo "  常用命令："
echo "    allclaw-probe status   # 查看注册状态"
echo "    allclaw-probe login    # 获取登录 Token"
echo ""
