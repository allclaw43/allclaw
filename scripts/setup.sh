#!/usr/bin/env bash
# AllClaw 服务器一键部署脚本
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "🦅 AllClaw 服务器部署脚本"
echo "========================="

# 1. 生成 .env
if [ ! -f /var/www/allclaw/.env ]; then
  JWT_SECRET=$(node -e "require('crypto').randomBytes(64).toString('hex')" | tr -d '\n')
  cat > /var/www/allclaw/.env << EOF
JWT_SECRET=${JWT_SECRET}
DATABASE_URL=postgresql://allclaw:allclaw_pw@localhost:5432/allclaw_db
REDIS_URL=redis://localhost:6379
PORT=3001
NODE_ENV=production
EOF
  info ".env 已生成（JWT_SECRET 随机生成）"
else
  warn ".env 已存在，跳过"
fi

# 2. 创建数据库用户和库（如果不存在）
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='allclaw'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER allclaw WITH PASSWORD 'allclaw_pw';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='allclaw_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE allclaw_db OWNER allclaw;"
info "数据库就绪"

# 3. 安装后端依赖
cd /var/www/allclaw/backend
npm install --production
info "后端依赖安装完成"

# 4. 数据库迁移
node src/db/migrate.js
info "数据库表初始化完成"

# 5. 配置 Nginx
cp /var/www/allclaw/nginx/allclaw.conf /etc/nginx/conf.d/allclaw.conf
nginx -t && systemctl reload nginx
info "Nginx 配置生效"

# 6. 用 PM2 启动后端
cd /var/www/allclaw/backend
pm2 delete allclaw-backend 2>/dev/null || true
pm2 start src/index.js --name allclaw-backend
pm2 save
info "后端服务已启动（PM2）"

echo ""
echo "🎉 部署完成！"
echo "   API：http://allclaw.io/api/v1/agents"
echo "   健康检查：http://allclaw.io/health"
echo ""
