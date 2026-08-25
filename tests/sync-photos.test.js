// Guards the selection logic in api/sync-photos.js: only codes the CDN really
// has get an upload slot, and a placeholder never burns one.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.GOAT_NOTIFY_SECRET = 's'; // the handler reads it once, at import
const handler = (await import('../api/sync-photos.js')).default;

const PLAYERS = Array.from({ length: 30 }, (_, i) => ({ element_id: i, code: 100 + i, short_name: `P${i}` }));
// 100 already has a photo; 101 is a placeholder; 102..106 are real; the rest 403.
const REAL = new Set([102, 103, 104, 105, 106]);

function fakeFetch(seen) {
  return async (url, opts = {}) => {
    if (url.includes('/rest/v1/players')) return { ok: true, json: async () => PLAYERS };
    if (url.includes('/storage/v1/object/list/')) return { ok: true, json: async () => [{ name: '100.webp' }] };
    const cdn = url.match(/p(\d+)\.png$/);
    if (cdn) {
      const code = Number(cdn[1]);
      const size = code === 101 ? 200 : REAL.has(code) ? 90000 : 0;
      if (opts.method === 'HEAD') {
        seen.head.push(code);
        return { ok: size > 0, status: size > 0 ? 200 : 403, headers: new Map([['content-length', String(size)]]) };
      }
      seen.get.push(code);
      return { ok: size > 0, arrayBuffer: async () => new ArrayBuffer(size) };
    }
    const up = url.match(/player-photos\/(\d+)\.webp$/);
    if (up) { seen.upload.push(Number(up[1])); return { ok: true }; }
    throw new Error('unexpected url ' + url);
  };
}

describe('sync-photos', () => {
  let seen;
  beforeEach(() => {
    seen = { head: [], get: [], upload: [] };
    vi.stubGlobal('fetch', fakeFetch(seen));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('HEADs the whole queue and uploads only what FPL actually has', async () => {
    let body;
    const res = { status: () => ({ json: b => { body = b; } }) };
    await handler({ method: 'GET', query: { secret: 's' } }, res);

    expect(body.missing).toBe(29);              // 30 players, one already stored
    expect(seen.head.length).toBe(29);          // whole queue scanned, not a slice
    expect(seen.head).not.toContain(100);       // stored photos are never re-fetched
    expect(body.head_status).toEqual({ 200: 6, 403: 23 }); // 101 answers 200, just too small
    expect(body.available).toBe(5);             // 101's 200-byte placeholder filtered out
    expect(seen.upload.sort()).toEqual([...REAL].sort());
    expect(body.uploaded).toBe(5);
    expect(seen.get).not.toContain(101);        // placeholder never costs a download
  });
});
