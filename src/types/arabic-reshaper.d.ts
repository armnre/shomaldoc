/**
 * Minimal type declaration for `arabic-reshaper` (no bundled types upstream).
 * Only the function this project uses is declared.
 */
declare module "arabic-reshaper" {
  export function convertArabic(text: string): string;
  export function convertArabicBack(text: string): string;
}
