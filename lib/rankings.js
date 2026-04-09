// Pure ranking logic extracted from app.js for testability

export function assignTiedRanks(sorted) {
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) { sorted[i].rank = 1; continue; }
    const prev = sorted[i - 1];
    sorted[i].rank = (sorted[i].goats === prev.goats && sorted[i].bps === prev.bps) ? prev.rank : i + 1;
  }
}

export function calcPlayerStats(allHistory) {
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

    const totalMinutes = rows.reduce((s, r) => s + (r.minutes || 0), 0);

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

  return { playerStats, statsMaxRound };
}
