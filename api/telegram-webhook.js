// api/telegram-webhook.js — Telegram bot webhook handler
// Handles: /start, email input, code verification, /status, /unlink, /help
// Uses direct Supabase REST API (no npm packages needed)

const TELEGRAM_API = 'https://api.telegram.org/bot';
const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret;
  if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const message = req.body?.message;
  if (!message || !message.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    if (text === '/start') {
      await handleStart(chatId);
    } else if (text === '/status') {
      await handleStatus(chatId);
    } else if (text === '/unlink') {
      await handleUnlink(chatId);
    } else if (text === '/help') {
      await handleHelp(chatId);
    } else if (text.includes('@')) {
      await handleEmail(chatId, text.toLowerCase());
    } else if (/^\d{6}$/.test(text)) {
      await handleCode(chatId, text);
    } else {
      await send(chatId, '🤔 I don\'t understand. Type /help for commands.');
    }
  } catch (err) {
    console.error('Telegram webhook error:', err);
    await send(chatId, '⚠️ Something went wrong. Try again later.');
  }

  return res.status(200).json({ ok: true });
};

// === Supabase REST helpers ===

function sbHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: sbHeaders(),
  });
  return r.json();
}

async function sbUpdate(table, query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sbRpc(fn, params) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(params),
  });
  return r.json();
}

// === Command Handlers ===

async function handleStart(chatId) {
  const rows = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id,team_name`);
  if (rows.length > 0) {
    await send(chatId,
      `✅ You're already linked as *${esc(rows[0].team_name || 'Unknown')}*.\n\nUse /status to check or /unlink to disconnect.`,
      'Markdown'
    );
    return;
  }

  await send(chatId,
    '⚽ *Welcome to GOAT Fantasy Bot\\!*\n\n'
    + 'Get alerts about deadlines, lineups, and results\\.\n\n'
    + '📧 Enter your GOAT email to link your account:',
    'MarkdownV2'
  );
}

async function handleEmail(chatId, email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await send(chatId, '❌ Invalid email format. Try again.');
    return;
  }

  // Check if this chat is already linked
  const linked = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id`);
  if (linked.length > 0) {
    await send(chatId, '✅ You\'re already linked! Use /unlink first to switch accounts.');
    return;
  }

  // Look up profile by email
  const profiles = await sbRpc('get_profile_by_email', { lookup_email: email });
  const profile = profiles?.[0];

  if (!profile) {
    await send(chatId, '❌ No GOAT account found with this email.\nMake sure you\'ve signed in at goatapp.club first.');
    return;
  }

  if (profile.telegram_chat_id) {
    await send(chatId, '⚠️ This account is already linked to another Telegram. Unlink it from the GOAT profile first.');
    return;
  }

  // Rate limit: check if code was sent less than 60s ago
  const existing = await sbSelect('profiles', `id=eq.${profile.id}&select=telegram_verify_expires`);
  if (existing[0]?.telegram_verify_expires) {
    const expires = new Date(existing[0].telegram_verify_expires);
    const sentAt = new Date(expires.getTime() - 10 * 60 * 1000);
    if (Date.now() - sentAt.getTime() < 60 * 1000) {
      await send(chatId, '⏳ Code already sent. Wait a minute before requesting a new one.');
      return;
    }
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sbUpdate('profiles', `id=eq.${profile.id}`, {
    telegram_pending_chat_id: chatId,
    telegram_verify_code: code,
    telegram_verify_expires: expiresAt,
    telegram_verify_attempts: 0,
  });

  await sendVerificationEmail(email, code);

  const masked = maskEmail(email);
  await send(chatId, `📨 Verification code sent to ${masked}\n\nEnter the 6-digit code. Valid for 10 minutes.`);
}

async function handleCode(chatId, code) {
  const rows = await sbSelect('profiles',
    `telegram_pending_chat_id=eq.${chatId}&select=id,telegram_verify_code,telegram_verify_expires,telegram_verify_attempts`
  );
  const profile = rows[0];

  if (!profile) {
    await send(chatId, '❌ No pending verification. Send your email first.');
    return;
  }

  // Check expiry
  if (new Date() > new Date(profile.telegram_verify_expires)) {
    await sbUpdate('profiles', `id=eq.${profile.id}`, {
      telegram_pending_chat_id: null, telegram_verify_code: null,
      telegram_verify_expires: null, telegram_verify_attempts: 0,
    });
    await send(chatId, '⏰ Code expired. Send your email again to get a new one.');
    return;
  }

  // Check attempts
  if (profile.telegram_verify_attempts >= 3) {
    await sbUpdate('profiles', `id=eq.${profile.id}`, {
      telegram_pending_chat_id: null, telegram_verify_code: null,
      telegram_verify_expires: null, telegram_verify_attempts: 0,
    });
    await send(chatId, '🚫 Too many attempts. Send your email again to get a new code.');
    return;
  }

  // Verify code
  if (code !== profile.telegram_verify_code) {
    const left = 2 - profile.telegram_verify_attempts;
    await sbUpdate('profiles', `id=eq.${profile.id}`, {
      telegram_verify_attempts: profile.telegram_verify_attempts + 1,
    });
    await send(chatId, `❌ Wrong code. ${left} attempt${left === 1 ? '' : 's'} left.`);
    return;
  }

  // Success — link account
  await sbUpdate('profiles', `id=eq.${profile.id}`, {
    telegram_chat_id: chatId,
    telegram_pending_chat_id: null, telegram_verify_code: null,
    telegram_verify_expires: null, telegram_verify_attempts: 0,
  });

  await send(chatId,
    '🎉 Account linked!\n\n'
    + 'You\'ll receive notifications about:\n'
    + '• ⏰ Pick deadlines\n'
    + '• 🔄 Lineup changes\n'
    + '• 🏆 Gameweek results\n\n'
    + 'Use /status to check or /unlink to disconnect.'
  );
}

async function handleStatus(chatId) {
  const rows = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=team_name`);
  if (rows.length > 0) {
    await send(chatId, `✅ Linked\nTeam: ${rows[0].team_name || '—'}\n\nUse /unlink to disconnect.`);
  } else {
    const pending = await sbSelect('profiles', `telegram_pending_chat_id=eq.${chatId}&select=id`);
    if (pending.length > 0) {
      await send(chatId, '⏳ Verification in progress. Enter your 6-digit code.');
    } else {
      await send(chatId, '❌ Not linked. Send your GOAT email to connect.');
    }
  }
}

async function handleUnlink(chatId) {
  const rows = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id`);
  if (rows.length === 0) {
    await send(chatId, '❌ Not linked. Nothing to disconnect.');
    return;
  }

  await sbUpdate('profiles', `id=eq.${rows[0].id}`, { telegram_chat_id: null });
  await send(chatId, '🔓 Telegram unlinked. You won\'t receive notifications anymore.\n\nSend your email to link again.');
}

async function handleHelp(chatId) {
  await send(chatId,
    '⚽ GOAT Fantasy Bot\n\n'
    + 'Commands:\n'
    + '/start — Link your GOAT account\n'
    + '/status — Check link status\n'
    + '/unlink — Disconnect Telegram\n'
    + '/help — Show this message\n\n'
    + '🌐 goatapp.club'
  );
}

// === Helpers ===

async function send(chatId, text, parseMode) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return local[0] + '***@' + domain;
  return local[0] + '***' + local[local.length - 1] + '@' + domain;
}

function esc(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}
