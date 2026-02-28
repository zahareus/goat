// api/notify.js — GOAT proactive notification dispatcher
// POST /api/notify?secret=WEBHOOK_SECRET&type=TYPE
// Types: match_finished, gw_finished, lineup_alert, deadline_reminder, pick_at_risk

const TELEGRAM_API = 'https://api.telegram.org/bot';
const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret;
  const validSecrets = [process.env.TELEGRAM_WEBHOOK_SECRET, process.env.GOAT_NOTIFY_SECRET].filter(Boolean);
  if (!secret || !validSecrets.includes(secret)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const type = req.query.type;
  const body = req.body || {};

  try {
    let result;
    switch (type) {
      case 'match_finished':
        result = await handleMatchFinished(body);
        break;
      case 'gw_finished':
        result = await handleGWFinished(body);
        break;
      case 'lineup_alert':
        result = await handleLineupAlert(body);
        break;
      case 'deadline_reminder':
        result = await handleDeadlineReminder(body);
        break;
      case 'pick_at_risk':
        result = await handlePickAtRisk(body);
        break;
      default:
        return res.status(400).json({ error: 'Unknown type: ' + type });
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Notify error:', type, err);
    return res.status(500).json({ error: err.message });
  }
};

// === Supabase REST helpers ===

function sbHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: sbHeaders(),
  });
  return r.json();
}

// === Telegram helpers ===

