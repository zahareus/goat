// ===== CONFIG =====
const SUPABASE_URL = 'https://zanssnurnzdqwaxuadge.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PU7gbL0MVSaVhI4WPodRxg_xA0-LG6e';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CDN = 'https://zanssnurnzdqwaxuadge.supabase.co/storage/v1/object/public/player-photos/';
const PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 68 78' fill='none'%3E%3Crect width='68' height='78' fill='%23252525'/%3E%3Ccircle cx='34' cy='28' r='12' fill='%23444'/%3E%3Cellipse cx='34' cy='62' rx='18' ry='14' fill='%23444'/%3E%3C/svg%3E";
const SEASON = '25-26';
const PO = {GKP:1, DEF:2, MID:3, FWD:4};
const POS_COLORS = {GKP:'#f5c518', DEF:'#00d5e0', MID:'#a0e000', FWD:'#ff6b35'};
const FPL_TEAM_MAP = {"1":"ARS","2":"AVL","3":"BUR","4":"BOU","5":"BRE","6":"BHA","7":"CHE","8":"CRY","9":"EVE","10":"FUL","11":"LEE","12":"LIV","13":"MCI","14":"MUN","15":"NEW","16":"NFO","17":"SUN","18":"TOT","19":"WHU","20":"WOL"};
const ADMIN_EMAIL = 'zahareus@gmail.com';

// ===== STATE =====
let currentUser = null;
const FIRST_GW = 28;
let activeGW = null;     // "real" current GW from gw_config
let viewGW = null;       // GW being viewed (nav switcher)
let gwConfigs = {};      // gw -> config cache
let gwLoading = false;   // prevent rapid switching race conditions
let fixtures = [];
let players = {};       // element_id -> player
let results = {};       // fixture_id -> [{element_id, bps, is_goat}]
let userPicks = {};     // fixture_id -> {element_id, id (pick uuid)}
let selections = {};    // fixture_id -> {element_id, code, name, img} (unsaved UI state)
let changingFixtureId = null; // My Team inline change state
let changeOrigElementId = null; // original pick before change
let changeTempElementId = null; // currently previewed pick
let playerStats = {};   // element_id -> {avgRank, formBps, goats}
let statsMaxRound = 0;  // highest GW round in player_history
let maxGW = null;       // highest GW with fixtures in DB
let lineupsData = null; // RotoWire lineup data: { "teamId-teamId": { home, away } }
let standingsMode = 'gw'; // 'gw' or 'season'

function isAdmin() { return currentUser && currentUser.email === ADMIN_EMAIL; }
function botLabel(profile) { return (isAdmin() && profile && profile.is_bot) ? ' \uD83E\uDD16' : ''; }

// ===== ONBOARDING TOUR =====
function startTour() {
  var driverObj = window.driver.js.driver({
    showProgress: true,
    animate: true,
    allowClose: false,
    disableActiveInteraction: true,
    stagePadding: 8,
    stageRadius: 4,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Done',
    onDestroyStarted: function() {
      localStorage.setItem('goat_tour_done', 'true');
      driverObj.destroy();
      // Clean reload: remove ?tour from URL and refresh
      var cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
      if (cleanUrl !== window.location.href) {
        window.location.href = cleanUrl;
      } else {
        window.location.reload();
      }
    },
    steps: [
      {
        element: '.nav',
        popover: {
          title: 'Welcome to GOAT!',
          description: 'Every gameweek, pick the best player from each match based on the BPS system. Use the arrows to switch between gameweeks \u2014 play every one to climb the rankings.',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '#pick-matches .match-block',
        popover: {
          title: 'Match Block',
          description: 'Each match lists players from both teams. Use the sort tabs \u2014 Avg Rank and Form help find top performers. Watch for coloured dots near names \u2014 they show availability status.',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '#pick-matches .match-block .phex-card',
        popover: {
          title: 'Player Card',
          description: 'Tap a player to select them \u2014 gold border = your pick. Tap the \u24D8 icon to open their full profile with BPS history and detailed stats.',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '#team-strip',
        popover: {
          title: 'Team Strip',
          description: 'Your picks appear here. Once you\'ve selected a player for every match, hit Submit.',
          side: 'top',
          align: 'center'
        }
      },
      {
        element: '#tab-btn-myteam',
        popover: {
          title: 'My Team',
          description: 'View results for all your picks and make substitutions before matches kick off.',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '#tab-btn-live',
        popover: {
          title: 'Live',
          description: 'During matches, switch here to watch BPS scores update in real-time.',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '#tab-btn-standings',
        popover: {
          title: 'Standings',
          description: 'See how you rank. Most GOATs wins, BPS total breaks ties. Good luck!',
          side: 'bottom',
          align: 'center'
        }
      },
      {
        element: '.nav-right',
        popover: {
          title: 'Menu',
          description: 'Open the menu to rename your team, connect a Telegram bot for match notifications, or read the full rules.',
          side: 'bottom',
          align: 'end'
        }
      }
    ]
  });

  driverObj.drive();
}

function replayTour() {
  localStorage.removeItem('goat_tour_done');
  maybeStartTour();
}

function maybeStartTour() {
  var forcetour = window.location.search.includes('tour');
  if (!forcetour && localStorage.getItem('goat_tour_done') === 'true') return;

  // If current GW is locked, load next GW for the tour
  var tourGW = viewGW;
  if (isViewGWPickLocked() && maxGW && viewGW < maxGW) {
    tourGW = viewGW + 1;
  }

  function showTourOnPickTab() {
    document.querySelectorAll('.tab-content').forEach(function(el) { el.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function(el) { el.classList.remove('active'); });
    document.getElementById('tab-pick').classList.add('active');
    document.getElementById('tab-btn-pick').classList.add('active');
    var strip = document.getElementById('team-strip');
    if (strip) strip.style.display = '';
    setTimeout(function() {
      if (document.querySelector('#pick-matches .match-block') && document.querySelector('#pick-matches .phex-card')) {
        startTour();
      }
    }, 500);
  }

  if (tourGW !== viewGW) {
    // Load next GW data first, then show tour
    loadGWData(tourGW).then(function() { showTourOnPickTab(); });
  } else {
    showTourOnPickTab();
  }
}

// ===== AUTH =====
async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user;
  }

  // Listen for auth changes (magic link callback)
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_IN' && session) {
      currentUser = session.user;
      closeAuthModal();
      // Reload with user context
      loadAppData().then(function() { maybeStartTour(); });
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      // Reload in guest mode
      loadAppData();
    }
  });

  // Always load the app (guest or authenticated)
  loadAppData().then(function() { maybeStartTour(); });
}

async function handleGoogleAuth() {
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) console.error('Google sign-in error:', error.message);
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const msg = document.getElementById('auth-msg');
  const btn = document.getElementById('auth-submit');
  if (!email) { msg.textContent = 'Enter your email'; msg.className = 'auth-msg error'; return; }

  btn.disabled = true;
  msg.textContent = 'Sending...';
  msg.className = 'auth-msg';

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });

  btn.disabled = false;
  if (error) {
    msg.textContent = error.message;
    msg.className = 'auth-msg error';
  } else {
    msg.textContent = 'Check your email for the magic link!';
    msg.className = 'auth-msg success';
  }
}

async function handleSignOut() {
  await sb.auth.signOut();
  closeMenu();
}

function showAuthModal() {
  document.getElementById('auth-msg').textContent = '';
  document.getElementById('auth-email').value = '';
  document.getElementById('auth-modal').classList.add('open');
}

function closeAuthModal() {
  document.getElementById('auth-modal').classList.remove('open');
}

// ===== DATA LOADING =====
async function loadAppData() {
  // Update menu for auth state
  updateMenuState();

  // Load GW config (active) + discover max GW available
  const [{ data: gwData }, { data: maxGWData }] = await Promise.all([
    sb.from('gw_config').select('*').eq('is_active', true).limit(1).single(),
    sb.from('fixtures').select('gw').order('gw', { ascending: false }).limit(1).single()
  ]);
  if (gwData) {
    activeGW = gwData.gw;
    viewGW = gwData.gw;
    gwConfigs[gwData.gw] = gwData;
  } else {
    document.getElementById('pick-gw-title').textContent = 'No active gameweek';
    return;
  }
  maxGW = maxGWData ? maxGWData.gw : activeGW;

  // Load players + stats once (they don't change per GW)
  await Promise.all([loadPlayers(), loadPlayerStats(), loadLineups()]);
  if (currentUser) loadProfileData();

  // Check URL hash for initial GW
  const hashGW = parseGWFromHash();
  if (hashGW && hashGW >= FIRST_GW && hashGW <= maxGW) {
    viewGW = hashGW;
  }

  // Load GW-specific data
  await loadGWData(viewGW);
}

function updateMenuState() {
  const isAuth = !!currentUser;
  document.getElementById('menu-profile').style.display = isAuth ? '' : 'none';
  document.getElementById('menu-signout').style.display = isAuth ? '' : 'none';
  document.getElementById('menu-signin').style.display = isAuth ? 'none' : '';
  document.getElementById('menu-admin').style.display = isAdmin() ? '' : 'none';
}

// ===== GW NAVIGATION =====
function changeViewGW(delta) {
  const newGW = viewGW + delta;
  if (newGW < FIRST_GW || newGW > (maxGW || activeGW)) return;
  loadGWData(newGW);
}

function updateGWNav() {
  document.getElementById('gw-nav-label').textContent = 'GW ' + viewGW;
  document.getElementById('gw-prev').disabled = (viewGW <= FIRST_GW);
  document.getElementById('gw-next').disabled = (viewGW >= (maxGW || activeGW));
  // Update URL hash
  const newHash = '#gw' + viewGW + '_' + SEASON;
  if (window.location.hash !== newHash) {
    window.location.hash = newHash;
  }
}

