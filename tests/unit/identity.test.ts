import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PDF_DEVELOPER, PDF_FOOTER } from "@/server/pdf";

/**
 * Identity rules for the system (Task v4 §1). These strings are contractual: the
 * footer, the PDF footer and the manifest must all carry the same name and link.
 */
const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("identity", () => {
  const dict = read("src/i18n/dictionaries.ts");
  const pkg = JSON.parse(read("package.json")) as { name: string; version: string };

  it("keeps the exact Persian footer strings: Jalali year and the developer credit", () => {
    expect(dict).toContain("© ۱۴۰۵ دانشگاه شمال، معاونت پژوهش و فناوری — کلیه حقوق محفوظ است.");
    expect(dict).toContain("طراحی و توسعه: پارامیس تک");
    expect(dict).toContain('developerUrl: "https://paramistech.ir/"');
    // The Gregorian year must not appear in the Persian footer.
    expect(dict).not.toContain("© ۲۰۲۶");
  });

  it("prints the same strings in every generated PDF", () => {
    expect(PDF_FOOTER).toBe("© ۱۴۰۵ دانشگاه شمال، معاونت پژوهش و فناوری — کلیه حقوق محفوظ است.");
    expect(PDF_DEVELOPER).toBe("طراحی و توسعه: پارامیس تک");
  });

  it("links the developer with rel=noopener noreferrer", () => {
    const footer = read("src/components/app-shell/site-footer.tsx");
    expect(footer).toContain('rel="noopener noreferrer"');
    expect(footer).toContain('target="_blank"');
    expect(footer).toContain("dict.brand.developerUrl");
  });

  it("identifies the app as shomaldoc version 1.0.0", () => {
    expect(pkg.name).toBe("shomaldoc");
    expect(pkg.version).toBe("1.0.0");
  });
});
