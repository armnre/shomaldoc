import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { convertArabic } from "arabic-reshaper";
import bidiFactory from "bidi-js";

/**
 * M12 — real Persian (RTL) PDF.
 *
 * A genuine PDF document is produced with `pdf-lib`, using the statically bundled
 * Vazirmatn TrueType font (see `assets/fonts`), visual Arabic/Persian shaping via
 * `arabic-reshaper` and the Unicode bidi algorithm via `bidi-js`. No HTML is
 * converted and no browser is involved; the text is written as real font glyphs,
 * which is why the result is searchable and copyable.
 *
 * Layout is run-based (see `visualRuns`): the line is split into Persian, Latin/digit
 * and neutral runs, the run order is reversed once for a right-to-left paragraph, and
 * Latin/digit runs are drawn character by character so the font engine cannot reverse
 * them a second time. This is what keeps "© ۱۴۰۵" and "IR-1402-000123" in the order a
 * reader expects; see `tests/unit/pdf.test.ts` and `scripts/pdf-proof.mjs`.
 */

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const LINE_HEIGHT = 20;
const TITLE_SIZE = 16;
const BODY_SIZE = 11;
const FOOTER_SIZE = 8;

/** Fixed footer strings required by the project identity rules. */
export const PDF_FOOTER = "© ۱۴۰۵ دانشگاه شمال، معاونت پژوهش و فناوری — کلیه حقوق محفوظ است.";
export const PDF_DEVELOPER = "طراحی و توسعه: پارامیس تک";

const bidi = bidiFactory();

let cachedFonts: { regular: Buffer; bold: Buffer } | null = null;

function fontPath(name: string): string {
  // Resolved from the process working directory: `next start` always runs from the
  // project root, and the fonts ship inside the release package.
  return resolve(process.cwd(), "assets", "fonts", name);
}

function loadFonts() {
  if (!cachedFonts) {
    cachedFonts = {
      regular: readFileSync(fontPath("Vazirmatn-Regular.ttf")),
      bold: readFileSync(fontPath("Vazirmatn-Bold.ttf")),
    };
  }
  return cachedFonts;
}

/**
 * Token-level RTL layout.
 *
 * The PDF content stream is always written left-to-right, so a logical Persian
 * sentence has to be reordered before it is drawn. Two rules make that reliable:
 *
 * 1. The paragraph direction comes from the Unicode bidi algorithm (`bidi-js`) with
 *    `auto` detection: a Persian line is reordered right-to-left, an English line is
 *    left as it is.
 * 2. The line is split into runs (Persian letters+ZWNJ, Latin/digits with their
 *    internal connectors, everything else neutral). The *runs* are reversed; the
 *    characters inside a run are never touched. Digits and Latin codes therefore keep
 *    their internal order (`۱۴۰۵`, `IR-1402-000123`) while Persian words stay in
 *    logical order and are joined by `arabic-reshaper`.
 *
 * Earlier versions reordered the *characters* of the whole line and then let the font
 * engine re-order again; that produced mirrored years ("۱۴۰۵" → "۵۰۴۱"). Reordering is
 * now done exactly once, here, and a unit test locks the four cases (Persian, Persian
 * with digits, mixed with a Latin code, Latin-only).
 */

