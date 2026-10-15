import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
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

/**
 * `docs/public-assets-manifest.json` is the verifiable inventory shipped with the
 * release. These tests fail whenever a public file is added, removed or altered
 * without regenerating it (`npm run assets:manifest`), and they reject placeholder
 * content: an "empty" or signature-less binary can never travel with a release.
 */
function walkPublic(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkPublic(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

describe("public asset manifest", () => {
  const manifestPath = resolve("docs/public-assets-manifest.json");

  it("exists and lists every file under public/ with size and SHA-256", () => {
    expect(existsSync(manifestPath), "docs/public-assets-manifest.json is missing").toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      count: number;
      allSignaturesValid: boolean;
      assets: Array<{ path: string; bytes: number; sha256: string; signatureOk: boolean; empty: boolean }>;
    };
    const files = walkPublic(resolve("public"))
      .map((f) => `/public/${relative(resolve("public"), f).split(sep).join("/")}`)
      .sort();
    expect(manifest.assets.map((a) => a.path).sort()).toEqual(files);
    expect(manifest.count).toBe(files.length);
    expect(manifest.allSignaturesValid).toBe(true);
    expect(manifest.assets.every((a) => a.signatureOk && !a.empty && a.bytes > 0)).toBe(true);
  });

  it("records hashes that match the bytes on disk (no drift)", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      assets: Array<{ path: string; bytes: number; sha256: string }>;
    };
    for (const asset of manifest.assets) {
      const diskPath = join(resolve("public"), asset.path.replace("/public/", ""));
      const buf = readFileSync(diskPath);
      expect(buf.length, `${asset.path} size drifted`).toBe(asset.bytes);
      expect(createHash("sha256").update(buf).digest("hex"), `${asset.path} hash drifted`).toBe(asset.sha256);
    }
  });
});
