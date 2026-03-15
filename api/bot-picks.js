// api/bot-picks.js — Generate picks for GOAT bots
// POST /api/bot-picks?secret=GOAT_NOTIFY_SECRET
// Called by n8n every 30 min — checks which bots should submit picks based on hours_before

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

  try {
    const result = await generateBotPicks();
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('Bot picks error:', err);
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

async function sbInsert(table, rows) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Insert ${table} failed: ${r.status} ${text}`);
  }
  return r;
}

// === Main logic ===

async function generateBotPicks() {
  // 1. Find the target GW: active GW, or next GW with picks_open if active has no scheduled fixtures
  const allGWConfigs = await sbSelect('gw_config', 'picks_open=eq.true&order=gw.asc');
  if (!allGWConfigs.length) return { message: 'No GW with picks open' };

  // Try each open GW until we find one with scheduled fixtures
  let targetGW = null;
  let fixtures = [];
  for (const cfg of allGWConfigs) {
    const gwFixtures = await sbSelect('fixtures', `gw=eq.${cfg.gw}&status=eq.scheduled&order=kickoff_time.asc`);
    if (gwFixtures.length) {
      targetGW = cfg;
      fixtures = gwFixtures;
      break;
    }
  }
  if (!targetGW) return { message: 'No GW with scheduled fixtures found' };

  const activeGW = targetGW.gw;
  const deadline = targetGW.deadline ? new Date(targetGW.deadline) : null;

  // Use first kickoff as deadline if no explicit deadline
  const firstKickoff = new Date(fixtures[0].kickoff_time);
  const effectiveDeadline = deadline || firstKickoff;

  // 3. Get all bots
  const bots = await sbSelect('profiles', 'is_bot=eq.true&select=id,team_name,bot_strategy,hours_before');
  if (!bots.length) return { message: 'No bots configured' };

  // 4. Check which bots should pick now
  const now = new Date();
  const hoursToDeadline = (effectiveDeadline - now) / (1000 * 60 * 60);

  // Get existing bot picks for this GW
  const botIds = bots.map(b => `"${b.id}"`).join(',');
  const existingPicks = await sbSelect('picks', `gw=eq.${activeGW}&user_id=in.(${botIds})&select=user_id,fixture_id`);
  const existingSet = new Set(existingPicks.map(p => `${p.user_id}_${p.fixture_id}`));

  // Filter bots: hours_before >= hoursToDeadline AND no existing picks
  const botsToRun = bots.filter(b => {
    const hb = b.hours_before || 12;
    const hasAnyPick = existingPicks.some(p => p.user_id === b.id);
    return hoursToDeadline <= hb && !hasAnyPick;
  });

  if (!botsToRun.length) {
    return { message: `No bots to run. ${hoursToDeadline.toFixed(1)}h to deadline, ${bots.length} bots total` };
  }

  // 5. Get player data for strategies
  const players = await sbSelect('players', 'select=element_id,name,short_name,team_id,team_short,position');

  // Get player_history for stats
  let allHistory = [];
  let offset = 0;
  while (true) {
    const batch = await sbSelect('player_history', `select=element_id,bps_rank,bps,round,minutes&order=round.asc&offset=${offset}&limit=1000`);
    if (!batch.length) break;
    allHistory = allHistory.concat(batch);
    offset += batch.length;
    if (batch.length < 1000) break;
  }

  // Calculate playerStats (same logic as frontend)
  const statsMaxRound = allHistory.reduce((max, r) => Math.max(max, r.round), 0);
  const formStart = Math.max(1, statsMaxRound - 5);
  const C = 6, M = 15;
  const byPlayer = {};
  for (const r of allHistory) {
    if (!byPlayer[r.element_id]) byPlayer[r.element_id] = [];
    byPlayer[r.element_id].push(r);
  }

  const playerStats = {};
  for (const [eid, rows] of Object.entries(byPlayer)) {
    const ranked = rows.filter(r => r.bps_rank);
    const rankSum = ranked.reduce((s, r) => s + r.bps_rank, 0);
    const n = ranked.length;
    const bayesAvg = (C * M + rankSum) / (C + n);
    const goats = ranked.filter(r => r.bps_rank === 1).length;

    const byRound = {};
    for (const r of rows) byRound[r.round] = r;
    let formBpsSum = 0;
    for (let gw = formStart; gw <= statsMaxRound; gw++) {
      const r = byRound[gw];
      if (r && r.minutes > 0) formBpsSum += (r.bps || 0);
    }
    const formBps = formBpsSum / 6;

    // Total minutes for ironman
    const totalMinutes = rows.reduce((s, r) => s + (r.minutes || 0), 0);

    // Streak: BPS trend over last 3 GWs
    let streak = 0;
    if (statsMaxRound >= 3) {
      const r1 = byRound[statsMaxRound - 2];
      const r2 = byRound[statsMaxRound - 1];
      const r3 = byRound[statsMaxRound];
      const b1 = r1 && r1.minutes > 0 ? r1.bps : 0;
      const b2 = r2 && r2.minutes > 0 ? r2.bps : 0;
      const b3 = r3 && r3.minutes > 0 ? r3.bps : 0;
      if (b3 > b2 && b2 > b1 && b1 > 0) streak = b3;
    }

    playerStats[eid] = { avgRank: bayesAvg, formBps, goats, games: n, totalMinutes, streak };
  }

  // Get FPL availability data (chance_of_playing)
  let fplAvail = {};
  try {
    const fplResp = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
    if (fplResp.ok) {
      const fpl = await fplResp.json();
      for (const el of fpl.elements) {
        fplAvail[el.id] = el.chance_of_playing_next_round;
      }
    }
  } catch (e) { console.warn('FPL availability fetch failed'); }

  // Get existing picks from all users for contrarian strategy
  const allUserPicks = await sbSelect('picks', `gw=eq.${activeGW}&select=element_id,fixture_id`);
  const pickCounts = {}; // fixture_id -> element_id -> count
  for (const p of allUserPicks) {
    if (!pickCounts[p.fixture_id]) pickCounts[p.fixture_id] = {};
    pickCounts[p.fixture_id][p.element_id] = (pickCounts[p.fixture_id][p.element_id] || 0) + 1;
  }

  // Build player map
  const playerMap = {};
  for (const p of players) playerMap[p.element_id] = p;

  // 6. Generate picks per bot
  const allNewPicks = [];
  const botResults = [];

  for (const bot of botsToRun) {
    const picks = [];

    for (const fixture of fixtures) {
      // Skip locked fixtures
      if (fixture.status !== 'scheduled' || new Date(fixture.kickoff_time) <= now) continue;

      // Get available players for this fixture (both teams)
      const matchPlayers = players.filter(p =>
        p.team_id === fixture.home_team_id || p.team_id === fixture.away_team_id
      );

      // Filter to available players (chance >= 75 or unknown)
      const available = matchPlayers.filter(p => {
        const chance = fplAvail[p.element_id];
        return chance === null || chance === undefined || chance >= 75;
      });

      if (!available.length) continue;

      // Apply strategy
      const pick = applyStrategy(bot.bot_strategy || 'form', available, fixture, playerStats, pickCounts);
      if (pick) {
        picks.push({
          id: crypto.randomUUID(),
          user_id: bot.id,
          fixture_id: fixture.id,
          element_id: pick.element_id,
          gw: activeGW,
          locked: false,
        });
      }
    }

    if (picks.length) {
      allNewPicks.push(...picks);
      botResults.push({ bot: bot.team_name, strategy: bot.bot_strategy, picks: picks.length });
    }
  }

  // 7. Batch insert all picks
  if (allNewPicks.length) {
    // Insert in batches of 50
    for (let i = 0; i < allNewPicks.length; i += 50) {
      await sbInsert('picks', allNewPicks.slice(i, i + 50));
    }
  }

  return {
    message: `Generated picks for ${botResults.length} bots`,
    bots: botResults,
    hoursToDeadline: hoursToDeadline.toFixed(1),
  };
}

// === Strategy implementations ===

function applyStrategy(strategy, available, fixture, playerStats, pickCounts) {
  // Enrich with stats
  const enriched = available.map(p => ({
    ...p,
    stats: playerStats[p.element_id] || { avgRank: 15, formBps: 0, goats: 0, games: 0, totalMinutes: 0, streak: 0 },
  }));

  // Filter out players with 0 games (never played)
  const played = enriched.filter(p => p.stats.games > 0);
  if (!played.length) return randomPick(enriched);

  let candidates;

  switch (strategy) {
    case 'form':
      candidates = topN(played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;

    case 'goat':
      candidates = topN(played, 3, (a, b) => b.stats.goats - a.stats.goats);
      break;

    case 'rank':
      candidates = topN(played, 3, (a, b) => a.stats.avgRank - b.stats.avgRank);
      break;

    case 'home': {
      const home = played.filter(p => p.team_id === fixture.home_team_id);
      candidates = topN(home.length ? home : played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
    }

    case 'away': {
      const away = played.filter(p => p.team_id === fixture.away_team_id);
      candidates = topN(away.length ? away : played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
    }

    case 'streak': {
      const streakers = played.filter(p => p.stats.streak > 0);
      if (streakers.length) {
        candidates = topN(streakers, 3, (a, b) => b.stats.streak - a.stats.streak);
      } else {
        // Fallback: sort by form
        candidates = topN(played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      }
      break;
    }

    case 'ironman':
      candidates = topN(played, 3, (a, b) => b.stats.totalMinutes - a.stats.totalMinutes);
      break;

    case 'contrarian': {
      const top5 = topN(played, 5, (a, b) => b.stats.formBps - a.stats.formBps);
      const fixPicks = pickCounts[fixture.id] || {};
      const unpicked = top5.filter(p => !fixPicks[p.element_id]);
      candidates = unpicked.length ? unpicked : top5;
      break;
    }

    case 'combo': {
      // Weighted score: form*0.4 + goats*0.3 + rank_score*0.3
      const maxForm = Math.max(...played.map(p => p.stats.formBps), 1);
      const maxGoats = Math.max(...played.map(p => p.stats.goats), 1);
      for (const p of played) {
        const formNorm = p.stats.formBps / maxForm;
        const goatNorm = p.stats.goats / maxGoats;
        const rankNorm = 1 - (p.stats.avgRank / 30); // lower rank = better, normalize
        p._comboScore = formNorm * 0.4 + goatNorm * 0.3 + Math.max(0, rankNorm) * 0.3;
      }
      candidates = topN(played, 3, (a, b) => b._comboScore - a._comboScore);
      break;
    }

    case 'fwd_only': {
      const fwds = played.filter(p => p.position === 'FWD');
      candidates = topN(fwds.length ? fwds : played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
    }

    case 'mid_only': {
      const mids = played.filter(p => p.position === 'MID');
      candidates = topN(mids.length ? mids : played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
    }

    case 'def_only': {
      const defs = played.filter(p => p.position === 'DEF' || p.position === 'GKP');
      candidates = topN(defs.length ? defs : played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
    }

    case 'chaos':
      return randomPick(available);

    default:
      // Unknown strategy — fallback to form
      candidates = topN(played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
  }

  return randomPick(candidates || played);
}

function topN(arr, n, compareFn) {
  return [...arr].sort(compareFn).slice(0, n);
}

function randomPick(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}
