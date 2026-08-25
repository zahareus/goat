// api/prize-finalize.js — auto-finalize finished gameweeks and accrue star prizes
// POST /api/prize-finalize?secret=GOAT_NOTIFY_SECRET
// Called by n8n hourly. Gate per GW: every fixture ft, every result final, and
// FPL has closed the gameweek AS AN EVENT — `events[gw].finished === true` AND
// `data_checked === true` in bootstrap-static. Per-fixture `finished` is not
// enough: bonuses land at the whistle while BPS stays editable, and accruals
// are irreversible. There is NO ceiling override (Victor, 25.08.26) — a flag
// that never flips raises an admin alert, it does not release the money.
// Last kickoff no older than 14 days (never finalize historical seasons).

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const TELEGRAM_API = 'https://api.telegram.org/bot';
const { computeGwStandings, distributePrizes, seasonForDate } = require('../lib/scoring.js');

const ALERT_H = 48; // FPL still silent this long after the last kickoff → tell the admin
const MAX_AGE_DAYS = 14;
const FPL_BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';

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
    for (const c of gws) {
      const outcome = await finalizeGw(c.gw, c);
      done.push({ gw: c.gw, ...outcome });
    }
    return res.status(200).json({ ok: true, checked: gws.map(c => c.gw), results: done });
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


// === Finalization ===

