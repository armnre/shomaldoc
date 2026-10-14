# تنظیم دامنه `shomaldoc.shomal.ac.ir` در Plesk

> قبل از شروع: سرویس `shomaldoc` باید روی `127.0.0.1:3080` در حال اجرا باشد (`curl -fsS http://127.0.0.1:3080/api/health`).

## ۱) رکورد DNS (کار واحد IT دانشگاه)
یک رکورد **A** برای `shomaldoc.shomal.ac.ir` به IP عمومی سرور اضافه شود. بررسی:
```bash
dig +short shomaldoc.shomal.ac.ir
```
خروجی مورد انتظار: IP عمومی سرور.

## ۲) ساخت ساب‌دامنه در Plesk
۱. Plesk → **Websites & Domains** → دامنه `shomal.ac.ir` → **Add Subdomain**.
۲. Subdomain: `shomaldoc` → Document root پیش‌فرض را بگذارید (بدون استفاده).
۳. ذخیره.

## ۳) Reverse Proxy به سرویس Node
Plesk → `shomaldoc.shomal.ac.ir` → **Apache & nginx Settings** → بخش **Additional nginx directives** (فقط یک بلوک `location` و تنظیمات زیر؛ `location` تکراری نسازید):

```nginx
client_max_body_size 25m;

location / {
    proxy_pass http://127.0.0.1:3080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 60s;
}

# Service worker must never be cached by the browser or proxy.
location = /sw.js {
    proxy_pass http://127.0.0.1:3080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    add_header Cache-Control "no-cache, no-store, must-revalidate" always;
}
```
- `client_max_body_size` را با `upload.maxSizeMb` هماهنگ نگه دارید (پیش‌فرض ۲۰ مگابایت).
- `Host` باید دامنه عمومی باشد؛ بررسی Origin در برنامه به همین مقدار وابسته است.
- در بخش **Apache & nginx Settings** گزینه‌ی Apache را خاموش نگه ندارید؛ تنظیمات بالا برای nginx جلو است.

پس از ذخیره:
```bash
sudo nginx -t && sudo systemctl reload nginx
curl -sI https://shomaldoc.shomal.ac.ir/login | head -5
```
خروجی مورد انتظار: `HTTP/2 200` (یا `HTTP/1.1 200`).

## ۴) گواهی Let's Encrypt و ریدایرکت HTTP→HTTPS
۱. Plesk → دامنه → **SSL/TLS Certificates** → **Let's Encrypt** → دامنه را انتخاب و صدور کنید.
۲. گزینه **Permanently redirect HTTP requests to HTTPS** را روشن کنید.
۳. بررسی:
```bash
curl -sI http://shomaldoc.shomal.ac.ir | grep -i location
curl -fsS https://shomaldoc.shomal.ac.ir/api/health
```
خروجی مورد انتظار: `Location: https://...` و JSON با `"ok":true`.

## ۵) سربرگ‌های امنیتی
برنامه خودش سربرگ‌های CSP، HSTS، X-Frame-Options، Referrer-Policy و `X-Content-Type-Options` را ارسال می‌کند. از افزودن تکراری در Plesk خودداری کنید تا مقادیر متناقض نشوند.

## ۶) عیب‌یابی
| علامت | بررسی |
|---|---|
| 502 Bad Gateway | `systemctl status shomaldoc`؛ پورت 3080 |
| 413 Request Entity Too Large | `client_max_body_size` را افزایش دهید |
| ورود کار نمی‌کند ولی API سالم است | کوکی `Secure` نیازمند HTTPS است؛ مرورگر را روی همان دامنه HTTPS باز کنید |
| `BAD_ORIGIN` | Host ارسالی را بررسی کنید (`proxy_set_header Host $host`) |

## ۷) وضعیت تأییدشده
این دستورها در محیط ایجنت اجرا نشده‌اند؛ تنظیم دامنه و گواهی توسط مسئول فنی دانشگاه انجام و تأیید می‌شود.