async function send(chatId, text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function getLinkedUsers() {
  return sbSelect('profiles', 'telegram_chat_id=not.is.null&select=id,team_name,telegram_chat_id');
}

function h(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `${day} ${time}`;
}

function fmtTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

// === Type: match_finished ===
// Body: { fixture_id }
// Per-user: show their pick result for this fixture

async function handleMatchFinished({ fixture_id }) {
  if (!fixture_id) return { error: 'missing fixture_id' };

  const [fixtures, users] = await Promise.all([
    sbSelect('fixtures', `id=eq.${fixture_id}&select=id,home_short,away_short,home_score,away_score,gw`),
    getLinkedUsers(),
  ]);

  const fix = fixtures[0];
  if (!fix) return { error: 'fixture not found' };
  if (users.length === 0) return { sent: 0 };

  const gw = fix.gw;
  const userIds = users.map(u => `"${u.id}"`).join(',');

  const [picks, results] = await Promise.all([
    sbSelect('picks', `fixture_id=eq.${fixture_id}&user_id=in.(${userIds})&select=user_id,element_id`),
    sbSelect('results', `fixture_id=eq.${fixture_id}&select=element_id,bps,is_goat&order=bps.desc`),
  ]);

  if (picks.length === 0) return { sent: 0, reason: 'no picks for this fixture' };

  const elementIds = [...new Set(picks.map(p => p.element_id))];
  const players = await sbSelect('players', `element_id=in.(${elementIds.join(',')})&select=element_id,short_name,team_short`);
  const playerMap = {};
  for (const p of players) playerMap[p.element_id] = p;

  const resultMap = {};
  for (const r of results) resultMap[r.element_id] = r;

  let sent = 0;
  for (const user of users) {
    const pick = picks.find(p => p.user_id === user.id);
    if (!pick) continue;

    const pl = playerMap[pick.element_id];
    const res = resultMap[pick.element_id];
    if (!pl) continue;

    const header = `🏁 <b>${h(fix.home_short)} ${fix.home_score}–${fix.away_score} ${h(fix.away_short)}</b>`;
    let detail;
    if (res) {
      const crown = res.is_goat ? ' 👑' : '';
      const rank = results.findIndex(r => r.element_id === pick.element_id) + 1;
      detail = `Your pick: ${h(pl.short_name)} (${h(pl.team_short)})${crown}\n#${rank}  ·  ${res.bps} BPS`;
    } else {
      detail = `Your pick: ${h(pl.short_name)} (${h(pl.team_short)})\nNo BPS data yet`;
    }

    await send(user.telegram_chat_id, header + '\n\n' + detail);
    sent++;
  }

  return { sent };
}

// === Type: gw_finished ===
// Body: { gw }
// Send full GW summary + standings to each user (same format as /gw command)

async function handleGWFinished({ gw }) {
  if (!gw) return { error: 'missing gw' };

  const users = await getLinkedUsers();
  if (users.length === 0) return { sent: 0 };

  const [fixtures, allPicks] = await Promise.all([
    sbSelect('fixtures', `gw=eq.${gw}&select=id,home_team_id,away_team_id,home_short,away_short,status,kickoff_time,home_score,away_score,minutes&order=kickoff_time`),
    sbSelect('picks', `gw=eq.${gw}&select=user_id,fixture_id,element_id`),
  ]);

  if (fixtures.length === 0) return { error: 'no fixtures' };

  const allElementIds = [...new Set(allPicks.map(p => p.element_id))];
  const fixtureIds = fixtures.map(f => f.id);

  const [players, results] = await Promise.all([
    allElementIds.length > 0
      ? sbSelect('players', `element_id=in.(${allElementIds.join(',')})&select=element_id,short_name,team_short`)
      : [],
    sbSelect('results', `fixture_id=in.(${fixtureIds.join(',')})&select=fixture_id,element_id,bps,is_goat`),
  ]);

  const playerMap = {};
  for (const p of players) playerMap[p.element_id] = p;

  const resultMap = {};
  for (const r of results) {
    if (!resultMap[r.fixture_id]) resultMap[r.fixture_id] = {};
    resultMap[r.fixture_id][r.element_id] = r;
  }

  // Build standings
  const userPicksMap = {};
  for (const p of allPicks) {
    if (!userPicksMap[p.user_id]) userPicksMap[p.user_id] = [];
    userPicksMap[p.user_id].push(p);
  }

  const allUserIds = Object.keys(userPicksMap);
  const profiles = allUserIds.length > 0
    ? await sbSelect('profiles', `id=in.(${allUserIds.map(u => `"${u}"`).join(',')})&select=id,team_name`)
    : [];
  const profileMap = {};
  for (const p of profiles) profileMap[p.id] = p.team_name || '—';

  const standings = [];
  for (const [uid, picks] of Object.entries(userPicksMap)) {
    let bps = 0, g = 0;
    for (const p of picks) {
      const r = resultMap[p.fixture_id]?.[p.element_id];
      if (r) { bps += r.bps; if (r.is_goat) g++; }
    }
    standings.push({ uid, name: profileMap[uid] || '—', goats: g, bps });
  }
  standings.sort((a, b) => b.goats - a.goats || b.bps - a.bps);

  let sent = 0;
  for (const user of users) {
    const userId = user.id;
    const teamName = user.team_name || '—';
    const myPicks = allPicks.filter(p => p.user_id === userId);
    const myPickMap = {};
    for (const p of myPicks) myPickMap[p.fixture_id] = p.element_id;

    let totalBps = 0;
    let goats = 0;
    const matchLines = [];

    for (const f of fixtures) {
      const eid = myPickMap[f.id];
      const score = `${f.home_score}:${f.away_score}`;
      let line = `🏁 <b>${h(f.home_short)} – ${h(f.away_short)}</b>  ${score}`;

      if (!eid) {
        line += '\n    <i>no pick</i>';
      } else {
        const pl = playerMap[eid];
        const name = pl ? pl.short_name : `#${eid}`;
        const team = pl ? pl.team_short : '';
        const res = resultMap[f.id]?.[eid];
        if (res) {
          const crown = res.is_goat ? ' 👑' : '';
          if (res.is_goat) goats++;
          totalBps += res.bps;
          const fResults = Object.values(resultMap[f.id] || {});
          fResults.sort((a, b) => b.bps - a.bps);
          const rank = fResults.findIndex(r => r.element_id === eid) + 1;
          line += `\n    ${h(name)} (${team})${crown}  #${rank}  <b>${res.bps}</b> BPS`;
        } else {
          line += `\n    ${h(name)} (${team})`;
        }
      }
      matchLines.push(line);
    }

    const myPos = standings.findIndex(s => s.uid === userId) + 1;
    const standLines = standings.map((s, i) => {
      const arrow = s.uid === userId ? ' ◀️' : '';
      return `${i + 1}. ${s.name}  ${s.goats}👑 ${s.bps} BPS${arrow}`;
    });

    const header = `🏆 <b>GW${gw} FINAL</b> — ${h(teamName)}`;
    const summary = `\n📊 <b>${goats}</b> GOATs  |  <b>${totalBps}</b> BPS`;
    const position = myPos > 0 ? `  |  🏆 ${myPos}/${standings.length}` : '';

    const msg = header + '\n\n'
      + matchLines.join('\n\n') + '\n'
      + summary + position + '\n\n'
      + '📋 <b>Standings</b>\n<code>'
      + standLines.join('\n')
      + '</code>';

    await send(user.telegram_chat_id, msg);
    sent++;
  }

  return { sent };
}

// === Type: lineup_alert ===
// Body: { fixture_ids: [273, 275, 278] }
// Per-user: show their picks for these fixtures with lineup status

async function handleLineupAlert({ fixture_ids }) {
  if (!fixture_ids || !fixture_ids.length) return { error: 'missing fixture_ids' };

  const [fixtures, users] = await Promise.all([
    sbSelect('fixtures', `id=in.(${fixture_ids.join(',')})&select=id,home_short,away_short,home_team_id,away_team_id,kickoff_time,gw`),
    getLinkedUsers(),
  ]);

  if (fixtures.length === 0 || users.length === 0) return { sent: 0 };

  const gw = fixtures[0].gw;
  const userIds = users.map(u => `"${u.id}"`).join(',');
  const picks = await sbSelect('picks', `gw=eq.${gw}&fixture_id=in.(${fixture_ids.join(',')})&user_id=in.(${userIds})&select=user_id,fixture_id,element_id`);

  if (picks.length === 0) return { sent: 0, reason: 'no picks for these fixtures' };

  const elementIds = [...new Set(picks.map(p => p.element_id))];
  const players = await sbSelect('players', `element_id=in.(${elementIds.join(',')})&select=element_id,short_name,team_short`);
  const playerMap = {};
  for (const p of players) playerMap[p.element_id] = p;

  // Fetch RotoWire lineups + FPL bootstrap
  let lineupsData = {};
  let fplAvail = {};
  try {
    const [linResp, fplResp] = await Promise.all([
      fetch('https://goatapp.club/api/lineups').catch(() => null),
      fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
      }),
    ]);
    if (linResp && linResp.ok) {
      const ld = await linResp.json();
      if (!ld.error) lineupsData = ld;
    }
    if (fplResp.ok) {
      const boot = await fplResp.json();
      const eids = new Set(elementIds);
      for (const el of boot.elements) {
        if (eids.has(el.id)) fplAvail[el.id] = el.chance_of_playing_next_round;
      }
    }
  } catch (_) {}

  // Earliest kickoff for header
  fixtures.sort((a, b) => new Date(a.kickoff_time) - new Date(b.kickoff_time));
  const kickoffTime = fmtTimeShort(fixtures[0].kickoff_time);

  let sent = 0;
  for (const user of users) {
    const userPicks = picks.filter(p => p.user_id === user.id);
    if (userPicks.length === 0) continue;

    const lines = [];
    for (const fix of fixtures) {
      const pick = userPicks.find(p => p.fixture_id === fix.id);
      if (!pick) continue;

      const pl = playerMap[pick.element_id];
      if (!pl) continue;

      // Determine status from RotoWire
      let statusIcon = '❓';
      const key = `${fix.home_team_id}-${fix.away_team_id}`;
      const lineup = lineupsData[key];
      if (lineup) {
        const allPlayers = [...(lineup.home || []), ...(lineup.away || [])];
        const found = allPlayers.find(lp => lp.fpl_id === pick.element_id);
        if (found) {
          const st = found.status;
          if (st === 'starter') statusIcon = '🟢';
          else if (st === 'starter_ques') statusIcon = '⚠️';
          else if (st === 'ques') statusIcon = '⚠️';
          else if (st === 'out' || st === 'sus') statusIcon = '🔴';
        }
      }
      // Fallback to FPL
      if (statusIcon === '❓' && pick.element_id in fplAvail) {
        const chance = fplAvail[pick.element_id];
        if (chance === null || chance === 100) statusIcon = '🟢';
        else if (chance === 75) statusIcon = '⚠️';
        else if (chance === 50) statusIcon = '⚠️';
        else statusIcon = '🔴';
      }

      let statusText = 'No data';
      if (statusIcon === '🟢') statusText = 'Starting XI';
      else if (statusIcon === '⚠️') statusText = 'Doubt/Benched';
      else if (statusIcon === '🔴') statusText = 'Out';

      lines.push(
        `<b>${h(fix.home_short)} – ${h(fix.away_short)}</b>\n` +
        `  ${h(pl.short_name)} (${h(pl.team_short)}) ${statusIcon} ${statusText}`
      );
    }

    if (lines.length === 0) continue;

    const msg = `📋 <b>Lineups out!</b> Kickoff ${kickoffTime}\n\n` + lines.join('\n\n');
    await send(user.telegram_chat_id, msg);
    sent++;
  }

  return { sent };
}

