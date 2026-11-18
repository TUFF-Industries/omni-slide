/** Long edge of an imported slide image, in pixels. */
export const TARGET_PX = 1920;

const JPEG_QUALITY = 0.9;

/**
 * A page that fails to render becomes a placeholder, but this many failures in a row means the
 * browser itself is struggling (usually out of memory), so the import stops and says why instead
 * of quietly filling the deck with placeholders.
 */
export const MAX_FAILURES_IN_A_ROW = 3;

/**
 * Encode a canvas as WebP, or JPEG where the browser can't encode WebP (Safari). PNG would be the
 * lossless choice, but for a full-page slide it is 5–10× larger, which adds up fast in big decks.
 */
export async function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', quality));
  if (webp && webp.type === 'image/webp') return webp;
  // JPEG has no alpha: put a white page under anything transparent, as a slide would have.
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }
  const jpeg = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', JPEG_QUALITY));
  if (!jpeg) throw new Error('Could not encode slide image (the browser may be out of memory)');
  return jpeg;
}

/**
 * Free a canvas's pixel memory now rather than whenever it's garbage collected. iOS Safari caps the
 * total memory of live canvases, so a long import that leaves them to GC fails part-way through.
 */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Rasterize an HTML fragment (already serialized as XHTML) laid out at `cssWidth`×`cssHeight` CSS
 * pixels, scaled so the image is `pxWidth`×`pxHeight`. The markup is drawn as an SVG image, which
 * the browser renders without running scripts or fetching anything, so embedded images must be
 * data URLs.
 */
export async function rasterizeXhtml(
  xhtml: string,
  cssWidth: number,
  pxWidth: number,
  pxHeight: number,
): Promise<Blob> {
  const k = pxWidth / cssWidth;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxWidth}" height="${pxHeight}">` +
    `<foreignObject x="0" y="0" width="${pxWidth}" height="${pxHeight}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" style="transform:scale(${k});transform-origin:0 0">` +
    `${xhtml}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = pxWidth;
  canvas.height = pxHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  try {
    ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
    return await canvasToBlob(canvas);
  } finally {
    releaseCanvas(canvas);
  }
}

/** Grey stand-in image for a page or slide that failed to render, so the gap is visible. */
export async function placeholderBlob(width: number, height: number, text: string): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');
  try {
    ctx.fillStyle = '#f4f4f4';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#666';
    ctx.font = `${Math.round(height / 20)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2, width * 0.9);
    return await canvasToBlob(canvas);
  } finally {
    releaseCanvas(canvas);
  }
}
