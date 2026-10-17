# وضعیت پیشرفت شمال‌داک — نسخهٔ ۱.۰.۰

## زمان‌بندی این Task
- **شروع: ۰۰:۰۲ UTC** — **توقف قابلیت‌افزایی: ۰۰:۵۰ UTC** — **پایان: ۰۰:۵۵ UTC** (در گزارش نهایی ثبت شد).
- خط پایهٔ اندازه‌گیری‌شدهٔ شروع (دادهٔ واقعی، نه گزارش قبلی): `tests/unit/public-assets.test.ts` ۷ فایل/تست قرمز بود و **پوشهٔ `src/server/storage/` در مخزن وجود نداشت** (فایل‌های `storage/index.ts`, `magic-bytes.ts`, `service.ts` فقط داخل آرشیو اسنپ‌شات اولیه بودند) → ۱۱ فایل تست و ۴۶ تست اجرا نمی‌شد یا شکست می‌خورد. این سه فایل اکنون در همین شاخه داخل مخزن‌اند و آرشیو اسنپ‌شات (که گذرواژهٔ قدیمی پیش‌نمایش را در خود داشت) از مخزن خارج شد؛ فایل روی دیسک سندباکس باقی است.

## جدول مایل‌استون‌ها

| مایل‌استون | وضعیت | مدرک / آنچه مانده |
|---|---|---|
| M0 ارجاع‌های شکسته و پایهٔ تحویل | ✅ کامل | بازیابی `src/server/storage/*` از آرشیو (منبع اصلی همین مخزن)؛ `public/branding/university-logo.jpg` JPEG واقعی ۵۱۲×۵۱۲ (۶۷۱۶۱ بایت، SHA-256 `d1eadc…`، امضای `ffd8ff`)؛ آیکون‌های PNG ۱۹۲/۵۱۲/maskable/apple-touch؛ `docs/public-assets-manifest.json` (۱۰ فایل، همهٔ امضاها معتبر) + تست تطبیق هش با دیسک |
| M1 موتور گردش‌کار داده‌محور | ✅ کامل | `workflow_transitions` تنها مرجع تصمیم؛ Seed ۷ وضعیتی + چرخهٔ ۳۱ مرحله‌ای پیش‌نویس؛ ویرایشگر UI؛ ۱۷ تست. اکنون **M4 هم از همین موتور تغذیه می‌شود** (تست: WAITING_SUPERVISOR → GROUP_REVIEW → TOPIC_APPROVED) |
| M2 مدل سازمانی و پروفایل‌ها | 🟡 نیمه | رشته/گرایش/ترم/پروفایل‌ها/ورود گروهی CSV + ۱۹ تست. **مانده: XLSX ورود گروهی (کار ۹)** |
| M3 درخواست استاد + ظرفیت | ✅ کامل | `supervisor_requests`، موتور ظرفیت از Settings، قفل ردیف، صف‌ها، UI `/supervisors` |
| M4 موضوع و پیشینهٔ نسخه‌دار | ✅ کامل (این Task) | `topic_versions` (ایندکس یکتای جزئی «یک نسخهٔ فعال»)، `literature_reviews` + `literature_review_versions`؛ بک‌فیل نسخهٔ v1 در مهاجرت ۰۰۰۹ (تست‌شده)؛ گردش ثبت → بررسی استاد → تأیید گروه با دلیل اجباری؛ مسدودسازی تغییر موضوع پس از مرحلهٔ Setting؛ پل واقعی به Workflow؛ UI: فهرست نسخه‌ها + Diff + پنل بازبین + فرم پیشینه و بازبین آن؛ ۱۴ تست |
| M5 فرم‌ساز پویا + پروپوزال | 🟡 نیمهٔ پیشرفته (این Task) | **انجام‌شده:** `dynamic_form_definitions` + `dynamic_form_fields` (نوع/اجباری/ترتیب/اعتبارسنجی/گزینه/شرط نمایش/نسخه‌بندی)؛ سازندهٔ UI در `/admin/forms` با پیش‌نمایش زنده و انتشار نسخه بدون خراب‌کردن پاسخ‌های قبلی؛ Seed ۱۶ فیلد پیش‌فرض پروپوزال (منتشرشده v1)؛ **Wizard چندمرحله‌ای** (بخش‌بندی از ترتیب خود تعریف) با **ذخیرهٔ خودکار پیش‌نویس** (debounce ۲٫۵ ثانیه) و نشانگر وضعیت؛ **بارگذاری Word/PDF** با ارجاع به `files.id` (بدون کپی دوم سند)؛ **زنجیرهٔ تأیید**: تأیید استاد ⇒ ماندن در انتظار سطح گروه، سپس تصویب گروه/تحصیلات تکمیلی ⇒ `approved` + ساخت ردیف ساختاریافتهٔ `proposals` از پاسخ‌ها (ورودی Rule Engine)؛ پل به `workflow_transitions` (PROPOSAL_REVIEW → PROPOSAL_APPROVED/PROPOSAL_REVISION)؛ ۱۶ تست. **مانده: استفادهٔ همین سازنده برای تمدید/کمیسیون/فرم‌های فارغ‌التحصیلی و اتصال صریح مجوز مشاور در زنجیره** |
| M6 موتور قواعد + ایرانداک | 🟡 پیش‌رفته (کار ۳) | موتور ۶ قاعده با دلایل فارسی ✅؛ **گردش داخلی ایرانداک اضافه شد:** ثبت کد پیگیری + تاریخ + رسید (ارجاع به `files.id`)، بررسی و تأیید/رد توسط تحصیلات تکمیلی با **دلیل اجباری**، نگه‌داشت کامل تاریخچه (رکورد هرگز حذف نمی‌شود)، گام‌های Workflow `IRANDOC_PENDING → IRANDOC_REVIEW → IRANDOC_APPROVED`، اعلان دقیق به دانشجو و به‌گیرندگان نقش `grad_office`، و **گارد مسیر**: بدون پروپوزال مصوب ثبت ایرانداک ممکن نیست. **صف بررسی مشترک** در `/review` (موضوع، پیشینه، ایرانداک — با مجوز `cases.review_topic` و لینک به پرونده). **مانده: اتصال صریح `canApproveFinal` و نمایش دکمهٔ «فعال‌سازی پایان‌نامه» (نیازمند یکسان‌سازی وضعیت قدیمی `STATUS_MAP` با نمونهٔ داده‌محور — تصمیم ۳۵)** |
| M7 ترم/تمدید/کمیسیون | 🟡 نیمه | کنترل ترم اکنون روی `academic_terms` واقعی و `start_term_id` است (Job با Skip صریح)؛ **Wizard تمدید و مسیر کمیسیون (کار ۴) ⏳** |
| M8 نگارش/همانندجویی | 🟡 فقط داده | `similarity_checks` آماده و Rule Engine از آن می‌خواند؛ گردش و UI همانندجویی ⏳ |
| M9 دفاع | ⏳ انجام‌نشد | — |
| M10 فارغ‌التحصیلی | ⏳ انجام‌نشد | — |
| M11 اعلان/یادآوری/Escalation | ✅ کامل (بازسازی‌شده در این Task) | گیرندگان فقط دارندهٔ نقش تسک در دامنهٔ پرونده؛ `dedupe_key` + ایندکس یکتا؛ آستانه‌ها از Settings؛ ارتقا از `workflow_transitions`/Settings؛ پنل «آخرین اجرا/وضعیت/آمار» در داشبورد مدیر؛ ۱۴ تست Scheduler |
| M12 PDF رسمی | ⏳ انجام‌نشد | راهکار تعیین‌شده در `decisions.md` (pdf-lib + fontkit + وزیرمتن static + reshaper/bidi + اثبات بصری). در این Task پیاده نشد |
| M13 گزارش‌ها/داشبوردها | 🟡 نیمه | گزارش CSV امن + داشبورد مدیر با سلامت Scheduler. مانده: نمودارها، XLSX، داشبوردهای تفکیکی نقش، جستجوی پیشرفته |
| M14 امنیت و دسترس‌پذیری | 🟡 نیمه | CSP-nonce، نشست‌ها، 2FA، ماسک‌سازی و… مانده: ماتریس نقش×Endpoint، `npm audit`، ممیزی دسترس‌پذیری، Playwright کامل |
| M15 صیقل بصری | 🟡 نیمه | Design System، حالت‌های Empty/Loading/Error؛ اجزای M4/M5 با هدف لمس ≥۴۴px و aria-expanded. مانده: مرور تک‌تک صفحات و اسکرین‌شات مرجع |
| M16 آمادگی تحویل | 🟡 نیمه | بستهٔ آفلاین/install.sh/upgrade.sh/rollback.sh/backup آپلودها و مستندات نصب (کارهای ۱۲ و ۱۳) **انجام نشد** |
| M17 پذیرش نهایی E2E | ⏳ انجام‌نشد | وابسته به کارهای ۳ تا ۱۰ |
| M18 سخت‌سازی Production | ⏳ انجام‌نشد | کار ۱۲ |

