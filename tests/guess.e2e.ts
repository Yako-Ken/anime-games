import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('guess game reveals hard hints and ends a round', async ({ app, screen, browser }) => {
  await app.open('/guess.html');
  await screen.getByLabel(/اسم اللاعب الأول/).fill('أحمد');
  await screen.getByLabel(/اسم اللاعب الثاني/).fill('زياد');
  await screen.getByRole('button', /ابدأ اللعبة/).click();

  await expect(browser.locator('#hintsList .hint-row')).toHaveCount(1);
  await screen.getByRole('button', /الهينت الجاي/).click();
  await expect(browser.locator('#hintsList .hint-row')).toHaveCount(2);
  await screen.getByRole('button', /محدش عرف/).click();
  const name = await browser.locator('#revealName').textContent();
  if (!name || !name.trim()) throw new Error('reveal name empty');
  await screen.getByRole('button', /الجولة الجاية/).click();
  await expect(browser.locator('#hintsList .hint-row')).toHaveCount(1);
});
