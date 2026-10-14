import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the PWA/brand contract: every public URL referenced by the manifest,
 * the service worker and the root layout must exist on disk and be non-empty.
 * This prevents "reference to a file that is not there" regressions (404 at runtime).
 */
const REFERENCED_ASSETS = [
  "/branding/shomaldoc-mark.svg",
  "/branding/shomaldoc-logo.svg",
  "/branding/shomaldoc-maskable.svg",
  "/branding/university-logo.jpg",
  "/icons/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/sw.js",
];

function publicPath(urlPath: string): string {
  // join (not resolve) because the second argument starts with "/".
  return join(resolve("public"), urlPath);
}

describe("public asset contract", () => {
  for (const asset of REFERENCED_ASSETS) {
    it(`${asset} exists and is non-empty`, () => {
      const path = publicPath(asset);
      expect(existsSync(path), `${asset} is referenced but missing from public/`).toBe(true);
      expect(statSync(path).size, `${asset} exists but is empty`).toBeGreaterThan(0);
    });
  }

  it("university logo is a real JPEG (magic bytes)", () => {
    const buf = readFileSync(publicPath("/branding/university-logo.jpg"));
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  });

  it("PNG icons carry the PNG signature", () => {
    for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) {
      const buf = readFileSync(publicPath(`/icons/${icon}`));
      expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }
  });
});
