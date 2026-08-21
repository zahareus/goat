// api/bot-picks.js — Generate picks for GOAT bots
// POST /api/bot-picks?secret=GOAT_NOTIFY_SECRET
// Called by n8n every 30 min — checks which bots should submit picks based on hours_before

const { applyStrategy } = require('../lib/bot-strategies');

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';

// Blend weight of last season's BPS/90 against this season's form. At GW1 the
// prior is all we have; by GW6+ real BPS dominates. ponytail: one constant, not a
// decay curve — tune it if bots look too stubborn in September.
const PRIOR_WEIGHT = 4;


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

// === When a bot submits ===
//
// Bots exist so a real player never opens a gameweek to an empty field, so they
// have to be finished before that player shows up — and the room between rounds is
// not constant. A midweek round can open a day before kickoff; a break can open ten
// days before. So a bot's slot is a FRACTION of the actual window, not a fixed
// number of hours: 0 = the moment picks open, 1 = last call.

const BOT_LAST_CALL_HOURS = 3;

// Picks for a round effectively open when the previous round's last match starts —
// that is when this endpoint begins targeting it. No previous round (season opener)
// falls back to a week.
async function pickWindowStart(gw, deadline) {
  const prev = await sbSelect('fixtures', `gw=eq.${gw - 1}&select=kickoff_time&order=kickoff_time.desc&limit=1`);
  if (prev && prev.length) return new Date(prev[0].kickoff_time);
  return new Date(deadline.getTime() - 7 * 24 * 3600 * 1000);
}

function botIsDue(bot, windowStart, deadline, now) {
  const end = new Date(deadline.getTime() - BOT_LAST_CALL_HOURS * 3600 * 1000);
  let start = windowStart;
  // Tight turnaround (or a round that opened late): compress rather than skip, so
  // everyone still lands before last call.
  if (start >= end) start = new Date(end.getTime() - 3600 * 1000);

  const slot = bot.pick_slot === null || bot.pick_slot === undefined
    ? fallbackSlot(bot, start, end)
    : Math.min(1, Math.max(0, Number(bot.pick_slot)));

  const due = start.getTime() + slot * (end.getTime() - start.getTime());
  return now.getTime() >= due;
}

// Bot predates the pick_slot column — place it by its old hours_before.
function fallbackSlot(bot, start, end) {
  const hb = bot.hours_before || 12;
  const due = end.getTime() + (BOT_LAST_CALL_HOURS - hb) * 3600 * 1000;
  const span = end.getTime() - start.getTime();
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (due - start.getTime()) / span));
}

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

