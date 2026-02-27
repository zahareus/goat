// api/player-detail.js — Proxy for FPL element-summary (CORS bypass)
// Node.js serverless runtime (Edge is blocked by FPL)

const FPL_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-GB,en;q=0.9',
    'Referer': 'https://fantasy.premierleague.com/',
};

module.exports = async function handler(req, res) {
    const id = req.query.id;
    if (!id || isNaN(id)) {
        return res.status(400).json({ error: 'Missing or invalid player id' });
    }

    try {
        const response = await fetch(
            `https://fantasy.premierleague.com/api/element-summary/${id}/`,
            { headers: FPL_HEADERS }
        );

        if (!response.ok) {
            return res.status(response.status).json({ error: 'FPL API error' });
        }

        const data = await response.json();
        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return res.status(200).json(data);
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch player data' });
    }
};
