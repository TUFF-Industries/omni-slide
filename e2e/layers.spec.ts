import { expect, test, type Page } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([960, 540]);
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.2 * i, 0.3, 0.5) });
  }
  return Buffer.from(await doc.save());
}

const cell = (page: Page, x: number, y: number) => page.locator(`[data-cell="${x},${y}"]`);
const current = (page: Page) => page.getByTestId('current-slide');
const tab = (page: Page, n: number) => page.getByRole('tab', { name: String(n), exact: true });

test('layers: put a slide behind another, then dive in and out while presenting', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('home-import-input').setInputFiles({
    name: 'deep.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(3),
  });
  await expect(page.locator('.cell.filled')).toHaveCount(3);
  await expect(tab(page, 1)).toHaveAttribute('aria-selected', 'true');
  const p2 = (await cell(page, 1, 0).getAttribute('data-slide'))!;

  // Push p2 one layer back, then slide it left so it sits right behind p1.
  await cell(page, 1, 0).click();
  await page.keyboard.press('Shift+Z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '1');
  await expect(tab(page, 2)).toHaveAttribute('aria-selected', 'true');
  await expect(cell(page, 1, 0)).toHaveAttribute('data-slide', p2);
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(cell(page, 0, 0)).toHaveAttribute('data-slide', p2);
  // On layer 2, empty cells show the slide in front of them faintly (p3 at column 3).
  await expect(cell(page, 2, 0).locator('.cell-ghost')).toHaveCount(1);

  // Deselecting stays on this layer; the front layer shows p1 with "1 behind".
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '1');
  await tab(page, 1).click();
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '0');
  await expect(cell(page, 0, 0).getByTestId('depth-badge')).toHaveText('⧉ 1');
  await expect(page.locator('.cell.filled')).toHaveCount(2);
  // Z / X flip layers when nothing is selected.
  await page.keyboard.press('z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '1');
  await page.keyboard.press('x');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '0');

  // Present: Z dives behind p1 to p2, X comes back out.
  await page.getByRole('button', { name: '▶ Present' }).click();
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p1');
  await expect(page.getByTestId('layer-pill')).toHaveText('Layer 1 of 2');
  await page.keyboard.press('z');
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p2');
  await expect(page.getByTestId('layer-pill')).toHaveText('Layer 2 of 2');
  await page.keyboard.press('ArrowRight'); // nothing to the right on layer 2
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p2');
  await page.keyboard.press('x');
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p1');
  await page.getByRole('button', { name: 'Go in' }).click();
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p2');

  // M flies out to the 3D overview of every layer; clicking a slide flies into it.
  await page.keyboard.press('x');
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p1');
  await page.keyboard.press('m');
  await expect(page.getByTestId('overview')).toBeVisible();
  await expect(page.locator('.ov-tile')).toHaveCount(3);
  await page.getByRole('button', { name: 'Go to slide at column 1, row 1, layer 2' }).click();
  await expect(page.getByTestId('overview')).toBeHidden();
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p2');
  // Esc closes the overview but stays in present mode.
  await page.keyboard.press('m');
  await expect(page.getByTestId('overview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overview')).toBeHidden();
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p2');

  // The layer survives a reload (it's in the URL) and the deck in storage.
  await page.reload();
  await expect(current(page)).toHaveAttribute('data-source', 'deep.pdf p2');
});

test('deleting the only slide on the last layer goes back to a real layer', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-import-input').setInputFiles({
    name: 'two.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(2),
  });
  await expect(page.locator('.cell.filled')).toHaveCount(2);
  await cell(page, 1, 0).click();
  await page.keyboard.press('Shift+Z');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '1');
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('grid')).toHaveAttribute('data-layer', '0');
  await expect(page.locator('.cell.filled')).toHaveCount(1);
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('3D overview: dragging turns the camera without picking a slide', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-import-input').setInputFiles({
    name: 'three.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(3),
  });
  await expect(page.locator('.cell.filled')).toHaveCount(3);
  await page.getByRole('button', { name: '▶ Present' }).click();
  await expect(current(page)).toHaveAttribute('data-source', 'three.pdf p1');
  await page.getByRole('button', { name: 'Overview' }).click();
  const scene = page.locator('.ov-scene');
  await expect(page.getByTestId('overview')).toBeVisible();
  // Let the fly-out finish, then drag starting on a slide.
  await page.waitForTimeout(800);
  const before = await scene.evaluate((el) => el.style.transform);
  const tile = (await page.getByRole('button', { name: /column 2, row 1/ }).boundingBox())!;
  await page.mouse.move(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await page.mouse.down();
  await page.mouse.move(tile.x + tile.width / 2 + 150, tile.y + tile.height / 2 + 40, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.getByTestId('overview')).toBeVisible(); // the drag didn't pick slide 2
  expect(await scene.evaluate((el) => el.style.transform)).not.toBe(before);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('overview')).toBeHidden();
  await expect(current(page)).toHaveAttribute('data-source', 'three.pdf p1');
});
