// api/bot-admin.js — Bot management API for GOAT admin panel
// All actions require authenticated admin user (zahareus@gmail.com)

const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const ADMIN_EMAIL = 'zahareus@gmail.com';

module.exports = async function handler(req, res) {
  // Verify admin via Supabase auth token
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const userResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
    });
    if (!userResp.ok) return res.status(401).json({ error: 'Invalid token' });
    const user = await userResp.json();
    if (user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'Not admin' });
  } catch (e) {
    return res.status(401).json({ error: 'Auth failed' });
  }

  const action = req.query.action;

  try {
    switch (action) {
      case 'list':
        return res.json(await listBots());
      case 'create':
        return res.json(await createBot(req.body));
      case 'toggle':
        return res.json(await toggleBot(req.body.id));
      case 'delete':
        return res.json(await deleteBot(req.body.id));
      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (err) {
    console.error('Bot admin error:', action, err);
    return res.status(500).json({ error: err.message });
  }
};

// === Supabase helpers ===

function sbHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  return r.json();
}

async function sbUpdate(table, query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: { ...sbHeaders(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });
  return r.json();
}

// === Actions ===

async function listBots() {
  const bots = await sbSelect('profiles',
    'is_bot=eq.true&select=id,team_name,bot_strategy,hours_before,bot_active,created_at&order=created_at.asc'
  );

  // Count picks per bot per GW
  if (bots.length) {
    const botIds = bots.map(b => `"${b.id}"`).join(',');
    const picks = await sbSelect('picks', `user_id=in.(${botIds})&select=user_id,gw`);
    const pickCounts = {};
    for (const p of picks) {
      if (!pickCounts[p.user_id]) pickCounts[p.user_id] = new Set();
      pickCounts[p.user_id].add(p.gw);
    }
    for (const bot of bots) {
      bot.gws_played = pickCounts[bot.id] ? pickCounts[bot.id].size : 0;
    }
  }

  return { bots };
}

async function createBot(body) {
  const { name, strategy } = body;
  if (!name || !strategy) throw new Error('Name and strategy required');

  // Random hours_before between 2 and 24
  const hours_before = Math.floor(Math.random() * 23) + 2;

  // Generate unique email
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 20);
  const email = `bot-${slug}-${Date.now().toString(36)}@goatapp.club`;

  // Create auth user via Supabase Admin API
  const createResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify({
      email,
      password: crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error('Create user failed: ' + err);
  }

  const userData = await createResp.json();
  const userId = userData.id;

  // Update profile with bot data
  await sbUpdate('profiles', `id=eq.${userId}`, {
    team_name: name,
    is_bot: true,
    bot_strategy: strategy,
    hours_before,
    bot_active: true,
    updated_at: new Date().toISOString(),
  });

  return {
    ok: true,
    bot: { id: userId, team_name: name, bot_strategy: strategy, hours_before, bot_active: true, gws_played: 0 },
  };
}

async function toggleBot(id) {
  if (!id) throw new Error('Bot ID required');

  // Get current state
  const bots = await sbSelect('profiles', `id=eq.${id}&is_bot=eq.true&select=id,bot_active`);
  if (!bots.length) throw new Error('Bot not found');

  const newActive = !bots[0].bot_active;
  await sbUpdate('profiles', `id=eq.${id}`, {
    bot_active: newActive,
    updated_at: new Date().toISOString(),
  });

  return { ok: true, bot_active: newActive };
}

async function deleteBot(id) {
  if (!id) throw new Error('Bot ID required');

  // Soft delete: keep profile + picks for historical standings, just unmark as bot
  await sbUpdate('profiles', `id=eq.${id}`, {
    is_bot: false,
    bot_active: false,
    bot_strategy: null,
    updated_at: new Date().toISOString(),
  });

  return { ok: true };
}
