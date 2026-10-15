import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

/**
 * Brand asset generator.
 *
 * Rasterises the committed SVGs into the PNG icon set that the PWA manifest,
 * the layout metadata and tests/unit/public-assets.test.ts require. Run it with:
 *
 *   npm run assets:brand
 *
 * It is developer tooling only: the generated files are committed, and the
 * offline release package ships the PNGs (no rasteriser is needed on the server).
 */

const root = process.cwd();
const publicDir = join(root, "public");

function renderSvg(svgPath, width) {
  const svg = readFileSync(svgPath);
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width }, background: "rgba(0,0,0,0)" });
  return Buffer.from(resvg.render().asPng());
}

/** Maskable icons need their artwork inside the 80% safe circle. */
function padMaskable(png, size) {
  const inner = Math.round(size * 0.78);
  return sharp(png)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: Math.round((size - inner) / 2),
      bottom: size - inner - Math.round((size - inner) / 2),
      left: Math.round((size - inner) / 2),
      right: size - inner - Math.round((size - inner) / 2),
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

async function main() {
  mkdirSync(join(publicDir, "icons"), { recursive: true });
  const mark = join(publicDir, "branding", "shomaldoc-mark.svg");
  const maskable = join(publicDir, "branding", "shomaldoc-maskable.svg");

  const icon192 = renderSvg(mark, 192);
  const icon512 = renderSvg(mark, 512);
  const maskable512 = await padMaskable(renderSvg(maskable, 512), 512);
  const appleTouch = await sharp(renderSvg(mark, 180))
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .png()
    .toBuffer();

  // The PWA "any maskable" icon must keep a solid background; a transparent
  // maskable icon renders as a black blob on several launchers.
  const files = [
    [join(publicDir, "icons", "icon-192.png"), icon192],
    [join(publicDir, "icons", "icon-512.png"), icon512],
    [join(publicDir, "icons", "icon-maskable-512.png"), maskable512],
    [join(publicDir, "icons", "apple-touch-icon.png"), appleTouch],
  ];

  const report = files.map(([path, buf]) => {
    writeFileSync(path, buf);
    return {
      file: path.replace(`${root}/`, ""),
      bytes: buf.length,
      sha256: createHash("sha256").update(buf).digest("hex"),
      signature: buf.subarray(0, 8).toString("hex"),
    };
  });
  console.log(JSON.stringify({ ok: true, generated: report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : "unknown" }));
  process.exitCode = 1;
});
