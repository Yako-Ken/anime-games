import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('theme select shows 3 worlds and football lands on draft', async ({ app, screen, browser }) => {
  await app.open('/index.html');
  await expect(screen.getByRole('button', { name: /عالم الأنمي/ })).toBeVisible();
  await expect(screen.getByRole('button', { name: /موبايل ليجند/ })).toBeVisible();
  await expect(screen.getByRole('button', { name: /كرة القدم/ })).toBeVisible();
  await screen.getByRole('button', { name: /كرة القدم/ }).click();
  await expect(browser).toHaveURL(/draft\.html/);
  await expect(screen.getByRole('button', { name: /ابدأ الدرافت/ })).toBeVisible();
});
