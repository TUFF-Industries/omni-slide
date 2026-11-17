import { parse } from 'pptxtojson';
import type { Slide } from '../model/types';
import { deleteAsset, newId, putAsset } from '../storage/db';
import type { Progress } from './index';
import { esc, slideToHtml, type SlideSize } from './pptxHtml';
import { rasterizeXhtml, TARGET_PX } from './raster';

/** CSS pixels per point. */
const PX_PER_PT = 96 / 72;

/** Characters XML 1.0 forbids. Text pasted from Word/Excel can carry them (e.g. U+000B). */
// eslint-disable-next-line no-control-regex
const XML_ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/**
 * Serialize slide HTML as XHTML, which SVG's foreignObject requires. Parsing happens in a document
 * with no browsing context, so nothing in the file's markup can run or load while we do this.
 */
function toXhtml(html: string): string {
  const doc = document.implementation.createHTMLDocument('');
  doc.body.innerHTML = html.replace(XML_ILLEGAL, '');
  const root = doc.body.firstElementChild;
  if (!root) throw new Error('Could not lay out slide');
  return new XMLSerializer().serializeToString(root);
}

/** Stand-in for a slide that failed to render, so the deck keeps its shape and the gap is visible. */
function failedSlideHtml(size: SlideSize, n: number): string {
  return (
    `<div style="width:${size.width}pt;height:${size.height}pt;background:#f4f4f4;color:#666;` +
    `display:flex;align-items:center;justify-content:center;font:24pt sans-serif">` +
    `Slide ${esc(n)} could not be imported</div>`
  );
}

/** Render every slide of a .pptx to an image, store it, and return the new slides in order. */
export async function importPptx(file: File, onProgress?: (p: Progress) => void): Promise<Slide[]> {
  onProgress?.({ file: file.name, page: 0, pages: 0, unit: 'Slide' });
  let parsed: Awaited<ReturnType<typeof parse>>;
  try {
    parsed = await parse(await file.arrayBuffer(), {
      imageMode: 'base64',
      videoMode: 'none',
      audioMode: 'none',
    });
  } catch {
    throw new Error(`${file.name} is not a PowerPoint (.pptx) file or is damaged`);
  }
  const { slides: pptSlides, size } = parsed;
  if (!(size?.width > 0 && size?.height > 0)) throw new Error(`${file.name} has no slide size`);

  const cssW = size.width * PX_PER_PT;
  const cssH = size.height * PX_PER_PT;
  const scale = TARGET_PX / Math.max(cssW, cssH);
  const pxW = Math.round(cssW * scale);
  const pxH = Math.round(cssH * scale);
  const render = (html: string) => rasterizeXhtml(toXhtml(html), cssW, pxW, pxH);

  const slides: Slide[] = [];
  try {
    for (let i = 0; i < pptSlides.length; i++) {
      onProgress?.({ file: file.name, page: i + 1, pages: pptSlides.length, unit: 'Slide' });
      let blob: Blob;
      let failed = false;
      try {
        blob = await render(slideToHtml(pptSlides[i], size));
      } catch {
        failed = true;
        blob = await render(failedSlideHtml(size, i + 1));
      }
      const assetId = newId();
      await putAsset(assetId, blob);
      slides.push({
        id: newId(),
        kind: 'image',
        assetId,
        width: pxW,
        height: pxH,
        source: `${file.name} s${i + 1}${failed ? ' (not imported)' : ''}`,
      });
    }
  } catch (e) {
    // Nothing references these images yet, so don't leave them behind in IndexedDB.
    await Promise.allSettled(slides.map((s) => deleteAsset(s.assetId)));
    throw e;
  }
  return slides;
}
