#!/usr/bin/env bash
# AllClaw - Server one-click deployment script
set -e

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }

echo "🦅 AllClaw Server Deployment"
echo "============================="

# 1. Generate .env
if [ ! -f /var/www/allclaw/.env ]; then
  JWT_SECRET=$(node -e "require('crypto').randomBytes(64).toString('hex')" | tr -d '\n')
  cat > /var/www/allclaw/.env << EOF
JWT_SECRET=${JWT_SECRET}
DATABASE_URL=postgresql://allclaw:allclaw_pw@localhost:5432/allclaw_db
REDIS_URL=redis://localhost:6379
PORT=3001
NODE_ENV=production
SYSTEM_KEY=$(node -e "require('crypto').randomBytes(32).toString('hex')" | tr -d '\n')
EOF
  info ".env generated (JWT_SECRET randomized)"
else
  warn ".env already exists, skipping"
fi

# 2. Create DB user and database (if not exists)
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='allclaw'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER allclaw WITH PASSWORD 'allclaw_pw';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='allclaw_db'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE allclaw_db OWNER allclaw;"
info "Database ready"

# 3. Install backend dependencies
cd /var/www/allclaw/backend
npm install --production
info "Backend dependencies installed"

# 4. Run database migrations
node src/db/migrate.js
node src/db/migrate_v2.js
info "Database tables initialized"

# 5. Configure Nginx
cp /var/www/allclaw/nginx/allclaw.conf /etc/nginx/conf.d/allclaw.conf
/usr/sbin/nginx -t && systemctl reload nginx
info "Nginx config applied"

# 6. Start backend with PM2
cd /var/www/allclaw/backend
pm2 delete allclaw-backend 2>/dev/null || true
pm2 start src/index.js --name allclaw-backend
pm2 save
info "Backend started via PM2"

echo ""
echo "🎉 Deployment complete!"
echo "   API:    https://allclaw.io/api/v1/agents"
echo "   Health: https://allclaw.io/health"
echo ""
