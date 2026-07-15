// api/telegram-webhook.js — Telegram bot webhook handler
// Handles: /start, email input, code verification, /status, /unlink, /help
// Uses direct Supabase REST API (no npm packages needed)

const TELEGRAM_API = 'https://api.telegram.org/bot';
const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = req.query.secret;
  if (!secret || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const message = req.body?.message;
  if (!message || !message.text) {
    return res.status(200).json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text.trim();

  try {
    if (text === '/start') {
      await handleStart(chatId);
    } else if (text === '/status') {
      await handleStatus(chatId);
    } else if (text === '/unlink') {
      await handleUnlink(chatId);
    } else if (text === '/gw' || text.startsWith('/gw ')) {
      await handleGW(chatId, text);
    } else if (text === '/help') {
      await handleHelp(chatId);
    } else if (text.includes('@')) {
      await handleEmail(chatId, text.toLowerCase());
    } else if (/^\d{6}$/.test(text)) {
      await handleCode(chatId, text);
    } else {
      await send(chatId, '🤔 I don\'t understand. Type /help for commands.');
    }
  } catch (err) {
    console.error('Telegram webhook error:', err);
    try { await send(chatId, '⚠️ Error: ' + (err.message || String(err))); } catch(_) {}
  }

  return res.status(200).json({ ok: true });
};

// === Supabase REST helpers ===

function sbHeaders() {
  return {
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

async function sbSelect(table, query) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: sbHeaders(),
  });
  return r.json();
}

async function sbUpdate(table, query, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  return r.json();
}

async function sbRpc(fn, params) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(params),
  });
  return r.json();
}

// === Command Handlers ===

async function handleStart(chatId) {
  const rows = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id,team_name`);
  if (rows.length > 0) {
    await send(chatId,
      `✅ You're already linked as "${rows[0].team_name || 'Unknown'}".\n\nUse /status to check or /unlink to disconnect.`
    );
    return;
  }

  await send(chatId,
    '⚽ Welcome to GOAT Fantasy Bot!\n\n'
    + 'Get alerts about deadlines, lineups, and results.\n\n'
    + '📧 Enter your GOAT email to link your account:'
  );
}