// FPL's own verdict on a gameweek, taken at the EVENT level. `finished` flips
// when the last whistle blows; `data_checked` flips when FPL has reconciled the
// data and BPS stops moving. We wait for both — the accrual cannot be undone.
// A failed fetch reads as "not confirmed": we retry next hour.
async function fplConfirmed(gw) {
  try {
    const r = await fetch(FPL_BOOTSTRAP, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    if (!r.ok) return { ok: false, finished: false, dataChecked: false };
    const { events } = await r.json();
    const ev = Array.isArray(events) && events.find(e => e.id === gw);
    if (!ev) return { ok: false, finished: false, dataChecked: false };
    return {
      ok: ev.finished === true && ev.data_checked === true,
      finished: ev.finished === true,
      dataChecked: ev.data_checked === true,
    };
  } catch (e) {
    console.error('fplConfirmed failed for gw', gw, e.message);
    return { ok: false, finished: false, dataChecked: false };
  }
}

async function candidateGws() {
  const rows = await sbSelect('gw_config', 'finalized_at=is.null&select=gw&order=gw.asc');
  const out = [];
  const stuck = [];
  for (const { gw } of rows) {
    const fixtures = await sbSelect('fixtures', `gw=eq.${gw}&select=id,status,kickoff_time`);
    if (!fixtures.length) continue;
    const kickoffs = fixtures.filter(f => f.kickoff_time).map(f => new Date(f.kickoff_time).getTime());
    if (!kickoffs.length) continue;
    const firstKickoff = Math.min(...kickoffs);
    const lastKickoff = Math.max(...kickoffs);
    const allFt = fixtures.every(f => f.status === 'ft' && f.kickoff_time);
    if (!allFt) {
      // a GW that started >7 days ago but still isn't fully played = postponed
      // match or dead sync; surface it instead of waiting silently
      const startedDaysAgo = (Date.now() - firstKickoff) / 86400e3;
      if (startedDaysAgo > 7 && startedDaysAgo < MAX_AGE_DAYS + 7) stuck.push(`${gw} (матчі не всі ft)`);
      continue;
    }
    const ageH = (Date.now() - lastKickoff) / 3600e3;
    if (ageH > MAX_AGE_DAYS * 24) continue;
    const fpl = await fplConfirmed(gw);
    // one line per hourly run: how long FPL took to confirm, for tuning the gate
    console.log(`gw${gw} gate: event finished=${fpl.finished} data_checked=${fpl.dataChecked} +${ageH.toFixed(1)}h since last kickoff`);
    if (!fpl.ok) {
      if (ageH > ALERT_H) stuck.push(`${gw} (FPL: finished=${fpl.finished}, data_checked=${fpl.dataChecked}, +${Math.round(ageH)}h)`);
      continue;
    }
    out.push({ gw, waitedH: Math.round(ageH * 10) / 10 });
  }
  // stateless once-a-day dedup: hourly cron, alert only on the 09:xx UTC run
  // stateless once-a-day dedup: hourly cron, alert only on the 09:xx UTC run
  if (stuck.length && new Date().getUTCHours() === 9) {
    const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';
    await send(adminChat, `⚠️ Не фіналізується — GW${stuck.join('\n⚠️ Не фіналізується — GW')}`);
  }
  return out;
}

async function finalizeGw(gw, gate) {
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
  try {
    await notifyAll(gw, standings, prizes, gate);
  } catch (e) {
    // accruals are in; a Telegram hiccup must not look like a failed finalize
    console.error('notifyAll failed for gw', gw, e);
  }
  return { players: standings.length, prizes: prizes.length };
}

async function markFinalized(gw) {
  await sbWrite('PATCH', 'gw_config', `gw=eq.${gw}`, { finalized_at: new Date().toISOString() });
}

// === Notifications ===

async function notifyAll(gw, standings, prizes, gate) {
  const userIds = standings.map(s => s.uid);
  const [profiles, ledger, activePayouts] = await Promise.all([
    sbSelectAll('profiles', `id=in.(${userIds.join(',')})&select=id,team_name,telegram_chat_id,is_bot`),
    sbSelectAll('prize_ledger', `user_id=in.(${userIds.join(',')})&select=user_id,stars`),
    sbSelectAll('payouts', `user_id=in.(${userIds.join(',')})&status=in.(requested,processing,expired)&select=user_id,stars`),
  ]);
  const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
  const balance = {};
  for (const row of ledger) balance[row.user_id] = (balance[row.user_id] || 0) + row.stars;
  for (const row of activePayouts) balance[row.user_id] = (balance[row.user_id] || 0) - row.stars;
  const prizeMap = Object.fromEntries(prizes.map(p => [p.uid, p]));

  // admin summary
  const lines = prizes.map(p => {
    const prof = profileMap[p.uid];
    const s = standings.find(x => x.uid === p.uid);
    return `${p.place}. ${prof ? prof.team_name : p.uid}${prof && prof.is_bot ? ' 🤖' : ''} — ${s.goats} GOAT / ${s.bps} BPS — ${p.stars} ⭐`;
  });
  const adminChat = env('GOAT_ADMIN_CHAT_ID') || '292048';
  const gateLine = gate ? `FPL закрив тур (finished + data_checked) через ${gate.waitedH}h після останнього кікофу` : '';
  await send(adminChat, `🏁 <b>GW${gw} фіналізовано</b>\n${standings.length} учасників, роздано ${prizes.reduce((a, p) => a + p.stars, 0)} ⭐${gateLine ? '\n' + gateLine : ''}\n\n${lines.join('\n') || 'Призів немає'}`);

  // player messages: one final GW message (matches + standings + stars) via
  // api/notify gw_finished — the only GW summary players get (24.08.26, Victor).
  // EVERY prize-winner goes in, bots included: to a player the standings must
  // read as a field of real rivals, so all five paid places show their stars.
  // Bots accrue in prize_ledger like anyone else — they simply cannot withdraw.
  // `balance` only ever surfaces for the message's own recipient.
  const prizePayload = {};
  for (const p of prizes) {
    prizePayload[p.uid] = { place: p.place, stars: p.stars, balance: balance[p.uid] || 0 };
  }
  const r = await fetch(`https://goatapp.club/api/notify?secret=${env('GOAT_NOTIFY_SECRET')}&type=gw_finished`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gw, prizes: prizePayload }),
  });
  if (!r.ok) throw new Error(`notify gw_finished ${r.status}: ${await r.text()}`);
}
