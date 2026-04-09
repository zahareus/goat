import { test, expect, gotoWithoutTour } from './fixtures.js';

const BASE_URL = process.env.BASE_URL || 'https://goatapp.club';

test.describe('GW Navigation & Historical Data', () => {
  test('can navigate to historical GW via hash', async ({ page }) => {
    await gotoWithoutTour(page, `${BASE_URL}#gw30`);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    const gwTitle = page.locator('#pick-gw-title');
    const text = await gwTitle.textContent();
    expect(text).toMatch(/30|GW/);
  });

  test('historical GW shows match results with BPS', async ({ page }) => {
    await gotoWithoutTour(page, `${BASE_URL}#gw30`);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    // Should have match blocks with player data
    const matches = page.locator('.match-block');
    const count = await matches.count();
    expect(count).toBeGreaterThan(0);

    // Player cards should be visible
    const playerCards = page.locator('.phex-card');
    expect(await playerCards.count()).toBeGreaterThan(0);
  });

  test('standings tab shows rankings for historical GW', async ({ page }) => {
    await gotoWithoutTour(page, `${BASE_URL}#gw30`);
    // Wait for data to fully load (GW data + standings)
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => switchTab('standings'));
    await page.waitForTimeout(3000);

    const standingsTab = page.locator('#tab-standings');
    await expect(standingsTab).toBeVisible({ timeout: 5000 });

    const text = await standingsTab.textContent();
    expect(text.length).toBeGreaterThan(10);
  });

  test('GW prev/next arrows navigate between gameweeks', async ({ page }) => {
    await gotoWithoutTour(page, `${BASE_URL}#gw30`);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    const gwTitle = page.locator('#pick-gw-title');
    const initialText = await gwTitle.textContent();

    // Click next GW
    const nextBtn = page.locator('#gw-next, .nav-arrow-right, [onclick*="nextGW"]').first();
    if (await nextBtn.isVisible() && await nextBtn.isEnabled()) {
      await nextBtn.click();
      await page.waitForTimeout(2000);

      const newText = await gwTitle.textContent();
      expect(newText).not.toBe(initialText);
    }
  });

  test('My Team tab shows picks for historical GW', async ({ page }) => {
    await gotoWithoutTour(page, `${BASE_URL}#gw30`);
    await page.waitForSelector('.tab', { timeout: 10000 });

    const myTeamBtn = page.locator('#tab-btn-myteam');
    if (await myTeamBtn.isVisible()) {
      await myTeamBtn.click();
      await page.waitForTimeout(1500);

      const myTeamTab = page.locator('#tab-myteam');
      await expect(myTeamTab).toBeVisible();
    }
  });

  test('Live tab exists and is accessible', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.tab', { timeout: 10000 });

    const liveBtn = page.locator('#tab-btn-live');
    if (await liveBtn.isVisible()) {
      await liveBtn.click();
      await page.waitForTimeout(1000);

      const liveTab = page.locator('#tab-live');
      await expect(liveTab).toBeVisible();
    }
  });

  test('current active GW loads by default', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    const gwTitle = page.locator('#pick-gw-title');
    const text = await gwTitle.textContent();
    // Should contain a GW number (28-40 range for current season)
    expect(text).toMatch(/\d+/);
  });
});
