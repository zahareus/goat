#!/usr/bin/env node
// populate-prior.js — Build player_prior from FPL history_past (last completed season).
//
// Run this at EVERY season rollover, before GW1. populate-history.js cannot help
// there: element-summary/history only ever holds the current season, so on GW1 it
// returns ~zero rows and the bots lose every ranking signal they have.
// history_past is keyed by element_code (stable across seasons), which we join to
// players.code — element_id is renumbered by FPL each August and must NOT be used.
//
// Usage: SUPABASE_SERVICE_ROLE_KEY=... node populate-prior.js

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) { console.error('Error: SUPABASE_SERVICE_ROLE_KEY env var is required'); process.exit(1); }

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
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
    return res;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const res = await sbFetch('/rest/v1/players?select=element_id,code,name&limit=1000', { prefer: 'return=representation' });
    const players = await res.json();
    console.log(`Found ${players.length} players`);

    const rows = [];
    let noPast = 0, errors = 0;

    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        try {
            const r = await fetch(`https://fantasy.premierleague.com/api/element-summary/${p.element_id}/`, { headers: FPL_HEADERS });
            if (!r.ok) { errors++; continue; }
            const data = await r.json();
            const past = data.history_past || [];
            // Last entry = most recent completed season.
            const last = past.length ? past[past.length - 1] : null;
            if (!last || !last.minutes) { noPast++; continue; }
            rows.push({
                element_id: p.element_id,
                code: last.element_code ?? p.code ?? null,
                season: last.season_name,
                prior_minutes: last.minutes,
                prior_bps: last.bps || 0,
                prior_bps90: Math.round(((last.bps || 0) / last.minutes) * 90 * 100) / 100,
            });
        } catch (e) {
            errors++;
            if (errors <= 5) console.error(`  Error for ${p.element_id}:`, e.message);
        }
        if ((i + 1) % 50 === 0) console.log(`  [${i + 1}/${players.length}] ${rows.length} with prior`);
        await sleep(350); // ~3 req/sec, FPL throttles harder than that
    }

    for (let i = 0; i < rows.length; i += 100) {
        await sbFetch('/rest/v1/player_prior?on_conflict=element_id', {
            method: 'POST',
            headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify(rows.slice(i, i + 100)),
        });
    }

    console.log(`\nDone: ${rows.length} priors written, ${noPast} players with no past season (debutants), ${errors} errors`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
