import { dirname } from 'path';
import { pathToFileURL } from 'url';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
// pdfjs-dist ships ES modules only; load it at runtime without TypeScript rewriting import() into require().
const esm = new Function('s', 'return import(s)') as (s: string) => Promise<PdfJs>;
let mod: Promise<PdfJs> | null = null;

/** pdf.js legacy (Node) build, loaded once per process. */
export const pdfjs = () => (mod ??= esm(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href));
/** Bundled metrics for the 14 standard fonts (better glyph widths when fonts are not embedded). */
export const standardFontDataUrl = () => `${dirname(require.resolve('pdfjs-dist/package.json')).replace(/\\/g, '/')}/standard_fonts/`;
