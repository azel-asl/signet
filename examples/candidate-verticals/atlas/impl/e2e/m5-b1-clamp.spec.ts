// ATLAS M5 B1: C6 clamp regression — real-server test at 19:25.
// Proves the inspector clamps horizon_t to range.max_t and renders the
// valid recommendation instead of UNKNOWN/BOUND_EXCEEDED.
import { test, expect } from '@playwright/test';

test.describe('B1 C6 clamp at world end', () => {
  test('19:25 inspector clamps horizon and renders recommendation', async ({ page }) => {
    // 19:25 in canonical world: t=1791339900, range.max_t=1791343800.
    // Unclamped: t+4200=1791344100 > max_t → BOUND_EXCEEDED → UNKNOWN.
    // Clamped: horizon_t=1791343800 → 200 → ranked recommendation.
    await page.goto('http://127.0.0.1:8123/?register=observed');
    await page.waitForSelector('[data-testid="floorplan"]', { timeout: 10000 });

    // Track the recommendation request to verify it doesn't exceed max_t.
    let requestedHorizon: number | null = null;
    let requestedT: number | null = null;
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/recommendations?')) {
        const u = new URL(url);
        requestedHorizon = Number(u.searchParams.get('horizon_t'));
        requestedT = Number(u.searchParams.get('t'));
      }
    });

    // Navigate to 19:25 (t=1791339900) via the scrub control.
    await page.evaluate(() => {
      const scrub = document.getElementById('scrub') as HTMLInputElement;
      scrub.value = '1791339900';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Wait for the frame at the new time to load.
    await page.waitForFunction(
      () => document.getElementById('time-readout')?.textContent?.includes('1791339900'),
      { timeout: 10000 },
    );

    const fry = page.locator('[data-entity="st_fry"]').first();
    await fry.click({ timeout: 10000 });

    // Panel should render the recommendation (not an error).
    const recLines = page.locator('[data-testid="recommendation-lines"]');
    await expect(recLines).toBeVisible({ timeout: 15000 });

    // Must not show UNKNOWN error.
    const errMsg = page.locator('[data-testid="recommendations-error"]');
    await expect(errMsg).toHaveCount(0);

    // Verify the request was for t=1791339900 and clamped to range.max_t.
    expect(requestedT).toBe(1791339900);
    expect(requestedHorizon).not.toBeNull();
    expect(requestedHorizon!).toBeLessThanOrEqual(1791343800);
    // The unclamped value would be t+4200=1791344100.
    expect(requestedHorizon!).not.toBe(1791344100);
    expect(requestedHorizon!).toBe(1791343800);

    // Verify the panel rendered recommendation lines (request returned 200).
    const lineCount = await recLines.locator('li').count();
    expect(lineCount).toBeGreaterThan(0);
  });
});
