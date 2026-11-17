/** Long edge of an imported slide image, in pixels. */
export const TARGET_PX = 1920;

/** Encode a canvas as WebP, or PNG where the browser can't encode WebP. */
export async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const webp = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', 0.92));
  if (webp && webp.type === 'image/webp') return webp;
  const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!png) throw new Error('Could not encode slide image');
  return png;
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
  ctx.drawImage(img, 0, 0, pxWidth, pxHeight);
  return canvasToBlob(canvas);
}
