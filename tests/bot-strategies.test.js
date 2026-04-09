import { describe, it, expect } from 'vitest';
import { topN, randomPick, applyStrategy } from '../lib/bot-strategies.js';

// === Test data factories ===

function makePlayer(overrides = {}) {
  return {
    element_id: overrides.element_id || 1,
    name: overrides.name || 'Test Player',
    team_id: overrides.team_id || 1,
    position: overrides.position || 'MID',
    ...overrides,
  };
}

function makeFixture(overrides = {}) {
  return {
    id: overrides.id || 100,
    home_team_id: overrides.home_team_id || 1,
    away_team_id: overrides.away_team_id || 2,
    ...overrides,
  };
}

function makeStats(overrides = {}) {
  return {
    avgRank: 10,
    formBps: 20,
    goats: 2,
    games: 5,
    totalMinutes: 450,
    streak: 0,
    ...overrides,
  };
}

// === topN ===

describe('topN', () => {
  it('returns top N items by comparator', () => {
    const items = [{ v: 3 }, { v: 1 }, { v: 5 }, { v: 2 }, { v: 4 }];
    const result = topN(items, 3, (a, b) => b.v - a.v);
    expect(result.map(i => i.v)).toEqual([5, 4, 3]);
  });

  it('returns all items if N > array length', () => {
    const items = [{ v: 2 }, { v: 1 }];
    const result = topN(items, 5, (a, b) => b.v - a.v);
    expect(result).toHaveLength(2);
  });

  it('does not mutate original array', () => {
    const items = [{ v: 3 }, { v: 1 }, { v: 2 }];
    const original = [...items];
    topN(items, 2, (a, b) => b.v - a.v);
    expect(items.map(i => i.v)).toEqual(original.map(i => i.v));
  });
});

// === randomPick ===

describe('randomPick', () => {
  it('returns null for empty array', () => {
    expect(randomPick([])).toBeNull();
  });

  it('returns the only element for single-item array', () => {
    expect(randomPick([42])).toBe(42);
  });

  it('returns an element from the array', () => {
    const arr = [1, 2, 3, 4, 5];
    const result = randomPick(arr);
    expect(arr).toContain(result);
  });
});

// === applyStrategy ===

