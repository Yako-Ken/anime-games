import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

// Full draft with squadSize=3 on football theme: bid + pass per round,
// then match screen with score, timeline events, and MOTM.
test('football draft completes and shows minute-by-minute timeline', async ({ app, screen, browser }) => {
  await app.open('/index.html');
  await screen.getByRole('button', /كرة القدم/).click();
  await screen.getByLabel(/اسم اللاعب الأول/).fill('أحمد');
  await screen.getByLabel(/اسم اللاعب الثاني/).fill('زياد');
  await screen.getByLabel(/عدد الشخصيات/).fill('3');
  await screen.getByRole('button', /ابدأ الدرافت/).click();

  await expect(browser.locator('#auctionCounter')).toContainText('جولة 1');
  await expect(browser.locator('#auctionCounter')).toContainText('حارس');
  for (let round = 1; round <= 3; round++) {
    await browser.locator('.bid-btn[data-inc="1"]').click();
    await screen.getByRole('button', /انسحب/).click();
    if (round < 3) {
      await expect(browser.locator('#auctionCounter')).toContainText(`جولة ${round + 1}`);
    }
  }

  // runMatch fires on a 400ms setTimeout after the last pass — wait for it.
  await expect(screen.getByRole('heading', /نتيجة المباراة/)).toBeVisible();
  const score = await browser.locator('#matchScore').textContent();
  if (!score || !/^\d+ - \d+$/.test(score.trim())) throw new Error('bad score: ' + score);
  const events = await browser.locator('#timelineList li').count();
  if (events < 1) throw new Error('timeline has no events');
  await expect(browser.locator('#motmBox')).toBeVisible();
  await expect(browser.locator('#lineupGrid .lu-team')).toHaveCount(2);
  await expect(browser.locator('#statsTable .stat-row').first()).toBeVisible();
});
