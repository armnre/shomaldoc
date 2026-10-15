#!/usr/bin/env bash
# Installs a real cron job (daily 02:15 Tehran-independent UTC) that runs backup-db.sh as the app user.
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "run as root"; exit 1; }
cat > /etc/cron.d/shomaldoc-backup <<CRON
SHELL=/bin/bash
PATH=/opt/shomaldoc/node/current/bin:/usr/local/bin:/usr/bin:/bin
15 2 * * * shomaldoc cd /opt/shomaldoc/current && bash deploy/backup-db.sh >> /var/log/shomaldoc-backup.log 2>&1
CRON
chmod 644 /etc/cron.d/shomaldoc-backup
touch /var/log/shomaldoc-backup.log && chown shomaldoc:shomaldoc /var/log/shomaldoc-backup.log
echo "installed /etc/cron.d/shomaldoc-backup"
