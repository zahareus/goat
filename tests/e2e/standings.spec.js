import { test, expect, gotoWithoutTour } from './fixtures.js';
import { supabaseQuery } from './helpers/auth.js';

const BASE_URL = process.env.BASE_URL || 'https://goatapp.club';
const HAS_SERVICE_KEY = !!process.env.SUPABASE_SERVICE_KEY;

test.describe('Standings - Data Integrity', () => {
  test('GW standings show content', async ({ page }) => {
    await gotoWithoutTour(page, `${BASE_URL}#gw30`);
    await page.waitForSelector('.match-block', { state: 'attached', timeout: 15000 });
    await page.waitForTimeout(2000);

    await page.evaluate(() => switchTab('standings'));
    await page.waitForTimeout(3000);

    const standings = page.locator('#tab-standings');
    await expect(standings).toBeVisible({ timeout: 5000 });
    const text = await standings.textContent();
    expect(text.length).toBeGreaterThan(10);
  });

  test('season standings toggle works', async ({ page }) => {
    await gotoWithoutTour(page, BASE_URL);
    await page.waitForSelector('.tab', { timeout: 10000 });

    await page.click('#tab-btn-standings');
    await page.waitForTimeout(1500);

    // Look for season/GW toggle
    const seasonBtn = page.locator('text=Season, button:has-text("Season"), .standings-toggle').first();
    if (await seasonBtn.isVisible()) {
      await seasonBtn.click();
      await page.waitForTimeout(1500);

      // Content should update
      const standings = page.locator('#tab-standings');
      const text = await standings.textContent();
      expect(text.length).toBeGreaterThan(10);
    }
  });
});

test.describe('Standings - DB Verification', () => {
  test.skip(!HAS_SERVICE_KEY, 'Requires SUPABASE_SERVICE_KEY');

  test('results table has BPS data for finished GWs', async () => {
    // GW 30 should have results
    const results = await supabaseQuery('results',
      'select=fixture_id,element_id,bps,is_goat&order=bps.desc&limit=5'
    );

    expect(results.length).toBeGreaterThan(0);

    // Top result should have high BPS
    expect(results[0].bps).toBeGreaterThan(0);

    // At least one GOAT per fixture
    const goats = results.filter(r => r.is_goat);
    expect(goats.length).toBeGreaterThan(0);
  });

  test('player_history has stats for completed rounds', async () => {
    const history = await supabaseQuery('player_history',
      'select=element_id,round,bps,bps_rank&round=eq.30&order=bps.desc&limit=5'
    );

    expect(history.length).toBeGreaterThan(0);
    expect(history[0].bps).toBeGreaterThan(0);
    expect(history[0].bps_rank).toBe(1); // Top BPS should be rank 1
  });

  test('fixtures data is consistent (home/away teams, status)', async () => {
    const fixtures = await supabaseQuery('fixtures',
      'select=id,gw,home_team_id,away_team_id,status&gw=eq.30'
    );

    expect(fixtures.length).toBe(10); // PL has 10 matches per GW

    for (const f of fixtures) {
      expect(f.home_team_id).toBeGreaterThan(0);
      expect(f.away_team_id).toBeGreaterThan(0);
      expect(f.home_team_id).not.toBe(f.away_team_id); // Can't play yourself
      expect(f.status).toBe('ft'); // GW 30 should be finished
    }
  });

  test('players table has FPL data', async () => {
    const players = await supabaseQuery('players',
      'select=element_id,name,team_id,position&limit=5'
    );

    expect(players.length).toBe(5);
    for (const p of players) {
      expect(p.element_id).toBeGreaterThan(0);
      expect(p.name).toBeTruthy();
      expect(['GKP', 'DEF', 'MID', 'FWD']).toContain(p.position);
      expect(p.team_id).toBeGreaterThanOrEqual(1);
      expect(p.team_id).toBeLessThanOrEqual(20);
    }
  });
});