// Arabic *letters* and combining marks only. The digit blocks (U+0660–U+0669,
// U+06F0–U+06F9) are deliberately excluded: they are their own class below.
const ARABIC_LETTER = /[\u0620-\u065F\u066E-\u06EF\u06FA-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const ZWNJ = /[\u200C\u200D]/;
/** Latin letters, ASCII digits and the Persian/Arabic digit blocks. */
const LTR_CHAR = /[A-Za-z0-9\u00C0-\u024F\u0660-\u0669\u06F0-\u06F9]/;
/** Characters that stay with the run they follow (codes, dates, decimals). */
const CONNECTOR = /[-/\\.,:٪%_+@#\u066B\u066C\u060C\u061B\u061F]/;
/** Paired characters that must be mirrored when the paragraph is right-to-left. */
const MIRRORED = "()[]{}<>";

export interface VisualRun {
  /** Characters in logical order; the font engine renders the run as one unit. */
  text: string;
  /** Persian run → shaped, and reversed by the font engine (right-to-left). */
  rtl: boolean;
}

type CharClass = "rtl" | "ltr" | "neutral";

function classify(char: string, previous: CharClass): CharClass {
  if (ARABIC_LETTER.test(char) || ZWNJ.test(char)) return "rtl";
  if (LTR_CHAR.test(char)) return "ltr";
  if (CONNECTOR.test(char) && previous !== "neutral") return previous;
  return "neutral";
}

/**
 * Paragraph direction of a logical line: 1 = right-to-left, 0 = left-to-right.
 * Calculated by the Unicode bidi algorithm with `auto` detection, so an English line
 * stays left-to-right and a Persian line is laid out right-to-left.
 */
export function paragraphDirection(line: string): 0 | 1 {
  const levels = bidi.getEmbeddingLevels(line, "auto");
  return levels.paragraphs.some((p) => p.level === 1) ? 1 : 0;
}

/**
 * Splits a logical line into runs in *draw order* (left to right).
 *
 * The paragraph is classified character by character into Persian (rtl), Latin/digit
 * (ltr) and neutral parts. Consecutive characters of the same non-neutral class form
 * one run; a connector (hyphen, slash, dot inside a date…) never breaks a run, so
 * `IR-1402-000123` and `۱۴۰۵/۰۷/۲۲` stay intact. Neutral characters (spaces, commas,
 * dashes, brackets, ©) stay individual tokens: when the run order is reversed they
 * are mirrored to the correct side of the neighbouring word by the same reversal.
 *
 * For a right-to-left paragraph the run order is reversed exactly once — characters
 * inside a run are never touched, which is what keeps digits and Latin codes readable.
 * Paired brackets are mirrored (UAX #9 rule L4) so a parenthetical still looks like a
 * parenthetical after the reversal.
 */
export function visualRuns(line: string): VisualRun[] {
  const runs: VisualRun[] = [];
  let previous: CharClass = "neutral";
  for (const char of line) {
    const cls = classify(char, previous);
    previous = cls;
    const last = runs[runs.length - 1];
    if (last && cls !== "neutral" && ((cls === "rtl" && last.rtl) || (cls === "ltr" && !last.rtl))) {
      last.text += char;
      continue;
    }
    runs.push({ text: char, rtl: cls === "rtl" });
  }

  if (paragraphDirection(line) === 0) return runs;

  return runs
    .slice()
    .reverse()
    .map((run) => {
      if (run.rtl) return run;
      let text = "";
      for (const char of run.text) text += mirrored(char) ?? char;
      return { ...run, text };
    });
}

/** The counterpart of a paired character, or null when it has none. */
function mirrored(char: string): string | null {
  return bidi.getMirroredCharacter(char) ?? null;
}

/**
 * Visual form of a single logical line (kept for tests and for callers that need a
 * plain string). Persian runs are shaped; other runs are left in logical order
 * because the drawing helper writes them one character at a time.
 */
export function shapeRtl(input: string): string {
  return input
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => (line.trim().length === 0 ? line : visualRuns(line).map((run) => (run.rtl ? convertArabic(run.text) : run.text)).join("")))
    .join("\n");
}

/** Width of a logical line once laid out (used for wrapping and alignment). */
function measureLine(line: string, font: PDFFont, size: number): number {
  return visualRuns(line).reduce((total, run) => total + font.widthOfTextAtSize(run.rtl ? convertArabic(run.text) : run.text, size), 0);
}

/**
 * Draws one logical line run by run, starting at `x`; returns the drawn width.
 *
 * A Persian run is shaped and drawn in a single call: the font engine lays the
 * joined glyphs out in the reverse of the given order, which is exactly the
 * right-to-left result we want. Every other run is written one character per call —
 * the engine treats the Persian digit blocks as Arabic-script text and would reverse
 * them too, and reversing a single character is a no-op.
 */
function drawLogicalLine(page: PDFPage, line: string, x: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>): number {
  let cursor = x;
  for (const run of line.length === 0 ? [] : visualRuns(line)) {
    const text = run.rtl ? convertArabic(run.text) : run.text;
    if (run.rtl) {
      page.drawText(text, { x: cursor, y, size, font, color });
      cursor += font.widthOfTextAtSize(text, size);
    } else {
      for (const char of text) {
        page.drawText(char, { x: cursor, y, size, font, color });
        cursor += font.widthOfTextAtSize(char, size);
      }
    }
  }
  return cursor - x;
}

/** Splits a logical (unshaped) paragraph into lines that fit the given width. */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (measureLine(paragraph, font, size) <= maxWidth) {
      out.push(paragraph);
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (measureLine(candidate, font, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current.length > 0) out.push(current);
        current = word;
      }
    }
    if (current.length > 0) out.push(current);
  }
  return out;
}

export interface PdfSection {
  heading?: string;
  body: string[];
}

export interface PdfDocumentInput {
  title: string;
  subtitle?: string;
  meta?: Array<{ label: string; value: string }>;
  sections: PdfSection[];
  footerNote?: string;
}

interface RenderState {
  doc: PDFDocument;
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
  y: number;
  pageNumber: number;
}

function newPage(state: Omit<RenderState, "page" | "y" | "pageNumber">): RenderState {
  const page = state.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return { ...state, page, y: PAGE_HEIGHT - MARGIN, pageNumber: (state as { pageNumber?: number }).pageNumber ?? 1 };
}

/**
 * Draws one already-shaped line. `align` decides the anchor: Persian body text is
 * right-aligned, which is what a Persian reader expects from an official document.
 */
