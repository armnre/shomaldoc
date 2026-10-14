# شمال‌داک (ShomalDoc)

سامانه جامع مدیریت پایان‌نامه — دانشگاه شمال، آمل (معاونت پژوهش و فناوری).

- پشته: Next.js 16 (App Router) + React 19 + TypeScript strict + Tailwind 4 + Drizzle ORM + PostgreSQL 16 + Zod + Vitest (+ Playwright برای E2E)
- رابط: فارسی/RTL، تقویم شمسی در UI، زمان UTC در دیتابیس، فونت Vazirmatn به‌صورت self-host (بدون CDN)
- استقرار: Native روی Ubuntu/Plesk (بدون Docker)، اپ روی `127.0.0.1:3080` پشت Reverse Proxy دامنهٔ `https://shomaldoc.shomal.ac.ir`

## شروع توسعه

```bash
npm ci
cp .env.example .env   # مقداردهی DATABASE_URL و متغیرهای محیطی
npm run db:generate    # فقط پس از تغییر Schema
npm run db:migrate
npm run db:seed-rbac
npm run db:seed-dev    # فقط در Preview/Development؛ در Production هرگز اجرا نشود
npm run dev
```

## اسکریپت‌ها

| دستور | کاربرد |
|---|---|
| `npm run dev` / `build` / `start` | توسعه / Build تولیدی / اجرای تولیدی |
| `npm run typecheck` / `lint` | TypeScript و ESLint |
| `npm run test` | Vitest (واحد + یکپارچه) |
| `npm run test:e2e` | Playwright (نیازمند `npx playwright install chromium`) |
| `npm run db:generate` / `db:migrate` | تولید و اجرای مهاجرت‌های افزایشی Drizzle |
| `npm run db:seed-rbac` | Seed idempotent نقش‌ها/مجوزها |
| `npm run db:seed-dev` | حساب‌های نمونه فقط Preview (`APP_ENV=production` را رد می‌کند) |
| `npm run admin:bootstrap` | مدیر اولیه فقط از `/etc/shomaldoc/bootstrap.env` (یک‌بارمصرف) |
| `npm run admin:reset-password` | بازنشانی رمز با `CONFIRM=RESET_ADMIN_PASSWORD` |

## ساختار

- `src/app` — صفحات و Route Handlerها
- `src/server` — env، http، auth، rbac، سرویس‌ها، workflow، storage، rules
- `src/components` — ui، brand، app-shell، features
- `src/i18n` — دیکشنری فارسی (منبع اصلی) + انگلیسی با fallback
- `src/validations` — schemaهای Zod
- `src/db` — Drizzle schema و client
- `drizzle/` — مهاجرت‌های افزایشی (مهاجرت‌های تاریخی را بازنویسی نکنید)
- `deploy/` — اسکریپت‌های استقرار Native/Plesk
- `docs/` — مستندات فارسی محصول، امنیت، API، تست و استقرار
- `tests/` — Vitest و Playwright

## کیفیت و امنیت

- هر عملیات تغییردهنده: تراکنش + قفل مناسب + Audit (کاربر/نقش/IP/قبل-بعد/دلیل)
- کنترل دسترسی فقط در Backend؛ پنهان‌کردن دکمه کافی نیست
- فایل‌ها خارج از `public/` ذخیره می‌شوند؛ دانلود فقط با `fileId` و کنترل دسترسی
- مقادیر حساس (رمز/توکن/کلید) هرگز در Git، Log یا گزارش عمومی نمی‌شوند

## استقرار

راهنمای کامل: `docs/deployment-fa.md` و `docs/plesk-domain-fa.md`. نکتهٔ کلیدی: مهاجرت با `npm run db:migrate` (نه `drizzle-kit push` در Production)، Seed RBAC، Bootstrap یک‌بارمصرف مدیر، systemd + Reverse Proxy + بکاپ/ریستور.