function parseGWFromHash() {
  const hash = window.location.hash;
  if (!hash) return null;
  const m = hash.match(/^#gw(\d+)/i);
  if (m) return parseInt(m[1]);
  return null;
}

async function loadGWData(gw) {
  if (gwLoading) return;
  gwLoading = true;
  if (changingFixtureId) mtClosePanel();

  viewGW = gw;
  updateGWNav();
  // Clear ALL stale data from previous GW
  fixtures = [];
  results = {};
  userPicks = {};
  selections = {};

  // Update tab states immediately (gwLoading=true → pick locked)
  updateTabStates();

  // Ensure a tab is visible during loading
  if (!document.querySelector('.tab-content.active')) {
    document.getElementById('tab-live').classList.add('active');
    document.getElementById('tab-btn-live').classList.add('active');
  }

  // Show loading inside each tab's content area (without destroying structure)
  document.getElementById('pick-matches').innerHTML = '<div class="loading-spinner">Loading GW ' + gw + '...</div>';
  document.getElementById('live-match-content').innerHTML = '<div class="loading-spinner">Loading GW ' + gw + '...</div>';
  document.getElementById('live-nav').innerHTML = '';
  document.getElementById('mt-strip').innerHTML = '<div class="loading-spinner" style="min-width:100vw">Loading GW ' + gw + '...</div>';

  try {
    // Cache gw_config if not cached
    if (!gwConfigs[gw]) {
      const { data: cfgArr } = await sb.from('gw_config').select('*').eq('gw', gw).limit(1);
      if (cfgArr && cfgArr.length) gwConfigs[gw] = cfgArr[0];
    }

    // Load fixtures + picks in parallel
    await Promise.all([loadFixtures(), loadUserPicks()]);
    await loadResults();

    // Data loaded — unlock loading guard before tab state check
    gwLoading = false;

    // Render all tabs
    renderPickTab();
    renderLiveTab();
    renderMyTeam();
    loadStandings(viewGW);
    updateTabStates();
    autoSelectTab();
  } catch(e) {
    gwLoading = false;
    throw e;
  }
}

function updateTabStates() {
  const pickBtn = document.getElementById('tab-btn-pick');
  const myteamBtn = document.getElementById('tab-btn-myteam');

  // Pick tab: locked if viewGW pick is locked (for everyone)
  if (isViewGWPickLocked()) {
    pickBtn.classList.add('locked');
    pickBtn.innerHTML = 'Pick Team <span class="lock-icon">&#x1F512;</span>';
  } else {
    pickBtn.classList.remove('locked');
    pickBtn.textContent = 'Pick Team';
  }

  // Live tab: blinking red dot if any match is live in viewed GW
  const liveBtn = document.getElementById('tab-btn-live');
  const hasLive = fixtures.some(f => f.status === 'live');
  if (hasLive) {
    liveBtn.innerHTML = 'Live<span class="live-dot"></span>';
  } else {
    liveBtn.textContent = 'Live';
  }

  // My Team tab: always accessible (has proper empty states)
  myteamBtn.classList.remove('locked');
  myteamBtn.textContent = 'My Team';
}

function isViewGWPickLocked() {
  // During data loading, lock pick to prevent confused state
  if (gwLoading) return true;
  // Past GW: always locked
  if (viewGW < activeGW) return true;
  // Future GW: not locked (browsable, auth required to pick)
  if (viewGW > activeGW) return false;
  // Active GW: locked if any match has started or kickoff passed
  if (!fixtures.length) return false;
  return fixtures.some(f => f.status !== 'scheduled' || new Date() >= new Date(f.kickoff_time));
}

function autoSelectTab() {
  const hasPicks = Object.keys(userPicks).length > 0;
  const locked = isViewGWPickLocked();

  if (!currentUser) {
    // Guest: Live for active/past GW, Pick for future (browsable)
    if (viewGW > activeGW) switchTab('pick');
    else switchTab('live');
  } else if (viewGW < activeGW) {
    // Past GW → Standings
    switchTab('standings');
  } else if (locked && hasPicks) {
    switchTab('myteam');
  } else if (locked && !hasPicks) {
    switchTab('live');
  } else {
    switchTab('pick');
  }
}

function goHome() {
  if (viewGW === activeGW) {
    // Already on active GW, just pick best tab
    autoSelectTab();
  } else {
    loadGWData(activeGW);
  }
}

async function loadFixtures() {
  const { data } = await sb.from('fixtures').select('*').eq('gw', viewGW).order('kickoff_time');
  fixtures = data || [];
}

async function loadPlayers() {
  const { data } = await sb.from('players').select('element_id,code,name,short_name,team_id,team_short,position');
  players = {};
  (data || []).forEach(p => { players[p.element_id] = p; });
}

async function loadResults() {
  results = {};
  if (!fixtures.length) return;
  const fixtureIds = fixtures.map(f => f.id);
  const { data } = await sb.from('results').select('*').in('fixture_id', fixtureIds).order('bps', { ascending: false });
  results = {};
  (data || []).forEach(r => {
    if (!results[r.fixture_id]) results[r.fixture_id] = [];
    results[r.fixture_id].push(r);
  });
}

async function loadUserPicks() {
  if (!currentUser || !viewGW) {
    userPicks = {};
    selections = {};
    return;
  }
  const { data } = await sb.from('picks').select('*').eq('user_id', currentUser.id).eq('gw', viewGW);
  userPicks = {};
  (data || []).forEach(p => { userPicks[p.fixture_id] = p; });

  // Sync to selections
  selections = {};
  for (const [fid, pick] of Object.entries(userPicks)) {
    const pl = players[pick.element_id];
    if (pl) {
      selections[parseInt(fid)] = {
        element_id: pick.element_id,
        code: pl.code,
        name: pl.short_name || pl.name,
        img: CDN + pl.code + '.png'
      };
    }
  }
}

async function loadPlayerStats() {
  // Fetch bps_rank + bps for all players to compute Bayesian avg rank, form (L6 GWs), GOAT count
  playerStats = {};
  let offset = 0;
  const allRows = [];
  while (true) {
    const { data } = await sb.from('player_history').select('element_id,bps_rank,bps,round,minutes').order('round', { ascending: true }).range(offset, offset + 999);
    if (!data || !data.length) break;
    allRows.push(...data);
    offset += data.length;
    if (data.length < 1000) break;
  }
  // Find max round in data for form window
  statsMaxRound = 0;
  for (const r of allRows) { if (r.round > statsMaxRound) statsMaxRound = r.round; }
  const formStart = Math.max(1, statsMaxRound - 5); // last 6 GWs

  // Bayesian average constants: C=6 prior games, M=15 mean rank
  const C = 6, M = 15;
  const byPlayer = {};   // eid -> [{round, bps_rank, bps}]
  for (const r of allRows) {
    if (!byPlayer[r.element_id]) byPlayer[r.element_id] = [];
    byPlayer[r.element_id].push(r);
  }
  for (const [eid, rows] of Object.entries(byPlayer)) {
    const ranked = rows.filter(r => r.bps_rank);
    const rankSum = ranked.reduce((s, r) => s + r.bps_rank, 0);
    const n = ranked.length;
    const bayesAvg = (C * M + rankSum) / (C + n);
    const goats = ranked.filter(r => r.bps_rank === 1).length;

    // Form: avg BPS over last 6 GWs (missed GWs = 0 BPS)
    const byRound = {};
    for (const r of rows) { byRound[r.round] = r; }
    let formBpsSum = 0;
    for (let gw = formStart; gw <= statsMaxRound; gw++) {
      const r = byRound[gw];
      if (r && r.minutes > 0) formBpsSum += (r.bps || 0);
    }
    const formBps = Math.round(formBpsSum / 6 * 10) / 10;

    playerStats[eid] = {
      avgRank: Math.round(bayesAvg * 10) / 10,
      formBps: formBps,
      goats, games: n
    };
  }
}

// ===== LINEUPS (RotoWire) =====
async function loadLineups() {
  try {
    const resp = await fetch('/api/lineups');
    if (resp.ok) lineupsData = await resp.json();
  } catch(e) { console.warn('Lineups unavailable'); }
}

function getAvailStatus(elementId) {
  if (!lineupsData) return null;
  for (const key of Object.keys(lineupsData)) {
    const m = lineupsData[key];
    for (const side of [m.home, m.away]) {
      if (!side) continue;
      const p = side.find(x => x.fpl_id === elementId);
      if (p) return p.status;
    }
  }
  return null;
}

function availHtml(elementId, fixture) {
  // Confirmed lineups: within 75 min of kickoff or match started
  if (fixture) {
    const ko = new Date(fixture.kickoff_time);
    const minsToKo = (ko - new Date()) / 60000;
    if (fixture.status === 'live' || fixture.status === 'ft' || (minsToKo <= 75 && minsToKo > -15)) {
      const st = getAvailStatus(elementId);
      if (!st) return '';
      if (st === 'starter' || st === 'starter_ques')
        return '<span class="avail-text avail-in">IN</span>';
      return '<span class="avail-text avail-out-text">OUT</span>';
    }
  }
  // Predictions: colored dots
  const st = getAvailStatus(elementId);
  if (!st) return '';
  return '<span class="avail-dot avail-' + st + '"></span>';
}

// ===== DEADLINE HELPERS =====
function getFirstKickoff() {
  // Returns kickoff of first SCHEDULED (not yet started) fixture
  if (!fixtures.length) return null;
  let earliest = null;
  for (const f of fixtures) {
    if (f.status !== 'scheduled') continue;
    const ko = new Date(f.kickoff_time);
    if (!earliest || ko < earliest) earliest = ko;
  }
  return earliest;
}

function hasSubmitted() {
  return Object.keys(userPicks).length > 0;
}

function isMatchLocked(f) {
  const now = new Date();
  const ko = new Date(f.kickoff_time);
  return f.status !== 'scheduled' || now >= ko;
}

// ===== PICK TAB =====
function renderPickTab() {
  const cfg = gwConfigs[viewGW];
  if (!cfg) return;
  document.getElementById('pick-gw-title').textContent = cfg.label || ('Gameweek ' + viewGW);

  // Show deadline = first kickoff time
  const firstKO = getFirstKickoff();
  const now = new Date();
  const submitted = hasSubmitted();
  let subText = '';

  if (!submitted) {
    if (!firstKO) {
      // All matches already started, no scheduled fixtures left
      subText = '\uD83D\uDD12 Deadline passed \u2014 all matches started';
    } else if (now >= firstKO) {
      subText = '\uD83D\uDD12 Deadline passed \u2014 picks are closed';
    } else {
      const koStr = firstKO.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + ' \u00B7 ' + firstKO.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});
      subText = 'Submit before ' + koStr;
    }
  } else {
    subText = 'Submitted \u2713 \u2014 change picks until each match kicks off';
  }
  document.getElementById('pick-gw-sub').textContent = subText;

  renderMatchBlocks();
  renderStrip();
}

