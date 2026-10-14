# وضعیت پیشرفت شمال‌داک — نسخهٔ ۱.۰.۰

## زمان‌بندی این Task
- شروع: ۰۵:۵۰ UTC — توقف قابلیت‌افزایی: ۰۶:۴۵ UTC — پایان: در گزارش نهایی ثبت شد.
- خط پایهٔ شروع: typecheck ✅ · lint ✅ · test ✅ **۱۴۹ تست** (پیش از هر تغییر).

## جدول مایل‌استون‌ها

| مایل‌استون | وضعیت | مدرک / آنچه مانده |
|---|---|---|
| M0 ارجاع‌های شکسته و پایهٔ تحویل | ✅ کامل | `find public -type f` و امضای باینری‌ها (JPEG/PNG) با node اثبات شد؛ تست قرارداد ۱۰ فایل public سبز؛ همهٔ URLها روی Preview ۲۰۰؛ `README.md`؛ جستجوی Topbar واقعی |
| M1 موتور گردش‌کار داده‌محور | ✅ کامل | جداول `workflow_definitions/steps/transitions/instances/tasks/task_history`؛ `workflow_transitions` مرجع تصمیم؛ Seed ۷وضعیتی بدون تغییر رفتار + چرخهٔ ۳۱مرحله‌ای **پیش‌نویس منتشرنشده** با `pending_university_approval`؛ versioning؛ ویرایشگر UI با اعتبارسنجی گراف؛ ۱۷ تست |
| M2 مدل سازمانی و پروفایل‌ها | ✅ کامل | رشته/گرایش/ترم + پروفایل دانشجو و استاد + ورود گروهی CSV با پیش‌نمایش/اعتبارسنجی؛ ۱۹ تست؛ UI در `/admin/organization` |
| M3 درخواست استاد + ظرفیت | ✅ کامل | `supervisor_requests`، موتور ظرفیت از Settings، صف استاد، صف مدیر گروه، سریال‌سازی رقابت با قفل ردیف؛ UI در `/supervisors` |
| M6 Rule Engine | ✅ کامل | `src/server/rules/` شش قاعدهٔ خالص با دلایل فارسی؛ `loadCaseFacts` از دادهٔ واقعی؛ API `/api/cases/[id]/rules` و پنل UI در صفحهٔ پرونده |
| M11 اعلان/یادآوری/Escalation | ✅ کامل | `notifications`+`notification_logs`؛ مرکز اعلان واقعی (شمارنده/فهرست/خوانده‌شدن)؛ Scheduler خودکار از `instrumentation.ts` با `pg_try_advisory_lock` و ثبت `scheduler_runs`؛ email/sms **صریحاً disabled** |
| M13 گزارش‌ها | 🟡 نیمه | گزارش پرونده‌ها با فیلتر + CSV امن (ضد Formula Injection) + صفحهٔ `/reports`. **مانده:** نمودارها، XLSX، گزارش استادان/دفاع، داشبوردهای تفکیکی هر نقش، جستجوی پیشرفتهٔ چندفیلدی |
| M14 امنیت و دسترس‌پذیری | 🟡 نیمه | `middleware.ts`→`proxy.ts` (قرارداد Next 16) با nonce و حذف `unsafe-inline` از script-src؛ مدیریت نشست‌ها (فهرست/خاتمه/خاتمهٔ همه با حفظ نشست جاری)؛ 2FA TOTP کامل (RFC 6238، رمز AES-GCM، اجبار در ورود). **مانده:** تست ماتریسی همهٔ Endpointها، `npm audit` رسمی، ممیزی کامل دسترس‌پذیری |
| M16 آمادگی تحویل | 🟡 نیمه | `deploy.sh` بدون `|| true` روی bootstrap + مالکیت release + smoke test (health/login/401) + `post-deploy-check.sh` + `package-release.sh` با checksum و اثبات باینری‌ها؛ نسخه `1.0.0`. **مانده:** اجرای واقعی Backup→Restore در این Task و Runbook کامل |
| M15 صیقل بصری | 🟡 نیمه | Design System و حالت‌های Empty/Loading/Error موجود؛ E2E دسکتاپ/موبایل ۶ سناریو سبز. **مانده:** مرور تک‌تک صفحات، اسکرین‌شات مرجع |
| M4 موضوع/پیشینه نسخه‌دار | ⏳ انجام‌نشد | `topic_versions` و `literature_reviews` ساخته نشد؛ موضوع همچنان روی `thesis_cases` است |
| M5 پروپوزال و فرم‌ساز پویا | 🟡 فقط داده | جداول `proposals` ساخته شد (بدون UI/فرم‌ساز/گردش)؛ `dynamic_form_*` و Wizard ساخته نشد |
| M7 ترم/تمدید/کمیسیون | ⏳ انجام‌نشد | فقط `canRequestExtension`/`canOpenCommission` در Rule Engine و job کنترل ترم؛ Wizard تمدید و مسیر کمیسیون ساخته نشد |
| M8 نگارش/همانندجویی | 🟡 فقط داده | جدول `similarity_checks` و قاعدهٔ `canRequestDefense` ساخته شد؛ ثبت/گردش همانندجویی و نسخه‌بندی پایان‌نامه UI ندارد |
| M9 دفاع | ⏳ انجام‌نشد | داور/جلسه/نتیجه/صورتجلسه ساخته نشد |
| M10 فارغ‌التحصیلی | ⏳ انجام‌نشد | فقط `canCloseCase` در Rule Engine؛ Workflow و جداول ساخته نشد |
| M12 PDF رسمی | ⏳ انجام‌نشد | **عمداً ساخته نشد**: بدون موتور shaping/bidi فارسی و فونت static وزیرمتن، خروجی PDF با حروف گسسته تولید می‌شود و معیار «اثبات کیفیت فارسی» را رد می‌کند. طبق ممنوعیت «PDF که HTML است» و «ادعای بدون مدرک»، هیچ خروجی ناقص تحویل داده نشد. راهکار پیشنهادی در `docs/decisions.md` |
| M17 پذیرش نهایی E2E | ⏳ انجام‌نشد | سناریوی سرتاسری کامل به M4–M10 وابسته است که ساخته نشدند |

