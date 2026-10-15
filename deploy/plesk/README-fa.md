# سخت‌سازی پروکسی معکوس روی Plesk (شمال‌داک)

هدف: تنها راه رسیدن به برنامه، `https://shomaldoc.shomal.ac.ir` باشد و خود برنامه فقط روی
`127.0.0.1:3080` گوش بدهد. هیچ پورت دیگری نباید از اینترنت باز باشد.

## ۱. تنظیمات Plesk
1. `Websites & Domains → shomaldoc.shomal.ac.ir → Apache & nginx Settings`
2. «Serve static files directly by nginx» روشن باشد (فایل‌های `public/` سریع‌تر سرو می‌شوند).
3. در «Additional nginx directives» محتوای `deploy/plesk/nginx-shomaldoc.conf` را بگذارید.
4. در «Additional directives for HTTP» هیچ ریدایرکتی به 3080 نسازید؛ ریدایرکت همه‌چیز به HTTPS کافی است.
5. SSL/TLS: گواهی معتبر روی دامنه؛ «Redirect from HTTP to HTTPS» روشن؛ پروتکل‌ها TLS 1.2/1.3.
6. `client_max_body_size` برابر ۳۲ مگابایت (هم‌راستا با سقف آپلود برنامه).

## ۲. جلوگیری از دسترسی مستقیم به برنامه
- در Plesk فایروال: فقط 80/443/8443 (و 22 محدود به IP مدیریت) باز باشد.
- اگر CSF نصب است: پورت 3080 نباید در `TCP_IN` باشد.
- بازبینی: `bash deploy/verify-host.sh` — اگر 3080 از بیرون جواب بدهد، FAIL می‌دهد.

## ۳. سرصفحه‌های امنیتی
سرصفحه‌های `CSP`، `HSTS`، `X-Frame-Options`، `X-Content-Type-Options`، `Referrer-Policy`،
`Permissions-Policy` و `X-Robots-Tag` در لایهٔ برنامه (`src/proxy.ts`) تولید می‌شوند؛ در nginx
تکرار نشوند تا دو نسخهٔ متناقض ساخته نشود (به‌جز `X-Robots-Tag` که در بالا برای مسیرهای
استاتیک هم گذاشته شده).

## ۴. fail2ban و CSF
سرور fail2ban و CSF دارد. یک فیلتر برای مسیر ورود اضافه کنید تا تلاش‌های ناموفق از لبه بسته شوند:

```ini
# /etc/fail2ban/filter.d/shomaldoc-login.conf
[Definition]
failregex = ^.*"path":"/api/auth/login".*"status":401.*"ip":"<HOST>".*$
ignoreregex =
```
```ini
# /etc/fail2ban/jail.d/shomaldoc.local
[shomaldoc-login]
enabled = true
filter  = shomaldoc-login
logpath = /var/log/shomaldoc/*.log
maxretry = 5
findtime = 10m
bantime  = 1h
```
(برنامه ورود ناموفق را با `ip` در گزارش JSON ثبت می‌کند؛ رمز هرگز در گزارش نوشته نمی‌شود.)

## ۵. بازبینی پس از هر استقرار
```bash
bash deploy/verify-host.sh          # میزبان + سرصفحه‌ها + افشا نشدن 3080
bash deploy/post-deploy-check.sh    # سلامت برنامه + صفحهٔ ورود + API بدون نشست
```
