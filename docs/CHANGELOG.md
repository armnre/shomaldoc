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
- M4 (نسخه‌بندی موضوع/پیشینه)، M5 (فرم‌ساز پویا و Wizard پروپوزال)، M7 (Wizard تمدید و مسیر کمیسیون)، M8 (گردش همانندجویی)، M9 (دفاع)، M10 (فارغ‌التحصیلی)، M12 (PDF رسمی)، M17 (E2E سرتاسری) — به‌دلیل نبود سند رسمی دانشگاه و/یا محدودیت بودجهٔ اجرا در این Task. جدول `proposals`/`irandoc_records`/`similarity_checks` آماده است و Rule Engine از آن‌ها می‌خواند.
- تست مرورگری برای تغییرات جدید این Task اجرا نشد (تأییدنشده).

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
