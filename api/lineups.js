// api/lineups.js — Predicted lineups from RotoWire matched to FPL players
// Source: rotowire.com/soccer/lineups.php (free, no auth, server-rendered HTML)
// Returns: { "fplHomeId-fplAwayId": { confirmed: bool, home: [...], away: [...] } }
// confirmed: RotoWire marks the block "is-confirmed" once the club announces the XI.
// Until then it is "is-expected" (journalist projection) or unmarked (pure guess) —
// callers MUST NOT present those as a real starting XI.
// Each player: { fpl_id, web_name, rw_name, rw_position, status }
// Status: "starter" (green) | "starter_ques" (yellow, in XI but QUES) | "ques" (orange, not in XI) | "out"|"sus" (red)

// RotoWire abbreviations that differ from FPL short_name. The abbr → team_id map
// itself is built per-request from bootstrap-static: FPL renumbers team ids every
// season, so a hardcoded map silently rots (bit us at the 26/27 rollover).
const RW_ALIAS = { 'BRN': 'BUR', 'BRI': 'BHA', 'LDS': 'LEE', 'NOT': 'NFO' };

// Strip accents and special characters for matching
function normalize(str) {
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // strip combining marks (accents)
        .replace(/\u00df/g, 'ss')         // ß → ss
        .replace(/\u0131/g, 'i')          // ı (Turkish dotless i) → i
        .replace(/\u0142/g, 'l')          // ł → l
        .replace(/\u00f8/g, 'o')          // ø → o
        .replace(/\u00d8/g, 'o')          // Ø → o
        .replace(/\u00e6/g, 'ae')         // æ → ae
        .replace(/\u0111/g, 'd')          // đ → d
        .replace(/[.]/g, '')              // strip dots (F.Kadıoğlu → FKadioglu)
        .toLowerCase()
        .trim();
}

// Normalize RotoWire detailed positions (DL, DC, DR, DMC, AML, AMC, AMR, FW, FWL, FWR, etc.)
// to standard FPL positions: GK, DEF, MID, FWD
function normalizePosition(rwPos) {
    const p = rwPos.toUpperCase().trim();
    if (p === 'GK') return 'GK';
    // Defensive midfielders go to MID (DMC, DM must be checked before D*)
    if (p === 'DM' || p === 'DMC' || p === 'DML' || p === 'DMR' || p === 'CDM') return 'MID';
    // Pure defenders
    if (p.startsWith('D') || p === 'CB' || p === 'LB' || p === 'RB' || p === 'LWB' || p === 'RWB') return 'DEF';
    // Forwards
    if (p.startsWith('FW') || p === 'ST' || p === 'CF' || p === 'F' || p === 'FC') return 'FWD';
    // Midfielders
    if (p.startsWith('M') || p.startsWith('AM') || p === 'CM' || p === 'LM' || p === 'RM' || p === 'CAM') return 'MID';
    // Hybrid positions like F/M → use first letter
    if (p.includes('/')) {
        const first = p.split('/')[0].trim();
        if (first === 'F') return 'FWD';
        if (first === 'D') return 'DEF';
        return 'MID';
    }
    return p; // fallback: return as-is
}

