import { expect, test } from '@playwright/test';

export function registerSmokeSuite({
  name,
  title,
  api,
}: {
  name: string;
  title: string;
  api: string;
}): void {
  test.describe(`${name} smoke`, () => {
    test(`serves the SPA on the ${name} origin`, async ({ page }) => {
      await page.goto('/');
      await expect(page).toHaveTitle(title);
      await expect(page.getByTestId('app-root')).toBeAttached();
    });

    test(`forwards /api to ${api} on the same origin (D11)`, async ({ request }) => {
      for (const path of ['/api', '/api/does-not-exist']) {
        const res = await request.get(path);
        expect(res.status()).toBe(404);
        expect(res.headers()['content-type']).toContain('application/json');
        expect(await res.json()).toMatchObject({
          statusCode: 404,
          error: 'Not Found',
        });
      }
    });

    test('deep links fall back to the SPA, not to a 404', async ({ page }) => {
      const res = await page.goto('/some/client/route');
      expect(res?.status()).toBe(200);
      await expect(page.getByTestId('app-root')).toBeAttached();
    });
  });
}