describe('applyStrategy', () => {
  const fixture = makeFixture();

  // Players with different stats profiles
  const players = [
    makePlayer({ element_id: 1, name: 'Form Star', team_id: 1, position: 'MID' }),
    makePlayer({ element_id: 2, name: 'GOAT King', team_id: 1, position: 'FWD' }),
    makePlayer({ element_id: 3, name: 'Rank Master', team_id: 2, position: 'DEF' }),
    makePlayer({ element_id: 4, name: 'Iron Man', team_id: 2, position: 'GKP' }),
    makePlayer({ element_id: 5, name: 'Streaker', team_id: 1, position: 'MID' }),
    makePlayer({ element_id: 6, name: 'Newbie', team_id: 2, position: 'FWD' }),
  ];

  const playerStats = {
    1: makeStats({ formBps: 50, goats: 1, avgRank: 8, totalMinutes: 300, streak: 0 }),
    2: makeStats({ formBps: 30, goats: 5, avgRank: 5, totalMinutes: 400, streak: 0 }),
    3: makeStats({ formBps: 20, goats: 2, avgRank: 3, totalMinutes: 500, streak: 0 }),
    4: makeStats({ formBps: 10, goats: 0, avgRank: 12, totalMinutes: 900, streak: 0 }),
    5: makeStats({ formBps: 40, goats: 3, avgRank: 6, totalMinutes: 350, streak: 25 }),
    // 6 has no stats — should be treated as never-played
  };

  describe('form strategy', () => {
    it('picks from top 3 by form BPS', () => {
      const result = applyStrategy('form', players, fixture, playerStats, {});
      // Top 3 by formBps: player 1 (50), 5 (40), 2 (30)
      expect([1, 5, 2]).toContain(result.element_id);
    });
  });

  describe('goat strategy', () => {
    it('picks from top 3 by GOAT count', () => {
      const result = applyStrategy('goat', players, fixture, playerStats, {});
      // Top 3 by goats: player 2 (5), 5 (3), 3 (2)
      expect([2, 5, 3]).toContain(result.element_id);
    });
  });

  describe('rank strategy', () => {
    it('picks from top 3 by avg rank (lowest is best)', () => {
      const result = applyStrategy('rank', players, fixture, playerStats, {});
      // Top 3 by avgRank (ascending): player 3 (3), 2 (5), 5 (6)
      expect([3, 2, 5]).toContain(result.element_id);
    });
  });

  describe('home strategy', () => {
    it('picks from home team players', () => {
      const result = applyStrategy('home', players, fixture, playerStats, {});
      // Home team = team_id 1: players 1, 2, 5
      expect([1, 2, 5]).toContain(result.element_id);
    });
  });

  describe('away strategy', () => {
    it('picks from away team players', () => {
      const result = applyStrategy('away', players, fixture, playerStats, {});
      // Away team = team_id 2: players 3, 4, 6
      // Player 6 has no stats, so only 3 and 4 are "played"
      expect([3, 4]).toContain(result.element_id);
    });
  });

  describe('streak strategy', () => {
    it('picks players with active streaks', () => {
      const result = applyStrategy('streak', players, fixture, playerStats, {});
      // Only player 5 has streak > 0
      expect(result.element_id).toBe(5);
    });

    it('falls back to form when no streakers', () => {
      const noStreakStats = { ...playerStats };
      noStreakStats[5] = makeStats({ ...playerStats[5], streak: 0 });
      const result = applyStrategy('streak', players, fixture, noStreakStats, {});
      // Falls back to form: top 3 are 1 (50), 5 (40), 2 (30) — but 5's formBps is still 40
      expect([1, 5, 2]).toContain(result.element_id);
    });
  });

  describe('ironman strategy', () => {
    it('picks from top 3 by total minutes', () => {
      const result = applyStrategy('ironman', players, fixture, playerStats, {});
      // Top 3 by totalMinutes: player 4 (900), 3 (500), 2 (400)
      expect([4, 3, 2]).toContain(result.element_id);
    });
  });

  describe('contrarian strategy', () => {
    it('avoids already-picked players', () => {
      const pickCounts = { 100: { 1: 5, 5: 3, 2: 2 } }; // top form players are picked
      const result = applyStrategy('contrarian', players, fixture, playerStats, pickCounts);
      // Top 5 by form: 1, 5, 2, 3, 4. Unpicked from those: 3, 4
      expect([3, 4]).toContain(result.element_id);
    });

    it('falls back to top 5 when all are picked', () => {
      const pickCounts = { 100: { 1: 5, 2: 3, 3: 2, 4: 1, 5: 4 } };
      const result = applyStrategy('contrarian', players, fixture, playerStats, pickCounts);
      expect([1, 5, 2, 3, 4]).toContain(result.element_id);
    });
  });

  describe('combo strategy', () => {
    it('picks from top 3 by weighted combo score', () => {
      const result = applyStrategy('combo', players, fixture, playerStats, {});
      expect(result).not.toBeNull();
      expect(result.element_id).toBeDefined();
    });
  });

  describe('position filter strategies', () => {
    it('fwd_only picks forwards', () => {
      const result = applyStrategy('fwd_only', players, fixture, playerStats, {});
      // FWDs with stats: player 2
      expect(result.element_id).toBe(2);
    });

    it('mid_only picks midfielders', () => {
      const result = applyStrategy('mid_only', players, fixture, playerStats, {});
      // MIDs: player 1 (50), 5 (40)
      expect([1, 5]).toContain(result.element_id);
    });

    it('def_only picks defenders and goalkeepers', () => {
      const result = applyStrategy('def_only', players, fixture, playerStats, {});
      // DEF + GKP: player 3 (DEF), 4 (GKP)
      expect([3, 4]).toContain(result.element_id);
    });
  });

  describe('chaos strategy', () => {
    it('returns any available player (including no-stats)', () => {
      const result = applyStrategy('chaos', players, fixture, playerStats, {});
      const allIds = players.map(p => p.element_id);
      expect(allIds).toContain(result.element_id);
    });
  });

  describe('unknown strategy', () => {
    it('falls back to form', () => {
      const result = applyStrategy('nonexistent', players, fixture, playerStats, {});
      expect([1, 5, 2]).toContain(result.element_id);
    });
  });

  describe('edge cases', () => {
    it('handles all players with no stats (no games played)', () => {
      const noobPlayers = [
        makePlayer({ element_id: 10, team_id: 1 }),
        makePlayer({ element_id: 11, team_id: 2 }),
      ];
      const result = applyStrategy('form', noobPlayers, fixture, {}, {});
      // All have 0 games, should fall back to randomPick from enriched
      expect([10, 11]).toContain(result.element_id);
    });

    it('handles single available player', () => {
      const singlePlayer = [makePlayer({ element_id: 99, team_id: 1 })];
      const stats = { 99: makeStats() };
      const result = applyStrategy('form', singlePlayer, fixture, stats, {});
      expect(result.element_id).toBe(99);
    });
  });
});