async function sbUpsert(table, rows, onConflict) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Upsert ${table} failed: ${r.status} ${await r.text()}`);
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
  const bots = await sbSelect('profiles', 'is_bot=eq.true&bot_active=eq.true&select=id,team_name,bot_strategy,hours_before,pick_slot');
  if (!bots.length) return { message: 'No bots configured' };

  // 4. Check which bots should pick now
  const now = new Date();
  const hoursToDeadline = (effectiveDeadline - now) / (1000 * 60 * 60);

  // Get existing bot picks for this GW
  const botIds = bots.map(b => `"${b.id}"`).join(',');
  const existingPicks = await sbSelect('picks', `gw=eq.${activeGW}&user_id=in.(${botIds})&select=user_id,fixture_id`);
  const existingSet = new Set(existingPicks.map(p => `${p.user_id}_${p.fixture_id}`));

  // Filter bots: their slot has come AND they are still missing at least one fixture.
  // Per-fixture, not per-GW: fixtures unlock progressively, and a deleted pick must
  // be regenerated without the bot's other picks blocking the whole gameweek.
  const openFixtures = fixtures.filter(f => new Date(f.kickoff_time) > new Date());
  const windowStart = await pickWindowStart(activeGW, effectiveDeadline);
  const botsToRun = bots.filter(b => {
    const missing = openFixtures.some(f => !existingSet.has(`${b.id}_${f.id}`));
    return missing && botIsDue(b, windowStart, effectiveDeadline, now);
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

    playerStats[eid] = { avgRank: bayesAvg, formBps, goats, games: n, totalMinutes, streak,
                         _rankSum: rankSum, _n: n, _formBpsSum: formBpsSum,
                         priorBps90: 0, priorMinutes: 0 };
  }

  // === Last season's prior ===
  // Without it every strategy is blind until ~GW6 (and totally blind at GW1, which
  // is how 8 of 10 bots ended up on Coventry in the opener). See populate-prior.js.
  const priors = await sbSelect('player_prior', 'select=element_id,prior_bps90,prior_minutes');
  const priorMap = {};
  for (const r of priors) priorMap[r.element_id] = r;

  // Percentile of BPS/90 among established players, used to seed the Bayesian rank
  // mean per player instead of the flat 15 (which made every debutant look average).
  const establishedBps90 = priors.filter(r => r.prior_minutes >= 450).map(r => Number(r.prior_bps90)).sort((a, b) => a - b);
  const pctOf = (v) => {
    if (!establishedBps90.length) return 0.5;
    let lo = 0;
    while (lo < establishedBps90.length && establishedBps90[lo] < v) lo++;
    return lo / establishedBps90.length;
  };

  for (const p of players) {
    const eid = p.element_id;
    const pr = priorMap[eid];
    const bps90 = pr ? Number(pr.prior_bps90) || 0 : 0;
    const priorMinutes = pr ? pr.prior_minutes || 0 : 0;
    if (!playerStats[eid]) {
      playerStats[eid] = { avgRank: 15, formBps: 0, goats: 0, games: 0, totalMinutes: 0, streak: 0,
                           _rankSum: 0, _n: 0, _formBpsSum: 0, priorBps90: 0, priorMinutes: 0 };
    }
    const st = playerStats[eid];
    st.priorBps90 = bps90;
    st.priorMinutes = priorMinutes;
    if (priorMinutes > 0) {
      // Form: prior counts as PRIOR_WEIGHT extra appearances at last season's rate.
      st.formBps = (st._formBpsSum + PRIOR_WEIGHT * bps90) / (6 + PRIOR_WEIGHT);
      // Rank: seed the Bayesian mean from where the player sat last season.
      const seed = Math.min(30, Math.max(1, 1 + 29 * (1 - pctOf(bps90))));
      st.avgRank = (C * seed + st._rankSum) / (C + st._n);
    }
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

  // === RotoWire predicted lineups (reuses the endpoint notify.js already consumes) ===
  // Keyed "homeFplTeamId-awayFplTeamId"; GOAT team_ids ARE FPL team ids.
  let lineups = {};
  try {
    const lr = await fetch('https://goatapp.club/api/lineups');
    if (lr.ok) {
      const ld = await lr.json();
      if (!ld.error) lineups = ld;
    }
  } catch (e) { console.warn('Lineups fetch failed:', e.message); }

  // === Bookmaker 1X2 → per-team weight ===
  const teamWeights = await fetchTeamWeights(fixtures);

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
  const degraded = [];

  const startersByFixture = {};
  for (const f of fixtures) {
    const side = lineups[`${f.home_team_id}-${f.away_team_id}`];
    if (!side) continue;
    const ids = [...(side.home || []), ...(side.away || [])]
      .filter(pl => pl.status === 'starter')
      .map(pl => pl.fpl_id);
    if (ids.length) startersByFixture[f.id] = new Set(ids);
  }

  for (const bot of botsToRun) {
    const picks = [];

    for (const fixture of fixtures) {
      // Skip locked fixtures and ones this bot already picked
      if (fixture.status !== 'scheduled' || new Date(fixture.kickoff_time) <= now) continue;
      if (existingSet.has(`${bot.id}_${fixture.id}`)) continue;

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
      const pick = applyStrategy(bot.bot_strategy || 'form', available, fixture, playerStats, pickCounts, {
        starters: startersByFixture[fixture.id] || null,
        teamWeightHome: teamWeights[fixture.id] ?? null,
      });
      if (pick) {
        if (pick.__degraded) degraded.push(`${bot.team_name} @ fixture ${fixture.id}`);
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

  // Loud fallback: a bot that found no ranking signal at all picked a coin flip.
  // This used to happen silently — the only symptom was odd picks in the UI.
  if (degraded.length) {
    console.error(`BOT DEGRADED to random for ${degraded.length} picks:`, degraded.join('; '));
    await alertAdmin(`\u26a0\ufe0f GOAT bots: ${degraded.length} \u043f\u0456\u043a\u0456\u0432 \u0437\u0440\u043e\u0431\u043b\u0435\u043d\u043e \u0420\u0410\u041d\u0414\u041e\u041c\u041e\u041c (\u043d\u0435\u043c\u0430\u0454 \u043d\u0456 \u0456\u0441\u0442\u043e\u0440\u0456\u0457, \u043d\u0456 \u043f\u0440\u0430\u0439\u043e\u0440\u0430) \u2014 GW${activeGW}. \u041f\u0435\u0440\u0435\u0432\u0456\u0440 player_prior / player_history.`);
  }

  return {
    message: `Generated picks for ${botResults.length} bots`,
    bots: botResults,
    hoursToDeadline: hoursToDeadline.toFixed(1),
    lineupsUsed: Object.keys(startersByFixture).length,
    oddsUsed: Object.keys(teamWeights).length,
    degraded: degraded.length,
  };
}

async function alertAdmin(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const chat = process.env.GOAT_ADMIN_CHAT_ID || '292048';
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch (e) { console.warn('Admin alert failed:', e.message); }
}

// === Bookmaker odds → team weight ===

// the-odds-api soccer_epl h2h (same source and free key ledap uses). Returns
// { fixtureId: weightHome }, where weightHome is the de-vigged win probability of
// the home side with the draw split evenly. Missing key or missing line => no tilt.
async function fetchTeamWeights(fixtures) {
  const key = process.env.THE_ODDS_API_KEY;
  const out = {};
  if (!key) {
    console.warn('THE_ODDS_API_KEY not set — bots pick teams 50/50 instead of by odds');
    return out;
  }

  // ONE call per gameweek: the first bot to wake up prices the whole round and
  // everyone else reads the cache. The free tier is 500 calls a MONTH and ledap
  // shares it, so per-tick fetching is not an option. Lines inside a gameweek
  // move too little to be worth refreshing.
  const ids = fixtures.map(f => f.id).join(',');
  const cached = await sbSelect('odds_cache', `fixture_id=in.(${ids})&select=fixture_id,weight_home`);
  if (cached.length) {
    for (const r of cached) out[r.fixture_id] = Number(r.weight_home);
    console.log(`Odds from cache (${cached.length} fixtures)`);
    return out;
  }

  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=eu&markets=h2h&oddsFormat=decimal&apiKey=${key}`);
    if (!r.ok) { console.warn('Odds fetch failed:', r.status); return out; }
    const events = await r.json();

    // FPL long names per team id, for matching against the bookmaker's names.
    const teamName = {};
    try {
      const fr = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
      if (fr.ok) for (const t of (await fr.json()).teams) teamName[t.id] = teamKey(t.name);
    } catch (e) { /* fall through — no names, no match */ }

    for (const f of fixtures) {
      const hn = teamName[f.home_team_id], an = teamName[f.away_team_id];
      if (!hn || !an) continue;
      const ev = events.find(e => nameMatch(teamKey(e.home_team), hn) && nameMatch(teamKey(e.away_team), an));
      if (!ev) continue;
      const book = ev.bookmakers?.find(b => b.key === 'pinnacle') || ev.bookmakers?.[0];
      const market = book?.markets?.find(m => m.key === 'h2h');
      if (!market) continue;
      const price = (name) => market.outcomes.find(o => norm(o.name) === norm(name))?.price;
      const oh = price(ev.home_team), oa = price(ev.away_team), od = price('Draw');
      if (!oh || !oa || !od) continue;
      const inv = 1 / oh + 1 / oa + 1 / od;
      const ph = (1 / oh) / inv, pd = (1 / od) / inv;
      out[f.id] = ph + pd / 2; // draw split evenly between the sides
    }

    const rows = Object.entries(out).map(([fixture_id, weight_home]) => ({
      fixture_id: Number(fixture_id), weight_home, fetched_at: new Date().toISOString(),
    }));
    if (rows.length) await sbUpsert('odds_cache', rows, 'fixture_id');
  } catch (e) {
    console.warn('Odds error:', e.message);
    // Stale cache beats no odds at all — lines barely move inside a gameweek.
    if (!Object.keys(out).length) for (const r of cached) out[r.fixture_id] = Number(r.weight_home);
  }
  return out;
}

// FPL abbreviates ("Man Utd", "Spurs"), the bookmaker spells it out.
const NAME_FIX = {
  manutd: 'manchesterunited', mancity: 'manchestercity', spurs: 'tottenhamhotspur',
  nottmforest: 'nottinghamforest', leeds: 'leedsunited', wolves: 'wolverhamptonwanderers',
  newcastle: 'newcastleunited', ipswich: 'ipswichtown', hull: 'hullcity',
};

function norm(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(fc|afc|and|&)\b/g, '').replace(/[^a-z]/g, '');
}

function teamKey(s) {
  const n = norm(s);
  return NAME_FIX[n] || n;
}

function nameMatch(a, b) {
  return a === b || a.includes(b) || b.includes(a);
}

// Exported for verification scripts and tests; the handler itself is the default export.
module.exports.fetchTeamWeights = fetchTeamWeights;

module.exports.botIsDue = botIsDue;
