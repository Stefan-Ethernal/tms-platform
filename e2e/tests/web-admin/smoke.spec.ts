import { expect, test } from '@playwright/test';

test.describe('web-admin smoke', () => {
  test('serves the SPA on the admin origin', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('TMS Admin');
    await expect(page.getByTestId('app-root')).toBeAttached();
  });

  test('forwards /api to api-admin on the same origin (D11)', async ({ request }) => {
    const res = await request.get('/api/does-not-exist');
    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });

  test('deep links fall back to the SPA, not to a 404', async ({ page }) => {
    const res = await page.goto('/some/client/route');
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId('app-root')).toBeAttached();
  });
});
