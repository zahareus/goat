import { describe, it, expect } from 'vitest';
import { botIsDue } from '../api/bot-picks.js';

// Slots are a fraction of the pick window, so the same field of bots has to fill up
// before last call whether the round opens a day or ten days ahead.
const SLOTS = [0, 0.012, 0.049, 0.111, 0.198, 0.309, 0.444, 0.605, 0.79, 1];
const bots = SLOTS.map((pick_slot, i) => ({ pick_slot, team_name: 'bot' + i }));

const DEADLINE = new Date('2026-09-01T14:00:00Z');
const hoursBefore = h => new Date(DEADLINE.getTime() - h * 3600 * 1000);
const windowOf = gap => hoursBefore(gap);
const dueCount = (gap, at) => bots.filter(b => botIsDue(b, windowOf(gap), DEADLINE, hoursBefore(at))).length;

describe('bot arrival window', () => {
  for (const gap of [24, 96, 240]) {
    it(`fills the whole field by last call with a ${gap}h window`, () => {
      expect(dueCount(gap, 3)).toBe(bots.length);
    });

    it(`has most of the field in six hours before kickoff with a ${gap}h window`, () => {
      expect(dueCount(gap, 6)).toBeGreaterThanOrEqual(bots.length - 1);
    });

    it(`starts empty at the moment picks open with a ${gap}h window`, () => {
      // Only the slot-0 bot may be due the instant the window opens.
      expect(dueCount(gap, gap)).toBeLessThanOrEqual(1);
    });
  }

  it('compresses instead of skipping when the round opens inside last call', () => {
    // Gap smaller than the 3h last call — everyone still has to get in.
    expect(dueCount(2, 0)).toBe(bots.length);
  });

  it('places a legacy bot with no slot by its old hours_before', () => {
    const legacy = { hours_before: 12, pick_slot: null };
    expect(botIsDue(legacy, windowOf(96), DEADLINE, hoursBefore(24))).toBe(false);
    expect(botIsDue(legacy, windowOf(96), DEADLINE, hoursBefore(11))).toBe(true);
  });
});
