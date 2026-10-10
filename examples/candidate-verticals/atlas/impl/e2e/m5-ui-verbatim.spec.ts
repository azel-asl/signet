// ATLAS M5 T-UI-VERBATIM (CCR-006 §5, BLOCKER 3).
// Uses route interception with controlled API responses.
import { test, expect } from '@playwright/test';

test.describe('T-UI-VERBATIM with route interception', () => {
  test('verbatim in-order rendering', async ({ page }) => {
    const mockLines = [
      { candidate_id: 'c1', text: 'First line from server.', claim_class: 'derived' },
      { candidate_id: 'c1', text: 'Second line from server.', claim_class: 'simulated' },
      { candidate_id: null, text: 'Advisory only. ATLAS does not execute or authorise this change.', claim_class: 'derived' },
    ];
    await page.route('**/api/recommendations*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ set: { candidates: [], top: { kind: 'no_action' } }, lines: mockLines }),
      });
    });
    await page.goto('http://127.0.0.1:8123/?register=observed&t=1791336000');
    await page.waitForSelector('[data-testid="floorplan"]', { timeout: 10000 });
    const fry = page.locator('[data-entity="st_fry"]').first();
    await fry.click({ timeout: 10000 });
    const recLines = page.locator('[data-testid="recommendation-lines"]');
    await expect(recLines).toBeVisible({ timeout: 15000 });
    const items = recLines.locator('li');
    await expect(items).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const text = await items.nth(i).textContent();
      expect(text?.startsWith(mockLines[i].text)).toBe(true);
    }
  });

  test('markup poison rendered as literal text', async ({ page }) => {
    const poisoned = '<img src=x onerror=alert(1)> harmless marker';
    await page.route('**/api/recommendations*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          set: { candidates: [], top: { kind: 'no_action' } },
          lines: [{ candidate_id: 'c1', text: poisoned, claim_class: 'derived' }],
        }),
      });
    });
    await page.goto('http://127.0.0.1:8123/?register=observed&t=1791336000');
    await page.waitForSelector('[data-testid="floorplan"]', { timeout: 10000 });
    const fry = page.locator('[data-entity="st_fry"]').first();
    await fry.click({ timeout: 10000 });
    const recLines = page.locator('[data-testid="recommendation-lines"]');
    await expect(recLines).toBeVisible({ timeout: 15000 });
    // Literal text appears.
    await expect(recLines).toContainText('<img src=x onerror=alert(1)>');
    // No img element was created.
    const imgs = recLines.locator('img');
    await expect(imgs).toHaveCount(0);
  });

  test('non-200 shows exact error text', async ({ page }) => {
    await page.route('**/api/recommendations*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INTERNAL', message: 'test error' }),
      });
    });
    await page.goto('http://127.0.0.1:8123/?register=observed&t=1791336000');
    await page.waitForSelector('[data-testid="floorplan"]', { timeout: 10000 });
    const fry = page.locator('[data-entity="st_fry"]').first();
    await fry.click({ timeout: 10000 });
    const errMsg = page.locator('[data-testid="recommendations-error"]');
    await expect(errMsg).toBeVisible({ timeout: 15000 });
    await expect(errMsg).toHaveText('Recommendations unavailable: INTERNAL');
  });
});