## تست‌ها (خروجی واقعی)
- `npx next typegen` ✅ · `npm run typecheck` ✅ · `npm run lint` ✅ · `npm run build` ✅
- `npm run test` ✅ — **۲۰۸ تست در ۱۷ فایل، همه سبز** (از ۱۴۹ در شروع Task)
- Playwright: ۶ سناریوی حیاتی در Task پیشین روی Preview سبز شد (دسکتاپ و موبایل)؛ در این Task به‌دلیل محدودیت بودجهٔ اجرا، دوباره اجرا نشد → **تأییدنشده برای تغییرات جدید این Task**

## مهاجرت‌های جدید
- `0005` جداول workflow + بک‌فیل instance برای پرونده‌های موجود
- `0006` رشته/گرایش/ترم/پروفایل‌ها/`supervisor_requests`/batches ورود
- `0007` `proposals`، `irandoc_records`، `similarity_checks`، `notifications`، `notification_logs`، `scheduler_runs`، `user_two_factors`
- همه افزایشی؛ مهاجرت‌های `0000`–`0004` دست‌نخورده. راه بازگشت: DROP ستون/جدول‌های جدید (دادهٔ قدیمی بدون تغییر می‌ماند)

## استقرار
- **Build و Preview واقعی انجام شد؛ Deploy روی سرور دانشگاه انجام نشده** (دسترسی SSH نیست).
- بسته: `npm run package:release` → `dist/shomaldoc-1.0.0.tar.gz` با SHA256 و اثبات حضور باینری‌های `public/`.

## نقطهٔ ادامهٔ Task بعدی
1. **M4**: `topic_versions` + بک‌فیل از `thesis_cases.title_fa` به v1؛ سپس `literature_reviews`.
2. **M12**: انتخاب موتور PDF با shaping فارسی (`pdf-lib` + `arabic-reshaper` + `bidi-js` + فونت static وزیرمتن) و اثبات بصری با رسترکردن نمونه.
3. **M13**: نمودارها و داشبوردهای تفکیکی نقش + XLSX.
4. **M14**: تست ماتریسی نقش × Endpoint و گزارش `npm audit`.
5. **M16**: اجرای واقعی Backup→Restore و تکمیل Runbook.