## کار ۰ — اصلاحات واجب (وضعیت هر بند)
1. **گیرندگان یادآوری** ✅ — `resolveTaskRecipients` + `roleRecipients(role, caseId)`؛ مسیر «۵۰ کاربر فعال دلخواه» حذف شد. تست: کاربر نامرتبط، کاربر گروه دیگر، کاربر غیرفعال و دانشجو هیچ اعلانی نمی‌گیرند.
2. **جلوگیری از اعلان تکراری** ✅ — `notifications.dedupe_key` + ایندکس یکتای `(user_id, dedupe_key)`؛ کلیدها `task:{id}:dayN`، `escalation:{id}`، `term:{caseId}:{termId}`؛ دو اجرای پشت‌سرهم ⇒ `created = 0`؛ تست سطح DB هم اضافه شد.
3. **`lastSchedulerRun`** ✅ — `ORDER BY started_at DESC, id DESC`؛ `lastSuccessfulSchedulerRun` جداگانه؛ تست با دو رکورد ۲۰۲۰ و ۲۰۳۱ (انتظار ۲۰۳۱)؛ نمایش آخرین اجرا/وضعیت/تعداد/یادداشت در داشبورد مدیر.
4. **کنترل ترم** ✅ — بر پایهٔ `academic_terms` + `thesis_cases.start_term_id` (ستون جدید + بک‌فیل در مهاجرت ۰۰۰۸)؛ «ماه ÷ ۴» حذف شد؛ نبود ترم جاری ⇒ Skip صریح و ثبت در `scheduler_runs.note` (+ وضعیت `skipped`).
5. **Escalation و آستانه‌ها** ✅ — `notify.escalationAfterDays`، `notify.escalationRole`، `notify.termControlRole`، `notify.reminderDay1AfterDays`، `notify.reminderDay3AfterDays`؛ نقش مقصد ارتقا از `workflow_transitions.escalation_role` با fallback تنظیمات؛ کد مرده (`dueTasks`/`void`) حذف شد.
6. **تست‌های Scheduler** ✅ — `tests/integration/scheduler.test.ts` با ۱۴ تست: dedupe، گیرندگان درست، تسک بدون مهلت/بدون نقش، آستانهٔ تغییر‌یافته از Settings، قفل هم‌زمانی (`pg_try_advisory_lock`)، و **زمان شبیه‌سازی‌شده** با پارامتر `now`.
7. **وضعیت صادقانه** ✅ — M6 و M2 و M5 و M7/M8/M13/M14/M15/M16 در جدول بالا 🟡 هستند و «✅ کامل» فقط برای موارد دارای DoD آمده است.
8. **فایل‌های باینری public** ✅ — `university-logo.jpg` (JPEG واقعی از لوگوی رسمی دانشگاه؛ منبع تصویر در `docs/public-assets-manifest.json` و `decisions.md`)، چهار PNG آیکون (راستری‌شده از SVG خود پروژه با `scripts/generate-brand-assets.mjs`)؛ `docs/public-assets-manifest.json` با SHA-256 و امضا؛ تست تطبیق هش/امضا.
9. **پاک‌سازی `progress.md`** ✅ — این نسخه از صفر بازنویسی شد؛ جستجوی الگوهای رمز در `docs/` و `git grep` هیچ رمزی نیافت.

