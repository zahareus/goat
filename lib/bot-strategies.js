// Pure bot strategy logic. Required by api/bot-picks.js (CJS) and imported by tests.
// Keep this the ONLY copy — bot-picks.js used to carry a duplicate that silently
// diverged from the tested version.

function topN(arr, n, compareFn) {
  return [...arr].sort(compareFn).slice(0, n);
}

function randomPick(arr, rng) {
  if (!arr.length) return null;
  const r = rng ? rng() : Math.random();
  return arr[Math.floor(r * arr.length)];
}

// Weighted coin flip between the two teams of a fixture.
// weightHome is the de-vigged bookmaker probability of the home side (draw split
// evenly). Undefined weight => no tilt, caller gets both squads as one pool.
function chooseTeam(fixture, weightHome, rng) {
  if (weightHome === null || weightHome === undefined || !isFinite(weightHome)) return null;
  const r = rng ? rng() : Math.random();
  return r < weightHome ? fixture.home_team_id : fixture.away_team_id;
}

const DEFAULT_STATS = {
  avgRank: 15, formBps: 0, goats: 0, games: 0, totalMinutes: 0, streak: 0, priorBps90: 0, priorMinutes: 0,
};

// A player is usable by a strategy if we know ANYTHING about him — this season's
// minutes or last season's prior. Without either, every comparator is a tie and
// the bot degrades to a coin flip (see __degraded below).
function hasEvidence(s) {
  return s.games > 0 || s.priorMinutes > 0;
}

// Secondary sort key so equal primaries never resolve arbitrarily by array order.
function tieBreak(a, b) {
  return (b.stats.priorBps90 || 0) - (a.stats.priorBps90 || 0);
}

function by(fn) {
  return (a, b) => {
    const d = fn(a, b);
    return d !== 0 ? d : tieBreak(a, b);
  };
}

const byForm = by((a, b) => b.stats.formBps - a.stats.formBps);

function applyStrategy(strategy, available, fixture, playerStats, pickCounts, opts = {}) {
  const { starters = null, teamWeightHome = null, rng = null } = opts;

  // Predicted-lineup gate: when RotoWire has published an XI for this fixture,
  // only starters are eligible. No lineups yet => caller's chance_of_playing filter stands.
  let pool = available;
  if (starters && starters.size) {
    const inXI = available.filter(p => starters.has(p.element_id));
    if (inXI.length) pool = inXI;
  }

  const enriched = pool.map(p => ({
    ...p,
    stats: { ...DEFAULT_STATS, ...(playerStats[p.element_id] || {}) },
  }));

  let played = enriched.filter(p => hasEvidence(p.stats));
  if (!played.length) {
    const fallback = randomPick(enriched, rng);
    if (fallback) fallback.__degraded = 'no-evidence';
    return fallback;
  }

  // Odds tilt: decide WHICH SIDE first, then run the strategy inside that squad.
  // Skipped for strategies whose identity already fixes the team (home/away/chaos).
  if (strategy !== 'home' && strategy !== 'away' && strategy !== 'chaos') {
    const teamId = chooseTeam(fixture, teamWeightHome, rng);
    if (teamId) {
      const side = played.filter(p => p.team_id === teamId);
      if (side.length) played = side;
    }
  }

  let candidates;

  switch (strategy) {
    case 'form':
      candidates = topN(played, 3, byForm);
      break;

    case 'goat':
      candidates = topN(played, 3, by((a, b) => b.stats.goats - a.stats.goats));
      break;

    case 'rank':
      candidates = topN(played, 3, by((a, b) => a.stats.avgRank - b.stats.avgRank));
      break;

    case 'home': {
      const home = played.filter(p => p.team_id === fixture.home_team_id);
      candidates = topN(home.length ? home : played, 3, byForm);
      break;
    }

    case 'away': {
      const away = played.filter(p => p.team_id === fixture.away_team_id);
      candidates = topN(away.length ? away : played, 3, byForm);
      break;
    }

    case 'streak': {
      const streakers = played.filter(p => p.stats.streak > 0);
      candidates = streakers.length
        ? topN(streakers, 3, by((a, b) => b.stats.streak - a.stats.streak))
        : topN(played, 3, byForm);
      break;
    }

    case 'ironman':
      // ponytail: last season's minutes count a quarter — enough to rank an
      // established starter above a debutant in August, gone by midseason.
      candidates = topN(played, 3, by((a, b) =>
        (b.stats.totalMinutes + b.stats.priorMinutes * 0.25) -
        (a.stats.totalMinutes + a.stats.priorMinutes * 0.25)));
      break;

    case 'contrarian': {
      const top5 = topN(played, 5, byForm);
      const fixPicks = pickCounts[fixture.id] || {};
      const unpicked = top5.filter(p => !fixPicks[p.element_id]);
      candidates = unpicked.length ? unpicked : top5;
      break;
    }

    case 'combo': {
      const maxForm = Math.max(...played.map(p => p.stats.formBps), 1);
      const maxGoats = Math.max(...played.map(p => p.stats.goats), 1);
      for (const p of played) {
        const formNorm = p.stats.formBps / maxForm;
        const goatNorm = p.stats.goats / maxGoats;
        const rankNorm = 1 - (p.stats.avgRank / 30);
        p._comboScore = formNorm * 0.4 + goatNorm * 0.3 + Math.max(0, rankNorm) * 0.3;
      }
      candidates = topN(played, 3, by((a, b) => b._comboScore - a._comboScore));
      break;
    }

    case 'fwd_only':
    case 'mid_only':
    case 'def_only': {
      const wanted = strategy === 'fwd_only' ? ['FWD']
        : strategy === 'mid_only' ? ['MID']
        : ['DEF', 'GKP', 'GK'];
      const inPos = played.filter(p => wanted.includes(p.position));
      candidates = topN(inPos.length ? inPos : played, 3, byForm);
      break;
    }

    case 'chaos':
      return randomPick(enriched, rng);

    default:
      candidates = topN(played, 3, byForm);
      break;
  }

  return randomPick(candidates && candidates.length ? candidates : played, rng);
}

module.exports = { topN, randomPick, chooseTeam, hasEvidence, applyStrategy };
