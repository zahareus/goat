import { describe, it, expect } from 'vitest';
import { computeGwStandings, distributePrizes, seasonForDate, PRIZE_GRID } from '../lib/scoring.js';

const pick = (u, f, e) => ({ user_id: u, fixture_id: f, element_id: e });
const res = (f, e, bps, goat) => ({ fixture_id: f, element_id: e, bps, is_goat: goat });

describe('computeGwStandings', () => {
  it('ranks by goats desc then bps desc with tied ranks', () => {
    const picks = [pick('a', 1, 10), pick('b', 1, 11), pick('c', 1, 12)];
    const results = [res(1, 10, 30, true), res(1, 11, 30, true), res(1, 12, 20, false)];
    const s = computeGwStandings(picks, results);
    expect(s.map(x => [x.uid, x.rank])).toEqual([['a', 1], ['b', 1], ['c', 3]]);
  });

  it('missing result counts as 0 bps, no goat', () => {
    const s = computeGwStandings([pick('a', 1, 10)], []);
    expect(s[0]).toMatchObject({ uid: 'a', goats: 0, bps: 0 });
  });
});

describe('distributePrizes', () => {
  const entry = (uid, goats, bps) => ({ uid, goats, bps });

  it('clean top-5 gets 50/40/30/20/10', () => {
    const standings = computeGwStandings(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((u, i) => pick(u, i + 1, i + 1)),
      ['a', 'b', 'c', 'd', 'e', 'f'].map((u, i) => res(i + 1, i + 1, 60 - i * 5, true))
    );
    const p = distributePrizes(standings);
    expect(p).toEqual([
      { uid: 'a', place: 1, stars: 50 },
      { uid: 'b', place: 2, stars: 40 },
      { uid: 'c', place: 3, stars: 30 },
      { uid: 'd', place: 4, stars: 20 },
      { uid: 'e', place: 5, stars: 10 },
    ]);
  });

  it('tie from 2nd to 7th: six players share slots 2-5 pool (100), floor(100/6)=16', () => {
    const standings = [
      entry('w', 3, 100),
      ...['t1', 't2', 't3', 't4', 't5', 't6'].map(u => entry(u, 2, 50)),
    ];
    standings.forEach((s, i) => (s.rank = i === 0 ? 1 : 2));
    const p = distributePrizes(standings);
    expect(p[0]).toEqual({ uid: 'w', place: 1, stars: 50 });
    const tied = p.slice(1);
    expect(tied).toHaveLength(6);
    tied.forEach(t => expect(t).toMatchObject({ place: 2, stars: 16 }));
    // total never exceeds the grid sum; remainder (4) is not paid
    expect(p.reduce((s, x) => s + x.stars, 0)).toBe(50 + 96);
  });

  it('100-way tie at 2nd place: pool 100 → 1 star each, fund capped', () => {
    const standings = [entry('w', 5, 200)];
    for (let i = 0; i < 100; i++) standings.push(entry(`u${i}`, 1, 10));
    const p = distributePrizes(standings);
    expect(p).toHaveLength(101);
    expect(p.reduce((s, x) => s + x.stars, 0)).toBe(50 + 100);
    expect(p[1].stars).toBe(1);
  });

  it('huge tie where floor gives 0 stars pays nothing', () => {
    const standings = [];
    for (let i = 0; i < 200; i++) standings.push(entry(`u${i}`, 1, 10));
    expect(distributePrizes(standings)).toEqual([]);
  });

  it('0-goat players win nothing even inside top-5', () => {
    const standings = [entry('a', 1, 5), entry('b', 0, 99), entry('c', 0, 50)];
    const p = distributePrizes(standings);
    expect(p).toEqual([{ uid: 'a', place: 1, stars: 50 }]);
  });

  it('grid total is 150', () => {
    expect(PRIZE_GRID.reduce((a, b) => a + b, 0)).toBe(150);
  });
});

describe('seasonForDate', () => {
  it('August 2026 → 2026-27, May 2027 → 2026-27, July 2027 → 2027-28', () => {
    expect(seasonForDate(new Date('2026-08-11'))).toBe('2026-27');
    expect(seasonForDate(new Date('2027-05-20'))).toBe('2026-27');
    expect(seasonForDate(new Date('2027-07-01'))).toBe('2027-28');
  });
});
