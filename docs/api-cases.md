# API پرونده‌های پایان‌نامه — شمال‌داک

## فهرست مسیرها

### `GET /api/cases`
فهرست پرونده‌ها با جستجو و صفحه‌بندی.

**پارامترهای Query:**
- `q`: عبارت جستجو (اختیاری، حداکثر ۱۲۰ نویسه)
- `status`: فیلتر وضعیت (اختیاری)
- `page`: شماره صفحه (پیش‌فرض: ۱)

**مجوز:** هر کاربر فقط پرونده‌های مجاز را می‌بیند.

**پاسخ موفق:**
```json
{
  "ok": true,
  "data": {
    "items": [{ "id": "...", "caseNumber": "TH-1405-00001", "studentFullName": "...", "currentStatus": "draft", "titleFa": "..." }],
    "total": 42,
    "page": 1,
    "pageSize": 20
  }
}
```

### `POST /api/cases`
ایجاد پرونده جدید.

**مجوز:** `cases.create`

**بدنه:**
```json
{
  "studentFullName": "نام دانشجو",
  "studentNumber": "12345678",
  "department": "مهندسی کامپیوتر",
  "degreeLevel": "کارشناسی ارشد",
  "fieldOfStudy": "هوش مصنوعی",
  "academicYear": "1405"
}
```

### `GET /api/cases/[id]`
جزئیات پرونده.

**مجوز:** دسترسی به پرونده بر اساس نقش.

### `PATCH /api/cases/[id]`
ویرایش اطلاعات پرونده با سیاست فیلدی (فاز ۲):

- فیلدهای هویتی (`studentFullName`, `studentNumber`): فقط `cases.edit_metadata`
- فیلدهای تحصیلی/موضوع: `cases.edit_metadata` یا `cases.update_assigned` یا دانشجوی مالک با `cases.update_own_draft` (فقط `draft`/`revision_required`)
- در همهٔ حالت‌ها دسترسی به همان پرونده نیز بررسی می‌شود؛ تغییر وضعیت از این مسیر ممکن نیست.

**خطاها:** `403 FIELD_FORBIDDEN` (فیلد هویتی بدون مجوز)، `409 ARCHIVED`/`409 REJECTED`

### `POST /api/cases/[id]/topic`
ثبت یا ارسال موضوع.

**مجوز:** `cases.submit_topic`

**بدنه:**
```json
{
  "titleFa": "عنوان فارسی",
  "titleEn": "English Title",
  "keywords": "کلمات کلیدی",
  "description": "توضیحات",
  "submitForReview": true
}
```

### `POST /api/cases/[id]/transitions`
تغییر وضعیت پرونده.

**مجوز:** مجوز دقیقِ خود انتقال در سرویس بررسی می‌شود (`cases.submit_topic` برای ارسال، `cases.review_topic` برای بررسی/تأیید/رد، `cases.archive` برای بایگانی). داشتن `cases.transition_status` عمومی به‌تنهایی کافی نیست و مسیر فقط احراز هویت را پیش‌شرط می‌داند.

**بدنه:**
```json
{
  "to": "under_review",
  "reason": "دلیل تغییر وضعیت"
}
```

**خطاها:**
- `409 INVALID_TRANSITION`: انتقال مجاز نیست
- `400 REASON_REQUIRED`: دلیل الزامی است

### `GET /api/cases/[id]/events`
تاریخچه پرونده.

**مجوز:** `cases.events.view`

### `GET /api/cases/[id]/supervisors`
فهرست استادان پرونده.

### `POST /api/cases/[id]/supervisors`
افزودن استاد.

**مجوز:** `cases.assign_supervisors`

**بدنه:**
```json
{
  "supervisorName": "نام استاد",
  "roleType": "supervisor"
}
```

### `GET /api/cases/[id]/files`
فهرست فایل‌های پرونده. پاسخ شامل `downloadUrl` است و `storageKey` داخلی را افشا نمی‌کند.

### `GET /api/files/{fileId}/download`
دانلود امن فایل. شناسهٔ فایل (UUID) فقط شناسه است و کلید ذخیره‌سازی هرگز به کلاینت داده نمی‌شود: نشست معتبر + `cases.files.download` + دسترسی اثبات‌شده به پروندهٔ صاحب فایل لازم است. پاسخ با `Content-Disposition: attachment` (پشتیبانی نام فارسی)، `nosniff` و `Cache-Control: private, no-store` ارسال می‌شود. کلید نامعتبر/فایل غایب: `404`؛ بدون دسترسی: `403`.

### `POST /api/cases/[id]/files`
بارگذاری فایل.

**مجوز:** `cases.files.upload`

**نوع درخواست:** `multipart/form-data`

**فرمت:**
- `file`: فایل (PDF، DOCX واقعی، JPG، PNG — سقف از تنظیمات `upload.maxSizeMb`؛ رد زودهنگام با `413` بر اساس Content-Length و اندازهٔ واقعی)
- `purpose`: یکی از `general`، `topic`، `supporting` (اختیاری)؛ نوع واقعی فایل از Magic Bytes تشخیص داده می‌شود و ZIP ساده DOCX محسوب نمی‌شود.

## قواعد دسترسی

| نقش | دسترسی |
|---|---|
| دانشجو | فقط پرونده خودش |
| استاد راهنما/مشاور | پرونده‌های ارجاع‌شده |
| مدیر گروه | پرونده‌های گروه |
| تحصیلات تکمیلی | همه پرونده‌ها |
| مدیر سیستم | همه پرونده‌ها |

## خطاهای متداول

| کد HTTP | کد خطا | توضیح |
|---|---|---|
| 400 | `INVALID_INPUT` | ورودی نامعتبر |
| 400 | `INVALID_STATUS` | وضعیت مقصد نامعتبر |
| 401 | `UNAUTHENTICATED` | نشست نامعتبر |
| 403 | `FORBIDDEN` | دسترسی ندارید |
| 404 | `CASE_NOT_FOUND` | پرونده یافت نشد |
| 409 | `INVALID_TRANSITION` | انتقال وضعیت مجاز نیست |
| 409 | `ARCHIVED` | پرونده بایگانی‌شده |
| 413 | `FILE_TOO_LARGE` | حجم فایل بیش از حد مجاز |