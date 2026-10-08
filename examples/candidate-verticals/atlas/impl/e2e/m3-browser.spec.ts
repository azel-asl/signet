// M3 Playwright e2e: T6, T12-T14, T16 (browser-level verification).
import { test, expect } from '@playwright/test';

const T1_CASES = [
  { register: 'observed', hhmm: '17:45' },
  { register: 'observed', hhmm: '18:08' },
  { register: 'observed', hhmm: '18:20' },
  { register: 'observed', hhmm: '19:00' },
  { register: 'baseline', hhmm: '19:00' },
  { register: 'scenario', hhmm: '19:00' },
];

function tOf(hhmm: string): number {
  // World origin is 2026-10-06T00:00:00-07:00; compute seconds.
  const origin = Math.floor(new Date('2026-10-06T00:00:00-07:00').getTime() / 1000);
  const [h, m] = hhmm.split(':').map(Number);
  return origin + h * 3600 + m * 60;
}

test.describe('T12 browser binding', () => {
  for (const c of T1_CASES) {
    test(`${c.register} @ ${c.hhmm} binds to frame`, async ({ page, baseURL }) => {
      const t = tOf(c.hhmm);
      // Fetch the expected frame directly from the API.
      const frameRes = await page.request.get(`${baseURL}/api/frame?register=${c.register}&t=${t}`);
      expect(frameRes.ok()).toBe(true);
      const frame = await frameRes.json();
      // Load the UI and wait for the real initial frame to settle before
      // injecting test state (avoids racing the application's startup request).
      await page.goto(`${baseURL}/`);
      await page.waitForSelector('#floorplan[data-t]', { timeout: 30000 });
      // Use the exposed test hook to render the exact frame (deterministic).
      // For a true binding test, we drive the UI via its controls below.
      await page.evaluate(({ register, tt }) => {
        return (window as any).__testLoadFrame(register, tt);
      }, { register: c.register, tt: t });
      await page.waitForSelector(`#floorplan[data-t="${t}"][data-register="${c.register}"]`);
      // Rebuild station status/queue/in_progress from DOM data attributes.
      for (const ent of frame.entities) {
        if (ent.kind !== 'station') continue;
        const sel = `[data-entity="${ent.id}"][data-kind="station"] [data-state]`;
        const el = page.locator(sel).first();
        await expect(el).toBeAttached();
        const stateJson = await el.getAttribute('data-state');
        const domState = JSON.parse(stateJson!);
        expect(domState.status).toBe(ent.state.status);
        expect(domState.queue_len).toBe(ent.state.queue_len);
        expect(domState.in_progress_count).toBe(ent.state.in_progress_count);
      }
    });
  }
});

test.describe('T13 browser register safety', () => {
  test('banner text equals label; simulated shows watermark and hatched fills', async ({ page, baseURL }) => {
    const t1820 = tOf('18:20');
    const t1900 = tOf('19:00');
    // Observed.
    await page.goto(`${baseURL}/`);
    await page.evaluate(({ tt }) => (window as any).__testLoadFrame('observed', tt), { tt: t1820 });
    await page.waitForSelector('#floorplan[data-register="observed"]');
    const bannerObs = await page.textContent('[data-testid="banner-label"]');
    expect(bannerObs).toContain('OBSERVED HISTORY');
    expect(await page.locator('[data-testid="sim-watermark"]').count()).toBe(0);
    // Scenario (simulated).
    await page.evaluate(({ tt }) => (window as any).__testLoadFrame('scenario', tt), { tt: t1900 });
    await page.waitForSelector('#floorplan[data-register="scenario"]');
    const bannerSim = await page.textContent('[data-testid="banner-label"]');
    expect(bannerSim).toContain('SIMULATION');
    expect(bannerSim).toContain('not observed');
    expect(await page.locator('[data-testid="sim-watermark"]').count()).toBeGreaterThan(0);
    // Hatched fills on stations.
    const stationClass = await page.locator('[data-entity][data-kind="station"] rect').first().getAttribute('class');
    expect(stationClass).toContain('station-hatched');
    // Comparison panel honesty notes, no collapse control.
    const notes = await page.textContent('[data-testid="honesty-notes"]');
    expect(notes).toContain('No economic quantities are reported in M2.');
    expect(await page.locator('[data-testid="honesty-notes"] button').count()).toBe(0);
  });
});

