#!/usr/bin/env node
/**
 * Migrate FPL player photos to Supabase Storage
 *
 * Usage: node migrate-photos.js
 *
 * 1. Creates public bucket 'player-photos' in Supabase Storage
 * 2. Fetches all player codes from DB
 * 3. Downloads photos from FPL CDN
 * 4. Uploads to Supabase Storage
 */

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbnNzbnVybnpkcXdheHVhZGdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIyNDcyNiwiZXhwIjoyMDg3ODAwNzI2fQ.ijaMMykqenSYWAgdwslUddnZxUriAf7ha60PDhIOsrA';
const FPL_CDN = 'https://resources.premierleague.com/premierleague25/photos/players/110x140/';

const BUCKET = 'player-photos';
const CONCURRENCY = 10;

async function main() {
  // 1. Create bucket (ignore if exists)
  console.log('Creating bucket...');
  const bucketRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      id: BUCKET,
      name: BUCKET,
      public: true,
      file_size_limit: 524288 // 512KB
    })
  });
  const bucketData = await bucketRes.json();
  if (bucketRes.ok) {
    console.log('Bucket created:', bucketData);
  } else if (bucketData.message?.includes('already exists')) {
    console.log('Bucket already exists, continuing...');
  } else {
    console.log('Bucket response:', bucketData);
  }

  // 2. Get all player codes from DB
  console.log('Fetching player codes from DB...');
  const playersRes = await fetch(`${SUPABASE_URL}/rest/v1/players?select=code,short_name&order=code`, {
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY
    }
  });
  const players = await playersRes.json();
  console.log(`Found ${players.length} players`);

  // 3. Check what's already uploaded
  console.log('Checking existing uploads...');
  const existingRes = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'apikey': SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefix: '', limit: 10000 })
  });
  const existing = await existingRes.json();
  const existingSet = new Set((existing || []).map(f => f.name));
  console.log(`Already uploaded: ${existingSet.size} photos`);

  // 4. Download & upload in batches
  const toUpload = players.filter(p => !existingSet.has(`${p.code}.png`));
  console.log(`Need to upload: ${toUpload.length} photos`);

  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < toUpload.length; i += CONCURRENCY) {
    const batch = toUpload.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(p => uploadPhoto(p.code))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') {
        if (r.value === 'skip') skipped++;
        else success++;
      } else {
        failed++;
      }
    }

    const total = Math.min(i + CONCURRENCY, toUpload.length);
    process.stdout.write(`\r  Progress: ${total}/${toUpload.length} (ok: ${success}, skip: ${skipped}, fail: ${failed})`);
  }

  console.log(`\n\nDone! Uploaded: ${success}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`\nPublic URL pattern: ${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/{code}.png`);
}

async function uploadPhoto(code) {
  // Download from FPL
  const url = `${FPL_CDN}${code}.png`;
  const res = await fetch(url);
  if (!res.ok) return 'skip';

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength < 500) return 'skip'; // too small = placeholder

  // Upload to Supabase Storage
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${code}.png`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Content-Type': 'image/png',
        'x-upsert': 'true'
      },
      body: buffer
    }
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    throw new Error(`Upload failed for ${code}: ${err}`);
  }

  return 'ok';
}

main().catch(console.error);
