# CHANGELOG — شمال‌داک (ShomalDoc)

## [1.0.0]

### Added
- **M1 موتور گردش‌کار داده‌محور**: جداول `workflow_definitions/steps/transitions/instances/tasks/task_history`؛ `workflow_transitions` تنها مرجع تصمیم؛ Seed ۷ وضعیت فعلی بدون تغییر رفتار + چرخهٔ ۳۱ مرحله‌ای به‌صورت پیش‌نویس منتشرنشده (`pending_university_approval`)؛ versioning (نمونه‌های باز روی نسخهٔ قبلی می‌مانند)؛ ویرایشگر گراف در `/admin/workflows` با اعتبارسنجی پیش از انتشار (بن‌بست، مقصد ناموجود، مرحلهٔ بدون خروج، دور بی‌پایان، مرحلهٔ آغازین تکراری/ناموجود).
- **M2**: رشته، گرایش، ترم تحصیلی، پروفایل دانشجو و استاد، ورود گروهی CSV با پیش‌نمایش و گزارش خطای ردیفی (رمز هرگز ذخیره نمی‌شود).
- **M3**: `supervisor_requests`، موتور ظرفیت لحظه‌ای از Settings، صف استاد، صف مدیر گروه پس از N تلاش ناموفق، تخصیص مستقیم با دلیل.
- **M6 Rule Engine**: `canSubmitProposal/canApproveFinal/canRequestExtension/canOpenCommission/canRequestDefense/canCloseCase` با دلایل دقیق فارسی + API و پنل UI.
- **M11**: مرکز اعلان واقعی، `notification_logs`، Scheduler خودکار از `instrumentation.ts` با `pg_try_advisory_lock` و `scheduler_runs`؛ email/sms صریحاً `disabled`.
- **M13**: گزارش پرونده‌ها با فیلتر و CSV امن (ضد Formula Injection) + `/reports`.
- **M14**: مدیریت نشست‌ها و 2FA TOTP کامل با اجبار در ورود.
- **M16**: `post-deploy-check.sh`، `package-release.sh` (checksum + اثبات باینری‌ها)، smoke test پس از deploy.

### Added — Task v4 (کارهای ۰ و ۱ و نیمهٔ ۲)
- **Scheduler بازسازی‌شده (کار ۰):** گیرندگان یادآوری فقط دارندگان نقش همان تسک در دامنهٔ گروه/دانشکدهٔ پرونده (مسیر «۵۰ کاربر فعال دلخواه» حذف شد)؛ `notifications.dedupe_key` با ایندکس یکتای `(user_id, dedupe_key)` و کلیدهای `task:{id}:dayN` / `escalation:{id}` / `term:{caseId}:{termId}`؛ آستانه‌ها و نقش مقصد از Settings و `workflow_transitions`؛ `lastSchedulerRun` = **جدیدترین** اجرا + `lastSuccessfulSchedulerRun`؛ کنترل ترم روی `academic_terms` و `thesis_cases.start_term_id` (بک‌فیل‌شده) با Skip صریح و ثبت دلیل در `scheduler_runs.note`؛ پنل سلامت زمان‌بند در داشبورد مدیر؛ ۱۴ تست جدید.
- **M4 (کار ۱):** `topic_versions` با ایندکس یکتای جزئی نسخهٔ فعال و بک‌فیل v1؛ گردش ثبت → بررسی استاد → تأیید/اصلاح گروه با **دلیل اجباری**؛ تغییر موضوع با دلیل (و فایل در صورت فعال‌بودن Setting) تا مرحلهٔ تعیین‌شده؛ `literature_reviews` + `literature_review_versions` با ارسال/بررسی/اصلاح/ارسال مجدد؛ پل واقعی به موتور گردش‌کار (`workflow_transitions`)؛ UI: فهرست نسخه‌ها، Diff ساده، پنل بازبین، فرم پیشینه؛ ۱۴ تست.
- **M6 — کار ۳ (گردش داخلی ایرانداک):** `src/server/services/irandoc.ts` (ثبت کد پیگیری/تاریخ/رسید، بررسی تحصیلات تکمیلی با دلیل اجباری برای رد، تاریخچهٔ بدون حذف)، دو مسیر API (`/api/cases/[id]/irandoc` و `/api/cases/[id]/irandoc/[recordId]/decision`)، پنل واقعی `IrandocPanel` در صفحهٔ پرونده (دسکتاپ و موبایل، حالت بارگذاری/خالی/خطا)، گام‌های Workflow و اعلان‌های هدفمند؛ ۴ تست یکپارچه. **این ماژول هیچ اتصالی به سرویس بیرونی ایرانداک ندارد و ادعای آن را هم نمی‌کند.**
- **صف بررسی مشترک (`/review`):** یک صفحهٔ واقعی برای دارندگان `cases.review_topic` شامل سه صف موضوع، پیشینه پژوهش و ایرانداک با لینک به هر پرونده (حالت خالی/خطا/بارگذاری)، به‌همراه تابع سرویس `listIrandocReviewQueue`.
- **M5 — ادامهٔ کار ۲:** زنجیرهٔ تأیید پروپوزال (تأیید استاد ⇒ سطح گروه ⇒ تصویب نهایی) با **دلیل اجباری**، ساخت ردیف ساختاریافتهٔ `proposals` از پاسخ‌های تأییدشده (ورودی Rule Engine)، پل به `workflow_transitions`، Wizard چندمرحله‌ای با **ذخیرهٔ خودکار پیش‌نویس** و **بارگذاری Word/PDF** با ارجاع به `files.id`؛ ۲ تست زنجیره و IDOR اضافه شد.
- **M5 (نیمهٔ اول کار ۲):** `dynamic_form_definitions`/`dynamic_form_fields` (نوع، اجباری، ترتیب، اعتبارسنجی، گزینه‌ها، شرط نمایش ساده، نسخه‌بندی)؛ سازندهٔ فرم در `/admin/forms` با پیش‌نمایش زنده و انتشار نسخه؛ Seed ۱۶ فیلد پیش‌فرض پروپوزال؛ `proposal_versions` و رندر فرم دانشجو از تعریف منتشرشده با اعتبارسنجی کامل سمت سرور؛ ۱۴ تست.
- **دارایی‌های برند:** لوگوی واقعی دانشگاه (`public/branding/university-logo.jpg`) و چهار آیکون PNG؛ `docs/public-assets-manifest.json` + اسکریپت‌های `assets:brand` / `assets:manifest` / `assets:verify`؛ تست تطبیق SHA-256 با دیسک.
- **فرم‌ساز/سازمان:** مجوزهای جدید `forms.view`، `forms.manage`، `cases.approve_topic_group`، `cases.submit_literature` (Seed در بازاستقرار به نقش‌های موجود اضافه می‌شود).

