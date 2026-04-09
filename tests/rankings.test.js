import { describe, it, expect } from 'vitest';
import { assignTiedRanks, calcPlayerStats } from '../lib/rankings.js';

// === assignTiedRanks ===

describe('assignTiedRanks', () => {
  it('assigns sequential ranks for unique scores', () => {
    const sorted = [
      { goats: 5, bps: 100 },
      { goats: 3, bps: 80 },
      { goats: 1, bps: 50 },
    ];
    assignTiedRanks(sorted);
    expect(sorted.map(s => s.rank)).toEqual([1, 2, 3]);
  });

  it('assigns tied ranks for equal goats and bps', () => {
    const sorted = [
      { goats: 5, bps: 100 },
      { goats: 5, bps: 100 },
      { goats: 3, bps: 80 },
    ];
    assignTiedRanks(sorted);
    expect(sorted.map(s => s.rank)).toEqual([1, 1, 3]);
  });

  it('handles three-way tie', () => {
    const sorted = [
      { goats: 5, bps: 100 },
      { goats: 5, bps: 100 },
      { goats: 5, bps: 100 },
      { goats: 2, bps: 50 },
    ];
    assignTiedRanks(sorted);
    expect(sorted.map(s => s.rank)).toEqual([1, 1, 1, 4]);
  });

  it('handles ties at different positions', () => {
    const sorted = [
      { goats: 5, bps: 100 },
      { goats: 3, bps: 80 },
      { goats: 3, bps: 80 },
      { goats: 1, bps: 50 },
    ];
    assignTiedRanks(sorted);
    expect(sorted.map(s => s.rank)).toEqual([1, 2, 2, 4]);
  });

  it('handles single player', () => {
    const sorted = [{ goats: 5, bps: 100 }];
    assignTiedRanks(sorted);
    expect(sorted[0].rank).toBe(1);
  });

  it('tie breaks on bps not just goats', () => {
    const sorted = [
      { goats: 5, bps: 100 },
      { goats: 5, bps: 90 },  // same goats but different bps
    ];
    assignTiedRanks(sorted);
    expect(sorted.map(s => s.rank)).toEqual([1, 2]);
  });
});

// === calcPlayerStats ===

describe('calcPlayerStats', () => {
  it('calculates basic stats for a single player', () => {
    const history = [
      { element_id: 1, bps_rank: 1, bps: 40, round: 1, minutes: 90 },
      { element_id: 1, bps_rank: 3, bps: 25, round: 2, minutes: 90 },
      { element_id: 1, bps_rank: 2, bps: 30, round: 3, minutes: 90 },
    ];
    const { playerStats, statsMaxRound } = calcPlayerStats(history);

    expect(statsMaxRound).toBe(3);
    expect(playerStats[1]).toBeDefined();
    expect(playerStats[1].games).toBe(3);
    expect(playerStats[1].goats).toBe(1); // only round 1 has bps_rank === 1
    expect(playerStats[1].totalMinutes).toBe(270);
  });

  it('calculates Bayesian average rank', () => {
    // C=6, M=15: bayesAvg = (6*15 + sum_of_ranks) / (6 + n)
    const history = [
      { element_id: 1, bps_rank: 1, bps: 40, round: 1, minutes: 90 },
      { element_id: 1, bps_rank: 1, bps: 35, round: 2, minutes: 90 },
    ];
    const { playerStats } = calcPlayerStats(history);
    // (6*15 + 1 + 1) / (6 + 2) = (90 + 2) / 8 = 11.5
    expect(playerStats[1].avgRank).toBeCloseTo(11.5);
  });

  it('calculates form BPS over last 6 GWs', () => {
    const history = [];
    for (let round = 1; round <= 10; round++) {
      history.push({ element_id: 1, bps_rank: 5, bps: round * 10, round, minutes: 90 });
    }
    const { playerStats } = calcPlayerStats(history);
    // formStart = max(1, 10-5) = 5, rounds 5-10
    // formBps = (50+60+70+80+90+100) / 6 = 75
    expect(playerStats[1].formBps).toBeCloseTo(75);
  });

  it('detects ascending BPS streak', () => {
    const history = [
      { element_id: 1, bps_rank: 5, bps: 10, round: 1, minutes: 90 },
      { element_id: 1, bps_rank: 4, bps: 20, round: 2, minutes: 90 },
      { element_id: 1, bps_rank: 3, bps: 30, round: 3, minutes: 90 },
    ];
    const { playerStats } = calcPlayerStats(history);
    // b1=10, b2=20, b3=30 — ascending, all > 0 → streak = b3 = 30
    expect(playerStats[1].streak).toBe(30);
  });

  it('no streak when not ascending', () => {
    const history = [
      { element_id: 1, bps_rank: 5, bps: 30, round: 1, minutes: 90 },
      { element_id: 1, bps_rank: 4, bps: 20, round: 2, minutes: 90 },
      { element_id: 1, bps_rank: 3, bps: 10, round: 3, minutes: 90 },
    ];
    const { playerStats } = calcPlayerStats(history);
    expect(playerStats[1].streak).toBe(0);
  });

  it('handles multiple players', () => {
    const history = [
      { element_id: 1, bps_rank: 1, bps: 40, round: 1, minutes: 90 },
      { element_id: 2, bps_rank: 2, bps: 30, round: 1, minutes: 90 },
      { element_id: 1, bps_rank: 3, bps: 20, round: 2, minutes: 90 },
      { element_id: 2, bps_rank: 1, bps: 45, round: 2, minutes: 90 },
    ];
    const { playerStats } = calcPlayerStats(history);

    expect(playerStats[1]).toBeDefined();
    expect(playerStats[2]).toBeDefined();
    expect(playerStats[1].goats).toBe(1);
    expect(playerStats[2].goats).toBe(1);
  });

  it('excludes unranked entries from games count', () => {
    const history = [
      { element_id: 1, bps_rank: 1, bps: 40, round: 1, minutes: 90 },
      { element_id: 1, bps_rank: null, bps: 0, round: 2, minutes: 0 }, // didn't play
    ];
    const { playerStats } = calcPlayerStats(history);
    expect(playerStats[1].games).toBe(1); // only 1 ranked entry
    expect(playerStats[1].totalMinutes).toBe(90);
  });

  it('returns empty stats for empty history', () => {
    const { playerStats, statsMaxRound } = calcPlayerStats([]);
    expect(statsMaxRound).toBe(0);
    expect(Object.keys(playerStats)).toHaveLength(0);
  });
});