function drawLine(state: RenderState, text: string, size: number, font: PDFFont, color = rgb(0, 0, 0), align: "right" | "left" | "center" = "right", indent = 0): void {
  const width = measureLine(text, font, size);
  const x =
    align === "right"
      ? PAGE_WIDTH - MARGIN - indent - width
      : align === "left"
        ? MARGIN + indent
        : (PAGE_WIDTH - width) / 2;
  drawLogicalLine(state.page, text, x, state.y, size, font, color);
}

function drawFooter(state: RenderState): void {
  const { page, regular } = state;
  const footerGrey = rgb(0.35, 0.35, 0.35);
  const copyrightWidth = measureLine(PDF_FOOTER, regular, FOOTER_SIZE);
  drawLogicalLine(page, PDF_FOOTER, PAGE_WIDTH - MARGIN - copyrightWidth, MARGIN - 14, FOOTER_SIZE, regular, footerGrey);
  drawLogicalLine(page, PDF_DEVELOPER, MARGIN, MARGIN - 14, FOOTER_SIZE, regular, footerGrey);
  // The page number sits on its own line below the identity footer: the copyright
  // line is long enough to reach the centre, and overlapping it would be unreadable.
  const numbers = `صفحهٔ ${state.pageNumber.toLocaleString("fa-IR")}`;
  const numbersWidth = measureLine(numbers, regular, FOOTER_SIZE);
  drawLogicalLine(page, numbers, (PAGE_WIDTH - numbersWidth) / 2, MARGIN - 26, FOOTER_SIZE, regular, footerGrey);
}

function ensureSpace(state: RenderState, needed: number): RenderState {
  if (state.y - needed > MARGIN + 24) return state;
  drawFooter(state);
  const page = state.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  return { ...state, page, y: PAGE_HEIGHT - MARGIN, pageNumber: state.pageNumber + 1 };
}

/**
 * Renders a Persian document. Every section body line is shaped and wrapped, and
 * multi-page documents keep the identity footer on each page.
 */
export async function renderPersianPdf(input: PdfDocumentInput): Promise<Uint8Array> {
  const fonts = loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fonts.regular, { subset: true });
  const bold = await doc.embedFont(fonts.bold, { subset: true });
  // An embedded Latin font is not required, but pdf-lib wants at least one standard
  // font for internal structures; keeping it does not affect the Persian glyphs.
  await doc.embedFont(StandardFonts.Helvetica);

  doc.setTitle(input.title);
  doc.setProducer("شمال‌داک — دانشگاه شمال، آمل");
  doc.setCreator("شمال‌داک");

  let state: RenderState = {
    doc,
    page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    regular,
    bold,
    y: PAGE_HEIGHT - MARGIN,
    pageNumber: 1,
  };

  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  const titleLines = wrapText(input.title, bold, TITLE_SIZE, maxWidth);
  for (const line of titleLines) {
    state = ensureSpace(state, LINE_HEIGHT);
    drawLine(state, line, TITLE_SIZE, bold, rgb(0.06, 0.09, 0.16), "center", 0);
    state.y -= LINE_HEIGHT + 4;
  }

  if (input.subtitle) {
    for (const line of wrapText(input.subtitle, regular, BODY_SIZE, maxWidth)) {
      state = ensureSpace(state, LINE_HEIGHT);
      drawLine(state, line, BODY_SIZE, regular, rgb(0.3, 0.3, 0.35), "center");
      state.y -= LINE_HEIGHT;
    }
    state.y -= 6;
  }

  for (const item of input.meta ?? []) {
    state = ensureSpace(state, LINE_HEIGHT);
    const text = `${item.label}: ${item.value}`;
    drawLine(state, text, BODY_SIZE, regular);
    state.y -= LINE_HEIGHT;
  }
  if ((input.meta ?? []).length > 0) state.y -= 6;

  for (const section of input.sections) {
    if (section.heading) {
      state = ensureSpace(state, LINE_HEIGHT + 8);
      for (const line of wrapText(section.heading, bold, BODY_SIZE + 1, maxWidth)) {
        drawLine(state, line, BODY_SIZE + 1, bold, rgb(0.1, 0.2, 0.4));
        state.y -= LINE_HEIGHT;
      }
      state.y -= 4;
    }
    for (const paragraph of section.body) {
      for (const line of wrapText(paragraph, regular, BODY_SIZE, maxWidth)) {
        state = ensureSpace(state, LINE_HEIGHT);
        drawLine(state, line, BODY_SIZE, regular, rgb(0, 0, 0));
        state.y -= LINE_HEIGHT;
      }
      state.y -= 4;
    }
    state.y -= 6;
  }

  if (input.footerNote) {
    state = ensureSpace(state, LINE_HEIGHT);
    for (const line of wrapText(input.footerNote, regular, FOOTER_SIZE + 1, maxWidth)) {
      drawLine(state, line, FOOTER_SIZE + 1, regular, rgb(0.4, 0.4, 0.4));
      state.y -= LINE_HEIGHT - 6;
    }
  }

  drawFooter(state);
  return doc.save();
}

/** Latin/ASCII-only helper kept for the acceptance test: pdf-lib's own font check. */
export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}