// === Type: deadline_reminder ===
// Body: { gw, hours_left, first_kickoff, matches: [{home_short, away_short, kickoff_time}] }
// Broadcast to all linked users

async function handleDeadlineReminder({ gw, hours_left, first_kickoff, matches }) {
  if (!gw || !hours_left) return { error: 'missing gw or hours_left' };

  const users = await getLinkedUsers();
  if (users.length === 0) return { sent: 0 };

  let hoursText;
  if (hours_left >= 24) hoursText = `${Math.round(hours_left)} hours`;
  else if (hours_left >= 2) hoursText = `${Math.round(hours_left)} hours`;
  else hoursText = `${Math.round(hours_left * 60)} minutes`;

  let matchLines = '';
  if (matches && matches.length > 0) {
    // Group by kickoff_time
    const groups = {};
    for (const m of matches) {
      const ko = fmtTime(m.kickoff_time);
      if (!groups[ko]) groups[ko] = [];
      groups[ko].push(`${m.home_short}–${m.away_short}`);
    }
    const groupLines = [];
    for (const [ko, ms] of Object.entries(groups)) {
      groupLines.push(`${ko}: ${ms.join(', ')}`);
    }
    matchLines = '\n\n' + groupLines.join('\n');
  }

  const msg = `⏰ <b>GW${gw} starts in ${hoursText}!</b>${matchLines}\n\nPick your GOATs → goatapp.club`;

  let sent = 0;
  for (const user of users) {
    await send(user.telegram_chat_id, msg);
    sent++;
  }

  return { sent };
}

