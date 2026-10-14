# راهنمای فارسی — کار ۸: PDF واقعی فارسی (M12)

## چه چیزی ساخته شد
- `src/server/pdf/index.ts`: `renderPersianPdf` با `pdf-lib` — **PDF واقعی** (نه HTML چاپ‌شده).
  قلم Vazirmatn از `assets/fonts/` به‌صورت **جاسازی‌شده** (offline، بدون CDN).
- شکل‌دهی متن: `arabic-reshaper` (`convertArabic`) + `bidi-js`
  (`getEmbeddingLevels(shaped,"rtl")` → `getReorderedString`). خروجی **راست‌به‌چپ درست** است.
- کاغذ A4 با حاشیهٔ ۴۸ نقطه، سربرگ/زیرنویس در هر صفحه از طریق `drawLine`، اعداد فارسی سالم.
- `buildCasePdf` (`src/server/pdf/case-report.ts`): فقط **سطرهای واقعی دیتابیس** — بدون داده‌نمایی.

## پیاده‌سازی در UI
- دکمهٔ «دریافت PDF پرونده» در صفحهٔ پرونده → `GET /api/cases/{id}/pdf` (دسترسی با همان قواعد
  `getVisibleCaseIds`؛ بدون دسترسی ⇒ `403`).

## اثبات بصری (اجراشده، نه ادعا)
```
node scripts/pdf-proof.mjs docs/pdf-sample.pdf docs   # mupdf raster + sharp crop
```
خروجی‌ها: `docs/pdf-sample.pdf`, `docs/pdf-sample.png` (کل صفحه),
`docs/pdf-sample-header.png` و `docs/pdf-sample-footer.png` (برش سربرگ/زیرنویس).

بررسی خواندنی: متن راست‌به‌چپ خوانده می‌شود، واژه‌ها جابه‌جا نشده‌اند، «IR-1402-000123» سالم است و
زیرنویس دقیقاً «© ۲۰۲۶ دانشگاه شمال، معاونت پژوهش و فناوری — کلیه حقوق محفوظ است.» و
«طراحی و توسعه: پارمیستک» را نشان می‌دهد.

> نکتهٔ فنی: `pdf-lib` همیشه به ترتیب رشته (چپ‌به‌راست) می‌کشد؛ تنها راه درست، همین زنجیرهٔ
> `convertArabic` + بازچینش bidi است. دست‌کاری دستی ترتیب رشته‌ها اشتباه است.

## تست
`tests/unit/pdf.test.ts` — ۴ تست سبز (ساخت PDF معتبر، شمایل `%PDF`، جاسازی قلم، نبود کاراکتر
HTML در خروجی).
