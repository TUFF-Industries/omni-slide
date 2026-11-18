import { useEffect, useState } from 'react';
import { canvasToBlob, releaseCanvas } from '../import/raster';
import { getAsset } from './db';

// Object URLs are cached for the lifetime of the page; assets are immutable once written.
const cache = new Map<string, Promise<string | null>>();
const thumbCache = new Map<string, Promise<string | null>>();

/** Long edge of a grid/deck-list thumbnail: a 480px-wide cell on a 2× screen, give or take. */
export const THUMB_PX = 640;
/** Thumbnails made at once. Each briefly decodes a full-size image (~8 MB), so keep this low. */
const THUMB_CONCURRENCY = 2;

export type AssetSize = 'full' | 'thumb';

export function assetUrl(id: string): Promise<string | null> {
  let p = cache.get(id);
  if (!p) {
    p = getAsset(id).then((b) => (b ? URL.createObjectURL(b) : null));
    cache.set(id, p);
    forgetIfMissing(cache, id, p);
  }
  return p;
}

/**
 * Don't remember "no such asset": undo can put an asset back moments after a cell asked for it
 * (assetTrash restores it asynchronously), and the cell should get it on the next try.
 */
function forgetIfMissing(
  c: Map<string, Promise<string | null>>,
  id: string,
  p: Promise<string | null>,
) {
  p.then((u) => {
    if (!u && c.get(id) === p) c.delete(id);
  });
}

let running = 0;
const waiting: (() => void)[] = [];

async function inSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= THUMB_CONCURRENCY) {
    await new Promise<void>((r) => waiting.push(r)); // the finishing task hands its slot over
  } else {
    running++;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

async function makeThumb(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  try {
    const k = THUMB_PX / Math.max(bmp.width, bmp.height);
    if (k >= 1) return blob;
    canvas.width = Math.round(bmp.width * k);
    canvas.height = Math.round(bmp.height * k);
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas, 0.85);
  } finally {
    bmp.close();
    releaseCanvas(canvas);
  }
}

/**
 * A small copy of an asset for grids and lists. Showing hundreds of slides at full size means
 * decoding gigabytes of pixels, which crashes phone browsers. Falls back to the full image if the
 * thumbnail can't be made.
 */
export function thumbUrl(id: string): Promise<string | null> {
  let p = thumbCache.get(id);
  if (!p) {
    p = inSlot(async () => {
      const blob = await getAsset(id);
      if (!blob) return null;
      return URL.createObjectURL(await makeThumb(blob));
    }).catch(() => assetUrl(id));
    thumbCache.set(id, p);
    forgetIfMissing(thumbCache, id, p);
  }
  return p;
}

export function forgetAsset(id: string): void {
  for (const c of [cache, thumbCache]) {
    const p = c.get(id);
    c.delete(id);
    p?.then((u) => u && URL.revokeObjectURL(u));
  }
}

export function useAssetUrl(id: string | undefined, size: AssetSize = 'full'): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!id) {
      setUrl(null);
      return;
    }
    (size === 'thumb' ? thumbUrl(id) : assetUrl(id)).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id, size]);
  return url;
}
