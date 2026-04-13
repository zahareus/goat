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

const SUPABASE_ANON_KEY = 'sb_publishable_PU7gbL0MVSaVhI4WPodRxg_xA0-LG6e';

export async function loginTestUser(page, targetUrl) {
  const session = await getSessionToken();
  if (!session?.access_token) throw new Error('Failed to obtain session token');

  const urlObj = new URL(targetUrl || 'https://goatapp.club');
  urlObj.searchParams.set('notour', '1');

  await page.goto(urlObj.toString(), { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.setItem('goat_tour_done', 'true'));

  // Use Supabase client to set session — it writes localStorage in the exact format app expects
  await page.evaluate(async ({ url, key, sess }) => {
    const client = window.supabase.createClient(url, key);
    await client.auth.setSession({
      access_token: sess.access_token,
      refresh_token: sess.refresh_token,
    });
  }, { url: SUPABASE_URL, key: SUPABASE_ANON_KEY, sess: session });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

export async function getSessionToken() {
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
