#!/usr/bin/env bash
# Creates a dedicated role and database on the EXISTING PostgreSQL. Refuses if anything already exists.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
DB_NAME=shomaldoc; DB_USER=shomaldoc; ENV_DIR=/etc/shomaldoc; ENV_FILE=$ENV_DIR/app.env
[ -e "$ENV_FILE" ] && { echo "$ENV_FILE exists; refusing to overwrite"; exit 1; }
ROLE=$(sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_USER'")
DB=$(sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'")
[ -z "$ROLE$DB" ] || { echo "role or database already exists; refusing to modify"; exit 1; }
id -u "$DB_USER" >/dev/null 2>&1 || useradd --system --home-dir /opt/shomaldoc --shell /usr/sbin/nologin "$DB_USER"
PASS=$(openssl rand -hex 32)
sudo -u postgres psql -v ON_ERROR_STOP=1 >/dev/null <<SQL
CREATE ROLE $DB_USER LOGIN PASSWORD '$PASS';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
SQL
install -d -m 750 -o root -g "$DB_USER" "$ENV_DIR"
umask 077
cat > "$ENV_FILE" <<ENV
APP_ENV=production
NODE_ENV=production
DATABASE_URL=postgresql://$DB_USER:$PASS@127.0.0.1:5432/$DB_NAME
UPLOAD_DIR=/opt/shomaldoc/shared/storage/uploads
LOG_LEVEL=info
PUBLIC_BASE_URL=https://shomaldoc.shomal.ac.ir
ENV
chown "$DB_USER:$DB_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
echo "database $DB_NAME and role $DB_USER created; secrets written to $ENV_FILE (mode 600). Secret not printed."
