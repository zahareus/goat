// GW scoring + prize distribution for the prize economy.
// computeGwStandings mirrors the leaderboard math in app.js loadGWStandings —
// app.js is a plain browser script and cannot import this module, so any change
// here must be mirrored there (tests/scoring.test.js guards the invariants).

const { assignTiedRanks } = require('./rankings.js');

const PRIZE_GRID = [50, 40, 30, 20, 10]; // stars for places 1..5, 150/GW total

// picks: [{user_id, fixture_id, element_id}], results: [{fixture_id, element_id, bps, is_goat}]
// → [{uid, goats, bps, rank}] sorted by goats desc, bps desc, with tied ranks
function computeGwStandings(picks, results) {
  const resMap = {};
  for (const r of results) {
    if (!resMap[r.fixture_id]) resMap[r.fixture_id] = {};
    resMap[r.fixture_id][r.element_id] = r;
  }
  const userScores = {};
  for (const pick of picks) {
    if (!userScores[pick.user_id]) userScores[pick.user_id] = { goats: 0, bps: 0 };
    const r = resMap[pick.fixture_id] && resMap[pick.fixture_id][pick.element_id];
    if (r) {
      userScores[pick.user_id].bps += r.bps;
      if (r.is_goat) userScores[pick.user_id].goats++;
    }
  }
  const sorted = Object.entries(userScores)
    .map(([uid, s]) => ({ uid, goats: s.goats, bps: s.bps }))
    .sort((a, b) => b.goats - a.goats || b.bps - a.bps);
  assignTiedRanks(sorted);
  return sorted;
}

// Pool-based prize split: a tie group jointly occupying prize places p..p+n-1
// shares the sum of those slots equally, rounded down. Rounding remainder is
// simply not paid out. Players with 0 GOAT hits win nothing.
// → [{uid, place, stars}]
function distributePrizes(standings, grid = PRIZE_GRID) {
  const eligible = standings.filter(s => s.goats > 0);
  const prizes = [];
  let pos = 1;
  let i = 0;
  while (i < eligible.length && pos <= grid.length) {
    let j = i;
    while (
      j + 1 < eligible.length &&
      eligible[j + 1].goats === eligible[i].goats &&
      eligible[j + 1].bps === eligible[i].bps
    ) j++;
    const size = j - i + 1;
    let pool = 0;
    for (let p = pos; p < pos + size && p <= grid.length; p++) pool += grid[p - 1];
    const each = Math.floor(pool / size);
    if (each > 0) {
      for (let k = i; k <= j; k++) prizes.push({ uid: eligible[k].uid, place: pos, stars: each });
    }
    pos += size;
    i = j + 1;
  }
  return prizes;
}

// '2026-27' for any date from July 2026 through June 2027
function seasonForDate(d = new Date()) {
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() + 1 >= 7 ? y : y - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

module.exports = { PRIZE_GRID, computeGwStandings, distributePrizes, seasonForDate };
