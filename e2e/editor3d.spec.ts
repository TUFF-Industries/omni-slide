import { expect, test, type Locator, type Page } from '@playwright/test';
import { PDFDocument, rgb } from 'pdf-lib';

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([960, 540]);
    page.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.25 * i, 0.3, 0.5) });
  }
  return Buffer.from(await doc.save());
}

const plate = (page: Page, z: number) => page.getByTestId(`plate-${z}`);
const center = async (l: Locator) => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

test('3D editor: arrange slides across layers in a 3D view', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('home-import-input').setInputFiles({
    name: 'deck.pdf',
    mimeType: 'application/pdf',
    buffer: await makePdf(3),
  });
  await expect(page.locator('.cell.filled')).toHaveCount(3);
  const p2 = (await page.locator('[data-cell="1,0"]').getAttribute('data-slide'))!;
  const p3 = (await page.locator('[data-cell="2,0"]').getAttribute('data-slide'))!;

  await page.getByRole('button', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('grid3d')).toBeVisible();
  await expect(plate(page, 0).locator('.cell.filled')).toHaveCount(3);
  await expect(plate(page, 1)).toHaveCount(0);

  // Drag p3 onto the "New layer" plane that appears behind while dragging, right behind p1.
  const from = await center(plate(page, 0).locator('[data-cell="2,0"]'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 20, { steps: 3 });
  await expect(plate(page, 1)).toContainText('New layer');
  const to = await center(plate(page, 1).locator('[data-cell="0,0"]'));
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect(plate(page, 1).locator('[data-cell="0,0"]')).toHaveAttribute('data-slide', p3);
  await expect(plate(page, 1)).toContainText('Layer 2');

  // Keyboard works in 3D too: select p2 and push it back a layer.
  await plate(page, 0).locator('[data-cell="1,0"]').click();
  await expect(plate(page, 0).locator('[data-cell="1,0"]')).toHaveClass(/selected/);
  await page.keyboard.press('Shift+Z');
  await expect(plate(page, 1).locator('[data-cell="1,0"]')).toHaveAttribute('data-slide', p2);

  // Orbiting by dragging empty space turns the view and keeps the selection.
  const scene = page.locator('.grid3d-scene');
  const before = await scene.evaluate((el) => el.style.transform);
  const box = (await page.getByTestId('grid3d').boundingBox())!;
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 90, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => scene.evaluate((el) => el.style.transform)).not.toBe(before);
  await expect(page.locator('.cell.selected')).toHaveCount(1);

  // The choice of view is remembered.
  await page.reload();
  await expect(page.getByTestId('grid3d')).toBeVisible();
  await expect(page.getByRole('button', { name: '3D', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Back in 2D, layer 2 has p3 and p2 behind p1 and the gap they left.
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await page.getByRole('tab', { name: '2', exact: true }).click();
  await expect(page.locator('[data-cell="0,0"]')).toHaveAttribute('data-slide', p3);
  await expect(page.locator('[data-cell="1,0"]')).toHaveAttribute('data-slide', p2);

  // Double-click in 3D presents from that slide.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await plate(page, 1).locator('[data-cell="0,0"]').dblclick();
  await expect(page.getByTestId('current-slide')).toHaveAttribute('data-source', 'deck.pdf p3');
});
