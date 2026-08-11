// api/prize-finalize.js — auto-finalize finished gameweeks and accrue star prizes
// POST /api/prize-finalize?secret=GOAT_NOTIFY_SECRET
// Called by n8n hourly. Gate per GW: every fixture ft, every result final,
// >=24h since last kickoff+FT buffer (FPL corrects bonuses within a day),
// last kickoff no older than 14 days (never finalize historical seasons).

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const { computeGwStandings, distributePrizes, seasonForDate } = require('../lib/scoring.js');

const KICKOFF_BUFFER_H = 27; // ~3h match + 24h FPL corrections buffer
const MAX_AGE_DAYS = 14;

function env(name) {
  return (process.env[name] || '').trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = req.query.secret;
  const validSecrets = [env('TELEGRAM_WEBHOOK_SECRET'), env('GOAT_NOTIFY_SECRET')].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) return res.status(403).json({ error: 'Forbidden' });

  try {
    const done = [];
    const gws = await candidateGws();
    for (const gw of gws) {
      const outcome = await finalizeGw(gw);
      done.push({ gw, ...outcome });
    }
    return res.status(200).json({ ok: true, checked: gws, results: done });
  } catch (err) {
    console.error('prize-finalize error:', err);
    return res.status(500).json({ error: err.message });
  }
};

// === Supabase REST helpers ===

function sbHeaders(extra) {
  return {
    'apikey': env('SUPABASE_SERVICE_ROLE_KEY'),
    'Authorization': `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY')}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`select ${table} ${r.status}`);
  return r.json();
}

// PostgREST silently caps at 1000 rows — page explicitly.
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
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? '?' + query : ''}`, {
    method,
    headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${table} ${r.status}: ${await r.text()}`);
}

async function send(chatId, text) {
  await fetch(`${TELEGRAM_API}${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// === Finalization ===

async function candidateGws() {
  const rows = await sbSelect('gw_config', 'finalized_at=is.null&select=gw&order=gw.asc');
  const out = [];
  for (const { gw } of rows) {
    const fixtures = await sbSelect('fixtures', `gw=eq.${gw}&select=id,status,kickoff_time`);
    if (!fixtures.length) continue;
    if (!fixtures.every(f => f.status === 'ft' && f.kickoff_time)) continue;
    const lastKickoff = Math.max(...fixtures.map(f => new Date(f.kickoff_time).getTime()));
    const ageH = (Date.now() - lastKickoff) / 3600e3;
    if (ageH < KICKOFF_BUFFER_H || ageH > MAX_AGE_DAYS * 24) continue;
    out.push(gw);
  }
  return out;
}

async function finalizeGw(gw) {
  const season = seasonForDate();

  // idempotency: an accrual for this season+gw means a previous run got here
  const existing = await sbSelect('prize_ledger', `season=eq.${season}&gw=eq.${gw}&type=eq.accrual&select=id&limit=1`);
  if (existing.length) {
    await markFinalized(gw);
    return { skipped: 'already_accrued' };
  }

  const fixtures = await sbSelect('fixtures', `gw=eq.${gw}&select=id`);
  const fixtureIds = fixtures.map(f => f.id);
  const results = await sbSelectAll('results', `fixture_id=in.(${fixtureIds.join(',')})&select=fixture_id,element_id,bps,is_goat,is_final`);

  // gate: every fixture has final results
  const fixturesWithResults = new Set(results.map(r => r.fixture_id));
  if (fixturesWithResults.size < fixtureIds.length) return { skipped: 'missing_results' };
  if (results.some(r => !r.is_final)) return { skipped: 'results_not_final' };

  const picks = await sbSelectAll('picks', `gw=eq.${gw}&select=user_id,fixture_id,element_id`);
  if (!picks.length) {
    await markFinalized(gw);
    return { skipped: 'no_picks' };
  }

  const standings = computeGwStandings(picks, results);
  const prizes = distributePrizes(standings);

  if (prizes.length) {
    await sbWrite('POST', 'prize_ledger', '', prizes.map(p => ({
      user_id: p.uid,
      season,
      gw,
      type: 'accrual',
      place: p.place,
      stars: p.stars,
    })));
  }
  await markFinalized(gw);
  await notifyAll(gw, standings, prizes);
  return { players: standings.length, prizes: prizes.length };
}

async function markFinalized(gw) {
  await sbWrite('PATCH', 'gw_config', `gw=eq.${gw}`, { finalized_at: new Date().toISOString() });
}

// === Notifications ===

async function notifyAll(gw, standings, prizes) {
  const userIds = standings.map(s => s.uid);
  const [profiles, ledger] = await Promise.all([
    sbSelectAll('profiles', `id=in.(${userIds.join(',')})&select=id,team_name,telegram_chat_id,is_bot`),
    sbSelectAll('prize_ledger', `user_id=in.(${userIds.join(',')})&select=user_id,stars`),
  ]);
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const balance = {};
  for (const row of ledger) balance[row.user_id] = (balance[row.user_id] || 0) + row.stars;
  const prizeMap = Object.fromEntries(prizes.map(p => [p.uid, p]));

  // admin summary
  const lines = prizes.map(p => {
    const prof = profileMap[p.uid];
    const s = standings.find(x => x.uid === p.uid);
    return `${p.place}. ${prof ? prof.team_name : p.uid}${prof && prof.is_bot ? ' 🤖' : ''} — ${s.goats} GOAT / ${s.bps} BPS — ${p.stars} ⭐`;
  });
  const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';
  await send(adminChat, `🏁 <b>GW${gw} фіналізовано</b>\n${standings.length} учасників, роздано ${prizes.reduce((a, p) => a + p.stars, 0)} ⭐\n\n${lines.join('\n') || 'Призів немає'}`);

  // player messages (humans with linked chats only)
  for (const s of standings) {
    const prof = profileMap[s.uid];
    if (!prof || prof.is_bot || !prof.telegram_chat_id) continue;
    const prize = prizeMap[s.uid];
    let msg = `🏁 <b>GW${gw} finished!</b>\nYour result: place <b>${s.rank}</b> of ${standings.length} — ${s.goats} GOAT, ${s.bps} BPS.`;
    if (prize) msg += `\n\n🏆 You won <b>${prize.stars} ⭐</b>!`;
    const bal = balance[s.uid] || 0;
    if (bal > 0) msg += `\n⭐ Star balance: <b>${bal}</b>`;
    await send(prof.telegram_chat_id, msg);
    await sleep(50); // Telegram rate limit
  }
}