test.describe('T6/T14 browser timeline', () => {
  test('T1 → T2 → T1 returns identical DOM; register switch clamps with notice', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/`);
    const t1 = tOf('18:20');
    const t2 = tOf('19:00');
    await page.evaluate(({ tt }) => (window as any).__testLoadFrame('observed', tt), { tt: t1 });
    await page.waitForSelector(`#floorplan[data-t="${t1}"]`);
    const dom1 = await page.locator('#floorplan').innerHTML();
    await page.evaluate(({ tt }) => (window as any).__testLoadFrame('observed', tt), { tt: t2 });
    await page.waitForSelector(`#floorplan[data-t="${t2}"]`);
    await page.evaluate(({ tt }) => (window as any).__testLoadFrame('observed', tt), { tt: t1 });
    await page.waitForSelector(`#floorplan[data-t="${t1}"]`);
    const dom1b = await page.locator('#floorplan').innerHTML();
    expect(dom1b).toBe(dom1);
    // Switch to baseline at 17:45 (outside [tB, tH]) → clamps to 18:20 with notice.
    const t1745 = tOf('17:45');
    await page.evaluate(({ tt }) => (window as any).__testSwitchRegister('baseline', tt), { tt: t1745 });
    await page.waitForSelector('#floorplan[data-register="baseline"]');
    const notice = await page.textContent('[data-testid="timeline-notice"]');
    expect(notice).toContain("time moved to the branch's range");
  });
});

test.describe('T8 poisoned frame', () => {
  test('renderer displays supplied values verbatim without recomputing', async ({ page, baseURL }) => {
    // Fetch a real frame, then poison it with inconsistent values.
    const t = tOf('18:20');
    const frameRes = await page.request.get(`${baseURL}/api/frame?register=observed&t=${t}`);
    const frame = await frameRes.json();
    // Poison: status OVERLOADED with queue_len 0, capacity.effective 99, in_progress_count 7.
    const fry = frame.entities.find((e: any) => e.id === 'st_fry');
    fry.state.status = 'OVERLOADED';
    fry.state.queue_len = 0;
    fry.state.capacity = { ...(fry.state.capacity as object), effective: 99 };
    fry.state.in_progress_count = 7;
    await page.goto(`${baseURL}/`);
    // Wait for the real initial frame to settle before injecting the poisoned
    // frame (avoids racing the application's startup request).
    await page.waitForSelector('#floorplan[data-t]', { timeout: 30000 });
    await page.evaluate((f) => (window as any).__renderFrameForTest(f), frame);
    await page.waitForSelector('#floorplan');
    const sel = `[data-entity="st_fry"][data-kind="station"] [data-state]`;
    const stateJson = await page.locator(sel).first().getAttribute('data-state');
    const domState = JSON.parse(stateJson!);
    // The DOM must show the poisoned values exactly, proving no recomputation.
    expect(domState.status).toBe('OVERLOADED');
    expect(domState.queue_len).toBe(0);
    expect(domState.in_progress_count).toBe(7);
  });
});

