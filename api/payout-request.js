// api/payout-request.js — player requests a star withdrawal
// POST /api/payout-request  { stars }  (Authorization: Bearer <supabase user token>)
// Guards: fresh @username required, balance >= stars >= 50, one active request
// per user (enforced by partial unique index). Alerts admin in Telegram.

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const MIN_WITHDRAW = 50; // Fragment/split.tg minimum

function env(name) {
  return (process.env[name] || '').trim();
}

function sbHeaders(extra) {
  return {
    'apikey': env('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'not_authenticated' });
  let userId;
  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': authHeader, 'apikey': env('SUPABASE_SERVICE_ROLE_KEY') },
    });
    if (!userResp.ok) return res.status(401).json({ error: 'invalid_token' });
    userId = (await userResp.json()).id;
  } catch (e) {
    return res.status(401).json({ error: 'auth_failed' });
  }

  try {
    const [profile] = await sbGet(`profiles?id=eq.${userId}&select=telegram_username,telegram_chat_id,is_bot`);
    if (!profile || profile.is_bot) return res.status(403).json({ error: 'forbidden' });
    if (!profile.telegram_chat_id) return res.status(400).json({ error: 'no_chat' });

    // Live username via Bot API — profiles.telegram_username refreshes only on
    // a server-side login, which cached TMA sessions skip entirely.
    let username = null;
    try {
      const chat = await fetch(`${TELEGRAM_API}${env('TELEGRAM_BOT_TOKEN')}/getChat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: profile.telegram_chat_id }),
      }).then(r => r.json());
      username = chat.ok ? chat.result.username || null : null;
    } catch (e) { /* fall through to no_username */ }
    if (!username) return res.status(400).json({ error: 'no_username' });
    if (username !== profile.telegram_username) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: sbHeaders({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ telegram_username: username }),
      }).catch(() => {});
    }

    const [ledger, active] = await Promise.all([
      sbGet(`prize_ledger?user_id=eq.${userId}&select=stars`),
      sbGet(`payouts?user_id=eq.${userId}&status=in.(requested,processing,expired)&select=stars`),
    ]);
    const balance = ledger.reduce((s, r) => s + r.stars, 0) - active.reduce((s, r) => s + r.stars, 0);

    const stars = parseInt(req.body?.stars, 10);
    if (!Number.isInteger(stars) || stars < MIN_WITHDRAW) return res.status(400).json({ error: 'below_minimum', min: MIN_WITHDRAW });
    if (stars > balance) return res.status(400).json({ error: 'insufficient_balance', balance });

    const insert = await fetch(`${SUPABASE_URL}/rest/v1/payouts`, {
      method: 'POST',
      headers: sbHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        user_id: userId,
        stars,
        username_snapshot: username,
        telegram_chat_id: profile.telegram_chat_id,
      }),
    });
    if (insert.status === 409) return res.status(409).json({ error: 'already_active' });
    if (!insert.ok) throw new Error(`insert ${insert.status}: ${await insert.text()}`);
    const [payout] = await insert.json();

    const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';
    await fetch(`${TELEGRAM_API}${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: adminChat,
        text: `💸 <b>Заявка на вивід</b>\n@${username} просить <b>${stars} ⭐</b> (баланс ${balance})\nID: <code>${payout.id}</code>`,
        parse_mode: 'HTML',
      }),
    });

    return res.status(200).json({ ok: true, id: payout.id, stars, status: payout.status });
  } catch (err) {
    console.error('payout-request error:', err);
    return res.status(500).json({ error: 'server_error' });
  }
};

async function sbGet(pathQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathQuery}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`select ${r.status}`);
  return r.json();
}
