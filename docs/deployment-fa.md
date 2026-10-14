# راهنمای استقرار شمال‌داک روی سرور Plesk (Native، بدون Docker)

> این راهنما برای مسئول فنی دانشگاه نوشته شده است. هر دستور جداگانه است و با **ترمینال داخلی Plesk** اجرا می‌شود.
> هیچ رمز یا کلیدی را در چت، Git یا لاگ قرار ندهید.

## ۰) تفاوت Preview و Production

| موضوع | Preview | Production |
|---|---|---|
| `APP_ENV` | `preview` یا `development` | `production` |
| حساب‌های نمونه `dev.*` | با `db:seed-dev` ساخته می‌شوند | **هرگز** ساخته نمی‌شوند (اسکریپت در Production رد می‌کند) |
| مدیر اولیه | رمز نمونه (فقط Preview) | از `/etc/shomaldoc/bootstrap.env` و یک‌بار ساخته می‌شود، سپس فایل حذف می‌شود |
| کوکی نشست | ناامن مجاز (HTTP) | `Secure` همیشه روشن |
| دیتابیس | موقت/محلی | `shomaldoc` جدا روی PostgreSQL موجود |

> **یادداشت فاز ۲:** فایل‌های بارگذاری‌شدهٔ پرونده‌ها در `UPLOAD_DIR` (پیش‌فرض `/opt/shomaldoc/shared/storage/uploads`) ذخیره می‌شوند؛ این مسیر خارج از پوشهٔ هر Release است و با تغییر نسخه پاک نمی‌شود. دانلود فقط از مسیر مجاز `/api/files/.../download` انجام می‌شود. سقف حجم Reverse Proxy (`client_max_body_size` در `docs/plesk-domain-fa.md`) باید حداقل برابر `upload.maxSizeMb` تنظیمات + سربار multipart باشد. پیش از استقرار نسخهٔ جدید، `npm run db:migrate` و `npm run db:seed-rbac` را اجرا کنید تا مهاجرت‌های `0002` تا `0004` (از جمله مدل سازمانی و بک‌فیل خودکار گروه‌ها از دادهٔ موجود) و مجوز `cases.edit_metadata` اعمال شوند.

## ۱) بررسی فقط‌خواندنی سرور

```bash
sudo bash /opt/shomaldoc/current/deploy/server-audit.sh
```
خروجی مورد انتظار: نسخه Ubuntu 24.04، وضعیت Node (احتمالاً `npm: not found`)، پورت‌های 80/443/8443/8880 مربوط به Plesk، و سرویس `postgresql` فعال. اگر `shomaldoc` هنوز نصب نشده، خط `service not installed` را می‌بینید.

> ابتدا کد را در `/opt/shomaldoc/source` قرار دهید (کلون Git یا آپلود بسته). همه دستورهای زیر از همین مسیر اجرا می‌شوند.

## ۲) نصب Node.js 22 در مسیر جدا

```bash
sudo bash /opt/shomaldoc/source/deploy/install-node.sh
```
خروجی مورد انتظار: `v22.x.x` و `10.x.x` یا بالاتر. این اسکریپت Node 18 ناقص سرور را **حذف نمی‌کند**؛ Node 22 را در `/opt/shomaldoc/node` نصب می‌کند و فقط سرویس شمال‌داک از آن استفاده می‌کند.

## ۳) ساخت کاربر و پایگاه‌داده اختصاصی

```bash
sudo bash /opt/shomaldoc/source/deploy/provision-db.sh
```
خروجی مورد انتظار: `database shomaldoc and role shomaldoc created`. اگر نقش یا پایگاه‌داده از قبل وجود داشته باشد، اسکریپت متوقف می‌شود و چیزی را تغییر نمی‌دهد. فایل `/etc/shomaldoc/app.env` با مجوز `600` ساخته می‌شود.

## ۴) فایل مدیر اولیه (یک‌بارمصرف)

```bash
sudo install -m 600 -o shomaldoc -g shomaldoc /dev/null /etc/shomaldoc/bootstrap.env
sudo nano /etc/shomaldoc/bootstrap.env
```
محتوا (رمز حداقل ۱۶ نویسه و شامل حرف و عدد):
```
ADMIN_USERNAME=<نام کاربری مدیر>
ADMIN_EMAIL=<ایمیل سازمانی>
ADMIN_FULL_NAME=<نام و نام خانوادگی>
ADMIN_PASSWORD=<رمز قوی>
```
پس از اولین ورود موفق، فایل به‌طور خودکار حذف می‌شود (اگر مدیری از قبل وجود داشته باشد، فایل دست‌نخورده می‌ماند؛ آن را خودتان حذف کنید).

