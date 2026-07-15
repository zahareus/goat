// api/telegram-auth.js — Telegram Mini App auth handler
// Uses direct Supabase REST API (no npm packages needed)

const { validateInitData } = require('../lib/telegram-initdata.js');

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const initData = req.body?.initData;
  // trim: the Vercel env value carries a trailing newline; URLs strip it, HMAC doesn't
  const validated = validateInitData(initData, (process.env.TELEGRAM_BOT_TOKEN || '').trim());

  if (!validated.ok) {
    return res.status(401).json({ error: 'invalid_init_data', reason: validated.reason });
  }

  const tgUser = validated.user;

  try {
    if (req.body?.action === 'create') {
      return res.status(200).json(await handleCreate(tgUser));
    }
    if (req.body?.action === 'link') {
      return res.status(200).json(await handleLink(tgUser, req.body?.email));
    }
    if (req.body?.action === 'code') {
      return res.status(200).json(await handleCode(tgUser, req.body?.code));
    }

    return res.status(200).json(await resolveLogin(tgUser));
  } catch (err) {
    console.error('Telegram auth error:', {
      telegram_user_id: tgUser?.id || null,
      message: err?.message || 'unexpected_error',
    });
    return res.status(500).json({ error: 'server_error' });
  }
};

function sbHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function sbAdmin(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { ...sbHeaders(), ...(opts.headers || {}) },
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) {
    const err = new Error('supabase_request_failed');
    err.status = r.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function sbAdminRaw(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    ...opts,
    headers: { ...sbHeaders(), ...(opts.headers || {}) },
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : null };
}

async function resolveLogin(tgUser) {
  const byChat = await sbAdmin(`/rest/v1/profiles?telegram_chat_id=eq.${tgUser.id}&select=id`);
  if (byChat[0]) {
    return authResponse(byChat[0].id, tgUser, false);
  }

  const synthetic = await findUserByEmail(syntheticEmail(tgUser));
  if (synthetic) {
    await sbAdmin(`/rest/v1/profiles?id=eq.${synthetic.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ telegram_chat_id: tgUser.id }),
    });
    return authResponse(synthetic.id, tgUser, false);
  }

  return { status: 'unknown' };
}

async function handleCreate(tgUser) {
  const existing = await resolveExistingUser(tgUser);
  if (existing) return authResponse(existing.id, tgUser, false);

  const created = await sbAdminRaw('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email: syntheticEmail(tgUser),
      email_confirm: true,
      user_metadata: telegramMetadata(tgUser),
    }),
  });

  let user;
  if (created.ok) {
    user = created.json;
  } else if (created.status === 422) {
    user = await findUserByEmail(syntheticEmail(tgUser));
  } else {
    const err = new Error('create_user_failed');
    err.status = created.status;
    throw err;
  }

  await patchCreatedProfile(user.id, tgUser);
  return authResponse(user.id, tgUser, true);
}

// Deliberate divergence from the bot's handleEmail: no "already linked to another
// Telegram" guard. Email ownership already equals account ownership in GOAT (web
// login is a magic link to the same inbox), and relink-via-code is the recovery
// path for a lost Telegram account.
async function handleLink(tgUser, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { status: 'no_account' };
  }

  const profiles = await sbRpc('get_profile_by_email', { lookup_email: normalized });
  const profile = profiles?.[0];
  if (!profile) return { status: 'no_account' };

  const existing = await sbAdmin(`/rest/v1/profiles?id=eq.${profile.id}&select=telegram_verify_expires`);
  if (existing[0]?.telegram_verify_expires) {
    const expires = new Date(existing[0].telegram_verify_expires);
    const sentAt = new Date(expires.getTime() - 10 * 60 * 1000);
    if (Date.now() - sentAt.getTime() < 60 * 1000) {
      return { status: 'wait' };
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sbAdmin(`/rest/v1/profiles?id=eq.${profile.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      telegram_pending_chat_id: tgUser.id,
      telegram_verify_code: code,
      telegram_verify_expires: expiresAt,
      telegram_verify_attempts: 0,
    }),
  });

  await sendVerificationEmail(normalized, code);
  return { status: 'code_sent' };
}