async function handleEmail(chatId, email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await send(chatId, '❌ Invalid email format. Try again.');
    return;
  }

  // Check if this chat is already linked
  const linked = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id`);
  if (linked.length > 0) {
    await send(chatId, '✅ You\'re already linked! Use /unlink first to switch accounts.');
    return;
  }

  // Look up profile by email
  const profiles = await sbRpc('get_profile_by_email', { lookup_email: email });
  const profile = profiles?.[0];

  if (!profile) {
    await send(chatId, '❌ No GOAT account found with this email.\nMake sure you\'ve signed in at goatapp.club first.');
    return;
  }

  if (profile.telegram_chat_id) {
    await send(chatId, '⚠️ This account is already linked to another Telegram. Unlink it from the GOAT profile first.');
    return;
  }

  // Rate limit: check if code was sent less than 60s ago
  const existing = await sbSelect('profiles', `id=eq.${profile.id}&select=telegram_verify_expires`);
  if (existing[0]?.telegram_verify_expires) {
    const expires = new Date(existing[0].telegram_verify_expires);
    const sentAt = new Date(expires.getTime() - 10 * 60 * 1000);
    if (Date.now() - sentAt.getTime() < 60 * 1000) {
      await send(chatId, '⏳ Code already sent. Wait a minute before requesting a new one.');
      return;
    }
  }

  // Generate 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await sbUpdate('profiles', `id=eq.${profile.id}`, {
    telegram_pending_chat_id: chatId,
    telegram_verify_code: code,
    telegram_verify_expires: expiresAt,
    telegram_verify_attempts: 0,
  });

  await sendVerificationEmail(email, code);

  const masked = maskEmail(email);
  await send(chatId, `📨 Verification code sent to ${masked}\n\nEnter the 6-digit code. Valid for 10 minutes.`);
}

async function handleCode(chatId, code) {
  const rows = await sbSelect('profiles',
    `telegram_pending_chat_id=eq.${chatId}&select=id,telegram_verify_code,telegram_verify_expires,telegram_verify_attempts`
  );
  const profile = rows[0];

  if (!profile) {
    await send(chatId, '❌ No pending verification. Send your email first.');
    return;
  }

  // Check expiry
  if (new Date() > new Date(profile.telegram_verify_expires)) {
    await sbUpdate('profiles', `id=eq.${profile.id}`, {
      telegram_pending_chat_id: null, telegram_verify_code: null,
      telegram_verify_expires: null, telegram_verify_attempts: 0,
    });
    await send(chatId, '⏰ Code expired. Send your email again to get a new one.');
    return;
  }

  // Check attempts
  if (profile.telegram_verify_attempts >= 3) {
    await sbUpdate('profiles', `id=eq.${profile.id}`, {
      telegram_pending_chat_id: null, telegram_verify_code: null,
      telegram_verify_expires: null, telegram_verify_attempts: 0,
    });
    await send(chatId, '🚫 Too many attempts. Send your email again to get a new code.');
    return;
  }

  // Verify code
  if (code !== profile.telegram_verify_code) {
    const left = 2 - profile.telegram_verify_attempts;
    await sbUpdate('profiles', `id=eq.${profile.id}`, {
      telegram_verify_attempts: profile.telegram_verify_attempts + 1,
    });
    await send(chatId, `❌ Wrong code. ${left} attempt${left === 1 ? '' : 's'} left.`);
    return;
  }

  // Success — link account
  const updateResult = await sbUpdate('profiles', `id=eq.${profile.id}`, {
    telegram_chat_id: chatId,
    telegram_pending_chat_id: null, telegram_verify_code: null,
    telegram_verify_expires: null, telegram_verify_attempts: 0,
  });

  if (!Array.isArray(updateResult)) {
    await send(chatId, '⚠️ This Telegram account is already linked to another GOAT profile. Use /unlink there first.');
    return;
  }

  await send(chatId,
    '🎉 Account linked!\n\n'
    + 'You\'ll receive notifications about:\n'
    + '• ⏰ Pick deadlines\n'
    + '• 🔄 Lineup changes\n'
    + '• 🏆 Gameweek results\n\n'
    + 'Use /status to check or /unlink to disconnect.'
  );
}

async function handleStatus(chatId) {
  const rows = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=team_name`);
  if (rows.length > 0) {
    await send(chatId, `✅ Linked\nTeam: ${rows[0].team_name || '—'}\n\nUse /unlink to disconnect.`);
  } else {
    const pending = await sbSelect('profiles', `telegram_pending_chat_id=eq.${chatId}&select=id`);
    if (pending.length > 0) {
      await send(chatId, '⏳ Verification in progress. Enter your 6-digit code.');
    } else {
      await send(chatId, '❌ Not linked. Send your GOAT email to connect.');
    }
  }
}

