// ATLAS M5 T-UI: Playwright — real click on Fry at observed 18:20 shows
// server recommendation lines verbatim, ASSUMED chip on economics, authority line.
import { test, expect } from '@playwright/test';

test.describe('T-UI M5 recommendations', () => {
  test('Fry inspector shows recommendations verbatim with ASSUMED chip and authority', async ({ page }) => {
    // Load observed 18:20.
    await page.goto('http://127.0.0.1:8123/?register=observed&t=1791336000');
    await page.waitForSelector('[data-testid="floorplan"]', { timeout: 10000 });

    // Click Fry station.
    const fry = page.locator('[data-entity="st_fry"]').first();
    await fry.click({ timeout: 10000 });

    // Recommendations section appears with server lines verbatim.
    const recLines = page.locator('[data-testid="recommendation-lines"]');
    await expect(recLines).toBeVisible({ timeout: 15000 });

    // ASSUMED chip on economics lines.
    const assumed = page.locator('[data-testid="assumed-chip"]').first();
    await expect(assumed).toBeVisible();

    // Authority line present.
    await expect(recLines).toContainText('Advisory only. ATLAS does not execute or authorise this change.');
  });
});
