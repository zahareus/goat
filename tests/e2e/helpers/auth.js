// GOAT test authentication helper
// Same approach as StickerHunt: magic link via Supabase Admin API

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TEST_EMAIL = 'test-automation@goatapp.club';
const TEST_USER_ID = '57c9416b-7f6a-4a0a-aac2-eca3f3c92fad';

export { TEST_EMAIL, TEST_USER_ID, SUPABASE_URL };

export async function generateMagicLink() {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY env var required');

  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL }),
  });

  const data = await resp.json();
  if (!data.action_link) throw new Error(`Magic link failed: ${JSON.stringify(data)}`);
  return data.action_link;
}

export async function loginTestUser(page, targetUrl) {
  // First, go to the site and set tour flag to prevent overlay
  const urlObj = new URL(targetUrl || 'https://goatapp.club');
  urlObj.searchParams.set('notour', '1');
  await page.goto(urlObj.toString());
  await page.evaluate(() => localStorage.setItem('goat_tour_done', 'true'));

  // Now get a session via magic link API (without visiting the link in browser)
  // Use the OTP approach: generate link, extract token, verify via API
  const session = await getSessionToken();
  if (session) {
    // Inject Supabase session into localStorage
    await page.evaluate((sess) => {
      const storageKey = `sb-zanssnurnzdqwaxuadge-auth-token`;
      localStorage.setItem(storageKey, JSON.stringify(sess));
    }, session);

    // Reload to pick up the session
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
  }
}

async function getSessionToken() {
  if (!SERVICE_KEY) return null;

  // Generate a magic link and extract the OTP
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', email: TEST_EMAIL }),
  });
  const linkData = await resp.json();
  const otp = linkData.email_otp;

  if (!otp) return null;

  // Verify the OTP to get a session
  const verifyResp = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'magiclink', token: otp, email: TEST_EMAIL }),
  });

  const session = await verifyResp.json();
  return session;
}

export async function cleanupTestPicks(gw) {
  if (!SERVICE_KEY) return;
  const q = gw
    ? `user_id=eq.${TEST_USER_ID}&gw=eq.${gw}`
    : `user_id=eq.${TEST_USER_ID}`;
  await fetch(`${SUPABASE_URL}/rest/v1/picks?${q}`, {
    method: 'DELETE',
    headers: sbHeaders(),
  });
}

export async function cleanupTestProfile() {
  if (!SERVICE_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${TEST_USER_ID}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({ team_name: 'TestBot FC' }),
  });
}

export async function supabaseQuery(table, query) {
  if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY required');
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: sbHeaders(),
  });
  return resp.json();
}

function sbHeaders() {
  return {
    'apikey': SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };
}
