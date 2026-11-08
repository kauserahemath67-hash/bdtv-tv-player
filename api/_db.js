// =========================================================
// BDTv Persistent Cloud Database Module - v3 FIXED
// GitHub as source of truth. Every read checks TTL cache,
// every write commits to GitHub AND invalidates cache.
// Serverless-safe: no module-level async state assumptions.
// =========================================================

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
if (!process.env.GITHUB_TOKEN) {
  console.warn('[_db.js] WARNING: GITHUB_TOKEN not set in environment. Set it in Vercel dashboard.');
}
const GITHUB_REPO  = 'kauserahemath67-hash/bdtv-tv-player';
const GITHUB_BRANCH = 'data-storage';
const GITHUB_CHANNELS_PATH  = 'data/channels.json';
const GITHUB_SETTINGS_PATH  = 'data/settings.json';
const GITHUB_PLAYLISTS_PATH = 'data/playlists.json';
const GITHUB_VERSION_PATH   = 'data/version.json';
const GITHUB_CUSTOMERS_PATH = 'data/customers.json';
const GITHUB_DEVICES_PATH   = 'data/devices.json';

const CACHE_TTL_MS = 20000; // 20-second in-process cache (warm requests)

// ── Default data ──────────────────────────────────────────
const defaultChannels = [
  { id: 'ch-1', name: 'Somoy TV',           category: 'News',            logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Somoy_TV_logo.svg/300px-Somoy_TV_logo.svg.png',          url: 'https://stream.somoynews.tv/live/somoy/playlist.m3u8',               is_pinned: true,  order: 1, status: 'ONLINE', response_time_ms: 120, manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null },
  { id: 'ch-2', name: 'Jamuna TV',           category: 'News',            logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/07/Jamuna_TV_logo.png/300px-Jamuna_TV_logo.png',           url: 'https://stream.jamuna.tv/live/jamuna/playlist.m3u8',                 is_pinned: true,  order: 2, status: 'ONLINE', response_time_ms: 140, manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null },
  { id: 'ch-3', name: 'T Sports',            category: 'Sports',          logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/9/91/T_Sports_logo.svg/300px-T_Sports_logo.svg.png',         url: 'https://tsports.live/stream/playlist.m3u8',                          is_pinned: true,  order: 3, status: 'ONLINE', response_time_ms: 110, manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null },
  { id: 'ch-4', name: 'Channel i',           category: 'Entertainment',   logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Channel_i_logo.svg/300px-Channel_i_logo.svg.png',       url: 'https://stream.channeli.tv/live/playlist.m3u8',                      is_pinned: false, order: 4, status: 'ONLINE', response_time_ms: 160, manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null },
  { id: 'ch-5', name: 'Al Jazeera English',  category: 'International',   logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Al_Jazeera_English_logo.svg/300px-Al_Jazeera_English_logo.svg.png', url: 'https://live-hls-web-aje.getaj.net/AJE/03.m3u8',           is_pinned: false, order: 5, status: 'ONLINE', response_time_ms: 95,  manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null },
  { id: 'ch-6', name: 'NHK World Japan',     category: 'International',   logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/NHK_World-Japan_logo.svg/300px-NHK_World-Japan_logo.svg.png', url: 'https://b-nhkworld.akamaized.net/hls/live/2014412/nhkworld/playlist_720.m3u8', is_pinned: false, order: 6, status: 'ONLINE', response_time_ms: 85, manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null },
  { id: 'ch-7', name: 'Bangladesh Betar',    category: 'Music & Radio',   logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/1/15/Bangladesh_Betar_Logo.svg/300px-Bangladesh_Betar_Logo.svg.png',   url: 'https://betarlive.teletalk.com.bd/live/betar.m3u8',                  is_pinned: false, order: 7, status: 'ONLINE', response_time_ms: 105, manual_override: false, use_proxy: false, proxy_referer: null, proxy_user_agent: null }
];

const defaultSettings = {
  site_title: 'BDTv Live - Premium IPTV Web Player',
  admin_email: 'kauserahemath67@gmail.com',
  admin_password: 'BDTv@Admin2026!',
  admin_pin: 'BDTv2026',
  notice_text: 'স্বাগতম BDTv লাইভ প্লেয়ারে! যেকোনো টিভি চ্যানেল সহজে উপভোগ করুন।',
  notice_active: true,
  subscription_restrictions_enabled: false,
  default_max_devices: 2,
  expiry_warning_days: 3,
  ads: { top: { active: false, code: '' }, below_player: { active: false, code: '' }, infeed: { active: false, code: '' }, footer: { active: false, code: '' } }
};

// ── In-process TTL cache (warm requests within same instance) ──
let _channelCache   = { data: null, loadedAt: 0 };
let _settingsCache  = { data: null, loadedAt: 0 };
let _playlistsCache = { data: null, loadedAt: 0 };
let _versionCache   = { data: null, loadedAt: 0 };
let _customersCache = { data: null, loadedAt: 0 };
let _devicesCache   = { data: null, loadedAt: 0 };

function isCacheValid(cacheObj) {
  return cacheObj.data !== null && (Date.now() - cacheObj.loadedAt) < CACHE_TTL_MS;
}
function invalidateChannelCache()   { _channelCache.loadedAt   = 0; }
function invalidateSettingsCache()  { _settingsCache.loadedAt  = 0; }
function invalidatePlaylistsCache() { _playlistsCache.loadedAt = 0; }
function invalidateVersionCache()   { _versionCache.loadedAt   = 0; }
function invalidateCustomersCache() { _customersCache.loadedAt = 0; }
function invalidateDevicesCache()   { _devicesCache.loadedAt   = 0; }

// ── GitHub low-level helpers ──────────────────────────────
function githubRequest(method, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${path}`,
      method,
      headers: {
        'User-Agent':    'BDTv-DB/3.0',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept':        'application/vnd.github.v3+json',
        'Content-Type':  'application/json',
      }
    };
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', d => { raw += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Fetch a JSON file from GitHub.
 * Returns { data, sha } or null on failure.
 */
async function ghFetch(filePath) {
  try {
    const res = await githubRequest('GET', `${filePath}?ref=${GITHUB_BRANCH}`);
    if (res.status !== 200 || !res.body || !res.body.content) return null;
    const decoded = Buffer.from(res.body.content, 'base64').toString('utf8');
    const data = JSON.parse(decoded);
    return { data, sha: res.body.sha };
  } catch (e) {
    console.error('[BDTv DB] ghFetch error:', e.message);
    return null;
  }
}

/**
 * Commit a JSON file to GitHub (create or update).
 * Always fetches current SHA first to avoid conflicts.
 * Targets the data-storage branch to prevent Vercel build loops!
 * Returns true on success.
 */
async function ghCommit(filePath, dataObj, message) {
  try {
    // Fetch current SHA (required for updates)
    const current = await ghFetch(filePath);
    const sha = current ? current.sha : undefined;

    const contentBase64 = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64');
    const body = { message, content: contentBase64, branch: GITHUB_BRANCH };
    if (sha) body.sha = sha;

    const res = await githubRequest('PUT', filePath, body);
    const ok = res.status === 200 || res.status === 201;
    if (!ok) console.error('[BDTv DB] ghCommit failed, status:', res.status);
    return ok;
  } catch (e) {
    console.error('[BDTv DB] ghCommit error:', e.message);
    return false;
  }
}

// ── Public async API ──────────────────────────────────────

/**
 * Get all channels. Always reads from GitHub on cache miss.
 */
async function getChannels() {
  if (isCacheValid(_channelCache)) {
    return [..._channelCache.data].sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  const result = await ghFetch(GITHUB_CHANNELS_PATH);
  if (result && Array.isArray(result.data) && result.data.length > 0) {
    _channelCache.data    = result.data;
    _channelCache.loadedAt = Date.now();
  } else {
    // Try local file fallback if available on disk (useful for local dev/testing)
    try {
      const fs = require('fs');
      const path = require('path');
      const localPath = path.join(__dirname, '..', GITHUB_CHANNELS_PATH);
      if (fs.existsSync(localPath)) {
        const localData = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        if (Array.isArray(localData) && localData.length > 0) {
          _channelCache.data = localData;
          _channelCache.loadedAt = Date.now();
          return [..._channelCache.data].sort((a, b) => (a.order || 0) - (b.order || 0));
        }
      }
    } catch (e) {}

    // GitHub file missing or empty — use defaults but don't cache
    return [...defaultChannels];
  }

  return [..._channelCache.data].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Save (create or update) a channel. Persists to GitHub.
 */
async function saveChannel(channel) {
  // 1. Load current state from GitHub (bypass cache for writes)
  invalidateChannelCache();
  const current = await getChannels();

  // 2. Mutate
  if (!channel.id) channel.id = 'ch-' + Date.now();
  const idx = current.findIndex(c => c.id === channel.id);
  if (idx >= 0) {
    const existingOrder = current[idx].order;
    current[idx] = {
      ...current[idx],
      ...channel,
      use_proxy: channel.use_proxy !== undefined ? Boolean(channel.use_proxy) : Boolean(current[idx].use_proxy),
      proxy_referer: channel.proxy_referer !== undefined ? (channel.proxy_referer ? String(channel.proxy_referer).trim() : null) : (current[idx].proxy_referer || null),
      proxy_user_agent: channel.proxy_user_agent !== undefined ? (channel.proxy_user_agent ? String(channel.proxy_user_agent).trim() : null) : (current[idx].proxy_user_agent || null)
    };
    if (channel.order === undefined && existingOrder !== undefined) {
      current[idx].order = existingOrder;
    }
  } else {
    channel.order  = channel.order  || current.length + 1;
    channel.status = channel.status || 'ONLINE';
    channel.use_proxy = Boolean(channel.use_proxy);
    channel.proxy_referer = channel.proxy_referer ? String(channel.proxy_referer).trim() : null;
    channel.proxy_user_agent = channel.proxy_user_agent ? String(channel.proxy_user_agent).trim() : null;
    current.push(channel);
  }

  // 3. Persist
  const ok = await ghCommit(GITHUB_CHANNELS_PATH, current, `Save channel: ${channel.name}`);
  if (ok) {
    _channelCache.data    = current;
    _channelCache.loadedAt = Date.now();
  } else {
    // If running locally without GITHUB_TOKEN, also save to local file
    try {
      const fs = require('fs');
      const path = require('path');
      const localPath = path.join(__dirname, '..', GITHUB_CHANNELS_PATH);
      fs.writeFileSync(localPath, JSON.stringify(current, null, 2), 'utf8');
      _channelCache.data = current;
      _channelCache.loadedAt = Date.now();
    } catch (e) {}
    invalidateChannelCache(); // force re-read next time
  }

  return idx >= 0 ? current[idx] : channel;
}

/**
 * Delete a channel by ID. Persists to GitHub.
 */
async function deleteChannel(id) {
  // 1. Load fresh from GitHub
  invalidateChannelCache();
  const current = await getChannels();

  // 2. Mutate
  const idx = current.findIndex(c => c.id === id);
  if (idx < 0) return false;
  current.splice(idx, 1);

  // 3. Persist
  const ok = await ghCommit(GITHUB_CHANNELS_PATH, current, `Delete channel: ${id}`);
  if (ok) {
    _channelCache.data    = current;
    _channelCache.loadedAt = Date.now();
  } else {
    invalidateChannelCache();
  }

  return true;
}

/**
 * Bulk import channels (replaces entire list). Persists to GitHub.
 * Automatically deduplicates channels by normalized name or URL.
 */
async function importChannels(newChannels) {
  if (Array.isArray(newChannels)) {
    const seenNames = new Set();
    const seenUrls = new Set();
    const unique = [];
    newChannels.forEach(c => {
      const normName = (c.name || '').trim().toLowerCase();
      const normUrl = (c.url || '').trim().toLowerCase();
      if (normName && !seenNames.has(normName) && (!normUrl || !seenUrls.has(normUrl))) {
        seenNames.add(normName);
        if (normUrl) seenUrls.add(normUrl);
        unique.push(c);
      }
    });
    newChannels = unique;
    newChannels.forEach((c, idx) => { c.order = idx + 1; });
  }

  const ok = await ghCommit(GITHUB_CHANNELS_PATH, newChannels, `Bulk import: ${newChannels.length} channels`);
  if (ok) {
    _channelCache.data    = newChannels;
    _channelCache.loadedAt = Date.now();
  } else {
    invalidateChannelCache();
  }
  return ok;
}

/**
 * Reorder channels by providing an ordered list of IDs.
 */
async function reorderChannels(orderedIds) {
  invalidateChannelCache();
  const current = await getChannels();
  if (Array.isArray(orderedIds)) {
    orderedIds.forEach((item, i) => {
      const targetId = (item && typeof item === 'object') ? item.id : item;
      const ch = current.find(c => c.id === targetId);
      if (ch) ch.order = i + 1;
    });
  }
  const sorted = current.sort((a, b) => (a.order || 0) - (b.order || 0));
  await ghCommit(GITHUB_CHANNELS_PATH, sorted, 'Reorder channels');
  _channelCache.data    = sorted;
  _channelCache.loadedAt = Date.now();
  return sorted;
}

/**
 * Update health/status of a single channel.
 */
async function updateChannelHealth(id, status, responseTimeMs) {
  invalidateChannelCache();
  const current = await getChannels();
  const ch = current.find(c => c.id === id);
  if (ch) {
    ch.status = status;
    if (responseTimeMs !== undefined) ch.response_time_ms = responseTimeMs;
    await ghCommit(GITHUB_CHANNELS_PATH, current, `Update health: ${ch.name} -> ${status}`);
    _channelCache.data = current;
    _channelCache.loadedAt = Date.now();
    return ch;
  }
  return null;
}

/**
 * Batch update channels (status, response_time_ms, manual_override) in one single GitHub commit.
 */
async function batchUpdateChannels(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return [];
  invalidateChannelCache();
  const current = await getChannels();
  let changedCount = 0;

  for (const item of updates) {
    if (!item.id) continue;
    const ch = current.find(c => c.id === item.id);
    if (ch) {
      if (item.status && ch.status !== item.status) {
        ch.status = item.status;
        changedCount++;
      }
      if (item.response_time_ms !== undefined) ch.response_time_ms = item.response_time_ms;
      if (item.manual_override !== undefined) ch.manual_override = Boolean(item.manual_override);
    }
  }

  if (changedCount > 0 || updates.length > 0) {
    await ghCommit(GITHUB_CHANNELS_PATH, current, `Batch update channels status (${updates.length} items)`);
    _channelCache.data = current;
    _channelCache.loadedAt = Date.now();
  }
  return current;
}

// ── Settings ──────────────────────────────────────────────
async function getSettings() {
  if (isCacheValid(_settingsCache)) return { ..._settingsCache.data };

  const result = await ghFetch(GITHUB_SETTINGS_PATH);
  if (result && result.data && typeof result.data === 'object') {
    _settingsCache.data    = { ...defaultSettings, ...result.data };
    _settingsCache.loadedAt = Date.now();
  } else {
    return { ...defaultSettings };
  }
  return { ..._settingsCache.data };
}

async function updateSettings(newSettings) {
  invalidateSettingsCache();
  const current = await getSettings();
  const merged  = { ...current, ...newSettings };
  const ok = await ghCommit(GITHUB_SETTINGS_PATH, merged, 'Update settings');
  if (ok) {
    _settingsCache.data    = merged;
    _settingsCache.loadedAt = Date.now();
  }
  return merged;
}

// ── Saved Playlists (GitHub-backed) ──────────────────────

/**
 * Get all saved playlists.
 */
async function getPlaylists() {
  if (isCacheValid(_playlistsCache)) return [..._playlistsCache.data];
  const result = await ghFetch(GITHUB_PLAYLISTS_PATH);
  if (result && Array.isArray(result.data)) {
    _playlistsCache.data    = result.data;
    _playlistsCache.loadedAt = Date.now();
  } else {
    return [];
  }
  return [..._playlistsCache.data];
}

/**
 * Save a playlist record (after import).
 */
async function savePlaylist(playlist) {
  invalidatePlaylistsCache();
  const current = await getPlaylists();
  if (!playlist.id) playlist.id = 'pl-' + Date.now();
  playlist.savedAt = new Date().toISOString();
  // Update if same ID or same URL already exists
  const idx = current.findIndex(p => (playlist.id && p.id === playlist.id) || (p.url && playlist.url && p.url === playlist.url));
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...playlist, id: current[idx].id };
  } else {
    current.unshift(playlist); // newest first
  }
  const ok = await ghCommit(GITHUB_PLAYLISTS_PATH, current, `Save playlist: ${playlist.name}`);
  if (ok) {
    _playlistsCache.data    = current;
    _playlistsCache.loadedAt = Date.now();
  } else {
    invalidatePlaylistsCache();
  }
  return playlist;
}

/**
 * Delete a saved playlist by ID.
 */
async function deletePlaylist(id) {
  invalidatePlaylistsCache();
  const current = await getPlaylists();
  const idx = current.findIndex(p => p.id === id);
  if (idx < 0) return false;
  current.splice(idx, 1);
  const ok = await ghCommit(GITHUB_PLAYLISTS_PATH, current, `Delete playlist: ${id}`);
  if (ok) {
    _playlistsCache.data    = current;
    _playlistsCache.loadedAt = Date.now();
  } else {
    invalidatePlaylistsCache();
  }
  return true;
}

// ── Customers & Subscription Management (GitHub-backed) ──
const defaultCustomers = [
  {
    id: 'cust-101',
    customer_code: 'BDTV-VIP-101',
    name: 'VIP Subscriber',
    login_pin: '1234',
    account_status: 'ACTIVE',
    manual_block: false,
    block_reason: '',
    max_devices: 2,
    channels_enabled: true,
    plan: 'Monthly VIP',
    starts_at: '2026-01-01',
    expires_at: '2030-12-31',
    payment_status: 'PAID',
    transaction_reference: 'DIRECT-ACTIVATION'
  }
];

async function getCustomers() {
  if (isCacheValid(_customersCache)) return [..._customersCache.data];

  const result = await ghFetch(GITHUB_CUSTOMERS_PATH);
  if (result && Array.isArray(result.data)) {
    _customersCache.data = result.data;
    _customersCache.loadedAt = Date.now();
  } else {
    _customersCache.data = [...defaultCustomers];
    _customersCache.loadedAt = Date.now();
  }
  return [..._customersCache.data];
}

async function saveCustomer(c) {
  invalidateCustomersCache();
  const current = await getCustomers();
  if (!c.id) c.id = 'cust-' + Date.now();
  const i = current.findIndex(x => x.id === c.id || (c.customer_code && x.customer_code.toLowerCase() === c.customer_code.toLowerCase()));
  if (i >= 0) {
    current[i] = { ...current[i], ...c, updatedAt: new Date().toISOString() };
  } else {
    current.unshift({ ...c, createdAt: new Date().toISOString() });
  }

  const ok = await ghCommit(GITHUB_CUSTOMERS_PATH, current, `Save customer: ${c.customer_code || c.id}`);
  if (ok) {
    _customersCache.data = current;
    _customersCache.loadedAt = Date.now();
  }
  return c;
}

async function deleteCustomer(id) {
  invalidateCustomersCache();
  let current = await getCustomers();
  current = current.filter(x => x.id !== id && x.customer_code !== id);
  const ok = await ghCommit(GITHUB_CUSTOMERS_PATH, current, `Delete customer: ${id}`);
  if (ok) {
    _customersCache.data = current;
    _customersCache.loadedAt = Date.now();
  }
  return ok;
}

async function findCustomer(code, pin) {
  if (!code) return null;
  const customers = await getCustomers();
  const found = customers.find(c => c.customer_code && c.customer_code.toLowerCase() === String(code).trim().toLowerCase());
  if (!found) return null;
  if (pin && String(found.login_pin).trim() !== String(pin).trim()) {
    return null;
  }
  return found;
}

// ── Real-Time Active Connections & Analytics ──────────────
let _activeConnections = [];

function logActivity({ ip, userAgent, streamUrl, channelName, customerCode }) {
  const cleanIp = (ip || '127.0.0.1').split(',')[0].trim();
  const cleanUa = userAgent || 'BDTv App';
  const now = Date.now();

  const idx = _activeConnections.findIndex(c => c.ip === cleanIp && c.user_agent === cleanUa);
  const entry = {
    id: idx >= 0 ? _activeConnections[idx].id : 'conn-' + now + '-' + Math.random().toString(36).substr(2, 4),
    ip: cleanIp,
    user_agent: cleanUa,
    stream_url: streamUrl || 'Live IPTV Stream',
    channel_name: channelName || 'Player Screen',
    customer_code: customerCode || 'Guest',
    last_ping: now,
    connected_at: idx >= 0 ? _activeConnections[idx].connected_at : new Date().toISOString()
  };

  if (idx >= 0) {
    _activeConnections[idx] = entry;
  } else {
    _activeConnections.unshift(entry);
    if (_activeConnections.length > 250) _activeConnections.pop();
  }
  return entry;
}

function getActiveConnections() {
  const now = Date.now();
  return _activeConnections.filter(c => (now - c.last_ping) < 90000);
}

// ── Devices & Reports ─────────────────────────────────────
let _reports = [];

async function getDevices(customerId = null) {
  if (isCacheValid(_devicesCache)) {
    const list = [..._devicesCache.data];
    return customerId ? list.filter(d => d.customer_id === customerId) : list;
  }

  const result = await ghFetch(GITHUB_DEVICES_PATH);
  if (result && Array.isArray(result.data)) {
    _devicesCache.data = result.data;
    _devicesCache.loadedAt = Date.now();
  } else {
    _devicesCache.data = [];
    _devicesCache.loadedAt = Date.now();
  }
  const list = [..._devicesCache.data];
  return customerId ? list.filter(d => d.customer_id === customerId) : list;
}

async function registerOrValidateDevice({ customer_id, customer_code, fingerprint, device_name, os, browser, ip }) {
  if (!fingerprint) {
    return { allowed: false, message: 'ডিভাইস ফিঙ্গারপ্রিন্ট পাওয়া যায়নি।' };
  }

  // 1. Get customer
  let cust = null;
  if (customer_id) {
    const customers = await getCustomers();
    cust = customers.find(c => c.id === customer_id);
  } else if (customer_code) {
    const customers = await getCustomers();
    cust = customers.find(c => c.customer_code && c.customer_code.toLowerCase() === String(customer_code).trim().toLowerCase());
  }

  if (!cust) {
    return { allowed: false, message: 'গ্রাহক অ্যাকাউন্ট পাওয়া যায়নি।' };
  }

  if (cust.manual_block || cust.account_status !== 'ACTIVE') {
    return { allowed: false, message: `অ্যাকাউন্ট স্থগিত: ${cust.block_reason || 'অ্যাডমিন দ্বারা সাময়িক স্থগিত'}। যোগাযোগ করুন: 01629666467` };
  }

  if (cust.expires_at && new Date(cust.expires_at) < new Date()) {
    return { allowed: false, message: 'সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে। নবায়ন করতে যোগাযোগ করুন: 01629666467' };
  }

  const maxAllowed = Number(cust.max_devices) || 2;

  // 2. Load all devices
  const allDevices = await getDevices();
  const customerDevices = allDevices.filter(d => d.customer_id === cust.id || (cust.customer_code && d.customer_code === cust.customer_code));

  // Check if this fingerprint already exists for this customer
  const existingIndex = allDevices.findIndex(d => 
    (d.customer_id === cust.id || (cust.customer_code && d.customer_code === cust.customer_code)) &&
    d.fingerprint === fingerprint
  );

  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    // Already registered device
    const dev = allDevices[existingIndex];
    if (dev.status === 'BLOCKED') {
      return { allowed: false, message: 'এই ডিভাইসটি অ্যাডমিন দ্বারা ব্লক করা হয়েছে। যোগাযোগ করুন: 01629666467' };
    }
    // Update last_active and details
    const lastActiveMs = dev.last_active ? new Date(dev.last_active).getTime() : 0;
    // Only commit ping to GitHub once every 30 minutes to prevent Vercel deployment limit exhaustion
    const shouldPersist = (Date.now() - lastActiveMs > 30 * 60 * 1000) || dev.status !== 'ACTIVE';

    allDevices[existingIndex] = {
      ...dev,
      device_name: device_name || dev.device_name || 'Device',
      os: os || dev.os || 'Unknown',
      browser: browser || dev.browser || 'Unknown',
      ip: ip || dev.ip || '127.0.0.1',
      last_active: now,
      status: 'ACTIVE'
    };
    if (shouldPersist) {
      await ghCommit(GITHUB_DEVICES_PATH, allDevices, `Update device ping: ${fingerprint}`);
    }
    _devicesCache.data = allDevices;
    _devicesCache.loadedAt = Date.now();
    return { allowed: true, message: 'ডিভাইস অনুমোদিত।', device: allDevices[existingIndex] };
  }

  // New device trying to register - check limit
  const activeCount = customerDevices.filter(d => d.status === 'ACTIVE').length;
  if (activeCount >= maxAllowed) {
    return {
      allowed: false,
      message: `সর্বোচ্চ অনুমোদিত ডিভাইস সীমা (${maxAllowed} টি) অতিক্রম করেছে! যোগাযোগ করুন: 01629666467`
    };
  }

  // Register new device
  const newDev = {
    id: 'dev-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
    customer_id: cust.id,
    customer_code: cust.customer_code,
    fingerprint: fingerprint,
    device_name: device_name || 'New Device',
    os: os || 'Unknown',
    browser: browser || 'Unknown',
    ip: ip || '127.0.0.1',
    status: 'ACTIVE',
    registered_at: now,
    last_active: now
  };

  allDevices.push(newDev);
  invalidateDevicesCache();
  await ghCommit(GITHUB_DEVICES_PATH, allDevices, `Register new device for ${cust.customer_code}: ${fingerprint}`);
  _devicesCache.data = allDevices;
  _devicesCache.loadedAt = Date.now();

  return { allowed: true, message: 'নতুন ডিভাইস সফলভাবে যুক্ত হয়েছে।', device: newDev };
}

async function revokeDevice(deviceId) {
  const allDevices = await getDevices();
  const i = allDevices.findIndex(d => d.id === deviceId);
  if (i >= 0) {
    allDevices[i].status = 'BLOCKED';
    allDevices[i].blocked_at = new Date().toISOString();
    invalidateDevicesCache();
    await ghCommit(GITHUB_DEVICES_PATH, allDevices, `Revoke device: ${deviceId}`);
    _devicesCache.data = allDevices;
    _devicesCache.loadedAt = Date.now();
    return allDevices[i];
  }
  return null;
}

async function unblockDevice(deviceId) {
  const allDevices = await getDevices();
  const i = allDevices.findIndex(d => d.id === deviceId);
  if (i >= 0) {
    allDevices[i].status = 'ACTIVE';
    delete allDevices[i].blocked_at;
    invalidateDevicesCache();
    await ghCommit(GITHUB_DEVICES_PATH, allDevices, `Unblock device: ${deviceId}`);
    _devicesCache.data = allDevices;
    _devicesCache.loadedAt = Date.now();
    return allDevices[i];
  }
  return null;
}

async function deleteDevice(deviceId) {
  const allDevices = await getDevices();
  const filtered = allDevices.filter(d => d.id !== deviceId);
  if (filtered.length !== allDevices.length) {
    invalidateDevicesCache();
    await ghCommit(GITHUB_DEVICES_PATH, filtered, `Delete device: ${deviceId}`);
    _devicesCache.data = filtered;
    _devicesCache.loadedAt = Date.now();
    return true;
  }
  return false;
}
function getReports() { return [..._reports]; }
function addReport(r) {
  r.id = 'rep-' + Date.now();
  r.created_at = new Date().toISOString();
  r.status = 'PENDING';
  _reports.unshift(r);
  return r;
}
function resolveReport(id) {
  const r = _reports.find(x => x.id === id);
  if (r) { r.status = 'RESOLVED'; return true; }
  return false;
}

// Version (GitHub-backed with fallback)
const defaultVersion = {
  versionCode: 124,
  versionName: '2.3.16',
  minSupportedVersion: 100,
  apkUrl: 'https://github.com/kauserahemath67-hash/bdtv-tv-player/releases/download/v2.3.16/BDTv.apk',
  updateTitle: 'New Update Available (v2.3.16)',
  changelog: [
    'Channels and player performance improved',
    'Smoother live streaming and bug fixes'
  ],
  forceUpdate: false,
  updateMessage: ''
};

async function getVersion() {
  if (isCacheValid(_versionCache)) return { ..._versionCache.data };

  const result = await ghFetch(GITHUB_VERSION_PATH);
  if (result && result.data && typeof result.data === 'object') {
    _versionCache.data = { ...defaultVersion, ...result.data };
    _versionCache.loadedAt = Date.now();
  } else {
    return { ...defaultVersion };
  }
  return { ..._versionCache.data };
}

async function updateVersion(newVersion) {
  invalidateVersionCache();
  const current = await getVersion();
  const merged = { ...current, ...newVersion, updatedAt: new Date().toISOString() };
  const ok = await ghCommit(GITHUB_VERSION_PATH, merged, 'Update app version info');
  if (ok) {
    _versionCache.data = merged;
    _versionCache.loadedAt = Date.now();
  }
  return merged;
}

// ── Exports ───────────────────────────────────────────────
module.exports = {
  // Channels (all async)
  getChannels,
  saveChannel,
  deleteChannel,
  importChannels,
  reorderChannels,
  updateChannelHealth,
  batchUpdateChannels,

  // Settings (all async)
  getSettings,
  updateSettings,

  // Playlists (all async)
  getPlaylists,
  savePlaylist,
  deletePlaylist,

  // Version
  getVersion,
  updateVersion,

  // Customers & Subscriptions
  getCustomers,
  saveCustomer,
  deleteCustomer,
  findCustomer,

  // Real-Time Activity & Analytics
  logActivity,
  getActiveConnections,

  // Devices (GitHub-persisted)
  getDevices,
  registerOrValidateDevice,
  revokeDevice,
  unblockDevice,
  deleteDevice,
  getReports,
  addReport,
  resolveReport
};