## تست‌ها (خروجی واقعی)
- `npx next typegen` ✅ · `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅
- `npm run test` ✅ — **۲۵۹ تست در ۲۱ فایل، همه سبز** (گیت کامل پایانی) (خط پایهٔ واقعی این Task: ۱۹۸ سبز + ۱۰ قرمز).
- Playwright در این Task اجرا **نشد**: مرورگر Playwright در سندباکس نصب نیست و دانلود آن نیازمند اینترنت بیرونی است (فقط npm/github در دسترس است؛ منبع دانلود مرورگر `playwright.azureedge.net` است). مراحل UI با تست‌های سرور و lint/typecheck اعتبارسنجی شدند → **بازبینی مرورگری تأییدنشده**.
- آزمون واقعی: PostgreSQL 18 در سندباکس بالا آمد، همهٔ مهاجرت‌ها (`0000`–`۰۰۱۰`) اعمال شد و تست‌ها روی همان دیتابیس اجرا شدند.

## مهاجرت‌های جدید
- `0008_light_frank_castle.sql`: `notifications.dedupe_key` + ایندکس یکتای `(user_id, dedupe_key)`؛ `scheduler_runs.note`؛ `thesis_cases.start_term_id` + FK + ایندکس؛ بک‌فیل از `student_profiles.entry_term_id` و ترم جاری.
- `0009_lively_victor_mancha.sql`: `topic_versions` (+ ایندکس یکتای جزئی نسخهٔ فعال)، `literature_reviews`، `literature_review_versions`؛ بک‌فیل نسخهٔ v1 موضوع از `thesis_cases.title_fa` (فقط پرونده‌های دارای عنوان و بدون نسخه).
- `0010_far_serpent_society.sql`: `dynamic_form_definitions`، `dynamic_form_fields`، `proposal_versions`.
- همه افزایشی؛ ستون/جدول قدیمی حذف نشده. راه بازگشت: `DROP TABLE`/`DROP COLUMN` موارد جدید — دادهٔ قبلی دست‌نخورده می‌ماند.

## نقطهٔ ادامهٔ Task بعدی
1. **کار ۲ (بقیهٔ M5)**: بازاستفادهٔ سازندهٔ فرم پویا در تمدید، کمیسیون موارد خاص و فرم‌های فارغ‌التحصیلی + گنجاندن استاد مشاور در زنجیرهٔ تأیید.
2. **کار ۳ (بقیهٔ M6)**: صف بررسی ایرانداک در پنل تحصیلات تکمیلی + اتصال `canApproveFinal` + دکمهٔ «فعال‌سازی پایان‌نامه» (گذار به `THESIS_ACTIVE`).
3. **کار ۴ (M7)**: Wizard تمدید، کمیسیون موارد خاص، نقش مالی.
4. **کار ۸ (M12)**: PDF رسمی فارسی با اثبات بصری.

---

## وضعیت زندهٔ پیش‌نمایش (۱۴ مهر ۱۴۰۵ / 2026-10-14)

برنامه **واقعاً اجرا می‌شود**: `npx next build` ✅ و `npx next start -H 0.0.0.0 -p 3080` (Build
تولیدی، نه dev). سرور روی پیش‌نمایش زنده در دسترس است و با اسکریپت پذیرش واقعی آزموده شد:

```
node scripts/acceptance.mjs        # ۶۶/۶۶ بررسی سبز (npm run acceptance)
```

| سطح | نتیجه |
| --- | --- |
| سلامت/سرصفحه‌ها | `/api/health` → `db:"up"` · CSP با nonce · HSTS · `X-Robots-Tag: noindex` · `nosniff` ✅ |
| صفحه‌های هر ۴ نقش (admin/depthead/supervisor/student) | همهٔ صفحه‌های اصلی ۲۰۰ و با پاصفحهٔ رسمی ✅ |
| دستکاری درخواست | بستن پرونده توسط دانشجو ۴۰۳ · تصمیم موضوع ۴۰۳ · فارغ‌التحصیلی پیش از شرط‌ها ۴۰۹ · Audit/Users/Settings ۴۰۳ · درخواست cross-origin ۴۰۳ ✅ |
| فایل‌ها | PDF پرونده واقعی (`%PDF`) · CSV · XLSX واقعی (`PK`) ✅ |
| جستجو | پاسخ ۲۰۰، پرس‌وجوی کوتاه ۴۰۰، نویسه‌های `%` بدون تطبیق همه‌چیز ✅ |

### اشکالات واقعی که همین اجرا پیدا کرد و رفع شد
1. `/dashboard` برای نقش‌های مدیر **۵۰۰** می‌داد: تابع `formatter` از Server Component به
   `SchedulerPanel` (Client) پاس می‌شد → به `locale` تغییر کرد (رفع ریشه‌ای + تست واحد هویت).
2. `/reports` و `/search` و APIهایشان برای سرپرست/مدیر گروه **۳۰۷/۴۰۳** می‌شدند، چون گیت روی
   `cases.view_own` بود → `CASE_VIEW_PERMISSIONS` («هر یک از» دامنه‌های دید) و هم‌راستاسازی ناوبری.
3. `/api/capacity` هیچ مصرف‌کنندهٔ UI نداشت → حذف شد (قاعدهٔ «هیچ API بدون UI»).
4. پاصفحهٔ وب «پارامیس‌تک» بود و با متن مصوب و پاصفحهٔ PDF یکی نبود → «پارمیستک» و تست قفل‌کننده.

### ماندهٔ مسیر استقرار (به‌ترتیب کار)
| # | کار | وضعیت |
| --- | --- | --- |
| 10 | M14 (سرفصل‌ها، ماسک‌سازی، robots، تغییر إلزامی گذرواژه، تست‌های ماتریس دسترسی) | ✅ انجام شد؛ فقط مستندسازی ماتریس دسترسی در `docs/m14-fa.md` ماند |
| 11 | M15 پرداخت بصری (Loading/Empty/Error، تقابل AA، هدف لمسی ۴۴px، تاریک/روشن) | ⏳ |
| 12 | M18 بستهٔ نصب آفلاین + نصب/ارتقا/بازگشت + پشتیبان/بازیابی (پایگاه‌داده **و** فایل‌ها) با اجرای واقعی تمرین بازیابی | 🟡 اسکریپت‌ها نوشته شده؛ اجرای واقعی تمرین‌ها ماند |
| 13 | M16 مستندات نصب/بهره‌برداری/UAT/راهنمای نقش‌ها + Seed تولید | ⏳ (`seed-prod` نوشته شد) |
| 14 | M17 پذیرش سرتاسری: سفر کامل دانشجو (ایجاد پرونده → موضوع → پیشینه → پروپوزال → ایرانداک → پایان‌نامه → همانندجویی → دفاع → فارغ‌التحصیلی → بستن) | 🟡 اسکریپت پذیرش پایه سبز است؛ سفر کامل مرحله‌به‌مرحله ماند |
| 15 | گیت انتشار go-live (Deploy واقعی فقط با SSH از سوی کاربر) | ⏳ |
| — | Playwright (دسکتاپ/موبایل) | ❌ در سندباکس اجراشدنی نیست (نبود مرورگر و نبود اینترنت به‌سوی منبع دانلود) — به‌جایش آزمون HTTP واقعی + ESLint/typecheck |

### بازیابی محیط پیش‌نمایش (پس از پاک‌شدن سندباکس)
پاک‌شدن سندباکس `node_modules`، `.next`، `.env`، `storage/` و حتی سرور PostgreSQL را از بین
می‌برد (کد مخزن دست‌نخورده می‌ماند). ترتیب بازیابی — همهٔ دستورها اجراشده و آزموده:

```bash
cd /home/user/shomaldoc
ls src/server/storage/   # ۱) فایل‌های storage اینک در خود مخزن‌اند (بدون نیاز به آرشیو)
printf 'APP_ENV=development\nDATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db\nUPLOAD_DIR=./storage/uploads\nLOG_LEVEL=info\nALLOW_EMBED=1\n' > .env
mkdir -p storage/uploads
npm install --no-audit --no-fund                                              # ۲) وابستگی‌ها (~۵۶۴ بسته)

