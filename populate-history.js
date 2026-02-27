#!/usr/bin/env node
// populate-history.js — Fetches season BPS data from FPL API and upserts into player_history table
// Run once to backfill, then n8n Bootstrap workflow handles ongoing updates
// Usage: node populate-history.js

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InphbnNzbnVybnpkcXdheHVhZGdlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjIyNDcyNiwiZXhwIjoyMDg3ODAwNzI2fQ.ijaMMykqenSYWAgdwslUddnZxUriAf7ha60PDhIOsrA';

const FPL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://fantasy.premierleague.com/',
};

async function sbFetch(path, opts = {}) {
    const res = await fetch(SUPABASE_URL + path, {
        ...opts,
        headers: {
            'apikey': SERVICE_KEY,
            'Authorization': 'Bearer ' + SERVICE_KEY,
            'Content-Type': 'application/json',
            'Prefer': opts.prefer || 'return=minimal',
            ...opts.headers,
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`Supabase ${res.status}: ${body}`);
    }
    return res;
}

async function getActivePlayers() {
    const res = await sbFetch('/rest/v1/players?select=element_id&limit=1000', {
        prefer: 'return=representation',
    });
    return (await res.json()).map(p => p.element_id);
}

async function fetchPlayerHistory(elementId) {
    const url = `https://fantasy.premierleague.com/api/element-summary/${elementId}/`;
    const res = await fetch(url, { headers: FPL_HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    return data.history || [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log('Fetching active players from Supabase...');
    const playerIds = await getActivePlayers();
    console.log(`Found ${playerIds.length} active players`);

    let totalRows = 0;
    let errors = 0;

    for (let i = 0; i < playerIds.length; i++) {
        const eid = playerIds[i];
        try {
            const history = await fetchPlayerHistory(eid);
            if (!history || !history.length) {
                if (i % 50 === 0) console.log(`  [${i+1}/${playerIds.length}] ${eid}: no history`);
                continue;
            }

            // Map to player_history rows
            const rows = history.filter(h => h.minutes > 0).map(h => ({
                element_id: eid,
                fixture_id: h.fixture,
                round: h.round,
                opponent_team: h.opponent_team,
                was_home: h.was_home,
                kickoff_time: h.kickoff_time,
                minutes: h.minutes,
                bps: h.bps || 0,
                total_points: h.total_points || 0,
                goals_scored: h.goals_scored || 0,
                assists: h.assists || 0,
                clean_sheets: h.clean_sheets || 0,
                yellow_cards: h.yellow_cards || 0,
                red_cards: h.red_cards || 0,
            }));

            if (rows.length > 0) {
                // Upsert in batches of 100
                for (let j = 0; j < rows.length; j += 100) {
                    const batch = rows.slice(j, j + 100);
                    await sbFetch('/rest/v1/player_history', {
                        method: 'POST',
                        prefer: 'resolution=merge-duplicates,return=minimal',
                        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
                        body: JSON.stringify(batch),
                    });
                }
                totalRows += rows.length;
            }

            if ((i+1) % 20 === 0) {
                console.log(`  [${i+1}/${playerIds.length}] processed, ${totalRows} rows total`);
            }

            // Rate limit: ~3 req/sec to avoid FPL throttling
            await sleep(350);
        } catch (e) {
            errors++;
            if (errors <= 5) console.error(`  Error for ${eid}:`, e.message);
        }
    }

    console.log(`\nDone! Upserted ${totalRows} rows for ${playerIds.length} players (${errors} errors)`);

    // Calculate BPS ranks per fixture
    console.log('\nCalculating BPS ranks per fixture...');
    await calculateRanks();
}

async function calculateRanks() {
    // Fetch all rows grouped by fixture
    let offset = 0;
    const allRows = [];
    while (true) {
        const res = await sbFetch(`/rest/v1/player_history?select=id,fixture_id,bps&order=fixture_id.asc,bps.desc&offset=${offset}&limit=1000`, {
            prefer: 'return=representation',
        });
        const batch = await res.json();
        if (!batch.length) break;
        allRows.push(...batch);
        offset += batch.length;
        if (batch.length < 1000) break;
    }
    console.log(`  Loaded ${allRows.length} rows for ranking`);

    // Group by fixture_id and assign ranks
    const byFixture = {};
    for (const r of allRows) {
        if (!byFixture[r.fixture_id]) byFixture[r.fixture_id] = [];
        byFixture[r.fixture_id].push(r);
    }

    const updates = [];
    for (const [fid, players] of Object.entries(byFixture)) {
        // Already sorted by bps desc from query
        let rank = 0;
        let prevBps = -1;
        let skip = 0;
        for (const p of players) {
            skip++;
            if (p.bps !== prevBps) {
                rank = skip;
                prevBps = p.bps;
            }
            updates.push({ id: p.id, bps_rank: rank });
        }
    }

    // Batch update ranks via PATCH
    let updated = 0;
    for (let i = 0; i < updates.length; i += 50) {
        const batch = updates.slice(i, i + 50);
        // Update one by one (REST API doesn't support bulk PATCH by different IDs)
        await Promise.all(batch.map(u =>
            sbFetch(`/rest/v1/player_history?id=eq.${u.id}`, {
                method: 'PATCH',
                body: JSON.stringify({ bps_rank: u.bps_rank }),
            })
        ));
        updated += batch.length;
        if (updated % 500 === 0) console.log(`  Ranked ${updated}/${updates.length}`);
    }
    console.log(`  Ranked ${updated} rows across ${Object.keys(byFixture).length} fixtures`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
