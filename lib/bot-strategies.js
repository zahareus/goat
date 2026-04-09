// Pure bot strategy logic extracted from api/bot-picks.js for testability
// Both bot-picks.js and tests import from here

export function topN(arr, n, compareFn) {
  return [...arr].sort(compareFn).slice(0, n);
}

export function randomPick(arr) {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export function applyStrategy(strategy, available, fixture, playerStats, pickCounts) {
  const enriched = available.map(p => ({
    ...p,
    stats: playerStats[p.element_id] || { avgRank: 15, formBps: 0, goats: 0, games: 0, totalMinutes: 0, streak: 0 },
  }));

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
      const maxForm = Math.max(...played.map(p => p.stats.formBps), 1);
      const maxGoats = Math.max(...played.map(p => p.stats.goats), 1);
      for (const p of played) {
        const formNorm = p.stats.formBps / maxForm;
        const goatNorm = p.stats.goats / maxGoats;
        const rankNorm = 1 - (p.stats.avgRank / 30);
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
      candidates = topN(played, 3, (a, b) => b.stats.formBps - a.stats.formBps);
      break;
  }

  return randomPick(candidates || played);
}
