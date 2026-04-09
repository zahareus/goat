// @ts-check
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://goatapp.club';

test.describe('GOAT Smoke Tests', () => {
  test('homepage loads with correct title', async ({ page }) => {
    await page.goto(BASE_URL);
    await expect(page).toHaveTitle(/GOAT/i);
  });

  test('main navigation tabs are visible', async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for app to initialize
    await page.waitForSelector('.tab', { timeout: 10000 });

    const tabs = page.locator('.tab');
    await expect(tabs).not.toHaveCount(0);
  });

  test('pick tab shows match blocks after load', async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait for fixtures to load
    await page.waitForSelector('.match-block', { timeout: 15000 });

    const matches = page.locator('.match-block');
    await expect(matches).not.toHaveCount(0);
  });

  test('standings tab displays leaderboard', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab', { timeout: 10000 });

    // Click standings tab
    await page.click('#tab-btn-standings');
    await page.waitForSelector('#tab-standings.active', { timeout: 5000 });

    // Should have standings content
    const standings = page.locator('#tab-standings');
    await expect(standings).toBeVisible();
  });

  test('auth modal opens on sign-in click', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.tab', { timeout: 10000 });

    // Look for sign-in button in menu or header
    const menuBtn = page.locator('.burger, .nav-right button, #menu-btn').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      // Wait a bit for menu animation
      await page.waitForTimeout(300);
    }

    const signInBtn = page.locator('text=Sign In, text=Log In, #auth-btn, [onclick*="showAuthModal"]').first();
    if (await signInBtn.isVisible()) {
      await signInBtn.click();
      await expect(page.locator('#auth-modal')).toBeVisible();
    }
  });

  test('GW navigation arrows work', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.match-block', { timeout: 15000 });

    // Get current GW title
    const gwTitle = page.locator('#pick-gw-title');
    const initialText = await gwTitle.textContent();

    // Click prev arrow if exists
    const prevBtn = page.locator('#gw-prev, .nav-arrow-left, [onclick*="prevGW"]').first();
    if (await prevBtn.isVisible() && await prevBtn.isEnabled()) {
      await prevBtn.click();
      await page.waitForTimeout(1000);
      const newText = await gwTitle.textContent();
      expect(newText).not.toBe(initialText);
    }
  });

  test('player cards show in match blocks', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('.match-block', { timeout: 15000 });

    const playerCards = page.locator('.phex-card');
    await expect(playerCards).not.toHaveCount(0);
  });

  test('no console errors on page load', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto(BASE_URL);
    await page.waitForSelector('.tab', { timeout: 10000 });

    // Filter out known acceptable errors (like ad blockers, external scripts)
    const criticalErrors = errors.filter(e =>
      !e.includes('favicon') &&
      !e.includes('ERR_BLOCKED') &&
      !e.includes('posthog') &&
      !e.includes('analytics')
    );

    expect(criticalErrors).toEqual([]);
  });

  test('CSS and JS resources load successfully', async ({ page }) => {
    const failedResources = [];
    page.on('response', response => {
      if (response.status() >= 400) {
        const url = response.url();
        if (url.includes('app.js') || url.includes('style.css')) {
          failedResources.push(`${url}: ${response.status()}`);
        }
      }
    });

    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    expect(failedResources).toEqual([]);
  });
});
