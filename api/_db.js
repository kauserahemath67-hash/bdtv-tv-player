// =========================================================
// BDTv Persistent Cloud Database Module - v3 FIXED
// GitHub as source of truth. Every read checks TTL cache,
// every write commits to GitHub AND invalidates cache.
// Serverless-safe: no module-level async state assumptions.
// =========================================================

const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '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';
const GITHUB_REPO  = 'kauserahemath67-hash/bdtv-tv-player';
const GITHUB_BRANCH = 'data-storage';
const GITHUB_CHANNELS_PATH  = 'data/channels.json';
const GITHUB_SETTINGS_PATH  = 'data/settings.json';
const GITHUB_PLAYLISTS_PATH = 'data/playlists.json';

const CACHE_TTL_MS = 20000; // 20-second in-process cache (warm requests)

// ── Default data ──────────────────────────────────────────
const defaultChannels = [
  { id: 'ch-1', name: 'Somoy TV',           category: 'News',            logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Somoy_TV_logo.svg/300px-Somoy_TV_logo.svg.png',          url: 'https://stream.somoynews.tv/live/somoy/playlist.m3u8',               is_pinned: true,  order: 1, status: 'ONLINE', response_time_ms: 120, manual_override: false },
  { id: 'ch-2', name: 'Jamuna TV',           category: 'News',            logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/07/Jamuna_TV_logo.png/300px-Jamuna_TV_logo.png',           url: 'https://stream.jamuna.tv/live/jamuna/playlist.m3u8',                 is_pinned: true,  order: 2, status: 'ONLINE', response_time_ms: 140, manual_override: false },
  { id: 'ch-3', name: 'T Sports',            category: 'Sports',          logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/9/91/T_Sports_logo.svg/300px-T_Sports_logo.svg.png',         url: 'https://tsports.live/stream/playlist.m3u8',                          is_pinned: true,  order: 3, status: 'ONLINE', response_time_ms: 110, manual_override: false },
  { id: 'ch-4', name: 'Channel i',           category: 'Entertainment',   logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Channel_i_logo.svg/300px-Channel_i_logo.svg.png',       url: 'https://stream.channeli.tv/live/playlist.m3u8',                      is_pinned: false, order: 4, status: 'ONLINE', response_time_ms: 160, manual_override: false },
  { id: 'ch-5', name: 'Al Jazeera English',  category: 'International',   logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Al_Jazeera_English_logo.svg/300px-Al_Jazeera_English_logo.svg.png', url: 'https://live-hls-web-aje.getaj.net/AJE/03.m3u8',           is_pinned: false, order: 5, status: 'ONLINE', response_time_ms: 95,  manual_override: false },
  { id: 'ch-6', name: 'NHK World Japan',     category: 'International',   logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/NHK_World-Japan_logo.svg/300px-NHK_World-Japan_logo.svg.png', url: 'https://b-nhkworld.akamaized.net/hls/live/2014412/nhkworld/playlist_720.m3u8', is_pinned: false, order: 6, status: 'ONLINE', response_time_ms: 85, manual_override: false },
  { id: 'ch-7', name: 'Bangladesh Betar',    category: 'Music & Radio',   logo: 'https://upload.wikimedia.org/wikipedia/en/thumb/1/15/Bangladesh_Betar_Logo.svg/300px-Bangladesh_Betar_Logo.svg.png',   url: 'https://betarlive.teletalk.com.bd/live/betar.m3u8',                  is_pinned: false, order: 7, status: 'ONLINE', response_time_ms: 105, manual_override: false }
];

const defaultSettings = {
  site_title: 'BDTv Live - Premium IPTV Web Player',
  admin_pin: '123456',
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

function isCacheValid(cacheObj) {
  return cacheObj.data !== null && (Date.now() - cacheObj.loadedAt) < CACHE_TTL_MS;
}
function invalidateChannelCache()   { _channelCache.loadedAt   = 0; }
function invalidateSettingsCache()  { _settingsCache.loadedAt  = 0; }
function invalidatePlaylistsCache() { _playlistsCache.loadedAt = 0; }

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
    // GitHub file missing or empty — use defaults but don't cache
    // (we want to retry next time)
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
    current[idx] = { ...current[idx], ...channel };
  } else {
    channel.order  = channel.order  || current.length + 1;
    channel.status = channel.status || 'ONLINE';
    current.push(channel);
  }

  // 3. Persist
  const ok = await ghCommit(GITHUB_CHANNELS_PATH, current, `Save channel: ${channel.name}`);
  if (ok) {
    _channelCache.data    = current;
    _channelCache.loadedAt = Date.now();
  } else {
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
 */
async function importChannels(newChannels) {
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
  orderedIds.forEach((id, i) => {
    const ch = current.find(c => c.id === id);
    if (ch) ch.order = i + 1;
  });
  const sorted = current.sort((a, b) => (a.order || 0) - (b.order || 0));
  await ghCommit(GITHUB_CHANNELS_PATH, sorted, 'Reorder channels');
  _channelCache.data    = sorted;
  _channelCache.loadedAt = Date.now();
  return sorted;
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
  // Update if same URL already exists
  const idx = current.findIndex(p => p.url && p.url === playlist.url);
  if (idx >= 0) {
    current[idx] = { ...current[idx], ...playlist };
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

// ── In-memory only (no persistence needed for sessions) ──
let _customers = [];
let _devices   = [];
let _reports   = [];

function getCustomers() { return [..._customers]; }
function saveCustomer(c) {
  if (!c.id) c.id = 'cust-' + Date.now();
  const i = _customers.findIndex(x => x.id === c.id);
  if (i >= 0) _customers[i] = { ..._customers[i], ...c }; else _customers.push(c);
  return c;
}
function getDevices() { return [..._devices]; }
function saveDevice(d) {
  const i = _devices.findIndex(x => x.id === d.id);
  if (i >= 0) _devices[i] = { ..._devices[i], ...d }; else _devices.push(d);
  return d;
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

// Version (static)
const VERSION = {
  versionCode: 107, versionName: '2.2.0', minSupportedVersion: 100,
  apkUrl: 'https://bdtv-live-tv.vercel.app/BDTv.apk',
  updateTitle: 'নতুন আপডেট উপলব্ধ!',
  changelog: [
    'প্লেয়ারের পারফরম্যান্স বৃদ্ধি ও বাফারিং অপ্টিমাইজেশন',
    'নতুন টিভি চ্যানেল ও লাইভ স্ট্রিম ফিক্স',
    'ড্রয়ার ও রিমোট কন্ট্রোল বাগ ফিক্স'
  ],
  forceUpdate: false, updateMessage: ''
};
function getVersion() { return { ...VERSION }; }
function updateVersion(v) { Object.assign(VERSION, v, { updatedAt: new Date().toISOString() }); return { ...VERSION }; }

// ── Exports ───────────────────────────────────────────────
module.exports = {
  // Channels (all async)
  getChannels,
  saveChannel,
  deleteChannel,
  importChannels,
  reorderChannels,

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

  // In-memory
  getCustomers,
  saveCustomer,
  getDevices,
  saveDevice,
  getReports,
  addReport,
  resolveReport
};
