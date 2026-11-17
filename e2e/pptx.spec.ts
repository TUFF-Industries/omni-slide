import { deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import PptxGenJS from 'pptxgenjs';

/** A solid-color PNG, so the test can embed a picture without fixture files. */
function solidPng(size: number, [r, g, b]: [number, number, number]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(size).fill([r, g, b]).flat())]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `image/png;base64,${png.toString('base64')}`;
}

/** 16:9 deck (10 × 5.625 in): a blue slide with a red ellipse and a green picture, then a white one. */
async function makePptx(): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  const s1 = pptx.addSlide();
  s1.background = { color: '1E3A8A' };
  s1.addText('Hello PPTX', {
    x: 0.5,
    y: 0.3,
    w: 9,
    h: 1.2,
    fontSize: 44,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
  });
  s1.addShape(pptx.ShapeType.ellipse, { x: 4, y: 3, w: 2, h: 1.5, fill: { color: 'FF0000' } });
  s1.addImage({ data: solidPng(8, [0, 200, 0]), x: 8, y: 3.5, w: 1.5, h: 1.5 });
  const s2 = pptx.addSlide();
  s2.addText(
    [
      { text: 'Bullet one', options: { bullet: true } },
      { text: 'Bullet two', options: { bullet: true } },
    ],
    { x: 1, y: 1, w: 8, h: 3, fontSize: 24 },
  );
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

/** RGB of the presented slide image at a point given as fractions of its width and height. */
async function pixelAt(page: Page, fx: number, fy: number): Promise<number[]> {
  const img = page.getByTestId('current-slide').locator('img');
  await expect(img).toBeVisible();
  return img.evaluate(
    async (el: HTMLImageElement, [x, y]) => {
      await el.decode();
      const c = document.createElement('canvas');
      c.width = el.naturalWidth;
      c.height = el.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(el, 0, 0);
      const d = ctx.getImageData(Math.floor(x * c.width), Math.floor(y * c.height), 1, 1).data;
      return [d[0], d[1], d[2]];
    },
    [fx, fy],
  );
}

function expectNear(actual: number[], expected: number[]) {
  actual.forEach((v, i) => expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(12));
}

test('import a PPTX: each slide becomes an image slide in a new row', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-import-input').setInputFiles({
    name: 'talk.pptx',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: await makePptx(),
  });
  await expect(page.getByLabel('Deck name')).toHaveValue('talk');
  await expect(page.locator('.cell.filled')).toHaveCount(2);
  await expect(page.locator('.cell.filled img')).toHaveCount(2);

  await page.getByRole('button', { name: '▶ Present' }).click();
  await expect(page.getByTestId('current-slide')).toHaveAttribute('data-source', 'talk.pptx s1');
  expectNear(await pixelAt(page, 0.02, 0.98), [0x1e, 0x3a, 0x8a]); // background
  expectNear(await pixelAt(page, 0.5, 0.667), [255, 0, 0]); // ellipse center
  expectNear(await pixelAt(page, 0.875, 0.8), [0, 200, 0]); // picture center

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('current-slide')).toHaveAttribute('data-source', 'talk.pptx s2');
  expectNear(await pixelAt(page, 0.02, 0.02), [255, 255, 255]);
});

test('PPTX import adds a row to an existing deck; old .ppt files get an explanation', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'New deck' }).click();
  const input = page.getByTestId('import-input');

  await input.setInputFiles({
    name: 'old.ppt',
    mimeType: 'application/vnd.ms-powerpoint',
    buffer: Buffer.from('x'),
  });
  await expect(page.locator('.error')).toContainText("old.ppt isn't supported");

  await input.setInputFiles({ name: 'a.pptx', mimeType: '', buffer: await makePptx() });
  await expect(page.locator('.cell.filled')).toHaveCount(2);
  await input.setInputFiles({ name: 'b.pptx', mimeType: '', buffer: await makePptx() });
  await expect(page.locator('.cell.filled')).toHaveCount(4);
  await expect(page.locator('[data-cell="0,1"]')).toHaveClass(/filled/);

  await input.setInputFiles({ name: 'broken.pptx', mimeType: '', buffer: Buffer.from('nope') });
  await expect(page.locator('.error')).toContainText('broken.pptx is not a PowerPoint');
  await expect(page.locator('.cell.filled')).toHaveCount(4);
});