async function handleUnlink(chatId) {
  const rows = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id`);
  if (rows.length === 0) {
    await send(chatId, '❌ Not linked. Nothing to disconnect.');
    return;
  }

  await sbUpdate('profiles', `id=eq.${rows[0].id}`, { telegram_chat_id: null });
  await send(chatId, '🔓 Telegram unlinked. You won\'t receive notifications anymore.\n\nSend your email to link again.');
}

async function handleGW(chatId, text) {
  const users = await sbSelect('profiles', `telegram_chat_id=eq.${chatId}&select=id,team_name`);
  if (users.length === 0) {
    await send(chatId, '❌ Not linked. Use /start first.');
    return;
  }
  const userId = users[0].id;
  const teamName = users[0].team_name || '—';

  let gw;
  const gwMatch = text.match(/\/gw\s+(\d+)/);
  if (gwMatch) {
    gw = parseInt(gwMatch[1]);
  } else {
    const active = await sbSelect('gw_config', 'is_active=eq.true&select=gw&limit=1');
    if (active.length === 0) { await send(chatId, '❌ No active gameweek.'); return; }
    gw = active[0].gw;
  }

  const [fixtures, myPicks, allPicks] = await Promise.all([
    sbSelect('fixtures', `gw=eq.${gw}&select=id,home_team_id,away_team_id,home_short,away_short,status,kickoff_time,home_score,away_score,minutes&order=kickoff_time`),
    sbSelect('picks', `user_id=eq.${userId}&gw=eq.${gw}&select=fixture_id,element_id`),
    sbSelect('picks', `gw=eq.${gw}&select=user_id,fixture_id,element_id`),
  ]);

  if (fixtures.length === 0) { await send(chatId, `❌ No fixtures for GW${gw}.`); return; }

  const allElementIds = [...new Set(allPicks.map(p => p.element_id))];
  const fixtureIds = fixtures.map(f => f.id);

  const myPickMap = {};
  for (const p of myPicks) myPickMap[p.fixture_id] = p.element_id;

  const [players, results] = await Promise.all([
    allElementIds.length > 0
      ? sbSelect('players', `element_id=in.(${allElementIds.join(',')})&select=element_id,short_name,team_short`)
      : [],
    sbSelect('results', `fixture_id=in.(${fixtureIds.join(',')})&select=fixture_id,element_id,bps,is_goat`),
  ]);

  // Fetch FPL availability for scheduled match picks
  const scheduled = fixtures.filter(f => f.status === 'scheduled');
  let lineupsData = {};
  let fplAvail = {};
  if (scheduled.length > 0) {
    const myEidsForScheduled = new Set();
    for (const p of myPicks) {
      if (scheduled.some(f => f.id === p.fixture_id)) myEidsForScheduled.add(p.element_id);
    }
    try {
      const [fplResp, linResp] = await Promise.all([
        fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
        }),
        fetch('https://goatapp.club/api/lineups').catch(() => null),
      ]);
      if (fplResp.ok) {
        const boot = await fplResp.json();
        for (const el of boot.elements) {
          if (myEidsForScheduled.has(el.id)) {
            fplAvail[el.id] = el.chance_of_playing_next_round;
          }
        }
      }
      if (linResp && linResp.ok) {
        const ld = await linResp.json();
        if (!ld.error) lineupsData = ld;
      }
    } catch (_) {}
  }

  const playerMap = {};
  for (const p of players) playerMap[p.element_id] = p;

  const resultMap = {};
  for (const r of results) {
    if (!resultMap[r.fixture_id]) resultMap[r.fixture_id] = {};
    resultMap[r.fixture_id][r.element_id] = r;
  }

  // Split fixtures into groups
  const finished = fixtures.filter(f => f.status === 'ft');
  const live = fixtures.filter(f => f.status === 'live');
  const upcoming = fixtures.filter(f => f.status === 'scheduled');

  let totalBps = 0;
  let goats = 0;
  const parts = [];

  // Helper: build match block
  function matchBlock(f, icon) {
    const score = (f.status === 'ft' || f.status === 'live')
      ? `  ${f.home_score}:${f.away_score}` : '';
    const minTag = f.status === 'live' && f.minutes ? ` [${f.minutes}']` : '';
    const header = `${icon} <b>${f.home_short} – ${f.away_short}</b>${score}${minTag}`;

    const eid = myPickMap[f.id];
    if (!eid) return header + '\n    <i>no pick</i>';

    const pl = playerMap[eid];
    const name = pl ? pl.short_name : `#${eid}`;
    const team = pl ? pl.team_short : '';

    const res = resultMap[f.id]?.[eid];
    if (res) {
      const crown = res.is_goat ? ' 👑' : '';
      if (res.is_goat) goats++;
      totalBps += res.bps;
      const fResults = Object.values(resultMap[f.id] || {});
      fResults.sort((a, b) => b.bps - a.bps);
      const rank = fResults.findIndex(r => r.element_id === eid) + 1;
      return header + `\n    ${h(name)} (${team})${crown}  #${rank}  <b>${res.bps}</b> BPS`;
    }

    // Scheduled — show availability status
    if (f.status === 'scheduled') {
      let statusTag = '';
      // 1) Try RotoWire lineups first (more specific)
      const key = `${f.home_team_id}-${f.away_team_id}`;
      const lineup = lineupsData[key];
      if (lineup) {
        const allPlayers = [...(lineup.home || []), ...(lineup.away || [])];
        const found = allPlayers.find(lp => lp.fpl_id === eid);
        if (found) {
          const st = found.status;
          if (st === 'starter') statusTag = ' ✅';
          else if (st === 'starter_ques') statusTag = ' ⚠️';
          else if (st === 'ques') statusTag = ' 🟡';
          else if (st === 'out' || st === 'sus') statusTag = ' 🔴';
        }
      }
      // 2) Fallback to FPL chance_of_playing
      if (!statusTag && eid in fplAvail) {
        const chance = fplAvail[eid];
        if (chance === null || chance === 100) statusTag = ' ✅';
        else if (chance === 75) statusTag = ' ⚠️';
        else if (chance === 50) statusTag = ' 🟡';
        else statusTag = ' 🔴';
      }
      const ko = fmtTime(f.kickoff_time);
      return header + `  <i>${ko}</i>\n    ${h(name)} (${team})${statusTag}`;
    }

    return header + `\n    ${h(name)} (${team})`;
  }

  // Finished matches
  if (finished.length > 0) {
    parts.push(finished.map(f => matchBlock(f, '🏁')).join('\n\n'));
  }

  // Live matches
  if (live.length > 0) {
    parts.push(live.map(f => matchBlock(f, '⚽')).join('\n\n'));
  }

  // Upcoming matches (extra line break before)
  if (upcoming.length > 0) {
    const upBlock = '\n⏳ <b>Upcoming</b>\n\n'
      + upcoming.map(f => matchBlock(f, '🕐')).join('\n\n');
    parts.push(upBlock);
  }

  // Standings
  const userPicks = {};
  for (const p of allPicks) {
    if (!userPicks[p.user_id]) userPicks[p.user_id] = [];
    userPicks[p.user_id].push(p);
  }
  const allUserIds = Object.keys(userPicks);
  const profiles = await sbSelect('profiles', `id=in.(${allUserIds.map(u => `"${u}"`).join(',')})&select=id,team_name`);
  const profileMap = {};
  for (const p of profiles) profileMap[p.id] = p.team_name || '—';

  const standings = [];
  for (const [uid, picks] of Object.entries(userPicks)) {
    let bps = 0, g = 0;
    for (const p of picks) {
      const r = resultMap[p.fixture_id]?.[p.element_id];
      if (r) { bps += r.bps; if (r.is_goat) g++; }
    }
    standings.push({ uid, name: profileMap[uid] || '—', goats: g, bps });
  }
  standings.sort((a, b) => b.goats - a.goats || b.bps - a.bps);
  const myPos = standings.findIndex(s => s.uid === userId) + 1;

  const standLines = standings.map((s, i) => {
    const arrow = s.uid === userId ? ' ◀️' : '';
    return `${i + 1}. ${s.name}  ${s.goats}👑 ${s.bps} BPS${arrow}`;
  });

  const header = `⚽ <b>GW${gw}</b> — ${h(teamName)}`;
  const summary = `\n📊 <b>${goats}</b> GOATs  |  <b>${totalBps}</b> BPS`;
  const position = myPos > 0 ? `  |  🏆 ${myPos}/${standings.length}` : '';

  const msg = header + '\n\n'
    + parts.join('\n\n') + '\n'
    + summary + position + '\n\n'
    + '📋 <b>Standings</b>\n<code>'
    + standLines.join('\n')
    + '</code>';

  await send(chatId, msg, 'HTML');
}

