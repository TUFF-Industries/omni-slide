import { expect, test } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([960, 540]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 960,
      height: 540,
      color: rgb(0.2, 0.4, (i % 10) / 10),
    });
  }
  return Buffer.from(await doc.save());
}

test('large imports: grid uses small thumbnails, present mode the full image', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-import-input').setInputFiles({
    name: 'long.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(30),
  });
  await expect(page.locator('.cell.filled')).toHaveCount(30);

  const first = page.locator('[data-cell="0,0"] img');
  await expect(first).toBeVisible();
  await expect
    .poll(() => first.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect(await first.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeLessThanOrEqual(
    640,
  );

  await page.getByRole('button', { name: '▶ Present' }).click();
  const full = page.getByTestId('current-slide').locator('img');
  await expect.poll(() => full.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1920);
});