async function handleCode(tgUser, code) {
  const rows = await sbAdmin(
    `/rest/v1/profiles?telegram_pending_chat_id=eq.${tgUser.id}&select=id,telegram_verify_code,telegram_verify_expires,telegram_verify_attempts`
  );
  const profile = rows[0];
  if (!profile) return { status: 'expired_code' };

  if (new Date() > new Date(profile.telegram_verify_expires)) {
    await clearPending(profile.id);
    return { status: 'expired_code' };
  }

  if (profile.telegram_verify_attempts >= 3) {
    await clearPending(profile.id);
    return { status: 'expired_code' };
  }

  if (String(code || '') !== profile.telegram_verify_code) {
    const attempts = profile.telegram_verify_attempts + 1;
    await sbAdmin(`/rest/v1/profiles?id=eq.${profile.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ telegram_verify_attempts: attempts }),
    });
    return { status: 'bad_code', attempts_left: Math.max(0, 3 - attempts) };
  }

  await sbAdmin(`/rest/v1/profiles?telegram_chat_id=eq.${tgUser.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ telegram_chat_id: null }),
  });
  await sbAdmin(`/rest/v1/profiles?id=eq.${profile.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      telegram_chat_id: tgUser.id,
      telegram_pending_chat_id: null,
      telegram_verify_code: null,
      telegram_verify_expires: null,
      telegram_verify_attempts: 0,
    }),
  });

  return authResponse(profile.id, tgUser, false);
}

async function resolveExistingUser(tgUser) {
  const byChat = await sbAdmin(`/rest/v1/profiles?telegram_chat_id=eq.${tgUser.id}&select=id`);
  if (byChat[0]) return { id: byChat[0].id };
  return findUserByEmail(syntheticEmail(tgUser));
}

async function authResponse(userId, tgUser, isNew) {
  const user = await getAuthUser(userId);
  await ensureTelegramMetadata(user, tgUser);
  const email = user.email || syntheticEmail(tgUser);
  const link = await sbAdmin('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  return {
    status: 'ok',
    token_hash: link.hashed_token || link.properties?.hashed_token,
    telegram_id: tgUser.id,
    is_new: isNew,
  };
}

async function getAuthUser(id) {
  return sbAdmin(`/auth/v1/admin/users/${id}`);
}

// GoTrue /admin/users has no reliable email filter (supabase/auth#180) — an ignored
// param would return the project's FIRST user. Probe via generate_link instead:
// magiclink for a nonexistent user errors, for an existing one returns the user record.
async function findUserByEmail(email) {
  const r = await sbAdminRaw('/auth/v1/admin/generate_link', {
    method: 'POST',
    body: JSON.stringify({ type: 'magiclink', email }),
  });
  if (!r.ok) return null;
  const user = r.json?.user || r.json;
  if (!user?.id || String(user.email || '').toLowerCase() !== email.toLowerCase()) return null;
  return user;
}

async function ensureTelegramMetadata(user, tgUser) {
  if (user?.user_metadata?.telegram_id) return;
  await sbAdmin(`/auth/v1/admin/users/${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      user_metadata: { ...(user.user_metadata || {}), telegram_id: tgUser.id },
    }),
  });
}

async function patchCreatedProfile(userId, tgUser) {
  const body = {
    team_name: tgUser.username || tgUser.first_name || `Team ${tgUser.id}`,
    avatar_url: tgUser.photo_url || null,
    telegram_chat_id: tgUser.id,
  };
  let rows = await sbAdmin(`/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
  if (Array.isArray(rows) && rows.length === 0) {
    await sleep(300);
    rows = await sbAdmin(`/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }
  return rows;
}

async function clearPending(profileId) {
  await sbAdmin(`/rest/v1/profiles?id=eq.${profileId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      telegram_pending_chat_id: null,
      telegram_verify_code: null,
      telegram_verify_expires: null,
      telegram_verify_attempts: 0,
    }),
  });
}

async function sbRpc(fn, params) {
  return sbAdmin(`/rest/v1/rpc/${fn}`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

async function sendVerificationEmail(email, code) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'GOAT Fantasy <noreply@goatapp.club>',
      to: email,
      subject: `${code} — Your GOAT verification code`,
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
        <h2 style="color:#BFB294;margin-bottom:8px">⚽ GOAT Fantasy</h2>
        <p>Your Telegram verification code:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#1a1a1a;color:#BFB294;text-align:center;border-radius:4px">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:16px">This code expires in 10 minutes.<br>If you didn't request this, ignore this email.</p>
      </div>`,
    }),
  });
}

function telegramMetadata(tgUser) {
  return {
    telegram_id: tgUser.id,
    username: tgUser.username || null,
    first_name: tgUser.first_name || null,
    avatar_url: tgUser.photo_url || null,
  };
}

function syntheticEmail(tgUser) {
  return `tg${tgUser.id}@telegram.goatapp.club`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
