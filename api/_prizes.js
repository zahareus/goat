// api/_prizes.js — prize admin logic shared by bot-admin.js (underscore files
// are not deployed as Vercel functions). All calls run under the admin gard.

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const SPLIT_API = 'https://api.split.tg';

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

async function sbSelectAll(table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: sbHeaders({ Range: `${from}-${from + 999}` }),
    });
    if (!r.ok) throw new Error(`select ${table} ${r.status}`);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function sbWrite(method, table, query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method,
    headers: sbHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${await r.text()}`);
  return r.json();
}

async function tg(method, body) {
  const r = await fetch(`${TELEGRAM_API}${env('TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function split(path, body) {
  const r = await fetch(`${SPLIT_API}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Authorization': `Bearer ${env('SPLIT_API_TOKEN')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || (json && json.ok === false)) {
    throw new Error(`split ${path}: ${r.status} ${json && json.error_message ? json.error_message : ''}`);
  }
  return json ? json.message : null;
}

async function balances() {
  const [ledger, payouts, profiles] = await Promise.all([
    sbSelectAll('prize_ledger', 'select=user_id,season,gw,type,stars'),
    sbSelectAll('payouts', 'select=id,user_id,stars,status,username_snapshot,invoice_url,invoice_expires_at,created_at&order=created_at.desc'),
    sbSelectAll('profiles', 'select=id,team_name,is_bot,telegram_username'),
  ]);
  const bal = {};
  for (const r of ledger) bal[r.user_id] = (bal[r.user_id] || 0) + r.stars;
  for (const p of payouts) {
    if (p.status === 'requested' || p.status === 'processing') bal[p.user_id] = (bal[p.user_id] || 0) - p.stars;
  }
  return { ledger, payouts, profiles, bal };
}

// === Actions ===

async function prizesSummary() {
  const { ledger, payouts, profiles, bal } = await balances();
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));

  const accrued = ledger.filter(r => r.type !== 'withdrawal').reduce((s, r) => s + r.stars, 0);
  const withdrawn = -ledger.filter(r => r.type === 'withdrawal').reduce((s, r) => s + r.stars, 0);
  const onBalances = Object.values(bal).reduce((s, v) => s + Math.max(0, v), 0);
  const botStars = Object.entries(bal)
    .filter(([uid]) => profileMap[uid] && profileMap[uid].is_bot)
    .reduce((s, [, v]) => s + Math.max(0, v), 0);

  const balanceRows = Object.entries(bal)
    .filter(([, v]) => v !== 0)
    .map(([uid, v]) => ({
      user_id: uid,
      team_name: profileMap[uid] ? profileMap[uid].team_name : '?',
      username: profileMap[uid] ? profileMap[uid].telegram_username : null,
      is_bot: !!(profileMap[uid] && profileMap[uid].is_bot),
      balance: v,
    }))
    .sort((a, b) => b.balance - a.balance);

  const queue = payouts
    .filter(p => p.status === 'requested' || p.status === 'processing')
    .map(p => ({
      ...p,
      team_name: profileMap[p.user_id] ? profileMap[p.user_id].team_name : '?',
    }));

  return {
    summary: { accrued, withdrawn, on_balances: onBalances, bot_stars: botStars, usd_spent: +(withdrawn * 0.0159).toFixed(2) },
    balances: balanceRows,
    queue,
    recent: payouts.slice(0, 10),
  };
}

async function payoutPreview(id) {
  const [p] = await sbSelectAll('payouts', `id=eq.${id}&select=*`);
  if (!p) throw new Error('payout not found');

  const chat = await tg('getChat', { chat_id: p.telegram_chat_id });
  const currentUsername = chat.ok ? chat.result.username || null : null;
  const usernameMatch = !!currentUsername && currentUsername === p.username_snapshot;

  let recipient = null;
  try {
    recipient = await split('/recipients/stars', { username: p.username_snapshot });
  } catch (e) {
    recipient = { error: e.message };
  }

  const { bal } = await balances();
  // available for THIS payout = balance with its own reservation added back
  const available = (bal[p.user_id] || 0) + p.stars;

  return {
    payout: p,
    current_username: currentUsername,
    username_match: usernameMatch,
    recipient,
    balance_ok: available >= p.stars,
    available,
  };
}

async function payoutConfirm(id) {
  const pre = await payoutPreview(id);
  const p = pre.payout;
  if (p.status !== 'requested') throw new Error(`payout is ${p.status}, expected requested`);
  if (!pre.username_match) throw new Error(`username changed: @${p.username_snapshot} -> @${pre.current_username || 'none'} — reject and let the player re-request`);
  if (!pre.balance_ok) throw new Error('insufficient balance');

  const buy = await split('/buy/stars', {
    payment_method: 'xrocket',
    username: p.username_snapshot,
    quantity: p.stars,
    transfer_id: p.id,
  });

  const invoice = buy && buy.invoice ? buy.invoice : buy;
  const invoiceUrl = invoice && (invoice.url || invoice.pay_url || invoice.payment_url) || null;
  const validUntil = invoice && (invoice.valid_until || invoice.expires_at) || null;
  const expiresAt = validUntil
    ? new Date(typeof validUntil === 'number' ? validUntil * 1000 : validUntil).toISOString()
    : new Date(Date.now() + 3600e3).toISOString();

  await sbWrite('PATCH', 'payouts', `id=eq.${id}`, {
    status: 'processing',
    invoice_url: invoiceUrl,
    invoice_expires_at: expiresAt,
    provider_response: buy,
    updated_at: new Date().toISOString(),
  });

  const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';
  await tg('sendMessage', {
    chat_id: adminChat,
    text: `⭐ <b>Оплати інвойс</b> — ${p.stars} ⭐ для @${p.username_snapshot}\n${invoiceUrl || 'інвойс без URL — глянь split.tg'}`,
    parse_mode: 'HTML',
  });

  return { ok: true, invoice_url: invoiceUrl, expires_at: expiresAt };
}

async function payoutReject(id, reason) {
  const [p] = await sbSelectAll('payouts', `id=eq.${id}&select=*`);
  if (!p) throw new Error('payout not found');
  if (p.status !== 'requested' && p.status !== 'processing') throw new Error(`payout is ${p.status}`);

  await sbWrite('PATCH', 'payouts', `id=eq.${id}`, {
    status: 'rejected',
    provider_response: { rejected_reason: reason || null },
    updated_at: new Date().toISOString(),
  });
  await tg('sendMessage', {
    chat_id: p.telegram_chat_id,
    text: `Your withdrawal request (${p.stars} ⭐) was declined${reason ? ': ' + reason : ''}. Your stars are back on your balance.`,
  });
  return { ok: true };
}

module.exports = { prizesSummary, payoutPreview, payoutConfirm, payoutReject, split, tg, sbSelectAll, sbHeaders, env };