function renderMatchBlocks() {
  const container = document.getElementById('pick-matches');
  if (!fixtures.length) {
    container.innerHTML = '<div class="empty-state"><span class="emoji">&#x1F4C5;</span><h3>No fixtures</h3><p>Fixtures will appear when the gameweek is set up</p></div>';
    return;
  }

  const now = new Date();
  const firstKO = getFirstKickoff();
  const submitted = hasSubmitted();
  // Before submit: block if no scheduled fixtures left (global deadline passed)
  const globalDeadlinePassed = !submitted && (!firstKO || now >= firstKO);
  // Lock all matches if viewing past GW
  const notActiveGW = viewGW < activeGW;

  let html = '';
  for (let idx = 0; idx < fixtures.length; idx++) {
    const f = fixtures[idx];
    const matchNum = idx + 1;
    const ko = new Date(f.kickoff_time);
    const matchStarted = isMatchLocked(f);
    // Always lock started matches. Before submit: also lock all if global deadline passed. Lock all for non-active GW.
    const locked = matchStarted || globalDeadlinePassed || notActiveGW;
    const sel = selections[f.id];

    // Get players for this fixture (both teams)
    const matchPlayers = getPlayersForFixture(f);

    const badgeHtml = sel ? '<span class="match-selected-badge">\u2713 ' + sel.name + '</span>' : '';
    const isFt = f.status === 'ft';
    const isLive = f.status === 'live';
    let lockedHtml = '';
    if (isFt) lockedHtml = '<span class="match-locked" style="color:#666">FT ' + f.home_score + '-' + f.away_score + '</span>';
    else if (isLive) lockedHtml = '<span class="match-locked">\u23F1 ' + f.minutes + "\u2019 " + f.home_score + '-' + f.away_score + '</span>';
    else if (locked) lockedHtml = '<span class="match-locked">\uD83D\uDD12 LOCKED</span>';
    const timeStr = ko.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + ' \u00B7 ' + ko.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});

    const cards = matchPlayers.map(function(p, ci) {
      const isSel = sel && sel.element_id === p.element_id;
      const sc = isSel ? ' selected' : '';
      const ps = playerStats[p.element_id] || {};
      const avgR = ps.avgRank || 99;
      const formB = ps.formBps || 0;
      const goats = ps.goats || 0;
      return '<div class="phex-card' + sc + '" data-orig-idx="' + ci + '" data-pos="' + (p.position||'') + '" data-eid="' + p.element_id + '" data-code="' + p.code + '" data-name="' + esc(p.short_name || p.name) + '" data-team="' + (p.team_short||'') + '" data-ph="' + CDN + p.code + '.png" data-avgrank="' + avgR + '" data-form="' + formB + '" data-goats="' + goats + '">'
        + '<div class="phex-name-wrap">'
        + '<div class="phex-name" onclick="event.stopPropagation();openProfileFromCard(this.closest(\'.phex-card\'))">' + availHtml(p.element_id, f) + esc(p.short_name || p.name) + '</div>'
        + '<span class="phex-info-btn" onclick="event.stopPropagation();openProfileFromCard(this.closest(\'.phex-card\'))">i</span>'
        + '</div>'
        + '<div class="phex-outer' + sc + '" onclick="selectPlayer(' + f.id + ',' + p.element_id + ',this.closest(\'.phex-card\'),' + (locked?'true':'false') + ')">'
        + '<div class="phex-inner">'
        + '<img src="' + CDN + p.code + '.png" loading="' + (idx === 0 ? 'eager' : 'lazy') + '" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt="">'
        + '</div></div>'
        + '<div class="phex-team-pos">' + (p.team_short||'') + ' \u00B7 ' + p.position + '</div>'
        + '</div>';
    }).join('');

    html += '<div class="match-block" id="match-' + f.id + '">'
      + '<div class="match-header">'
      + '<div class="match-header-left">'
      + '<div class="match-num-hex">' + matchNum + '</div>'
      + '<div class="match-teams-wrap">'
      + '<div class="match-teams">' + f.home_short + ' <span>v</span> ' + f.away_short + '</div>'
      + '<div class="match-time">' + timeStr + '</div>'
      + '</div></div>'
      + '<div>' + badgeHtml + lockedHtml + '</div>'
      + '</div>'
      + '<div class="pos-tabs">'
      + '<div class="pos-tab active" onclick="sortMatch(' + f.id + ',\'avgrank\',this)">Avg Rank</div>'
      + '<div class="pos-tab" onclick="sortMatch(' + f.id + ',\'form\',this)">Form</div>'
      + '<div class="pos-tab" onclick="sortMatch(' + f.id + ',\'goats\',this)">\uD83D\uDC51 GOAT</div>'
      + '<div class="pos-tab" onclick="sortMatch(' + f.id + ',\'all\',this)">All</div>'
      + '</div>'
      + '<div class="player-row-outer"><div class="player-row">' + cards + '</div></div>'
      + '</div>';
  }

  container.innerHTML = html;

  // Default sort: Avg Rank
  fixtures.forEach(function(f) {
    var block = document.getElementById('match-' + f.id);
    if (block) {
      var tab = block.querySelector('.pos-tab');
      if (tab) sortMatch(f.id, 'avgrank', tab);
    }
  });
}

function getPlayersForFixture(f) {
  // Get all players for both teams in this fixture
  const all = Object.values(players).filter(p =>
    p.team_id === f.home_team_id || p.team_id === f.away_team_id
  );
  // Sort: home team first, then by position
  all.sort((a, b) => {
    const aHome = a.team_id === f.home_team_id ? 0 : 1;
    const bHome = b.team_id === f.home_team_id ? 0 : 1;
    if (aHome !== bHome) return aHome - bHome;
    return (PO[a.position]||5) - (PO[b.position]||5);
  });
  return all;
}

function selectPlayer(fixtureId, elementId, cardEl, locked) {
  if (!currentUser) { showAuthModal(); return; }
  if (viewGW < activeGW) { showToast('Cannot pick for past gameweeks'); return; }
  if (locked) { showToast('This match is locked'); return; }

  const matchBlock = document.getElementById('match-' + fixtureId);
  const currentSel = selections[fixtureId];
  const isDeselect = currentSel && currentSel.element_id === elementId;

  // Deselect all in this match
  matchBlock.querySelectorAll('.phex-card').forEach(c => {
    c.classList.remove('selected');
    c.querySelector('.phex-outer').classList.remove('selected');
  });

  const badge = matchBlock.querySelector('.match-header > div:last-child');

  if (isDeselect) {
    // Toggle off — clear selection
    delete selections[fixtureId];
    badge.innerHTML = '';
    renderStrip();

    // If already submitted, delete the pick from DB
    if (hasSubmitted() && userPicks[fixtureId]) {
      deleteSinglePick(fixtureId);
    }
    return;
  }

  // Select this card
  cardEl.classList.add('selected');
  cardEl.querySelector('.phex-outer').classList.add('selected');

  const name = cardEl.dataset.name;
  const code = parseInt(cardEl.dataset.code);
  const img = cardEl.dataset.ph;

  badge.innerHTML = '<span class="match-selected-badge">\u2713 ' + name + '</span>';

  selections[fixtureId] = { element_id: elementId, code, name, img };
  renderStrip();

  // Auto-save if user already submitted picks (Phase 2)
  if (hasSubmitted()) {
    saveSinglePick(fixtureId, elementId);
  }
}

async function saveSinglePick(fixtureId, elementId) {
  if (!currentUser || viewGW < activeGW) return;
  const existing = userPicks[fixtureId];
  try {
    if (existing) {
      if (existing.element_id === elementId) return; // no change
      await sb.from('picks').update({
        element_id: elementId,
        updated_at: new Date().toISOString()
      }).eq('id', existing.id);
    } else {
      await sb.from('picks').insert({
        user_id: currentUser.id,
        fixture_id: fixtureId,
        element_id: elementId,
        gw: viewGW
      });
    }
    // Update local state
    await loadUserPicks();
    showToast('Pick saved');
  } catch(e) {
    showToast('Error saving pick');
    console.error(e);
  }
}

async function deleteSinglePick(fixtureId) {
  if (!currentUser || viewGW < activeGW) return;
  const existing = userPicks[fixtureId];
  if (!existing) return;
  try {
    await sb.from('picks').delete().eq('id', existing.id);
    await loadUserPicks();
    showToast('Pick removed');
  } catch(e) {
    showToast('Error removing pick');
    console.error(e);
  }
}

function renderStrip() {
  const slotsEl = document.getElementById('strip-slots');
  const submitBtn = document.getElementById('strip-submit');
  const totalMatches = fixtures.length;
  let html = '';
  let count = 0;

  for (let i = 0; i < totalMatches; i++) {
    const fid = fixtures[i].id;
    const sel = selections[fid];
    if (sel) {
      count++;
      html += '<div class="strip-slot filled"><img src="' + sel.img + '" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt=""></div>';
    } else {
      html += '<div class="strip-slot"></div>';
    }
  }

  slotsEl.innerHTML = html;
  document.getElementById('strip-count').textContent = count + '/' + totalMatches;

  const submitted = hasSubmitted();
  const now = new Date();
  const firstKO = getFirstKickoff();
  const globalDeadlinePassed = !submitted && firstKO && now >= firstKO;

  if (submitted) {
    // Phase 2: auto-save mode, hide submit button
    submitBtn.style.display = 'none';
  } else if (globalDeadlinePassed) {
    submitBtn.textContent = 'Closed';
    submitBtn.disabled = true;
    submitBtn.style.display = '';
  } else if (count < totalMatches) {
    submitBtn.style.display = '';
    submitBtn.textContent = count === 0 ? 'Submit' : count + '/' + totalMatches + ' \u2014 pick all';
    submitBtn.disabled = true;
  } else {
    submitBtn.style.display = '';
    submitBtn.textContent = 'Submit';
    submitBtn.disabled = false;
  }
}

