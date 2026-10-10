import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('deal boxes start and show the box grid', async ({ app, screen, browser }) => {
  await app.open('/deal.html');
  await screen.getByRole('button', /ابدأ اللعبة/).click();
  await expect(browser.locator('#dealStage .box-btn').first()).toBeVisible();
  await browser.locator('#dealStage .box-btn').first().click();
  await expect(browser.locator('#dealStage .reveal-panel')).toBeVisible();
});

test('packs challenge builds packs and opens one', async ({ app, screen, browser }) => {
  await app.open('/packs.html');
  await screen.getByRole('button', /ابدأ/).click();
  await expect(browser.locator('#packsGrid .pack-card')).toHaveCount(3);
});
