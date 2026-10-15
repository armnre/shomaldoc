import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

/**
 * Builds `docs/public-assets-manifest.json`: the verifiable inventory of every
 * file under `public/`. Each entry records path, byte size, SHA-256 and — for
 * binary formats — the magic signature, so a delivered archive can be checked
 * against this file without trusting the packager.
 *
 *   node scripts/public-assets-manifest.mjs           # write the manifest
 *   node scripts/public-assets-manifest.mjs --check   # verify, exit 1 on drift
 */

const root = resolve(process.cwd());
const publicDir = join(root, "public");
const manifestPath = join(root, "docs", "public-assets-manifest.json");

const SIGNATURES = [
  { ext: ".jpg", label: "JPEG", magic: "ffd8ff" },
  { ext: ".jpeg", label: "JPEG", magic: "ffd8ff" },
  { ext: ".png", label: "PNG", magic: "89504e470d0a1a0a" },
  { ext: ".webp", label: "WEBP", magic: "52494646" },
  { ext: ".gif", label: "GIF", magic: "47494638" },
  { ext: ".ico", label: "ICO", magic: "00000100" },
  { ext: ".woff2", label: "WOFF2", magic: "774f4632" },
  { ext: ".ttf", label: "TTF", magic: "00010000" },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function entryFor(fullPath) {
  const buf = readFileSync(fullPath);
  const rel = relative(publicDir, fullPath).split(sep).join("/");
  const lower = fullPath.toLowerCase();
  const sig = SIGNATURES.find((s) => lower.endsWith(s.ext));
  const hex = buf.subarray(0, sig ? sig.magic.length / 2 : 8).toString("hex");
  const signatureOk = sig ? hex.startsWith(sig.magic) : true;
  return {
    path: `/public/${rel}`,
    url: `/${rel}`,
    bytes: statSync(fullPath).size,
    sha256: createHash("sha256").update(buf).digest("hex"),
    kind: sig ? sig.label : rel.endsWith(".svg") ? "SVG" : rel.endsWith(".js") ? "JavaScript" : "text",
    signatureHex: sig || rel.endsWith(".svg") ? hex.slice(0, sig ? sig.magic.length : 8) : null,
    signatureOk,
    empty: buf.length === 0,
  };
}

function build() {
  const files = walk(publicDir).sort();
  const assets = files.map(entryFor);
  return {
    generatedBy: "scripts/public-assets-manifest.mjs",
    note: "فهرست قابل‌راستی‌آزمایی فایل‌های public/ — مسیر، حجم، SHA-256 و امضای باینری هر فایل.",
    generatedAt: new Date().toISOString().slice(0, 10),
    count: assets.length,
    totalBytes: assets.reduce((a, e) => a + e.bytes, 0),
    binaryCount: assets.filter((e) => e.kind !== "SVG" && e.kind !== "text" && e.kind !== "JavaScript").length,
    allSignaturesValid: assets.every((e) => e.signatureOk && !e.empty),
    assets,
  };
}

const mode = process.argv.includes("--check") ? "check" : "write";
const built = build();

if (mode === "write") {
  writeFileSync(manifestPath, `${JSON.stringify(built, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, mode, count: built.count, totalBytes: built.totalBytes, allSignaturesValid: built.allSignaturesValid }));
} else {
  const existing = JSON.parse(readFileSync(manifestPath, "utf8"));
  const drift = [];
  const byPath = new Map(existing.assets.map((a) => [a.path, a]));
  for (const asset of built.assets) {
    const prev = byPath.get(asset.path);
    if (!prev) drift.push(`added: ${asset.path}`);
    else if (prev.sha256 !== asset.sha256 || prev.bytes !== asset.bytes) drift.push(`changed: ${asset.path}`);
  }
  for (const prev of existing.assets) if (!built.assets.some((a) => a.path === prev.path)) drift.push(`removed: ${prev.path}`);
  const invalid = built.assets.filter((a) => !a.signatureOk || a.empty).map((a) => a.path);
  if (drift.length || invalid.length || existing.count !== built.count) {
    console.error(JSON.stringify({ ok: false, drift, invalid }, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, mode, count: built.count, allSignaturesValid: built.allSignaturesValid }));
  }
}
