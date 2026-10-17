import { expect, type Locator, type Page } from '@playwright/test';

/** Date-axis scaling stays available when an embedded chart leaves wheel input to the page. */
export async function dragChartTimeAxis(page: Page, plot: Locator) {
  await plot.scrollIntoViewIfNeeded();
  await expect(plot).toHaveAttribute('data-visible-from', /^\d+$/);
  const before = (await plot.getAttribute('data-visible-from'))!;
  const box = (await plot.boundingBox())!;
  const y = box.y + box.height - 12;
  await page.mouse.move(box.x + box.width * 0.65, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 12 });
  await page.mouse.up();
  await expect(plot).not.toHaveAttribute('data-visible-from', before);
}