mkdir -p /home/user/pgsrv && cd /home/user/pgsrv                              # ۳) PostgreSQL سندباکس
npm init -y && npm install embedded-postgres
cp /home/user/shomaldoc/tools/sandbox-postgres.mjs server.mjs
node server.mjs &        # خوشهٔ تازه در /home/user/pgdata روی 127.0.0.1:5432 + ساخت app_db

cd /home/user/shomaldoc                                                       # ۴) مهاجرت و دادهٔ مرجع
npm run db:migrate && npm run db:seed-rbac && npm run db:seed-forms && npm run db:seed-dev

npx next build && npx next start -H 0.0.0.0 -p 3080                           # ۵) ساخت و اجرا
node scripts/acceptance.mjs                                                   # ۶) آزمون پذیرش
```

> `tools/sandbox-postgres.mjs` فقط ابزار سندباکس/CI است (وابستگی `embedded-postgres` عمداً در
> `package.json` برنامه نیست) و در بستهٔ آفلاین هم بسته‌بندی نمی‌شود.

## UX overhaul — شاخه `feature/ux-overhaul`

### انجام‌شده
- ممیزی UX در `docs/ux-audit-fa.md` با فهرست ۱۸ صفحه و شمار کلیک مسیرهای اصلی.
- رفع ریشه‌ای ذخیره گردش‌کار: draft درجا ویرایش می‌شود؛ ذخیره از published یک draft موجود را بازاستفاده یا فقط یک نسخه بعدی می‌سازد؛ redirect به ID draft، reset با key، toast، dialog دلیل، هشدار خروج، diff، اعتبارسنجی و انتشار شفاف.
- invariant انتشار: برای هر `workflow_definitions.code` فقط یک ردیف active باقی می‌ماند؛ instanceهای باز همچنان به definition قدیمی خود اشاره می‌کنند.
- مرکز مدیریت، command palette و کاهش آیتم‌های sidebar؛ `/design` از ناوبری production خارج شد.
- تایم‌لاین پرونده و feed رویدادها با فیلتر/گروه‌بندی، مسئول و مهلت؛ گراف SVG و timeline نسخه‌های گردش‌کار.
- تست integration چرخه کامل draft و تست Playwright ماندگاری پس از refresh اضافه شد.

### بررسی ادیتورهای مشابه
- فرم‌ساز از قبل `PUT` روی draft انجام می‌دهد و published را در سرور immutable نگه می‌دارد؛ پس از انتشار فهرست API را reload می‌کند.
- سازمان، تنظیمات و نقش‌ها update درجا و audit دارند؛ الگوی معیوب «ساخت نسخه جدید و ماندن روی ID قبلی» در آن‌ها دیده نشد.
- بهبود یکپارچه toast/هشدار خروج برای تمام ادیتورهای قدیمی هنوز کامل نشده و نباید تمام‌شده تلقی شود.

### دیتابیس
- migration جدید: **ندارد**. داده تایم‌لاین از `workflow_steps`، `workflow_instances`، `workflow_tasks` و `thesis_case_events` موجود بازسازی می‌شود.

### خط پایه و QA
- baseline پیش از تغییر: `npm ci` ✅؛ `typecheck` ✅؛ `lint` ✅؛ `test` ❌ به‌علت نبود `DATABASE_URL` در کلون تازه (۲۱ فایل fail، ۸ فایل/۶۷ تست pass). npm نیز ۱۷ vulnerability dependency گزارش کرد.
- گیت میانی پس از تغییر: `npm run typecheck` ✅ و `npm run lint` ✅.
- نتیجه نهایی build/test و محدودیت Playwright در گزارش نهایی همین تحویل ثبت می‌شود.

### انجام‌نشده/محدود
- بازطراحی صفحه‌به‌صفحه تمام فرم‌های بلند و جدول‌های موبایل در این دامنه کامل نشده است.
- نام فاعل/دلیل انتشار در timeline نسخه ادمین فقط تا حد داده definition نمایش داده می‌شود؛ audit کامل در صفحه ممیزی موجود است اما join اختصاصی timeline هنوز اضافه نشده است.
- اجرای مرورگری Playwright وابسته به وجود Chromium و `E2E_PASSWORD` محیط است.

### وضعیت پس از بازیابی (۱۴۰۵/۰۷/۲۲ — 2026-10-14 17:13Z)
| مورد | نتیجه |
| --- | --- |
| `npm install` | ۵۶۴ بسته ✅ |
| PostgreSQL 18.4 (خوشهٔ تازه) | `127.0.0.1:5432` · db `app_db` ✅ |
| مهاجرت‌ها + Seedها | `db:migrate` · `seed-rbac` (۹ نقش + چرخهٔ کامل) · `seed-forms` · `seed-dev` ✅ |
| `npx next build` | ✅ · `npx next start` روی `0.0.0.0:3080` ✅ |
| `/api/health` | `{"ok":true,"app":"shomaldoc","version":"1.0.0","db":"up"}` ✅ |
| `node scripts/acceptance.mjs` | **۶۷/۶۷ سبز** (شامل ایجاد پروندهٔ آزمون برای دانشجو) ✅ |