// Match a RotoWire player name to FPL player from the same team
function matchPlayer(rwName, teamId, fplPlayers) {
    const normRW = normalize(rwName);
    const teamPlayers = fplPlayers.filter(p => p.team_id === teamId);

    // 1. Exact web_name match (normalized)
    let match = teamPlayers.find(p => normalize(p.web_name) === normRW);
    if (match) return match;

    // 2. web_name is a suffix of the RotoWire name (e.g., "Mohamed Salah" ends with "Salah")
    match = teamPlayers.find(p => normRW.endsWith(normalize(p.web_name)));
    if (match) return match;

    // 3. web_name contains or is contained in RotoWire name
    match = teamPlayers.find(p => normRW.includes(normalize(p.web_name)) && normalize(p.web_name).length >= 4);
    if (match) return match;

    // 4. RotoWire name contains web_name (shorter names like "Saka")
    match = teamPlayers.find(p => normRW.includes(normalize(p.web_name)) && normalize(p.web_name).length >= 3);
    if (match) return match;

    // 5. Last word of RotoWire name matches web_name
    const rwParts = normRW.split(/[\s-]+/);
    const rwLast = rwParts[rwParts.length - 1];
    match = teamPlayers.find(p => normalize(p.web_name) === rwLast || normalize(p.web_name).endsWith(rwLast));
    if (match) return match;

    // 6. Hyphenated names: "Alexander-Arnold" in "Trent Alexander-Arnold"
    match = teamPlayers.find(p => {
        const normWeb = normalize(p.web_name);
        if (!normWeb.includes('-')) return false;
        return normRW.includes(normWeb);
    });
    if (match) return match;

    // 7. Match against first_name + second_name (e.g., "Bruno Guimaraes" vs web_name "Bruno G.")
    match = teamPlayers.find(p => {
        const fullNorm = normalize((p.first_name || '') + ' ' + (p.second_name || ''));
        return fullNorm === normRW;
    });
    if (match) return match;

    // 8. RW last name matches FPL second_name (e.g., "Idrissa Gueye" → second_name "Gueye")
    match = teamPlayers.find(p => {
        const normSecond = normalize(p.second_name || '');
        return normSecond.length >= 4 && (normSecond === rwLast || rwLast === normSecond);
    });
    if (match) return match;

    // 9. RW first name matches FPL first_name AND same team (for single-name players like "Alisson", "Rodri")
    const rwFirst = rwParts[0];
    match = teamPlayers.find(p => {
        const normFirst = normalize(p.first_name || '');
        return normFirst === normRW || normFirst === rwFirst;
    });
    if (match) return match;

    // 10. web_name prefix matches RW name words (e.g., "O.Dango" → strip dots → "odango" contains "dango")
    match = teamPlayers.find(p => {
        const normWeb = normalize(p.web_name);
        if (normWeb.length < 4) return false;
        return rwParts.some(part => part.length >= 4 && normWeb.includes(part));
    });
    if (match) return match;

    return null;
}

