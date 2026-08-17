// api/invite-prepare.js — bot-composed invite for Telegram's native shareMessage picker
// POST /api/invite-prepare  (Authorization: Bearer <supabase user token>)
// t.me/share/url can only carry flat text AND on some clients the mini-app window
// stays on top of the "Forward to…" sheet, hiding the chat list. savePreparedInlineMessage
// + WebApp.shareMessage (Bot API 8.0) is the sanctioned path: rich HTML, proper picker.

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const APP_URL = 'https://t.me/goatsoccergame_bot/goat';

function env(name) {
  return (process.env[name] || '').trim();
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
    const profResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=team_name,telegram_chat_id`,
      { headers: { 'apikey': env('SUPABASE_SERVICE_ROLE_KEY'), 'Authorization': `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}` } }
    );
    const [profile] = await profResp.json();
    // The prepared message can only be shared by the user it was made for
    if (!profile || !profile.telegram_chat_id) return res.status(409).json({ error: 'no_telegram' });

    const text =
      `\u{1F410} <b>GOAT</b> — pick the best player of every Premier League match\n\n` +
      `<b>${escapeHtml(profile.team_name || 'A friend')}</b> invites you to the game.\n\n` +
      `One tap per match — the player with the highest BPS is the GOAT. ` +
      `Most GOATs wins the gameweek.\n\n` +
      `⭐ <b>Top-5 of every gameweek win Telegram Stars</b> — 50⭐ for #1, paid straight to your account\n` +
      `\u{1F4F1} Free, runs right inside Telegram\n\n` +
      `\u{1F449} <a href="${APP_URL}">Join the game</a>`;

    const tgResp = await fetch(`${TELEGRAM_API}${env('TELEGRAM_BOT_TOKEN')}/savePreparedInlineMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: profile.telegram_chat_id,
        allow_user_chats: true, allow_group_chats: true, allow_channel_chats: true,
        result: {
          type: 'article',
          id: 'goat-invite',
          title: 'Join GOAT',
          description: 'Pick the best player of every PL match — win Telegram Stars',
          input_message_content: {
            message_text: text,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
          },
        },
      }),
    }).then(r => r.json()).catch(() => null);

    if (!tgResp || !tgResp.ok || !tgResp.result || !tgResp.result.id) {
      return res.status(502).json({ error: 'prepare_failed' });
    }
    return res.status(200).json({ ok: true, id: tgResp.result.id });
  } catch (e) {
    console.error('invite-prepare error');
    return res.status(500).json({ error: 'internal' });
  }
};
