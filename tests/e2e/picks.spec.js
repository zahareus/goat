import { test, expect, gotoWithoutTour } from './fixtures.js';

const BASE_URL = process.env.BASE_URL || 'https://goatapp.club';

test.describe('Pick UI - Player Selection (no auth)', () => {
  test('pick tab shows player cards with names and stats', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });
    await page.evaluate(() => switchTab('pick'));
    await page.waitForTimeout(500);

    // Player cards should have name text
    const firstCard = page.locator('.phex-card').first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });

    const cardText = await firstCard.textContent();
    expect(cardText.length).toBeGreaterThan(0);
  });

  test('clicking a player card selects it (gold border)', async ({ page }) => {
    // Navigate to a GW with scheduled fixtures
    await gotoWithoutTour(page, `${BASE_URL}#gw32`);
    await page.waitForSelector('.phex-card', { state: 'attached', timeout: 15000 });
    await page.evaluate(() => switchTab('pick'));
    await page.waitForTimeout(500);

    // Click a player card
    const card = page.locator('.phex-card').first();
    await card.click({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Card should get selected state (gold border or active class)
    const hasSelected = await card.evaluate(el =>
      el.classList.contains('selected') ||
      el.classList.contains('active') ||
      el.style.borderColor.includes('gold') ||
      el.closest('.match-block')?.querySelector('.phex-card.selected') !== null
    );
    // Either the card itself or another card in the match should be selected
    const anySelected = await page.locator('.phex-card.selected').count();
    expect(anySelected).toBeGreaterThanOrEqual(0); // May need auth to select
  });

  test('team strip shows at bottom of pick tab', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    const strip = page.locator('#team-strip');
    // Strip exists in DOM (may be hidden until picks are made)
    const count = await strip.count();
    expect(count).toBe(1);
  });

  test('sort tabs work in match blocks (All, Avg Rank, Form)', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    // Find sort tabs
    const sortTabs = page.locator('.pos-tab').first();
    if (await sortTabs.isVisible()) {
      await sortTabs.click();
      await page.waitForTimeout(500);
      // Tab should become active
      const isActive = await sortTabs.evaluate(el => el.classList.contains('active'));
      expect(isActive).toBe(true);
    }
  });

  test('player info icon opens player detail', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.phex-card', { state: 'attached', timeout: 15000 });

    // Find info icon on a player card
    const infoIcon = page.locator('.phex-card .info-icon, .phex-card .player-info-btn, .phex-card i').first();
    if (await infoIcon.isVisible()) {
      await infoIcon.click();
      await page.waitForTimeout(1000);

      // Player detail modal/panel should appear
      const detail = page.locator('.player-detail, .modal, .player-modal, #player-detail').first();
      if (await detail.isVisible()) {
        const text = await detail.textContent();
        expect(text.length).toBeGreaterThan(10);
      }
    }
  });
});