// === Type: pick_at_risk ===
// Body: { element_id, name, team, chance, news }
// Per-user: only users who picked this player in upcoming (scheduled) fixtures

async function handlePickAtRisk({ element_id, name, team, chance, news }) {
  if (!element_id) return { error: 'missing element_id' };

  const users = await getLinkedUsers();
  if (users.length === 0) return { sent: 0 };

  // Find scheduled fixtures where this player could be relevant
  const activeGW = await sbSelect('gw_config', 'is_active=eq.true&select=gw&limit=1');
  if (activeGW.length === 0) return { sent: 0 };
  const gw = activeGW[0].gw;

  const scheduledFixtures = await sbSelect('fixtures', `gw=eq.${gw}&status=eq.scheduled&select=id,home_short,away_short,kickoff_time`);
  if (scheduledFixtures.length === 0) return { sent: 0 };

  const fixtureIds = scheduledFixtures.map(f => f.id);
  const userIds = users.map(u => `"${u.id}"`).join(',');

  const picks = await sbSelect('picks',
    `gw=eq.${gw}&element_id=eq.${element_id}&fixture_id=in.(${fixtureIds.join(',')})&user_id=in.(${userIds})&select=user_id,fixture_id`
  );

  if (picks.length === 0) return { sent: 0, reason: 'no users picked this player' };

  const fixtureMap = {};
  for (const f of scheduledFixtures) fixtureMap[f.id] = f;

  let sent = 0;
  for (const pick of picks) {
    const user = users.find(u => u.id === pick.user_id);
    if (!user) continue;

    const fix = fixtureMap[pick.fixture_id];
    if (!fix) continue;

    const ko = fmtTime(fix.kickoff_time);
    const chanceText = chance !== undefined && chance !== null ? ` (${chance}%)` : '';
    const newsText = news ? `${news}${chanceText}` : `Availability doubt${chanceText}`;

    const msg = `⚠️ <b>Pick at risk!</b>\n\n`
      + `${h(name)} (${h(team)}) — ${newsText}\n`
      + `${h(fix.home_short)} – ${h(fix.away_short)} · ${ko}\n\n`
      + `Change your pick → goatapp.club`;

    await send(user.telegram_chat_id, msg);
    sent++;
  }

  return { sent };
}
