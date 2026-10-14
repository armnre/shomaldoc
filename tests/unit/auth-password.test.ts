import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { passwordSchema, usernameSchema } from "@/validations/schemas";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const hash = await hashPassword("Correct-Horse-42");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct-Horse-42", hash)).toBe(true);
    expect(await verifyPassword("Wrong-Horse-42", hash)).toBe(false);
  });

  it("uses a fresh salt for every hash", async () => {
    const a = await hashPassword("Same-Password-1");
    const b = await hashPassword("Same-Password-1");
    expect(a).not.toBe(b);
  });

  it("treats malformed stored hashes as invalid", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "scrypt$a$b$c$d$e")).toBe(false);
  });
});

describe("validation policies", () => {
  it("requires letters and digits, minimum length 10", () => {
    expect(passwordSchema.safeParse("short1").success).toBe(false);
    expect(passwordSchema.safeParse("onlyletterslong").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890").success).toBe(false);
    expect(passwordSchema.safeParse("Good-Pass-2026").success).toBe(true);
  });

  it("normalises usernames to lowercase and rejects spaces", () => {
    expect(usernameSchema.parse("  Ali.Rezaei ")).toBe("ali.rezaei");
    expect(usernameSchema.safeParse("ali rezaei").success).toBe(false);
  });
});
