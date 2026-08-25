// api/sync-photos.js — Sync missing player photos from FPL CDN to Supabase Storage
// Triggered manually or via n8n: GET /api/sync-photos
// Auth: header `x-goat-secret` (what n8n uses — an n8n credential keeps the value
// out of the workflow JSON, where a query string would sit in plain sight), or
// `?secret=` for a quick curl by hand. Same GOAT_NOTIFY_SECRET either way.

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// season-agnostic path; files are p{code}.png (the old premierleague25/ path started 403ing)
const FPL_CDN = 'https://resources.premierleague.com/premierleague/photos/players/110x140/';
const BUCKET = 'player-photos';
const SECRET = process.env.GOAT_NOTIFY_SECRET;
const MAX_UPLOADS = 10; // ~100 KB each; 20 real downloads no longer fit the budget
const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' };

module.exports = async function handler(req, res) {
  const given = (req.headers && req.headers['x-goat-secret']) || req.query.secret;
  if (!SECRET || given !== SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sbHeaders = {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY
  };

  try {
    // 1. Get all player codes from DB
    const playersRes = await fetch(`${SUPABASE_URL}/rest/v1/players?select=element_id,code,short_name&limit=1000&order=element_id`, {
      headers: sbHeaders
    });
    const players = await playersRes.json();
    if (!Array.isArray(players)) {
      return res.status(500).json({ error: 'Failed to fetch players', detail: players });
    }

    // 2. List existing photos in Storage
    const existingRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
      method: 'POST',
      headers: { ...sbHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: '', limit: 10000 })
    });
    const existing = await existingRes.json();
    const existingSet = new Set((existing || []).map(f => f.name));

    // 3. Find players missing photos
    // ponytail: ключ .webp — фронт просить саме його (app.js CDN + code + '.webp').
    // Якщо звірятися з .png, нові гравці мовчки лишаються сірим плейсхолдером.
    const missing = players.filter(p => p.code && !existingSet.has(`${p.code}.webp`));

    if (missing.length === 0) {
      return res.status(200).json({ message: 'All photos synced', total: players.length, existing: existingSet.size });
    }

    // 4. Which of the missing does FPL actually have? HEAD is cheap and the CDN
    // discriminates 200/403 on it exactly like on GET (403 = no such photo).
    // Scanning the whole queue means a newly published photo lands within one
    // tick instead of waiting for the random slice to happen upon it.
    // ponytail: HEAD concurrency 5 — a burst from a shared Vercel IP risks a
    // throttling 403, which is indistinguishable from "no photo".
    const deadline = Date.now() + 45000; // n8n's HTTP node gives up at 60s
    const status = {};
    const available = [];
    for (let i = 0; i < missing.length && Date.now() < deadline; i += 5) {
      await Promise.all(missing.slice(i, i + 5).map(async p => {
        try {
          const h = await fetch(`${FPL_CDN}p${p.code}.png`, { method: 'HEAD', headers: UA });
          status[h.status] = (status[h.status] || 0) + 1;
          // Placeholder images are a few hundred bytes; skip them here so they
          // never eat an upload slot.
          if (h.ok && Number(h.headers.get('content-length')) >= 500) available.push(p);
        } catch (e) {
          status.error = (status.error || 0) + 1;
        }
      }));
    }
    const scanned = Object.values(status).reduce((a, b) => a + b, 0);

    // 5. Download and upload what exists (cap per invocation to stay in budget)
    // ponytail: shuffle survives the filter — a code that keeps failing to upload
    // must not permanently block the head of the queue.
    available.sort(() => Math.random() - 0.5);
    const batch = available.slice(0, MAX_UPLOADS);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (const p of batch) {
      if (Date.now() >= deadline) break;
      try {
        const photoRes = await fetch(`${FPL_CDN}p${p.code}.png`, { headers: UA });
        if (!photoRes.ok) { skipped++; continue; }

        const buffer = await photoRes.arrayBuffer();
        // Belt and braces: HEAD and GET can land on different CloudFront edges.
        if (buffer.byteLength < 500) { skipped++; continue; } // placeholder image

        // ponytail: кладемо PNG-байти під ім'ям .webp з чесним Content-Type: image/png.
        // Браузер рендерить за content-type, розширення йому байдуже. Стеля відома:
        // ці файли ~100 KB замість ~5 KB (cwebp на Vercel нема, а `sharp` — це
        // 30 MB нативної залежності у функції, де зараз лише `pg`).
        // Апгрейд: раз на квартал прогнати `scripts/recompress-photos.sh` — він
        // дотискає все, що ще не webp.
        const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p.code}.webp`, {
          method: 'POST',
          headers: {
            ...sbHeaders,
            'Content-Type': 'image/png',
            'x-upsert': 'true'
          },
          body: buffer
        });

        if (uploadRes.ok) {
          uploaded++;
        } else {
          failed++;
          errors.push(`${p.short_name} (${p.code}): ${uploadRes.status}`);
        }
      } catch (e) {
        failed++;
        errors.push(`${p.short_name}: ${e.message}`);
      }
    }

    return res.status(200).json({
      total_players: players.length,
      existing_photos: existingSet.size,
      missing: missing.length,
      scanned,
      head_status: status,
      available: available.length,
      processed: batch.length,
      uploaded,
      skipped,
      failed,
      remaining: available.length - batch.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
