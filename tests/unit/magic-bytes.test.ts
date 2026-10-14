import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { detectMimeType, ALLOWED_MIME_TYPES } from "@/server/storage";

describe("magic-byte detection", () => {
  it("detects a real PDF file header", () => {
    const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    expect(detectMimeType(pdfHeader)).toBe("application/pdf");
  });

  it("detects a real JPEG file header", () => {
    const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectMimeType(jpegHeader)).toBe("image/jpeg");
  });

  it("detects a real PNG file header", () => {
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectMimeType(pngHeader)).toBe("image/png");
  });

  it("accepts a DOCX (ZIP containing word/document.xml)", () => {
    const name = Buffer.from("word/document.xml");
    const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, ...name]);
    expect(detectMimeType(zipHeader)).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  it("rejects a bare ZIP that is not a DOCX", () => {
    const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x01, 0x02]);
    expect(detectMimeType(zipHeader)).toBeNull();
  });

  it("rejects executable content (MZ header)", () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    expect(detectMimeType(exe)).toBeNull();
  });

  it("returns null for a completely unknown header", () => {
    const junk = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    expect(detectMimeType(junk)).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(detectMimeType(new Uint8Array(0))).toBeNull();
  });

  it("recognises the university logo as JPEG", () => {
    const logo = readFileSync(resolve("public/branding/university-logo.jpg"));
    expect(detectMimeType(new Uint8Array(logo.subarray(0, 16)))).toBe("image/jpeg");
  });

  it("recognises a real PNG favicon", () => {
    const icon = readFileSync(resolve("public/icons/icon-192.png"));
    expect(detectMimeType(new Uint8Array(icon.subarray(0, 16)))).toBe("image/png");
  });

  it("ALLOWED_MIME_TYPES contains only the expected set", () => {
    expect([...ALLOWED_MIME_TYPES].sort()).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/jpeg",
      "image/png",
    ]);
  });
});