export default async function handler(req, res) {
    // Edge cache: 50 phones on matchday must not hammer RotoWire per render
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    try {
        // Fetch RotoWire page
        const rwRes = await fetch('https://www.rotowire.com/soccer/lineups.php', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept': 'text/html',
            }
        });
        if (!rwRes.ok) return res.status(502).json({ error: 'RotoWire fetch error' });
        const html = await rwRes.text();

        // Fetch FPL players for matching
        const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json',
                'Referer': 'https://fantasy.premierleague.com/',
            }
        });
        if (!fplRes.ok) return res.status(502).json({ error: 'FPL fetch error' });
        const fplData = await fplRes.json();
        const rwToFpl = {};
        for (const t of fplData.teams) rwToFpl[t.short_name] = t.id;
        for (const [rw, fpl] of Object.entries(RW_ALIAS)) {
            if (rwToFpl[fpl]) rwToFpl[rw] = rwToFpl[fpl];
        }
        const fplPlayers = fplData.elements.map(p => ({
            id: p.id,
            web_name: p.web_name,
            first_name: p.first_name,
            second_name: p.second_name,
            team_id: p.team,
            position: p.element_type,
        }));

        // Parse RotoWire HTML
        // Structure: <div class="lineup is-soccer"> per match
        //   lineup__abbr → team abbreviation (2 per match)
        //   lineup__list is-home / is-visit → home/away player lists
        //   Predicted XI first, then "Injuries" section with QUES/OUT/SUS players
        //   Each player: <li class="lineup__player">
        //     <div class="lineup__pos">GK</div>
        //     <a title="Full Name" href="...">Display Name</a>
        //     [optional] <span class="lineup__inj">QUES|OUT|SUS</span>
        const result = {};
        const matchBlocks = html.split(/class="lineup is-soccer"/g);

        for (let i = 1; i < matchBlocks.length; i++) {
            const block = matchBlocks[i];

            // Extract team abbreviations
            const abbrMatches = [...block.matchAll(/class="lineup__abbr"[^>]*>([A-Z]{2,4})/g)];
            if (abbrMatches.length < 2) continue;

            const homeAbbr = abbrMatches[0][1];
            const awayAbbr = abbrMatches[1][1];
            const homeFpl = rwToFpl[homeAbbr];
            const awayFpl = rwToFpl[awayAbbr];
            if (!homeFpl || !awayFpl) continue;

            // Split into home (is-home) and away (is-visit) sections
            const homeSectionMatch = block.match(/class="lineup__list is-home"([\s\S]*?)(?=class="lineup__list is-visit"|$)/);
            const awaySectionMatch = block.match(/class="lineup__list is-visit"([\s\S]*?)(?=<\/div>\s*<\/div>|$)/);

            const parseSide = (sectionHtml, teamId) => {
                if (!sectionHtml) return [];
                const players = [];
                const seen = new Set();

                // Split into individual <li> blocks for safe per-player parsing
                const liParts = sectionHtml.split(/<li\b/);
                let inInjurySection = false;

                for (const li of liParts) {
                    // Detect "Injuries" section header
                    if (li.includes('lineup__title') && /injuries/i.test(li)) {
                        inInjurySection = true;
                        continue;
                    }

                    // Only process lineup__player items
                    if (!li.includes('lineup__player')) continue;

                    // Extract position
                    const posMatch = li.match(/class="lineup__pos[^"]*"[^>]*>([^<]*)/);
                    const rwPosRaw = posMatch ? posMatch[1].trim() : '';

                    // Extract player name from title attribute
                    const nameMatch = li.match(/<a\s+title="([^"]*)"/);
                    const rwName = nameMatch ? nameMatch[1].trim() : '';
                    if (!rwName) continue;

                    if (seen.has(rwName)) continue;
                    seen.add(rwName);

                    // Check for injury status within THIS <li> only
                    const injMatch = li.match(/class="lineup__inj[^"]*"[^>]*>([^<]*)/);
                    const injStatus = (injMatch ? injMatch[1] : '').trim().toUpperCase();

                    const fplMatch = matchPlayer(rwName, teamId, fplPlayers);

                    let status;
                    if (inInjurySection) {
                        // Injury section: not in starting XI
                        if (injStatus === 'OUT') status = 'out';
                        else if (injStatus === 'SUS') status = 'sus';
                        else status = 'ques'; // orange — not in XI, questionable
                    } else {
                        // Predicted XI section
                        if (injStatus === 'QUES') status = 'starter_ques'; // yellow — in XI but doubtful
                        else if (injStatus === 'SUS') status = 'sus';
                        else if (injStatus === 'OUT') status = 'out';
                        else status = 'starter'; // green — confirmed starter
                    }

                    players.push({
                        fpl_id: fplMatch?.id || null,
                        web_name: fplMatch?.web_name || rwName,
                        rw_name: rwName,
                        rw_position: normalizePosition(rwPosRaw),
                        status,
                    });
                }

                return players;
            };

            const home = parseSide(homeSectionMatch?.[1], homeFpl);
            const away = parseSide(awaySectionMatch?.[1], awayFpl);

            if (home.length > 0 || away.length > 0) {
                const confirmed = /class="lineup__status[^"]*\bis-confirmed\b/.test(block);
                result[`${homeFpl}-${awayFpl}`] = { confirmed, home, away };
            }
        }

        // 60s, not an hour: the whole point of this endpoint is catching the moment
        // a club confirms its XI. An hour-old copy told notify.js "not confirmed"
        // 4 minutes after RotoWire confirmed NEW-LIV (23.08.26).
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
        return res.json(result);
    } catch (err) {
        console.error('lineups error:', err);
        return res.status(500).json({ error: 'Failed to fetch lineups' });
    }
}
