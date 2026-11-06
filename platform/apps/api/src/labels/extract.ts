import type { PageText } from '../../../../packages/labels/src';
import { pdfjs, standardFontDataUrl } from './engine/pdfjs';

/** Text layer of every page (positions in PDF user space), used to find labels and invoices. */
export async function extractPages(data: Uint8Array): Promise<PageText[]> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: new Uint8Array(data), verbosity: 0, disableFontFace: true, useWorkerFetch: false, standardFontDataUrl: standardFontDataUrl() });
  const doc = await task.promise;
  const pages: PageText[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      const tc = await page.getTextContent();
      pages.push({
        width: x1 - x0, height: y1 - y0,
        items: tc.items.flatMap((it) => ('str' in it && it.str.trim() ? [{ str: it.str, x: it.transform[4] - x0, y: it.transform[5] - y0, w: it.width, h: it.height, rotated: Math.abs(it.transform[1]) > 0.01 }] : [])),
      });
      page.cleanup();
    }
  } finally { await task.destroy(); }
  return pages;
}