### Fixed — Task v4
- **بازیابی `src/server/storage/`** که در مخزن وجود نداشت (۱۱ فایل تست و ۴۶ تست سبز نشده بودند).
- **بن‌بست اعلان داخل تراکنش:** فراخوانی `notify()` با استخر اتصال عمومی در حین قفل `FOR UPDATE` روی ردیف پرونده، با قفل `KEY SHARE` کلید خارجی بن‌بست می‌داد (به‌صورت timeout ۲۰ ثانیه‌ای در تست دیده و رفع شد).
- **صحت تست‌ها:** `tests/integration/rbac.test.ts` به `seedRbac` در `beforeAll` وابسته شد و تست «آخرین اجرای زمان‌بند» اصلاح شد (خطای ادعایی در سند قبلی).

### Changed
- `src/middleware.ts` → `src/proxy.ts` (قرارداد Next 16) با حفظ CSP nonce.
- `deploy/deploy.sh`: خطای bootstrap دیگر بلعیده نمی‌شود؛ مالکیت release و `.next/cache` شفاف شد.
- نسخهٔ بسته به `1.0.0`.

### Fixed
- `revokeAllSessions` نشست جاری را هم باطل می‌کرد (باگ واقعی، با تست پوشش داده شد).
- بن‌بست تراکنش تودرتو در پذیرش درخواست استاد.
- رقابت ظرفیت: دو دانشجو می‌توانستند هم‌زمان آخرین ظرفیت را بگیرند.
- `createCase` ردیف پیش از شروع instance را برمی‌گرداند (`currentInstanceId` تهی).
- `submitTopic` وضعیت را مستقیم می‌نوشت و instance را همگام نمی‌کرد.
- سرویس‌های workflow-admin مجوز را فقط در Route بررسی می‌کردند.

### Not delivered (honest)
- منوی کارهای ۳ تا ۱۵ صف (ایرانداک، تمدید/کمیسیون، همانندجویی، دفاع، فارغ‌التحصیلی، PDF، داشبوردهای نقشی و XLSX، امنیت/دسترس‌پذیری، صیقل بصری، بستهٔ نصب آفلاین، مستندات استقرار، E2E، Release Gate) در این Task انجام نشد؛ نقطهٔ ادامه در `docs/progress.md` ثبت شده است. کار ۳ (M6) نیمه‌کاره است: سازندهٔ فرم و رندر پاسخ انجام شده، Wizard چندمرحله‌ای و زنجیرهٔ تأیید پروپوزال نه.
- تست مرورگری (Playwright) در این Task اجرا نشد: مرورگر Playwright در سندباکس نصب نیست و منبع دانلود آن (`playwright.azureedge.net`) در فهرست دامنه‌های مجاز نیست → تغییرات UI **از نظر مرورگری تأییدنشده** هستند.

## [Unreleased]

### Added
- M0: `README.md` پروژه، تست قرارداد فایل‌های public (manifest/SW/branding)، جستجوی سراسری Topbar متصل به `/cases?q=`، اسکریپت `npm run test:e2e`.
- CSP با nonce در `src/middleware.ts` و اسکریپت inline در `src/app/layout.tsx`.
- Playwright E2E: `tests/e2e/critical-flows.spec.ts` (۶ سناریو) — نتیجهٔ واقعی روی Preview: Desktop 6/6، Mobile 6/6.
- فرم ایجاد پرونده: `name` attribute برای فیلدها جهت E2E و دسترس‌پذیری.

### Changed
- عبارت پیش‌فرض جستجوی سراسری از «به‌زودی» به «جستجوی شماره پرونده، نام دانشجو یا عنوان…» تغییر کرد.

### Fixed
- ارجاع به فایل public با تست قرارداد فایل مسدود شد.
- E2E selectors با محدودهٔ `main` و مدیریت صحیح کوکی `httpOnly` (logout + clearCookies) تثبیت شد.

### Known incomplete (honest)
- M1–M13 و M17: موتور workflow داده‌محور، نسخه‌بندی موضوع/پروپوزال، Rule Engine، ایرانداک داخلی، تمدید/کمیسیون، دفاع، فارغ‌التحصیلی، اعلان/Scheduler، PDF رسمی، داشبوردهای نقشی/گزارش‌ها — هنوز پیاده نشده‌اند.
- M16: بستهٔ استقرار کامل/Runbook/Backup→Restore تست‌نشده؛ Deploy واقعی روی سرور انجام نشده.