async function submitPicks() {
  if (!currentUser || viewGW < activeGW) return;
  const btn = document.getElementById('strip-submit');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    for (const [fixtureId, sel] of Object.entries(selections)) {
      const fid = parseInt(fixtureId);
      const f = fixtures.find(x => x.id === fid);
      if (!f) continue;

      // Skip locked matches
      const now = new Date();
      const ko = new Date(f.kickoff_time);
      if (f.status !== 'scheduled' || now >= ko) continue;

      const existing = userPicks[fid];
      if (existing) {
        // Update existing pick
        if (existing.element_id !== sel.element_id) {
          await sb.from('picks').update({
            element_id: sel.element_id,
            updated_at: new Date().toISOString()
          }).eq('id', existing.id);
        }
      } else {
        // Insert new pick
        await sb.from('picks').insert({
          user_id: currentUser.id,
          fixture_id: fid,
          element_id: sel.element_id,
          gw: viewGW
        });
      }
    }

    // Reload picks
    await loadUserPicks();
    showToast('Picks saved!');
    // Re-render to switch to Phase 2 (auto-save mode)
    renderPickTab();
    renderMyTeam();
  } catch(e) {
    showToast('Error saving picks');
    console.error(e);
  }

  btn.disabled = false;
  btn.textContent = 'Submit';
}

function sortMatch(fixtureId, mode, tabEl, useRawId) {
  const matchBlock = document.getElementById(useRawId ? fixtureId : 'match-' + fixtureId);
  matchBlock.querySelectorAll('.pos-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  const row = matchBlock.querySelector('.player-row');
  const cards = Array.from(row.querySelectorAll('.phex-card'));
  cards.forEach(c => c.classList.remove('hidden'));
  if (mode === 'all') {
    // Default: home team first, then by position
    cards.sort((a, b) => {
      const aIdx = parseInt(a.dataset.origIdx || '0');
      const bIdx = parseInt(b.dataset.origIdx || '0');
      return aIdx - bIdx;
    });
  } else if (mode === 'avgrank') {
    cards.sort((a, b) => parseFloat(a.dataset.avgrank) - parseFloat(b.dataset.avgrank));
  } else if (mode === 'form') {
    cards.sort((a, b) => parseFloat(b.dataset.form) - parseFloat(a.dataset.form));
  } else if (mode === 'goats') {
    cards.sort((a, b) => parseInt(b.dataset.goats) - parseInt(a.dataset.goats));
  }
  cards.forEach(c => row.appendChild(c));
}

// ===== LIVE TAB =====
async function renderLiveTab() {
  await Promise.all([loadFixtures(), loadResults()]);

  const nav = document.getElementById('live-nav');
  const content = document.getElementById('live-match-content');

  if (!fixtures.length) {
    nav.innerHTML = '';
    content.innerHTML = '<div class="empty-state"><span class="emoji">&#x26BD;</span><h3>No fixtures for GW' + viewGW + '</h3><p>Fixtures will appear when the gameweek is set up</p></div>';
    return;
  }

  // Build nav buttons
  let navHtml = '';
  let firstLive = null;
  let lastFt = null;
  for (const f of fixtures) {
    const isLive = f.status === 'live';
    const isFt = f.status === 'ft';
    const dotHtml = isLive ? '<span class="live-dot"></span>' : '';
    const statusHtml = isLive ? '<span class="live-nav-min">' + f.minutes + "'" + '</span>'
      : isFt ? '<span class="live-nav-ft">FT</span>'
      : '<span class="live-nav-time">' + new Date(f.kickoff_time).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) + '</span>';

    const scoreHtml = (isLive || isFt) ? ' <span class="score">' + f.home_score + '\u2013' + f.away_score + '</span> ' : ' ';

    // Get user's pick rank in this match
    const myPick = userPicks[f.id];
    const matchResults = results[f.id] || [];
    let rankHtml = '';
    if (myPick) {
      if (matchResults.length) {
        const idx = matchResults.findIndex(r => r.element_id === myPick.element_id);
        const rank = idx >= 0 ? idx + 1 : '–';
        const isGoat = idx === 0 && matchResults[0].is_goat;
        rankHtml = '<span class="lv-nav-rank' + (isGoat ? ' lv-rank-motm' : '') + '">' + rank + '</span>';
      } else {
        rankHtml = '<span class="lv-nav-rank">–</span>';
      }
    }

    // Track first live and last FT
    if (isLive && !firstLive) firstLive = f.id;
    if (isFt) lastFt = f.id;

    navHtml += '<div class="live-match-btn" data-fid="' + f.id + '" onclick="showLiveMatch(' + f.id + ',this)">' + dotHtml + f.home_short + ' - ' + f.away_short + scoreHtml + statusHtml + rankHtml + '</div>';
  }

  // Smart match selection: first live → last FT → first fixture
  let firstActive = firstLive || lastFt || (fixtures.length ? fixtures[0].id : null);
  if (!firstActive) return;

  nav.innerHTML = navHtml;
  // Ensure first active button is marked
  if (!nav.querySelector('.live-match-btn.active')) {
    var firstBtn = nav.querySelector('.live-match-btn[data-fid="' + firstActive + '"]');
    if (firstBtn) firstBtn.classList.add('active');
  }

  showLiveMatchContent(firstActive);
}