test.describe('T6-real: real user path', () => {
  test('A-I: clean page loads, register switch, scrub, entity inspect via real UI', async ({ page, baseURL }) => {
    // A. Open a clean-built page.
    await page.goto(`${baseURL}/`);
    // B. Verify first frame loads without injected state (no test hooks used).
    // The page auto-loads observed at initial_t via /api/world.
    await page.waitForSelector('#floorplan[data-register="observed"]', { timeout: 30000 });
    const t1 = await page.locator('#floorplan').getAttribute('data-t');
    expect(t1).toBeTruthy();
    // The banner must show the observed label.
    expect(await page.textContent('[data-testid="banner-label"]')).toContain('OBSERVED HISTORY');
    // C. Use the visible register controls: switch to scenario.
    await page.click('[data-register-btn="scenario"]');
    await page.waitForSelector('#floorplan[data-register="scenario"]', { timeout: 30000 });
    expect(await page.textContent('[data-testid="banner-label"]')).toContain('SIMULATION');
    // I. Confirm simulated watermark/banner through the real user path.
    expect(await page.locator('[data-testid="sim-watermark"]').count()).toBeGreaterThan(0);
    // D. Use the visible scrub control: move to a different T.
    const scrub = page.locator('[data-testid="scrub"]');
    const min = Number(await scrub.getAttribute('min'));
    const max = Number(await scrub.getAttribute('max'));
    const mid = Math.floor((min + max) / 2);
    await scrub.fill(String(mid));
    // The change event fires on fill; wait for the frame to update.
    await page.waitForFunction(
      (expected) => document.getElementById('floorplan')?.getAttribute('data-t') === expected,
      String(mid),
      { timeout: 30000 },
    );
    // F. Verify displayed timestamp changes.
    const tAfterScrub = await page.locator('#floorplan').getAttribute('data-t');
    expect(tAfterScrub).toBe(String(mid));
    // E. Move observed → scenario → baseline → observed via real buttons.
    await page.click('[data-register-btn="baseline"]');
    await page.waitForSelector('#floorplan[data-register="baseline"]', { timeout: 30000 });
    await page.click('[data-register-btn="observed"]');
    await page.waitForSelector('#floorplan[data-register="observed"]', { timeout: 30000 });
    // G. Select an entity using the actual UI (genuine Playwright click).
    // The click handler is on the <g>; we click the <rect> inside (which has
    // a real bounding box). The click bubbles to the <g> handler. This is a
    // genuine user click with full actionability checks — it will fail if an
    // overlay blocks it.
    await page.locator('[data-entity="st_fry"][data-kind="station"] rect').first().click();
    await page.waitForSelector('[data-testid="inspector-body"]:not(:empty)', { timeout: 30000 });
    // H. Inspect evidence using actual UI: the inspector shows evidence items.
    const inspectorText = await page.textContent('[data-testid="inspector-body"]');
    expect(inspectorText).toContain('Evidence');
  });

  test('stale inspector response does not overwrite newer selection (real UI)', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/`);
    await page.waitForSelector('#floorplan[data-register="observed"]', { timeout: 30000 });
    // Delay the /api/inspect response for station A (st_fry).
    let releaseA: (() => void) | null = null;
    const aBlocked = new Promise<void>((resolve) => { releaseA = resolve; });
    await page.route('**/api/inspect*', async (route) => {
      const url = route.request().url();
      if (url.includes('st_fry') && !url.includes('st_grill')) {
        await aBlocked;
      }
      await route.continue();
    });
    // Click station A (genuine click). Its inspector request will be delayed.
    await page.locator('[data-entity="st_fry"][data-kind="station"] rect').first().click();
    // Immediately click station B (st_grill) via genuine click. Its request is not delayed.
    await page.locator('[data-entity="st_grill"][data-kind="station"] rect').first().click();
    // B's inspector should load (not delayed).
    await page.waitForFunction(
      () => document.getElementById('inspector-head')?.textContent?.includes('st_grill'),
      { timeout: 30000 },
    );
    const headAfterB = await page.textContent('[data-testid="inspector-head"]');
    expect(headAfterB).toContain('st_grill');
    // Now release A's delayed response. It must NOT overwrite B.
    releaseA!();
    await page.waitForTimeout(1000);
    const headAfterA = await page.textContent('[data-testid="inspector-head"]');
    expect(headAfterA).toContain('st_grill');
    expect(headAfterA).not.toContain('st_fry');
  });
});

test.describe('T16 out-of-order responses', () => {
  test('delayed older response is not painted after newer', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/`);
    // Issue two loads; the first is artificially delayed via route interception.
    const t1 = tOf('18:20');
    const t2 = tOf('19:00');
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => { releaseFirst = r; });
    let firstSeen = false;
    await page.route('**/api/frame?*', async (route) => {
      const url = route.request().url();
      if (!firstSeen && url.includes(`t=${t1}`)) {
        firstSeen = true;
        await firstGate;
      }
      await route.continue();
    });
    const p1 = page.evaluate(({ tt }) => (window as any).__testLoadFrame('observed', tt), { tt: t1 });
    const p2 = page.evaluate(({ tt }) => (window as any).__testLoadFrame('observed', tt), { tt: t2 });
    await p2;
    await page.waitForSelector(`#floorplan[data-t="${t2}"]`);
    releaseFirst();
    await p1;
    // The older response must not overwrite the newer painted state.
    await page.waitForTimeout(300);
    expect(await page.locator('#floorplan').getAttribute('data-t')).toBe(String(t2));
  });
});
