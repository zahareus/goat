// api/sync-photos.js — Sync missing player photos from FPL CDN to Supabase Storage
// Triggered manually or via n8n: GET /api/sync-photos?secret=GOAT_NOTIFY_SECRET

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbnNzbnVybnpkcXdheHVhZGdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIyNDcyNiwiZXhwIjoyMDg3ODAwNzI2fQ.ijaMMykqenSYWAgdwslUddnZxUriAf7ha60PDhIOsrA';
const FPL_CDN = 'https://resources.premierleague.com/premierleague25/photos/players/110x140/';
const BUCKET = 'player-photos';
const SECRET = process.env.GOAT_NOTIFY_SECRET || 'd3b29ba30e1db2c7a24d9f704c66befc';

module.exports = async function handler(req, res) {
  if (req.query.secret !== SECRET) {
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
    const missing = players.filter(p => p.code && !existingSet.has(`${p.code}.png`));

    if (missing.length === 0) {
      return res.status(200).json({ message: 'All photos synced', total: players.length, existing: existingSet.size });
    }

    // 4. Download and upload missing (max 20 per invocation to stay within timeout)
    const batch = missing.slice(0, 20);
    let uploaded = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];

    for (const p of batch) {
      try {
        const photoRes = await fetch(`${FPL_CDN}${p.code}.png`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        });
        if (!photoRes.ok) { skipped++; continue; }

        const buffer = await photoRes.arrayBuffer();
        if (buffer.byteLength < 500) { skipped++; continue; } // placeholder image

        const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${p.code}.png`, {
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
      processed: batch.length,
      uploaded,
      skipped,
      failed,
      remaining: missing.length - batch.length,
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