function showLiveMatch(fixtureId, btnEl) {
  document.querySelectorAll('.live-match-btn').forEach(b => b.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
  showLiveMatchContent(fixtureId);
}

function showLiveMatchContent(fixtureId) {
  const content = document.getElementById('live-match-content');
  const f = fixtures.find(x => x.id === fixtureId);
  if (!f) return;

  const matchResults = results[fixtureId] || [];
  const isLive = f.status === 'live';
  const isFt = f.status === 'ft';
  const myPick = userPicks[fixtureId];

  // Header
  let html = '<div class="live-header">';
  html += '<div class="live-score-row">';
  html += '<div class="live-team-name">' + f.home_short + '</div>';
  if (isLive || isFt) {
    html += '<div class="live-score">' + f.home_score + ' \u2013 ' + f.away_score + '</div>';
  } else {
    html += '<div class="live-score">\u2013</div>';
  }
  html += '<div class="live-team-name">' + f.away_short + '</div>';
  html += '</div>';
  if (isLive) html += '<div style="text-align:center"><span class="live-minute">\u23F1 ' + f.minutes + "'" + '</span></div>';
  if (isFt) html += '<div style="text-align:center"><span style="color:#666;font-size:12px;font-weight:700">FULL TIME</span></div>';
  html += '</div>';

  // Player cards
  if (matchResults.length) {
    html += '<div class="live-strip-section"><div class="live-strip-wrap"><div class="live-strip">';
    let pickFoundInResults = false;
    matchResults.forEach((r, idx) => {
      const pl = players[r.element_id];
      if (!pl) return;
      const rank = idx + 1;
      const isGoat = r.is_goat;
      const isYours = myPick && myPick.element_id === r.element_id;
      if (isYours) pickFoundInResults = true;
      let cls = 'lv-card';
      if (isGoat) cls += ' lv-motm';
      else if (isYours) cls += ' lv-yours';

      html += '<div class="' + cls + '">'
        + '<div class="lv-hex-wrap">'
        + '<div class="lv-hex-outer"><div class="lv-hex-inner"><img src="' + CDN + pl.code + '.png" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt=""></div></div>'
        + '<div class="lv-rank-badge">' + rank + '</div>'
        + '</div>'
        + '<div class="lv-name">' + esc(pl.short_name || pl.name) + '</div>'
        + '<div class="lv-pos">' + pl.position + '</div>'
        + '<div class="lv-bps">' + r.bps + '</div>'
        + '</div>';
    });
    // Show user's pick with 0 BPS if they didn't appear in results (didn't play)
    if (myPick && !pickFoundInResults) {
      const pl = players[myPick.element_id];
      if (pl) {
        html += '<div class="lv-card lv-dnp">'
          + '<div class="lv-hex-wrap">'
          + '<div class="lv-hex-outer"><div class="lv-hex-inner"><img src="' + CDN + pl.code + '.png" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt=""></div></div>'
          + '<div class="lv-rank-badge">–</div>'
          + '</div>'
          + '<div class="lv-name">' + esc(pl.short_name || pl.name) + '</div>'
          + '<div class="lv-pos">' + pl.position + '</div>'
          + '<div class="lv-bps">0</div>'
          + '</div>';
      }
    }
    html += '</div></div></div>';
  } else if (myPick && players[myPick.element_id]) {
    // No results yet but user has a pick — show it with 0
    const pl = players[myPick.element_id];
    html += '<div class="live-strip-section"><div class="live-strip-wrap"><div class="live-strip">';
    html += '<div class="lv-card lv-dnp">'
      + '<div class="lv-hex-wrap">'
      + '<div class="lv-hex-outer"><div class="lv-hex-inner"><img src="' + CDN + pl.code + '.png" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt=""></div></div>'
      + '<div class="lv-rank-badge">–</div>'
      + '</div>'
      + '<div class="lv-name">' + esc(pl.short_name || pl.name) + '</div>'
      + '<div class="lv-pos">' + pl.position + '</div>'
      + '<div class="lv-bps">0</div>'
      + '</div>';
    html += '</div></div></div>';
  } else {
    html += '<div class="empty-state"><span class="emoji">&#x1F4CA;</span><h3>No BPS data yet</h3><p>BPS will update during the match</p></div>';
  }

  content.innerHTML = html;
}

// ===== MY TEAM TAB =====
// ===== MY TEAM — INLINE CHANGE =====
function openChangePanel(fixtureId) {
  // Close any existing panel first
  if (changingFixtureId) mtClosePanel();

  const f = fixtures.find(x => x.id === fixtureId);
  if (!f) return;
  const pick = userPicks[fixtureId];
  if (!pick) return;

  changingFixtureId = fixtureId;
  changeOrigElementId = pick.element_id;
  changeTempElementId = pick.element_id;

  // Re-render cards to show Save/Cancel on the active card
  renderMyTeam();

  // Render the match block (same as Pick tab)
  const panel = document.getElementById('mt-change-panel');
  const matchPlayers = getPlayersForFixture(f);

  const cards = matchPlayers.map(function(p, ci) {
    const isSel = p.element_id === changeTempElementId;
    const sc = isSel ? ' selected' : '';
    const ps = playerStats[p.element_id] || {};
    const avgR = ps.avgRank || 99;
    const formB = ps.formBps || 0;
    const goats = ps.goats || 0;
    return '<div class="phex-card' + sc + '" data-orig-idx="' + ci + '" data-pos="' + (p.position||'') + '" data-eid="' + p.element_id + '" data-code="' + p.code + '" data-name="' + esc(p.short_name || p.name) + '" data-team="' + (p.team_short||'') + '" data-ph="' + CDN + p.code + '.png" data-avgrank="' + avgR + '" data-form="' + formB + '" data-goats="' + goats + '">'
      + '<div class="phex-name-wrap">'
      + '<div class="phex-name" onclick="event.stopPropagation();openProfileFromCard(this.closest(\'.phex-card\'))">' + availHtml(p.element_id, f) + esc(p.short_name || p.name) + '</div>'
      + '<span class="phex-info-btn" onclick="event.stopPropagation();openProfileFromCard(this.closest(\'.phex-card\'))">i</span>'
      + '</div>'
      + '<div class="phex-outer' + sc + '" onclick="mtSelectPlayer(' + fixtureId + ',' + p.element_id + ',this.closest(\'.phex-card\'))">'
      + '<div class="phex-inner">'
      + '<img src="' + CDN + p.code + '.png" loading="lazy" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt="">'
      + '</div></div>'
      + '<div class="phex-team-pos">' + (p.team_short||'') + ' \u00B7 ' + p.position + '</div>'
      + '</div>';
  }).join('');

  const ko = new Date(f.kickoff_time);
  const timeStr = ko.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'}) + ' \u00B7 ' + ko.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit'});

  panel.innerHTML = '<div class="mt-cp-header">'
    + '<div class="mt-cp-title">' + f.home_short + ' v ' + f.away_short + ' \u00B7 ' + timeStr + '</div>'
    + '<div class="mt-cp-close" onclick="mtCancelChange()">&#x2715;</div>'
    + '</div>'
    + '<div class="match-block" id="mt-match-' + fixtureId + '">'
    + '<div class="pos-tabs">'
    + '<div class="pos-tab active" onclick="sortMatch(\'mt-match-' + fixtureId + '\',\'avgrank\',this,true)">Avg Rank</div>'
    + '<div class="pos-tab" onclick="sortMatch(\'mt-match-' + fixtureId + '\',\'form\',this,true)">Form</div>'
    + '<div class="pos-tab" onclick="sortMatch(\'mt-match-' + fixtureId + '\',\'goats\',this,true)">\uD83D\uDC51 GOAT</div>'
    + '<div class="pos-tab" onclick="sortMatch(\'mt-match-' + fixtureId + '\',\'all\',this,true)">All</div>'
    + '</div>'
    + '<div class="player-row-outer"><div class="player-row">' + cards + '</div></div>'
    + '</div>';

  panel.classList.add('open');

  // Scroll panel into view
  setTimeout(function() { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
}

function mtSelectPlayer(fixtureId, elementId, cardEl) {
  if (fixtureId !== changingFixtureId) return;

  // Deselect all in change panel
  const panel = document.getElementById('mt-match-' + fixtureId);
  panel.querySelectorAll('.phex-card').forEach(c => {
    c.classList.remove('selected');
    c.querySelector('.phex-outer').classList.remove('selected');
  });

  // Select this card
  cardEl.classList.add('selected');
  cardEl.querySelector('.phex-outer').classList.add('selected');

  changeTempElementId = elementId;

  // Update the mt2-card preview
  const pl = players[elementId];
  if (pl) {
    const img = document.getElementById('mt-img-' + fixtureId);
    if (img) { img.src = CDN + pl.code + '.png'; img.style.display = ''; }
    const nameEl = document.getElementById('mt-name-' + fixtureId);
    if (nameEl) nameEl.textContent = pl.short_name || pl.name;
    const posEl = document.getElementById('mt-pos-' + fixtureId);
    if (posEl) posEl.textContent = pl.position;
  }
}

async function mtSaveChange() {
  if (!changingFixtureId || !changeTempElementId) return;
  if (changeTempElementId !== changeOrigElementId) {
    await saveSinglePick(changingFixtureId, changeTempElementId);
  }
  mtClosePanel();
  renderMyTeam();
}

function mtCancelChange() {
  if (!changingFixtureId) return;
  // Revert card preview to original
  if (changeOrigElementId) {
    const pl = players[changeOrigElementId];
    if (pl) {
      const img = document.getElementById('mt-img-' + changingFixtureId);
      if (img) { img.src = CDN + pl.code + '.png'; img.style.display = ''; }
      const nameEl = document.getElementById('mt-name-' + changingFixtureId);
      if (nameEl) nameEl.textContent = pl.short_name || pl.name;
      const posEl = document.getElementById('mt-pos-' + changingFixtureId);
      if (posEl) posEl.textContent = pl.position;
    }
  }
  mtClosePanel();
  renderMyTeam();
}

function mtClosePanel() {
  changingFixtureId = null;
  changeOrigElementId = null;
  changeTempElementId = null;
  const panel = document.getElementById('mt-change-panel');
  panel.classList.remove('open');
  panel.innerHTML = '';
}

function renderMyTeam() {
  const strip = document.getElementById('mt-strip');
  const cfg = gwConfigs[viewGW];
  document.getElementById('mt-subtitle').textContent = cfg ? (cfg.label || 'Gameweek ' + viewGW) : '';

  if (!Object.keys(userPicks).length) {
    if (!currentUser) {
      strip.innerHTML = '<div class="empty-state" style="min-width:100vw"><span class="emoji">&#x1F512;</span><h3>Sign in to play</h3><p>Create an account to pick your GOATs and track your results</p><div style="margin-top:16px"><button onclick="showAuthModal()" style="background:#BFB294;color:#111;border:none;padding:10px 24px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;cursor:pointer">Sign In</button></div></div>';
    } else {
      strip.innerHTML = '<div class="empty-state" style="min-width:100vw"><span class="emoji">&#x1F90C;</span><h3>No picks yet for GW' + viewGW + '</h3><p>Head to the Pick Team tab to choose your GOATs</p><div style="margin-top:16px"><button onclick="switchTab(\'pick\')" style="background:#BFB294;color:#111;border:none;padding:10px 24px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;cursor:pointer">Pick Team</button></div></div>';
    }
    return;
  }

  let html = '';
  for (const f of fixtures) {
    const pick = userPicks[f.id];
    if (!pick) continue;
    const pl = players[pick.element_id];
    if (!pl) continue;

    const isLive = f.status === 'live';
    const isFt = f.status === 'ft';
    const matchResults = results[f.id] || [];

    // Find rank (results are pre-sorted by bps desc)
    let rank = '–';
    let bpsVal = '–';
    let isGoat = false;
    if (matchResults.length) {
      const sorted = [...matchResults].sort((a, b) => b.bps - a.bps);
      const idx = sorted.findIndex(r => r.element_id === pick.element_id);
      if (idx >= 0) {
        rank = idx + 1;
        bpsVal = sorted[idx].bps;
        isGoat = sorted[idx].is_goat;
      }
    }

    const cardClass = isGoat ? ' motm' : '';
    let statusClass = '';
    let statusText = '';
    if (isFt) {
      statusClass = ' ft';
      statusText = 'FT ' + f.home_score + '-' + f.away_score;
    } else if (isLive) {
      statusClass = ' live';
      statusText = f.minutes + "' " + f.home_score + '-' + f.away_score;
    } else {
      const ko = new Date(f.kickoff_time);
      statusText = ko.toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'}) + ' · ' + ko.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
    }

    const bpsClass = (!isLive && !isFt) ? ' pending' : '';
    const bpsDisplay = (!isLive && !isFt) ? '\u2013' : bpsVal;
    const canChange = !isMatchLocked(f);
    const isChanging = changingFixtureId === f.id;
    let actionHtml = '';
    if (isChanging) {
      actionHtml = '<div class="mt2-actions">'
        + '<div class="mt2-save" onclick="mtSaveChange()">Save</div>'
        + '<div class="mt2-cancel" onclick="mtCancelChange()">Cancel</div>'
        + '</div>';
    } else if (canChange) {
      actionHtml = '<div class="mt2-change" onclick="openChangePanel(' + f.id + ')">Change</div>';
    }
    const changingClass = isChanging ? ' changing' : '';

    html += '<div class="mt2-card' + cardClass + changingClass + '" id="mt-card-' + f.id + '">'
      + '<div class="mt2-header">'
      + '<div class="mt2-match">' + f.home_short + ' v ' + f.away_short + '</div>'
      + '<div class="mt2-status' + statusClass + '">' + statusText + '</div>'
      + '</div>'
      + '<div class="mt2-hex-wrap">'
      + '<div class="mt2-hex-outer"><div class="mt2-hex-inner"><img id="mt-img-' + f.id + '" src="' + CDN + pl.code + '.png" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt=""></div></div>'
      + '<div class="mt2-rank-badge">' + rank + '</div>'
      + '</div>'
      + '<div class="mt2-name" id="mt-name-' + f.id + '">' + availHtml(pl.element_id, f) + esc(pl.short_name || pl.name) + '</div>'
      + '<div class="mt2-pos" id="mt-pos-' + f.id + '">' + pl.position + '</div>'
      + '<div class="mt2-bps' + bpsClass + '">' + bpsDisplay + '</div>'
      + actionHtml
      + '</div>';
  }

  strip.innerHTML = html || '<div class="empty-state" style="min-width:100vw"><span class="emoji">&#x1F90C;</span><h3>No picks yet</h3></div>';
}

// ===== STANDINGS TAB =====
async function loadStandings(gw) {
  const content = document.getElementById('standings-content');
  if (standingsMode === 'season') {
    await loadSeasonStandings(content);
  } else {
    await loadGWStandings(gw, content);
  }
}

function switchStandings(mode) {
  standingsMode = mode;
  loadStandings(viewGW);
}

async function loadGWStandings(gw, content) {

  content.innerHTML = '<div class="loading-spinner">Loading standings...</div>';

  // Get all picks for this GW
  const { data: allPicks } = await sb.from('picks').select('*').eq('gw', gw);
  if (!allPicks || !allPicks.length) {
    content.innerHTML = buildStandingsToggle() + '<div class="empty-state"><span class="emoji">&#x1F3C6;</span><h3>No standings yet</h3><p>Standings appear after picks are submitted</p></div>';
    return;
  }

  // Get results for GW fixtures
  const { data: gwFixtures } = await sb.from('fixtures').select('*').eq('gw', gw);
  const fIds = (gwFixtures || []).map(f => f.id);
  const { data: gwResults } = await sb.from('results').select('*').in('fixture_id', fIds);

  // Build results lookup
  const resMap = {};
  (gwResults || []).forEach(r => {
    if (!resMap[r.fixture_id]) resMap[r.fixture_id] = {};
    resMap[r.fixture_id][r.element_id] = r;
  });

  // Calculate scores per user
  const userScores = {};
  allPicks.forEach(pick => {
    if (!userScores[pick.user_id]) userScores[pick.user_id] = { goats: 0, bps: 0, picks: [] };
    const r = resMap[pick.fixture_id] && resMap[pick.fixture_id][pick.element_id];
    const bps = r ? r.bps : 0;
    const isGoat = r ? r.is_goat : false;
    // Calculate rank from sorted results for this fixture
    let pickRank = 0;
    if (resMap[pick.fixture_id]) {
      const fResults = Object.values(resMap[pick.fixture_id]).sort((a, b) => b.bps - a.bps);
      const rIdx = fResults.findIndex(x => x.element_id === pick.element_id);
      if (rIdx >= 0) pickRank = rIdx + 1;
    }
    userScores[pick.user_id].bps += bps;
    if (isGoat) userScores[pick.user_id].goats++;
    userScores[pick.user_id].picks.push({ fixture_id: pick.fixture_id, element_id: pick.element_id, bps, isGoat, rank: pickRank });
  });

  // Get profiles
  const userIds = Object.keys(userScores);
  const { data: profiles } = await sb.from('profiles').select('*').in('id', userIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  // Sort: GOATs desc, BPS desc
  const sorted = userIds.map(uid => ({
    uid,
    name: profileMap[uid] ? profileMap[uid].team_name : 'Unknown',
    goats: userScores[uid].goats,
    bps: userScores[uid].bps,
    picks: userScores[uid].picks,
    _profile: profileMap[uid]
  })).sort((a, b) => b.goats - a.goats || b.bps - a.bps);

  // Find my position
  const myIdx = sorted.findIndex(s => s.uid === (currentUser ? currentUser.id : null));
  const myRank = myIdx >= 0 ? myIdx + 1 : '\u2013';
  const myEntry = myIdx >= 0 ? sorted[myIdx] : null;

  // Build HTML
  let html = buildStandingsToggle();
  html += '<div class="lb-header">';
  html += '<div style="font-size:14px;font-weight:900;color:#fff">LEADERBOARD \u2014 GW' + gw + '</div>';
  html += '<div style="font-size:11px;color:#777;margin-top:4px">Ranked by: GOATs \u00B7 tiebreak: Total BPS &nbsp;\u00B7&nbsp; <span style="color:#BFB294;font-weight:700">' + sorted.length + ' managers</span></div>';
  html += '</div>';

  if (myEntry) {
    html += '<div class="lb-your-pos"><div>';
    html += '<div style="font-size:11px;color:#777;margin-bottom:2px">YOUR POSITION</div>';
    html += '<div class="lb-your-rank">#' + myRank + '</div>';
    html += '</div><div class="lb-your-info">' + esc(myEntry.name) + '<br><span>' + myEntry.goats + ' GOATs</span> \u00B7 <span>' + myEntry.bps.toLocaleString() + ' BPS</span></div></div>';
  }

  html += '<table class="lb-table"><thead><tr><th>#</th><th>Player</th><th style="text-align:center">GOATs</th><th style="text-align:right">BPS</th></tr></thead><tbody>';

  // Show top 20 + separator + my row
  const showCount = Math.min(20, sorted.length);
  for (let i = 0; i < showCount; i++) {
    const s = sorted[i];
    const rank = i + 1;
    const isMe = s.uid === (currentUser ? currentUser.id : null);
    const rankCls = rank <= 3 ? ' top3' : '';
    const nameCls = isMe ? ' me' : '';
    const rowCls = isMe ? ' class="my-row"' : '';
    html += '<tr' + rowCls + '><td class="lb-rank' + rankCls + '">' + rank + '</td><td class="lb-name' + nameCls + '"><span class="lb-name-btn" onclick="togglePicks(\'' + i + '\')">' + esc(s.name) + botLabel(s._profile) + '</span></td><td class="lb-motms">' + s.goats + '</td><td class="lb-pts">' + s.bps.toLocaleString() + '</td></tr>';
    html += buildPicksRow(i, s.picks, gwFixtures || []);
  }

  if (myIdx >= 20) {
    const gap = myIdx - showCount;
    html += '<tr class="separator"><td colspan="4">\u00B7 \u00B7 \u00B7 ' + gap + ' entries \u00B7 \u00B7 \u00B7</td></tr>';
    html += '<tr class="my-row"><td class="lb-rank">' + myRank + '</td><td class="lb-name me"><span class="lb-name-btn" onclick="togglePicks(\'me\')">' + esc(myEntry.name) + botLabel(myEntry._profile) + '</span></td><td class="lb-motms">' + myEntry.goats + '</td><td class="lb-pts">' + myEntry.bps.toLocaleString() + '</td></tr>';
    html += buildPicksRow('me', myEntry.picks, gwFixtures || []);
  }

  html += '</tbody></table>';
  content.innerHTML = html;
}

function buildStandingsToggle() {
  return '<div class="lb-toggle">'
    + '<button class="lb-toggle-btn' + (standingsMode === 'gw' ? ' active' : '') + '" onclick="switchStandings(\'gw\')">Gameweek</button>'
    + '<button class="lb-toggle-btn' + (standingsMode === 'season' ? ' active' : '') + '" onclick="switchStandings(\'season\')">Season</button>'
    + '</div>';
}

async function loadSeasonStandings(content) {
  content.innerHTML = '<div class="loading-spinner">Loading season standings...</div>';

  // Get ALL picks across all GWs
  const { data: allPicks } = await sb.from('picks').select('user_id,gw,fixture_id,element_id').gte('gw', FIRST_GW);
  if (!allPicks || !allPicks.length) {
    content.innerHTML = buildStandingsToggle() + '<div class="empty-state"><span class="emoji">&#x1F3C6;</span><h3>No season data yet</h3><p>Season standings appear after picks are submitted</p></div>';
    return;
  }

  // Get ALL results for all fixtures with picks
  const allFixtureIds = [...new Set(allPicks.map(p => p.fixture_id))];
  // Fetch in batches of 200 to avoid URL length limits
  let allResults = [];
  for (let i = 0; i < allFixtureIds.length; i += 200) {
    const batch = allFixtureIds.slice(i, i + 200);
    const { data } = await sb.from('results').select('fixture_id,element_id,bps,is_goat').in('fixture_id', batch);
    if (data) allResults = allResults.concat(data);
  }

  // Build results lookup
  const resMap = {};
  allResults.forEach(r => {
    if (!resMap[r.fixture_id]) resMap[r.fixture_id] = {};
    resMap[r.fixture_id][r.element_id] = r;
  });

  // Aggregate per user: total GOATs, total BPS, GWs played
  const userTotals = {};
  allPicks.forEach(pick => {
    if (!userTotals[pick.user_id]) userTotals[pick.user_id] = { goats: 0, bps: 0, gws: new Set() };
    const r = resMap[pick.fixture_id] && resMap[pick.fixture_id][pick.element_id];
    const bps = r ? r.bps : 0;
    const isGoat = r ? r.is_goat : false;
    userTotals[pick.user_id].bps += bps;
    if (isGoat) userTotals[pick.user_id].goats++;
    userTotals[pick.user_id].gws.add(pick.gw);
  });

  // Get profiles
  const userIds = Object.keys(userTotals);
  const { data: profiles } = await sb.from('profiles').select('*').in('id', userIds);
  const profileMap = {};
  (profiles || []).forEach(p => { profileMap[p.id] = p; });

  // Sort: GOATs desc, BPS desc
  const sorted = userIds.map(uid => ({
    uid,
    name: profileMap[uid] ? profileMap[uid].team_name : 'Unknown',
    goats: userTotals[uid].goats,
    bps: userTotals[uid].bps,
    gwCount: userTotals[uid].gws.size,
    _profile: profileMap[uid]
  })).sort((a, b) => b.goats - a.goats || b.bps - a.bps);

  // Find my position
  const myIdx = sorted.findIndex(s => s.uid === (currentUser ? currentUser.id : null));
  const myRank = myIdx >= 0 ? myIdx + 1 : '\u2013';
  const myEntry = myIdx >= 0 ? sorted[myIdx] : null;

  // Build HTML
  let html = buildStandingsToggle();
  html += '<div class="lb-header">';
  html += '<div style="font-size:14px;font-weight:900;color:#fff">SEASON STANDINGS</div>';
  html += '<div style="font-size:11px;color:#777;margin-top:4px">All gameweeks combined \u00B7 <span style="color:#BFB294;font-weight:700">' + sorted.length + ' managers</span></div>';
  html += '</div>';

  if (myEntry) {
    html += '<div class="lb-your-pos"><div>';
    html += '<div style="font-size:11px;color:#777;margin-bottom:2px">YOUR POSITION</div>';
    html += '<div class="lb-your-rank">#' + myRank + '</div>';
    html += '</div><div class="lb-your-info">' + esc(myEntry.name) + '<br><span>' + myEntry.goats + ' GOATs</span> \u00B7 <span>' + myEntry.bps.toLocaleString() + ' BPS</span> \u00B7 <span>' + myEntry.gwCount + ' GWs</span></div></div>';
  }

  html += '<table class="lb-table"><thead><tr><th>#</th><th>Player</th><th style="text-align:center">GOATs</th><th style="text-align:right">BPS</th></tr></thead><tbody>';

  const showCount = Math.min(20, sorted.length);
  for (let i = 0; i < showCount; i++) {
    const s = sorted[i];
    const rank = i + 1;
    const isMe = s.uid === (currentUser ? currentUser.id : null);
    const rankCls = rank <= 3 ? ' top3' : '';
    const nameCls = isMe ? ' me' : '';
    const rowCls = isMe ? ' class="my-row"' : '';
    html += '<tr' + rowCls + '><td class="lb-rank' + rankCls + '">' + rank + '</td><td class="lb-name' + nameCls + '">' + esc(s.name) + botLabel(s._profile) + '</td><td class="lb-motms">' + s.goats + '</td><td class="lb-pts">' + s.bps.toLocaleString() + '</td></tr>';
  }

  if (myIdx >= 20) {
    const gap = myIdx - showCount;
    html += '<tr class="separator"><td colspan="4">\u00B7 \u00B7 \u00B7 ' + gap + ' entries \u00B7 \u00B7 \u00B7</td></tr>';
    html += '<tr class="my-row"><td class="lb-rank">' + myRank + '</td><td class="lb-name me">' + esc(myEntry.name) + botLabel(myEntry._profile) + '</td><td class="lb-motms">' + myEntry.goats + '</td><td class="lb-pts">' + myEntry.bps.toLocaleString() + '</td></tr>';
  }

  html += '</tbody></table>';
  content.innerHTML = html;
}

function buildPicksRow(rowId, picks, gwFixtures) {
  const sortedPicks = [...picks].sort((a, b) => {
    const fa = gwFixtures.find(x => x.id === a.fixture_id);
    const fb = gwFixtures.find(x => x.id === b.fixture_id);
    if (!fa || !fb) return 0;
    return new Date(fa.kickoff_time) - new Date(fb.kickoff_time);
  });

  let cells = '';
  for (const p of sortedPicks) {
    const f = gwFixtures.find(x => x.id === p.fixture_id);
    const pl = players[p.element_id];
    if (!f || !pl) continue;

    let matchLabel = f.home_short + ' \u2013 ' + f.away_short;
    if (f.status === 'ft') matchLabel += ' ' + f.home_score + '-' + f.away_score;
    else if (f.status === 'live') matchLabel += ' ' + f.home_score + '-' + f.away_score;
    const started = f.status === 'ft' || f.status === 'live';

    let playerText, rankText, bpsText;
    if (started) {
      playerText = esc(pl.short_name || pl.name) + ' (' + (pl.team_short||'') + ')' + (p.isGoat ? ' \uD83D\uDC51' : '');
      rankText = p.rank > 0 ? '#' + p.rank : '\u2013';
      bpsText = p.bps > 0 ? '' + p.bps : '';
    } else {
      playerText = '\u2014';
      rankText = '';
      bpsText = '';
    }

    cells += '<span class="lbp-match">' + matchLabel + '</span>'
      + '<span class="lbp-player' + (started ? '' : ' hidden') + '">' + playerText + '</span>'
      + '<span class="lbp-rank">' + rankText + '</span>'
      + '<span class="lbp-bps">' + bpsText + '</span>';
  }

  return '<tr class="lb-picks-row" id="picks-' + rowId + '" style="display:none"><td colspan="4"><div class="lbp-grid">' + cells + '</div></td></tr>';
}

// ===== PROFILE =====
async function loadProfileData() {
  if (!currentUser) return;
  document.getElementById('profile-email').value = currentUser.email || '';
  const { data } = await sb.from('profiles').select('*').eq('id', currentUser.id).single();
  if (data) {
    document.getElementById('profile-team-name').value = data.team_name || '';
    // Telegram section
    const hasT = !!data.telegram_chat_id;
    document.getElementById('tg-linked').style.display = hasT ? '' : 'none';
    document.getElementById('tg-not-linked').style.display = hasT ? 'none' : '';
  }
}

async function disconnectTelegram() {
  if (!confirm('Disconnect Telegram? You won\'t receive notifications.')) return;
  const { error } = await sb.from('profiles').update({ telegram_chat_id: null }).eq('id', currentUser.id);
  if (!error) {
    document.getElementById('tg-linked').style.display = 'none';
    document.getElementById('tg-not-linked').style.display = '';
  }
}

async function saveProfile() {
  const name = document.getElementById('profile-team-name').value.trim();
  if (!name) return;
  const { error } = await sb.from('profiles').update({ team_name: name, updated_at: new Date().toISOString() }).eq('id', currentUser.id);
  const msg = document.getElementById('profile-msg');
  if (error) { msg.textContent = 'Error: ' + error.message; msg.style.color = '#ff4444'; }
  else { msg.textContent = 'Saved!'; msg.style.color = '#4CAF50'; }
  setTimeout(() => { msg.textContent = ''; }, 3000);
}

// ===== PLAYER PROFILE MODAL =====
function openProfileFromCard(cardEl) {
  openProfile(
    parseInt(cardEl.dataset.eid),
    parseInt(cardEl.dataset.code),
    cardEl.dataset.name,
    cardEl.dataset.team,
    cardEl.dataset.pos,
    cardEl.dataset.ph
  );
}

async function openProfile(elementId, code, name, team, pos, ph) {
  const overlay = document.getElementById('mb-profile-overlay');
  const content = document.getElementById('mb-profile-content');
  overlay.style.display = 'flex';
  content.innerHTML = buildProfileHeader(name, team, pos, ph) + '<div class="mb-loading">Loading match history...</div>';

  try {
    // Try Supabase player_history first (fast, has bps_rank), fallback to FPL API
    const localData = await sb.from('player_history').select('*').eq('element_id', elementId).order('round', { ascending: true });

    let history;
    if (localData.data && localData.data.length > 0) {
      history = localData.data.map(r => ({
        fixture: r.fixture_id, round: r.round, opponent_team: r.opponent_team,
        was_home: r.was_home, kickoff_time: r.kickoff_time, minutes: r.minutes,
        bps: r.bps, total_points: r.total_points, goals_scored: r.goals_scored,
        assists: r.assists, clean_sheets: r.clean_sheets,
        yellow_cards: r.yellow_cards, red_cards: r.red_cards,
        bps_rank: r.bps_rank
      }));
    } else {
      const resp = await fetch('/api/player-detail?id=' + elementId);
      const data = await resp.json();
      if (!data.history) throw new Error('No history data');
      history = data.history;
    }

    content.innerHTML = buildProfileHeader(name, team, pos, ph)
      + buildProfileStats(history)
      + buildProfileHistory(history);
  } catch(e) {
    console.error('Profile load error:', e);
    content.innerHTML = buildProfileHeader(name, team, pos, ph)
      + buildProfileStatsMock()
      + '<div class="mb-api-note">\u26A0 Player data temporarily unavailable. Try again later.</div>';
  }
}

function closeProfile() { document.getElementById('mb-profile-overlay').style.display = 'none'; }
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') { closeProfile(); closeAuthModal(); } });

function buildProfileHeader(name, team, pos, ph) {
  var col = POS_COLORS[pos] || '#BFB294';
  return '<div class="mb-profile-header">'
    + '<div class="mb-profile-hex-outer"><div class="mb-profile-hex-inner">'
    + (ph ? '<img src="' + ph + '" onerror="this.src=PLACEHOLDER_IMG;this.onerror=null" alt="">' : '')
    + '</div></div>'
    + '<div style="flex:1">'
    + '<div class="mb-profile-name">' + esc(name) + '</div>'
    + '<div class="mb-profile-detail">'
    + '<span class="mb-pos-badge" style="background:' + col + '">' + pos + '</span>'
    + '<span>' + esc(team) + '</span>'
    + '</div></div></div>';
}

function buildProfileStats(history) {
  if (!history || !history.length) return buildProfileStatsMock();
  var played = history.filter(h => h.minutes > 0);
  // If bps_rank is missing, calculate it from BPS per fixture
  var byFixture = {};
  played.forEach(h => { if (!byFixture[h.fixture_id]) byFixture[h.fixture_id] = []; byFixture[h.fixture_id].push(h); });
  Object.values(byFixture).forEach(rows => { rows.sort((a,b) => b.bps - a.bps); rows.forEach((r,i) => { if (!r.bps_rank) r.bps_rank = i + 1; }); });
  var ranked = played.filter(h => h.bps_rank);
  var goatCount = ranked.filter(h => h.bps_rank === 1).length;
  var avgRank = ranked.length > 0 ? (ranked.reduce((s, h) => s + h.bps_rank, 0) / ranked.length).toFixed(1) : '-';
  // Form: avg BPS over last 6 GWs (missed GWs = 0)
  var mr = statsMaxRound || Math.max.apply(null, history.map(function(h) { return h.round; }));
  var formStart = Math.max(1, mr - 5);
  var byRound = {};
  history.forEach(function(h) { byRound[h.round] = h; });
  var formBpsSum = 0;
  for (var gw = formStart; gw <= mr; gw++) {
    var h = byRound[gw];
    if (h && h.minutes > 0) formBpsSum += (h.bps || 0);
  }
  var formBps = (formBpsSum / 6).toFixed(1);
  var totalBps = played.reduce((s, h) => s + (h.bps || 0), 0);
  return '<div class="mb-profile-stats">'
    + '<div class="mb-stat-block"><div class="mb-stat-val">' + goatCount + ' \uD83D\uDC51</div><div class="mb-stat-label">GOATs</div></div>'
    + '<div class="mb-stat-block"><div class="mb-stat-val">' + avgRank + '</div><div class="mb-stat-label">Avg Rank</div></div>'
    + '<div class="mb-stat-block"><div class="mb-stat-val">' + formBps + '</div><div class="mb-stat-label">Form (L6)</div></div>'
    + '<div class="mb-stat-block"><div class="mb-stat-val">' + totalBps + '</div><div class="mb-stat-label">BPS Total</div></div>'
    + '</div>';
}

function buildProfileStatsMock() {
  return '<div class="mb-profile-stats">'
    + '<div class="mb-stat-block"><div class="mb-stat-val">\u2014</div><div class="mb-stat-label">BPS Total</div></div>'
    + '<div class="mb-stat-block"><div class="mb-stat-val">\u2014</div><div class="mb-stat-label">Form</div></div>'
    + '<div class="mb-stat-block"><div class="mb-stat-val">\u2014</div><div class="mb-stat-label">Games</div></div>'
    + '</div>';
}

function buildProfileHistory(history) {
  if (!history || !history.length) {
    return '<div class="mb-history-title">Season History</div><p style="padding:20px;color:#555;text-align:center;font-size:12px">No match history available</p>';
  }
  // Ensure bps_rank exists (fallback calc for old data)
  var byFix = {};
  history.forEach(function(h) { if (h.minutes > 0) { if (!byFix[h.fixture_id]) byFix[h.fixture_id] = []; byFix[h.fixture_id].push(h); } });
  Object.values(byFix).forEach(function(rows) { rows.sort(function(a,b) { return b.bps - a.bps; }); rows.forEach(function(r,i) { if (!r.bps_rank) r.bps_rank = i + 1; }); });
  // Build lookup by round
  var byRound = {};
  history.forEach(function(h) { byRound[h.round] = h; });
  // Use global max round so all GWs are shown even if player missed recent ones
  var maxRound = statsMaxRound || Math.max.apply(null, history.map(function(h) { return h.round; }));
  var rows = '';
  // Show all GWs from most recent to GW1
  for (var gw = maxRound; gw >= 1; gw--) {
    var h = byRound[gw];
    if (h && h.minutes > 0) {
      var opp = FPL_TEAM_MAP[h.opponent_team] || '?';
      var ha = h.was_home ? '(H)' : '(A)';
      var bps = h.bps || 0;
      var rank = h.bps_rank;
      var rankHtml = '';
      if (rank === 1) rankHtml = ' <span style="color:#BFB294">\uD83D\uDC51</span>';
      else if (rank && rank <= 3) rankHtml = ' <span style="color:#8a8060;font-size:10px">(' + rank + ')</span>';
      else if (rank) rankHtml = ' <span style="color:#555;font-size:10px">(' + rank + ')</span>';
      var rowCls = rank === 1 ? ' class="goat-row"' : '';
      rows += '<tr' + rowCls + '><td>GW' + gw + '</td><td>' + opp + ' ' + ha + '</td><td>' + h.minutes + "'" + '</td><td class="td-bps">' + bps + rankHtml + '</td></tr>';
    } else {
      rows += '<tr style="opacity:0.35"><td>GW' + gw + '</td><td>\u2014</td><td>\u2014</td><td class="td-bps">\u2014</td></tr>';
    }
  }
  return '<div class="mb-history-title">Season History</div>'
    + '<div class="mb-history-wrap"><table class="mb-history-table">'
    + '<thead><tr><th>GW</th><th>Opp</th><th>Min</th><th>BPS / Rank</th></tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

// ===== NAVIGATION HELPERS =====
function goToMatch(fixtureId) {
  if (isViewGWPickLocked()) return;
  switchTab('pick');
  setTimeout(function() {
    var el = document.getElementById('match-' + fixtureId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ===== UI HELPERS =====
function switchTab(name) {
  // Close My Team change panel on tab switch
  if (changingFixtureId) mtClosePanel();
  // Prevent switching to locked pick tab
  if (name === 'pick' && isViewGWPickLocked()) return;

  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tab-btn-' + name).classList.add('active');

  // Show/hide team strip — only show on pick tab for active GW
  var strip = document.getElementById('team-strip');
  if (strip) strip.style.display = (name === 'pick' && viewGW >= activeGW) ? '' : 'none';

  closeMenu();

  // Refresh data when switching tabs
  if (name === 'pick') { loadFixtures().then(() => { renderPickTab(); }); }
  if (name === 'live') renderLiveTab();
  if (name === 'myteam') { Promise.all([loadFixtures(), loadResults()]).then(() => renderMyTeam()); }
  if (name === 'standings') { loadStandings(viewGW); }
}

function togglePicks(rowId) {
  var row = document.getElementById('picks-' + rowId);
  if (!row) return;
  var isOpen = row.style.display !== 'none';
  document.querySelectorAll('.lb-picks-row').forEach(r => { r.style.display = 'none'; });
  if (!isOpen) row.style.display = '';
}

function toggleMenu() {
  document.getElementById('nav-dropdown').classList.toggle('open');
}

function closeMenu() {
  document.getElementById('nav-dropdown').classList.remove('open');
}

async function shareApp() {
  closeMenu();
  const shareData = {
    title: 'GOAT — Pick the Greatest',
    text: 'Pick the best player for every Premier League match. No budget, no transfers — just pure prediction skill.',
    url: 'https://goatapp.club'
  };
  if (navigator.share) {
    try { await navigator.share(shareData); } catch(e) {}
  } else {
    try {
      await navigator.clipboard.writeText('Join me on GOAT — pick the best player for every Premier League match!\nhttps://goatapp.club');
      showToast('Link copied!');
    } catch(e) {
      showToast('Share: goatapp.club');
    }
  }
}

// Close menu on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.nav-right')) closeMenu();
});

function openPage(name) {
  document.getElementById('page-' + name).classList.add('open');
  closeMenu();
  if (name === 'admin') adminLoadBots();
}

// ===== BOT ADMIN =====
async function adminApiCall(action, body) {
  const session = await sb.auth.getSession();
  const token = session.data.session ? session.data.session.access_token : null;
  if (!token) { showToast('Not authenticated'); return null; }
  const resp = await fetch('/api/bot-admin?action=' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  return resp.json();
}

async function adminLoadBots() {
  const list = document.getElementById('admin-bot-list');
  list.innerHTML = '<div class="loading-spinner">Loading bots...</div>';
  const res = await adminApiCall('list');
  if (!res || !res.bots) { list.innerHTML = '<div class="bot-empty">Failed to load bots</div>'; return; }
  const bots = res.bots;
  document.getElementById('admin-bot-count').textContent = '(' + bots.filter(b => b.bot_active).length + ' active / ' + bots.length + ' total)';
  if (!bots.length) { list.innerHTML = '<div class="bot-empty">No bots yet. Add one above.</div>'; return; }
  const stratLabels = {form:'Form',goat:'GOAT',rank:'Rank',home:'Home',away:'Away',streak:'Streak',ironman:'Iron Man',contrarian:'Contrarian',combo:'Balanced',fwd_only:'FWD Only',mid_only:'MID Only',def_only:'DEF Only',chaos:'Chaos'};
  list.innerHTML = bots.map(b =>
    '<div class="bot-card' + (b.bot_active ? '' : ' paused') + '">'
    + '<div class="bot-info">'
    + '<div class="bot-name">' + esc(b.team_name) + '</div>'
    + '<div class="bot-meta">'
    + '<span class="bot-strategy">' + (stratLabels[b.bot_strategy] || b.bot_strategy) + '</span>'
    + '<span>' + b.hours_before + 'h before</span>'
    + '<span>' + (b.gws_played || 0) + ' GWs played</span>'
    + '</div></div>'
    + '<div class="bot-actions">'
    + '<button class="bot-btn" onclick="adminToggleBot(\'' + b.id + '\')">' + (b.bot_active ? 'Pause' : 'Resume') + '</button>'
    + '<button class="bot-btn del" onclick="adminDeleteBot(\'' + b.id + '\',\'' + esc(b.team_name) + '\')">Delete</button>'
    + '</div></div>'
  ).join('');
}

async function adminCreateBot() {
  const nameEl = document.getElementById('admin-bot-name');
  const stratEl = document.getElementById('admin-bot-strategy');
  const msgEl = document.getElementById('admin-add-msg');
  const name = nameEl.value.trim();
  const strategy = stratEl.value;
  if (!name) { msgEl.className = 'admin-msg err'; msgEl.textContent = 'Enter a team name'; return; }
  if (!strategy) { msgEl.className = 'admin-msg err'; msgEl.textContent = 'Select a strategy'; return; }
  msgEl.className = 'admin-msg'; msgEl.textContent = 'Creating...';
  const res = await adminApiCall('create', { name, strategy });
  if (res && res.ok) {
    msgEl.className = 'admin-msg ok'; msgEl.textContent = 'Created! Picks in ' + res.bot.hours_before + 'h before deadline.';
    nameEl.value = ''; stratEl.value = '';
    adminLoadBots();
    setTimeout(() => { msgEl.textContent = ''; }, 4000);
  } else {
    msgEl.className = 'admin-msg err'; msgEl.textContent = 'Error: ' + (res ? res.error : 'unknown');
  }
}

async function adminToggleBot(id) {
  const res = await adminApiCall('toggle', { id });
  if (res && res.ok) adminLoadBots();
  else showToast('Error toggling bot');
}

async function adminDeleteBot(id, name) {
  if (!confirm('Delete bot "' + name + '"? Historical picks will be preserved in standings.')) return;
  const res = await adminApiCall('delete', { id });
  if (res && res.ok) adminLoadBots();
  else showToast('Error deleting bot');
}

function closePage(name) {
  document.getElementById('page-' + name).classList.remove('open');
}

function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ===== HASH ROUTING (browser back/forward) =====
window.addEventListener('hashchange', function() {
  if (!activeGW) return;
  const hashGW = parseGWFromHash();
  if (hashGW && hashGW >= FIRST_GW && hashGW <= (maxGW || activeGW) && hashGW !== viewGW) {
    loadGWData(hashGW);
  }
});

// ===== AUTO-REFRESH (every 60s when on Live tab, only for active GW) =====
setInterval(function() {
  var liveTab = document.getElementById('tab-live');
  if (liveTab && liveTab.classList.contains('active') && viewGW === activeGW) {
    renderLiveTab();
  }
}, 60000);

// ===== INIT =====
// Handle email input enter key
document.getElementById('auth-email').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') handleAuth();
});

initAuth();
