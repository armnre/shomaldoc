import { describe, expect, it } from "vitest";
import { maskEmail, maskNationalId, maskPhone, maskStudentNumber, maySeePersonalData } from "@/lib/personal-data";

/** M14 — masking rules for personal identifiers. */
describe("personal data masking", () => {
  it("keeps a recognisable prefix/suffix and hides the middle of an identifier", () => {
    expect(maskNationalId("1234567890")).toBe("123****90");
    expect(maskStudentNumber("40123456")).toBe("40***56");
    expect(maskEmail("student@example.ac.ir")).toBe("s******@example.ac.ir");
    expect(maskPhone("09123456789")).toBe("0912***89");
  });

  it("never throws on missing or short values and returns a dash instead", () => {
    expect(maskNationalId(null)).toBeNull();
    expect(maskNationalId("12")).toBe("—");
    expect(maskEmail("broken")).toBe("—");
    expect(maskStudentNumber("")).toBeNull();
  });

  it("allows raw values only for the owner or an operator with users.view", () => {
    expect(maySeePersonalData({ isOwner: true, permissions: [] })).toBe(true);
    expect(maySeePersonalData({ isOwner: false, permissions: ["users.view"] })).toBe(true);
    expect(maySeePersonalData({ isOwner: false, permissions: ["cases.view_own"] })).toBe(false);
  });

  it("is not reversible: the masked output never contains the original fully", () => {
    const raw = "1234567890";
    const masked = maskNationalId(raw) as string;
    expect(masked.replace("*", "")).not.toBe(raw);
    expect(masked.length).toBeLessThan(raw.length + 1);
  });
});
