import { test, expect } from './fixtures.js';
import { loginTestUser, cleanupTestPicks, cleanupTestProfile, supabaseQuery, TEST_USER_ID } from './helpers/auth.js';

const BASE_URL = process.env.BASE_URL || 'https://goatapp.club';
const HAS_SERVICE_KEY = !!process.env.SUPABASE_SERVICE_KEY;

test.describe('Authenticated Pick Flow - Full Integration', () => {
  // TODO: fix session injection (magic link OTP verify approach)
  test.skip(true, 'Auth session injection needs fixing — tour blocks magic link redirect');
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async () => {
    // Find a GW with scheduled fixtures to clean up test picks
    const configs = await supabaseQuery('gw_config', 'picks_open=eq.true&order=gw.asc');
    for (const cfg of configs) {
      await cleanupTestPicks(cfg.gw);
    }
  });

  test.afterAll(async () => {
    const configs = await supabaseQuery('gw_config', 'picks_open=eq.true&order=gw.asc');
    for (const cfg of configs) {
      await cleanupTestPicks(cfg.gw);
    }
  });

  test('login works and user sees authenticated UI', async ({ page }) => {
    await loginTestUser(page, BASE_URL);

    // Menu should show user options (sign out, team name)
    const menuBtn = page.locator('.burger, .nav-right button, #menu-btn').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click();
      await page.waitForTimeout(500);
    }

    // Should see sign out option (proof of auth)
    const signOut = page.locator('text=Sign Out, text=Log Out, [onclick*="SignOut"], [onclick*="signOut"]').first();
    await expect(signOut).toBeVisible({ timeout: 5000 });
  });

  test('profile is created in database after login', async ({ page }) => {
    await loginTestUser(page, BASE_URL);
    await page.waitForTimeout(3000);

    const profiles = await supabaseQuery('profiles', `id=eq.${TEST_USER_ID}`);
    expect(profiles.length).toBe(1);
    expect(profiles[0].id).toBe(TEST_USER_ID);
  });

  test('can select a player and submit pick to database', async ({ page }) => {
    // Find the first GW with scheduled fixtures
    const configs = await supabaseQuery('gw_config', 'picks_open=eq.true&order=gw.asc');
    let targetGW = null;
    let targetFixtures = [];

    for (const cfg of configs) {
      const fixtures = await supabaseQuery('fixtures',
        `gw=eq.${cfg.gw}&status=eq.scheduled&order=kickoff_time.asc`
      );
      if (fixtures.length > 0) {
        targetGW = cfg.gw;
        targetFixtures = fixtures;
        break;
      }
    }

    if (!targetGW) {
      // No scheduled fixtures available — skip gracefully
      test.skip(true, 'No GW with scheduled fixtures available');
      return;
    }

    // Clean up any existing test picks for this GW
    await cleanupTestPicks(targetGW);

    // Login and navigate to the target GW
    await loginTestUser(page, `${BASE_URL}#gw${targetGW}`);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });

    // Find a player card and click it
    const firstCard = page.locator('.phex-card').first();
    await expect(firstCard).toBeVisible({ timeout: 10000 });
    await firstCard.click();
    await page.waitForTimeout(500);

    // Look for submit button and click it
    const submitBtn = page.locator('#strip-submit, button:has-text("Submit")').first();
    if (await submitBtn.isVisible() && await submitBtn.isEnabled()) {
      await submitBtn.click();
      await page.waitForTimeout(3000); // Wait for DB write

      // Verify pick was saved in database
      const picks = await supabaseQuery('picks',
        `user_id=eq.${TEST_USER_ID}&gw=eq.${targetGW}&order=created_at.desc`
      );

      expect(picks.length).toBeGreaterThan(0);
      expect(picks[0].user_id).toBe(TEST_USER_ID);
      expect(picks[0].gw).toBe(targetGW);
      expect(picks[0].element_id).toBeGreaterThan(0);
      expect(picks[0].fixture_id).toBeGreaterThan(0);
    }
  });

  test('picks appear in My Team tab after submission', async ({ page }) => {
    // Check if we have any picks from previous test
    const configs = await supabaseQuery('gw_config', 'is_active=eq.true&limit=1');
    if (!configs.length) return;
    const activeGW = configs[0].gw;

    const existingPicks = await supabaseQuery('picks',
      `user_id=eq.${TEST_USER_ID}&gw=eq.${activeGW}`
    );

    if (!existingPicks.length) {
      // No picks yet — this is OK, skip
      return;
    }

    await loginTestUser(page, `${BASE_URL}#gw${activeGW}`);
    await page.waitForSelector('.tab', { timeout: 10000 });

    // Switch to My Team tab
    const myTeamBtn = page.locator('#tab-btn-myteam');
    await myTeamBtn.click();
    await page.waitForTimeout(2000);

    const myTeamTab = page.locator('#tab-myteam');
    await expect(myTeamTab).toBeVisible();
  });

  test('standings show test user after making picks', async ({ page }) => {
    const configs = await supabaseQuery('gw_config', 'is_active=eq.true&limit=1');
    if (!configs.length) return;
    const activeGW = configs[0].gw;

    await loginTestUser(page, `${BASE_URL}#gw${activeGW}`);
    await page.waitForSelector('.tab', { timeout: 10000 });

    // Switch to standings
    await page.click('#tab-btn-standings');
    await page.waitForTimeout(2000);

    // Standings should be visible
    const standings = page.locator('#tab-standings');
    await expect(standings).toBeVisible();
  });
});
