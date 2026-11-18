// The legacy build bundles polyfills (e.g. Map.getOrInsertComputed) that current browsers still lack.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { newId, putAsset } from '../storage/db';
import type { Progress, SlideSink } from './index';
import {
  canvasToBlob,
  MAX_FAILURES_IN_A_ROW,
  placeholderBlob,
  releaseCanvas,
  TARGET_PX,
} from './raster';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Render every page of a PDF to an image and store it, handing each new slide to `onSlide` in page
 * order as soon as it's stored. A page that fails to render becomes a placeholder slide.
 */
export async function importPdf(
  file: File,
  onSlide: SlideSink,
  onProgress?: (p: Progress) => void,
): Promise<void> {
  onProgress?.({ file: file.name, page: 0, pages: 0, unit: 'Page' });
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  // One canvas for the whole file: allocating one per page piles up canvas memory faster than the
  // browser reclaims it on long documents.
  const canvas = document.createElement('canvas');
  try {
    let doc: Awaited<typeof task.promise>;
    try {
      doc = await task.promise;
    } catch (e) {
      const locked = e instanceof Error && e.name === 'PasswordException';
      throw new Error(
        locked
          ? `${file.name} is password-protected. Save an unlocked copy and import that.`
          : `${file.name} is not a PDF or is damaged`,
        { cause: e },
      );
    }
    let failuresInARow = 0;
    let lastSize = { width: TARGET_PX, height: Math.round((TARGET_PX * 9) / 16) };
    for (let i = 1; i <= doc.numPages; i++) {
      onProgress?.({ file: file.name, page: i, pages: doc.numPages, unit: 'Page' });
      let blob: Blob;
      let size = lastSize;
      let failed = false;
      try {
        const page = await doc.getPage(i);
        try {
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({
            scale: TARGET_PX / Math.max(base.width, base.height),
          });
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          await page.render({ canvas, viewport }).promise;
          size = { width: canvas.width, height: canvas.height };
          blob = await canvasToBlob(canvas);
        } finally {
          page.cleanup();
        }
      } catch (e) {
        if (++failuresInARow >= MAX_FAILURES_IN_A_ROW) {
          const why = e instanceof Error ? e.message : String(e);
          throw new Error(`Pages ${i - failuresInARow + 1}–${i} of ${file.name} failed: ${why}`, {
            cause: e,
          });
        }
        failed = true;
        blob = await placeholderBlob(size.width, size.height, `Page ${i} could not be imported`);
      }
      if (!failed) failuresInARow = 0;
      lastSize = size;
      const assetId = newId();
      await putAsset(assetId, blob);
      await onSlide({
        id: newId(),
        kind: 'image',
        assetId,
        width: size.width,
        height: size.height,
        source: `${file.name} p${i}${failed ? ' (not imported)' : ''}`,
      });
    }
  } finally {
    releaseCanvas(canvas);
    await task.destroy();
  }
}
