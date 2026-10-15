# شناسایی سرور و مسیر استقرار (شمال‌داک)

این فایل دو بخش دارد:
1. **دستورهای شناسایی** — همه فقط‌خواندنی‌اند (`read-only`) و چیزی روی سرور تغییر نمی‌دهند.
   کل بلوک را کپی کنید و در ترمینال سرور (یا SSH Terminal پنل) اجرا کنید و **کل خروجی** را برگردانید.
2. **نقشهٔ استقرار** — بر اساس همان خروجی، دقیقاً می‌گوییم کدام مسیر را برویم.

> هیچ رمزی در این فایل نیست و نباید در خروجی‌ها هم باشد. دستورها عمداً هیچ رمز/کلیدی چاپ نمی‌کنند.

## ۱) بلوک شناسایی (کپی-پیست کامل)

```bash
{
echo "=== 1. OS ==="; cat /etc/os-release 2>/dev/null | head -4; uname -a; echo "uptime:$(uptime -p 2>/dev/null)"
echo "=== 2. CPU/RAM/DISK ==="; nproc; free -h | head -2; df -h / /var /opt 2>/dev/null | sort -u
echo "=== 3. WHO AM I ==="; id; echo "HOME=$HOME"; sudo -n true 2>/dev/null && echo "sudo: passwordless" || echo "sudo: needs password or unavailable"
echo "=== 4. PANEL ==="; (plesk version 2>/dev/null || cat /etc/psa/.psa-version 2>/dev/null || echo "no plesk cli"); ls -d /opt/psa /usr/local/psa /var/www/vhosts 2>/dev/null
echo "=== 5. WEB SERVER ==="; (nginx -v 2>&1 | head -1); (apache2 -v 2>/dev/null | head -1 || httpd -v 2>/dev/null | head -1); ls /etc/nginx/plesk.conf.d/vhosts 2>/dev/null | head; systemctl is-active nginx apache2 2>/dev/null
echo "=== 6. NODE/NPM ==="; for b in node npm npx pm2; do printf '%s: ' "$b"; command -v $b >/dev/null && $b -v 2>/dev/null | head -1 || echo "not found"; done
echo "=== 7. DATABASES ==="; (psql --version 2>/dev/null || echo "psql not found"); systemctl is-active postgresql 2>/dev/null; (mysql --version 2>/dev/null || mariadb --version 2>/dev/null || echo "mysql/mariadb not found")
echo "--- database NAMES only (no data) ---"; sudo -u postgres psql -tAc "select datname from pg_database where not datistemplate" 2>/dev/null || echo "cannot query postgres as root"
echo "=== 8. PORTS ==="; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E 'LISTEN' | head -20
echo "=== 9. FIREWALL/FAIL2BAN ==="; (csf -l 2>/dev/null | head -20 || echo "csf not installed"); (fail2ban-client status 2>/dev/null || echo "fail2ban not installed"); (ufw status 2>/dev/null | head -3)
echo "=== 10. DNS ==="; D=shomaldoc.shomal.ac.ir; host $D 2>/dev/null || nslookup $D 2>/dev/null | head -6; echo "--- NS ---"; host -t NS shomal.ac.ir 2>/dev/null | head -3; echo "--- server public IP ---"; curl -s -m 5 ifconfig.me 2>/dev/null; echo
echo "=== 11. TLS/CERT ==="; (certbot --version 2>/dev/null || echo "certbot not found"); ls /etc/letsencrypt/live 2>/dev/null; ls /usr/local/psa/var/certificates 2>/dev/null | head -3
echo "=== 12. INTERNET ACCESS ==="; for u in https://registry.npmjs.org https://nodejs.org https://github.com; do printf '%s -> ' "$u"; curl -s -o /dev/null -m 6 -w '%{http_code}\n' "$u" || echo "unreachable"; done
echo "=== 13. EXISTING APP ==="; systemctl is-active shomaldoc 2>/dev/null || echo "service not installed"; ls -la /opt/shomaldoc 2>/dev/null | head -5; ls -la /etc/shomaldoc 2>/dev/null | head -5
echo "=== 14. TIMEZONE/CRON ==="; timedatectl 2>/dev/null | head -3; ls /etc/cron.d 2>/dev/null | head -10
echo "=== 15. PHP (for Plesk tasks) ==="; (php -v 2>/dev/null | head -1 || echo "no cli php"); ls /opt/plesk/php 2>/dev/null
} 2>&1 | tee /tmp/shomaldoc-server-report.txt
echo; echo "REPORT SAVED: /tmp/shomaldoc-server-report.txt ($(wc -l < /tmp/shomaldoc-server-report.txt) lines)"
```

خروجی را همان‌طور که هست برای من بفرستید (فایل یا متن). هیچ رمزی در آن نیست.

## ۲) نقشهٔ استقرار (پس از دیدن خروجی)

۱. **دسترسی**: اگر `sudo: passwordless` نبود یا پنل فقط گرافیکی باشد، دو گزینه داریم —
   «کاربر sudo برای استقرار» یا اجرای دستورها از Terminal خود پنل.
۲. **Node 22**: سرور به اینترنت مطمئن دسترسی ندارد (بند ۱۲)؛ فایل `node-v22.x.y-linux-x64.tar.xz`
   را از جای دیگری می‌آوریم و با `deploy/install-node.sh --from <file> --sha256 <hash>` نصب می‌شود
   (هیچ نیازی به npm روی سیستم نیست).
۳. **PostgreSQL**: اگر نسخه ۱۶ موجود باشد، `deploy/provision-db.sh` کاربر/دیتابیس اختصاصی می‌سازد
   (به هیچ دیتابیس دیگری دست نمی‌زند). اگر نبود، باید از پنل/مخزن سیستم نصب شود.
۴. **دامنه `shomaldoc.shomal.ac.ir`**: رکورد A به IP سرور + در Plesk یک vhost با SSL.
   سپس `deploy/plesk/nginx-shomaldoc.conf` در «Additional nginx directives» و `proxy_pass` به
   `127.0.0.1:3080`.
۵. **بستهٔ آفلاین**: `npm run package:offline` روی همین ماشین ساخته می‌شود و روی سرور با
   `deploy/install-offline.sh <tar.gz> --check` ابتدا راستی‌آزمایی و بعد نصب می‌شود.
۶. **پس از نصب**: `bash deploy/verify-host.sh` و `bash deploy/post-deploy-check.sh` باید PASS بدهند.
