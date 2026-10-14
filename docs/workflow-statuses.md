# وضعیت‌های گردش‌کار پرونده پایان‌نامه — شمال‌داک

## وضعیت‌های پیاده‌سازی‌شده (تأییدشده در فاز ۱)

این وضعیت‌ها در حال حاضر در موتور گردش‌کار فعال هستند و بر اساس قواعد قابل تأیید فنی پیاده‌سازی شده‌اند.

| کلید | عنوان فارسی | عنوان انگلیسی | توضیح |
|---|---|---|---|
| `draft` | پیش‌نویس | Draft | پرونده ایجاد شده اما موضوع هنوز ارسال نشده |
| `submitted` | ثبت‌شده برای بررسی | Submitted | موضوع برای بررسی ارسال شده |
| `under_review` | در حال بررسی | Under Review | بررسی رسمی توسط استاد/گروه آغاز شده |
| `revision_required` | نیازمند اصلاح | Revision Required | موضوع رد شده و نیاز به اصلاح دارد |
| `approved` | تأییدشده | Approved | موضوع تأیید شده |
| `rejected` | ردشده | Rejected | موضوع رد شده |
| `archived` | بایگانی‌شده | Archived | پرونده بایگانی شده (وضعیت نهایی) |

## انتقال‌های مجاز

```
draft → submitted (دانشجو ارسال می‌کند)
submitted → under_review (بررسی‌کننده شروع می‌کند)
submitted → revision_required (نیاز به اصلاح — دلیل الزامی)
submitted → approved (تأیید مستقیم)
submitted → rejected (رد — دلیل الزامی)
under_review → revision_required (نیاز به اصلاح — دلیل الزامی)
under_review → approved (تأیید)
under_review → rejected (رد — دلیل الزامی)
revision_required → submitted (ارسال مجدد پس از اصلاح)
revision_required → approved (تأیید)
revision_required → rejected (رد — دلیل الزامی)
approved → archived (بایگانی)
rejected → archived (بایگانی)
```

## مجوزهای لازم برای هر انتقال

| انتقال | مجوز | دلیل الزامی |
|---|---|---|
| draft → submitted | `cases.submit_topic` | خیر |
| submitted → under_review | `cases.review_topic` | خیر |
| submitted/under_review → revision_required | `cases.review_topic` | **بله** |
| submitted/under_review/revision_required → approved | `cases.review_topic` | خیر |
| submitted/under_review/revision_required → rejected | `cases.review_topic` | **بله** |
| revision_required → submitted | `cases.submit_topic` | خیر |
| approved/rejected → archived | `cases.archive` | خیر |

## ملاحظات فنی

- انتقال وضعیت و ثبت رویداد در یک تراکنش انجام می‌شود.
- از قفل‌گذاری `FOR UPDATE` روی ردیف پرونده برای جلوگیری از رقابت هم‌زمان استفاده می‌شود.
- وضعیت `archived` یک وضعیت نهایی است و هیچ انتقالی از آن تعریف نشده.
- ثبت رویداد (`thesis_case_events`) همیشه همراه با تغییر وضعیت انجام می‌شود.
- دلیل رد یا اصلاح در فیلد `reason` رویداد ثبت می‌شود و در UI نمایش داده می‌شود.

## وضعیت‌های نیازمند تأیید دانشگاه

فهرست ۲۹ وضعیتی که در توضیحات اولیه محصول ذکر شده، **هنوز تأیید نشده است**. وضعیت‌های زیر در صورت تأیید دانشگاه اضافه خواهند شد:

- مرتبط با پروپوزال و نسخه‌بندی آن
- مرتبط با ایرانداک و همانندجویی
- مرتبط با تعیین ظرفیت و سهمیه استادان
- مرتبط با تمدید سنوات
- مرتبط با تعیین داور و زمان‌بندی دفاع
- مرتبط با ثبت نمره و صورت‌جلسه دفاع
- مرتبط با تسویه‌حساب مالی
- مرتبط با تأیید نهایی فارغ‌التحصیلی

**ساختار موتور گردش‌کار برای اضافه‌شدن وضعیت‌های جدید آماده است.** افزودن وضعیت و انتقال جدید فقط نیازمند اضافه‌کردن رکورد به آرایه‌های `CASE_STATUSES` و `TRANSITIONS` در مسیر `src/server/workflows/` است.