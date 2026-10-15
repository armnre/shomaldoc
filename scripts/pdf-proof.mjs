/**
 * M12 visual proof tool (development only — never runs in production).
 *
 * Renders a generated Persian PDF with a real rasterizer (mupdf) and writes:
 *  - the full page as PNG,
 *  - a zoomed crop of the header and of the footer, so the joined letter forms and
 *    the Latin/digit runs can be inspected visually.
 *
 * It also prints the footer/header text extracted by the PDF engine, so the identity
 * strings can be asserted in the shipped document, not just in the source.
 *
 * Usage: node scripts/pdf-proof.mjs <input.pdf> <out-dir>
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import * as mupdf from "mupdf";
import sharp from "sharp";

const [, , input = "docs/pdf-sample.pdf", outDir = "docs"] = process.argv;
mkdirSync(outDir, { recursive: true });
const doc = mupdf.Document.openDocument(readFileSync(input), "application/pdf");
const page = doc.loadPage(0);

const SCALE = 3;
const pix = page.toPixmap(mupdf.Matrix.scale(SCALE, SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
const width = pix.getWidth();
const height = pix.getHeight();
const raw = Buffer.from(pix.getPixels());
const image = sharp(raw, { raw: { width, height, channels: 3 } });

const base = input.split("/").pop().replace(/\.pdf$/, "");
await image.clone().png().toFile(join(outDir, `${base}.png`));
await image
  .clone()
  .extract({ left: 0, top: 0, width, height: Math.round(height * 0.2) })
  .resize({ width: Math.min(width, 1400) })
  .png()
  .toFile(join(outDir, `${base}-header.png`));
await image
  .clone()
  .extract({ left: 0, top: height - Math.round(height * 0.08), width, height: Math.round(height * 0.08) })
  .resize({ width: Math.min(width, 1400) })
  .png()
  .toFile(join(outDir, `${base}-footer.png`));

const text = page.toStructuredText("preserve-whitespace").asText();
const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
const footer = lines.filter((l) => l.includes("©") || l.includes("پارامیس"));
console.log(
  JSON.stringify({
    ok: true,
    pages: doc.countPages(),
    size: `${width}x${height}`,
    files: [`${base}.png`, `${base}-header.png`, `${base}-footer.png`],
    searchableChars: text.trim().length,
    footerLines: footer,
    // The extracted text is the *visual* order, so the assertion is about the two
    // things that actually went wrong before: a mirrored year and a missing credit.
    identityOk: text.includes("۱۴۰۵") && text.includes("پارامیس تک") && !text.includes("۵۰۴۱") && !text.includes("۲۰۲۶"),
  }),
);