async function handleHelp(chatId) {
  await send(chatId,
    '⚽ GOAT Fantasy Bot\n\n'
    + 'Commands:\n'
    + '/gw — Current gameweek summary\n'
    + '/gw 29 — Specific gameweek\n'
    + '/start — Link your account\n'
    + '/status — Check link status\n'
    + '/unlink — Disconnect Telegram\n'
    + '/help — Show this message\n\n'
    + '🌐 goatapp.club'
  );
}

// === Helpers ===

async function send(chatId, text, parseMode) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function sendVerificationEmail(email, code) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'GOAT Fantasy <noreply@goatapp.club>',
      to: email,
      subject: `${code} — Your GOAT verification code`,
      html: `<div style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
        <h2 style="color:#BFB294;margin-bottom:8px">⚽ GOAT Fantasy</h2>
        <p>Your Telegram verification code:</p>
        <div style="font-size:32px;font-weight:bold;letter-spacing:8px;padding:16px;background:#1a1a1a;color:#BFB294;text-align:center;border-radius:4px">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:16px">This code expires in 10 minutes.<br>If you didn't request this, ignore this email.</p>
      </div>`,
    }),
  });
}

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Europe/London' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return `${day} ${time}`;
}

function h(text) {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return local[0] + '***@' + domain;
  return local[0] + '***' + local[local.length - 1] + '@' + domain;
}

function esc(text) {
  if (!text) return '';
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
}