## ۵) استقرار اول

```bash
sudo bash /opt/shomaldoc/source/deploy/deploy.sh /opt/shomaldoc/source
```
مراحل: کپی نسخه → `npm ci` → `build` → بکاپ پایگاه‌داده → `migrate` → `seed-rbac` → ساخت مدیر اولیه (در صورت وجود فایل) → تغییر symlink → ری‌استارت → Health Check.

خروجی مورد انتظار: `deploy ok: <timestamp>`. اگر Health شکست بخورد، نسخه قبلی خودکار برگردانده می‌شود.

### سرویس systemd
```bash
sudo cp /opt/shomaldoc/current/deploy/shomaldoc.service /etc/systemd/system/shomaldoc.service
sudo useradd --system --home-dir /opt/shomaldoc --shell /usr/sbin/nologin shomaldoc 2>/dev/null || true
sudo systemctl daemon-reload
sudo systemctl enable --now shomaldoc
sudo systemctl status shomaldoc --no-pager
curl -fsS http://127.0.0.1:3080/api/health
```
خروجی مورد انتظار health: `"ok":true`.

## ۶) بکاپ خودکار و آزمون بازیابی

```bash
sudo bash /opt/shomaldoc/current/deploy/install-backup-cron.sh
sudo -u shomaldoc bash /opt/shomaldoc/current/deploy/backup-db.sh
ADMIN_DATABASE_URL='postgresql://postgres:<رمز-superuser>@127.0.0.1:5432/postgres' sudo -E bash /opt/shomaldoc/current/deploy/test-restore.sh
```
خروجی مورد انتظار: `backup ok: ...` و `test-restore OK`. بکاپ‌ها در `/var/backups/shomaldoc` با مجوز محرمانه و حداکثر ۱۴ نسخه نگهداری می‌شوند.

## ۷) تنظیم دامنه و HTTPS
دستورهای کامل Plesk و Reverse Proxy در `docs/plesk-domain-fa.md` است.

## ۸) خطاهای رایج

| خطا | علت | راه‌حل |
|---|---|---|
| `npm: command not found` | Node نصب نشده یا PATH اشتباه | `install-node.sh` را اجرا و `NODE_BIN` را بررسی کنید |
| `Node 22 required` | نسخه قدیمی در PATH | `export PATH=/opt/shomaldoc/node/current/bin:$PATH` |
| `502 Bad Gateway` در Plesk | سرویس بالا نیست یا پورت 3080 | `systemctl status shomaldoc` و `journalctl -u shomaldoc -n 100` |
| `Invalid environment configuration` | متغیر ناقص در `app.env` | نام متغیر در پیام خطا را اصلاح کنید؛ مقدار چاپ نمی‌شود |
| `role or database already exists` | provision قبلاً اجرا شده | فایل `app.env` را بررسی کنید؛ اسکریپت عمداً متوقف می‌شود |
| `bootstrap file must have permission 600` | مجوز فایل مدیر باز است | `sudo chmod 600 /etc/shomaldoc/bootstrap.env` |
| `CSRF/BAD_ORIGIN` در ورود | دامنه Host را تغییر داده است | در Plesk گزینه ارسال Host اصلی را فعال کنید |
| ورود کار نمی‌کند پس از چند تلاش | قفل موقت | پس از مدت قفل دوباره تلاش کنید؛ مدت از تنظیمات قابل تغییر است |

## ۹) بازنشانی رمز مدیر (فقط با تأیید صریح)
```bash
sudo install -m 600 -o shomaldoc -g shomaldoc /dev/null /tmp/new-admin-pass
sudo nano /tmp/new-admin-pass        # فقط رمز جدید
sudo -u shomaldoc env CONFIRM=RESET_ADMIN_PASSWORD ADMIN_USERNAME=<نام-کاربری> NEW_PASSWORD_FILE=/tmp/new-admin-pass \
  bash -c 'cd /opt/shomaldoc/current && set -a && . /etc/shomaldoc/app.env && set +a && npm run admin:reset-password'
sudo shred -u /tmp/new-admin-pass
```
خروجی مورد انتظار: `{"ok":true,"step":"reset-admin-password",...}`.

## ۱۰) وضعیت تأییدشده
- بسته و اسکریپت‌ها در مخزن آماده‌اند و سینتکس Bash آن‌ها بررسی شده است.
- **اجرای واقعی روی سرور دانشگاه انجام نشده است؛** تا زمانی که مسئول فنی مراحل بالا را اجرا نکرده و `https://shomaldoc.shomal.ac.ir/api/health` را بررسی نکرده باشد، استقرار تأیید‌شده نیست.
