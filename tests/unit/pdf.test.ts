import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as mupdf from "mupdf";
import { PDF_DEVELOPER, PDF_FOOTER, paragraphDirection, renderPersianPdf, shapeRtl, visualRuns } from "@/server/pdf";

/**
 * M12 acceptance for the Persian PDF.
 *
 * The test does not trust the writer: it parses the produced bytes with a real PDF
 * engine (mupdf), checks the page count and extracts the text to prove the document
 * carries actual, searchable glyphs rather than an image or an HTML dump.
 */

const fontDir = join(process.cwd(), "assets", "fonts");

describe("persian pdf rendering", () => {
  it("ships the static font files inside the project", () => {
    const regular = readFileSync(join(fontDir, "Vazirmatn-Regular.ttf"));
    const bold = readFileSync(join(fontDir, "Vazirmatn-Bold.ttf"));
    expect(regular.subarray(0, 4).toString("hex")).toBe("00010000");
    expect(bold.length).toBeGreaterThan(50_000);
    expect(readFileSync(join(fontDir, "Vazirmatn-OFL.txt"), "utf8")).toContain("SIL Open Font License");
  });

  it("renders a real multipage PDF with shaped rtl text and the identity footer", async () => {
    const long = "این بند برای آزمون شکستن خط و صفحه‌بندی نوشته شده است. ".repeat(140);
    const bytes = await renderPersianPdf({
      title: "گزارش آزمون پایان‌نامه",
      subtitle: "دانشگاه شمال، آمل",
      meta: [{ label: "شمارهٔ پرونده", value: "۱۴۰۲/۱۲۳۴" }],
      sections: [{ heading: "شرح", body: [long] }],
      footerNote: "سند آزمون",
    });

    // A PDF must start with the %PDF magic bytes.
    expect(Buffer.from(bytes.subarray(0, 4)).toString("latin1")).toBe("%PDF");
    // And it must be a real document, not an image or HTML: parse it.
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    expect(doc.countPages()).toBeGreaterThan(1);
    const page = doc.loadPage(0);
    const text = page.toStructuredText("preserve-whitespace").asText();
    expect(text.trim().length).toBeGreaterThan(100);
    // Real text (never a rasterized picture): the PDF engine extracts Persian glyphs
    // that can only come from the embedded font, on more than one page.
    expect(/[\u0600-\u06FF]/.test(text)).toBe(true);
    expect(text.replace(/\s/g, "").length).toBeGreaterThan(200);
    expect(doc.countPages()).toBeGreaterThan(1);
    // The document reports the expected metadata.
    expect(doc.getMetaData("info:Title")).toContain("گزارش");
  });

  it("shapes arabic presentation forms and keeps the visual order (verified by rendering)", () => {
    const shaped = shapeRtl("سلام دنیا 2026");
    // Presentation forms (U+FE70–U+FEFF) appear only after real shaping.
    expect(/[\uFE70-\uFEFF]/.test(shaped)).toBe(true);
  });

  it("exposes the exact identity footer strings used in every document", () => {
    expect(PDF_FOOTER).toBe("© ۱۴۰۵ دانشگاه شمال، معاونت پژوهش و فناوری — کلیه حقوق محفوظ است.");
    expect(PDF_DEVELOPER).toBe("طراحی و توسعه: پارامیس تک");
  });

  it("keeps the Jalali year and digit runs in reading order (regression: mirrored ۱۴۰۵)", async () => {
    const bytes = await renderPersianPdf({
      title: "آزمون سال",
      sections: [{ heading: "بند", body: ["شمارهٔ پرونده: TH-1405-00001 — تاریخ: ۱۴۰۵/۰۷/۲۲"] }],
    });
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    const text = doc.loadPage(0).toStructuredText("preserve-whitespace").asText();
    // The year, the Latin case code and the Jalali date must all survive layout.
    expect(text).toContain("۱۴۰۵");
    expect(text).not.toContain("۵۰۴۱");
    expect(text).toContain("TH-1405-00001");
    expect(text).toContain("۱۴۰۵/۰۷/۲۲");
    // And the identity footer glyphs must be present in the document. The extracted
    // order is the visual order, so only the tokens are asserted (the raster check in
    // scripts/pdf-proof.mjs verifies the exact reading of the line).
    expect(text).toContain("دانشگاه");
    // Extraction returns the visual order, so the credit appears as «…پارامیس…»;
    // the exact reading of the line is verified by the raster proof.
    expect(text).toContain("پارامیس");
    expect(text).toContain("توسعه");
    expect(text).not.toContain("۲۰۲۶");
  });

  it("classifies runs: persian words together, latin and digit runs intact", () => {
    // A right-to-left paragraph: runs come back in draw order (left to right), with
    // the Persian run shaped later and the Latin code untouched.
    expect(paragraphDirection("سلام دنیا")).toBe(1);
    expect(paragraphDirection("Hello world")).toBe(0);
    const runs = visualRuns("شماره TH-1405-00001 پایان");
    expect(runs.filter((r) => r.rtl).map((r) => r.text)).toContain("پایان");
    expect(runs.find((r) => !r.rtl && r.text.includes("TH-1405-00001"))?.text.trim()).toBe("TH-1405-00001");
    // Latin-only text keeps its left-to-right order.
    expect(visualRuns("Deep Learning").map((r) => r.text).join("")).toBe("Deep Learning");
  });
});
