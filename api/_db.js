// =========================================================
// BDTv Persistent Cloud Database Module
// In-Memory Fast Cache + Automatic GitHub Private Storage Sync
// Changes are permanently preserved across serverless cold starts!
// =========================================================

const https = require('https');

const GITHUB_TOKEN = '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';
const GITHUB_REPO = 'kauserahemath67-hash/bdtv-tv-player';
const GITHUB_CHANNELS_PATH = 'data/channels.json';
const GITHUB_SETTINGS_PATH = 'data/settings.json';

// Embedded default channels fallback
const defaultChannels = [
  {
    "id": "ch-1",
    "name": "Somoy TV",
    "category": "News",
    "logo": "https://upload.wikimedia.org/wikipedia/en/thumb/e/e0/Somoy_TV_logo.svg/300px-Somoy_TV_logo.svg.png",
    "url": "https://stream.somoynews.tv/live/somoy/playlist.m3u8",
    "is_pinned": true,
    "order": 1,
    "status": "ONLINE",
    "response_time_ms": 120,
    "manual_override": false
  },
  {
    "id": "ch-2",
    "name": "Jamuna TV",
    "category": "News",
    "logo": "https://upload.wikimedia.org/wikipedia/en/thumb/0/07/Jamuna_TV_logo.png/300px-Jamuna_TV_logo.png",
    "url": "https://stream.jamuna.tv/live/jamuna/playlist.m3u8",
    "is_pinned": true,
    "order": 2,
    "status": "ONLINE",
    "response_time_ms": 140,
    "manual_override": false
  },
  {
    "id": "ch-3",
    "name": "T Sports",
    "category": "Sports",
    "logo": "https://upload.wikimedia.org/wikipedia/en/thumb/9/91/T_Sports_logo.svg/300px-T_Sports_logo.svg.png",
    "url": "https://tsports.live/stream/playlist.m3u8",
    "is_pinned": true,
    "order": 3,
    "status": "ONLINE",
    "response_time_ms": 110,
    "manual_override": false
  },
  {
    "id": "ch-4",
    "name": "Channel i",
    "category": "Entertainment",
    "logo": "https://upload.wikimedia.org/wikipedia/en/thumb/0/0e/Channel_i_logo.svg/300px-Channel_i_logo.svg.png",
    "url": "https://stream.channeli.tv/live/playlist.m3u8",
    "is_pinned": false,
    "order": 4,
    "status": "ONLINE",
    "response_time_ms": 160,
    "manual_override": false
  },
  {
    "id": "ch-5",
    "name": "Al Jazeera English",
    "category": "International",
    "logo": "https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Al_Jazeera_English_logo.svg/300px-Al_Jazeera_English_logo.svg.png",
    "url": "https://live-hls-web-aje.getaj.net/AJE/03.m3u8",
    "is_pinned": false,
    "order": 5,
    "status": "ONLINE",
    "response_time_ms": 95,
    "manual_override": false
  },
  {
    "id": "ch-6",
    "name": "NHK World Japan",
    "category": "International",
    "logo": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/NHK_World-Japan_logo.svg/300px-NHK_World-Japan_logo.svg.png",
    "url": "https://b-nhkworld.akamaized.net/hls/live/2014412/nhkworld/playlist_720.m3u8",
    "is_pinned": false,
    "order": 6,
    "status": "ONLINE",
    "response_time_ms": 85,
    "manual_override": false
  },
  {
    "id": "ch-7",
    "name": "Bangladesh Betar (Radio)",
    "category": "Music & Radio",
    "logo": "https://upload.wikimedia.org/wikipedia/en/thumb/1/15/Bangladesh_Betar_Logo.svg/300px-Bangladesh_Betar_Logo.svg.png",
    "url": "https://betarlive.teletalk.com.bd/live/betar.m3u8",
    "is_pinned": false,
    "order": 7,
    "status": "ONLINE",
    "response_time_ms": 105,
    "manual_override": false
  }
];

const defaultSettings = {
  site_title: "BDTv Live - Premium IPTV Web Player",
  admin_pin: "123456",
  notice_text: "স্বাগতম BDTv লাইভ প্লেয়ারে! যেকোনো টিভি চ্যানেল সহজে উপভোগ করুন।",
  notice_active: true,
  subscription_restrictions_enabled: false,
  default_max_devices: 2,
  expiry_warning_days: 3,
  ads: {
    top: { active: false, code: "" },
    below_player: { active: false, code: "" },
    infeed: { active: false, code: "" },
    footer: { active: false, code: "" }
  }
};

const defaultVersion = {
  versionCode: 105,
  versionName: "2.1.0",
  minSupportedVersion: 100,
  apkUrl: "https://bdtv.free.je/BDTv.apk",
  updateTitle: "নতুন আপডেট উপলব্ধ!",
  changelog: [
    "অ্যান্ড্রয়েড টিভি রিমোট কন্ট্রোল আরও স্মুথ ও দ্রুত হয়েছে",
    "লো-লেটেন্সি লাইভ স্ট্রিমিং মোড যুক্ত করা হয়েছে",
    "চ্যানেল ড্রয়ার ও সোয়াইপ জেসচার আরও অপ্টিমাইজ করা হয়েছে",
    "বাফারিং ও এরর অটো-রিকভারি ফিক্স"
  ],
  forceUpdate: false,
  updatedAt: "2026-10-27T00:00:00.000Z"
};

let memoryStore = {
  channels: defaultChannels,
  settings: defaultSettings,
  version: defaultVersion,
  customers: [
    {
      id: "cust-1",
      customer_code: "BDTV-1001",
      name: "Demo Customer",
      login_pin: "1234",
      account_status: "ACTIVE",
      manual_block: false,
      block_reason: "",
      max_devices: 2,
      channels_enabled: true,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      plan: "Monthly VIP",
      starts_at: "2026-10-01",
      expires_at: "2026-12-31",
      payment_status: "PAID",
      transaction_reference: "bKash-TRX99201"
    }
  ],
  devices: [],
  reports: []
};

let hasSyncedFromGitHub = false;

// GitHub Cloud Persistence Helpers
function fetchGitHubFile(filePath) {
  return new Promise((resolve) => {
    https.get({
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/contents/${filePath}`,
      headers: {
        'User-Agent': 'BDTv-Database-Sync',
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          if (res.statusCode === 200) {
            const json = JSON.parse(data);
            const content = Buffer.from(json.content, 'base64').toString('utf8');
            resolve({ sha: json.sha, data: JSON.parse(content) });
          } else {
            resolve(null);
          }
        } catch (e) {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

function commitGitHubFile(filePath, dataObj, commitMessage = 'Auto-sync database update') {
  return new Promise(async (resolve) => {
    try {
      const existing = await fetchGitHubFile(filePath);
      const sha = existing ? existing.sha : undefined;
      const contentBase64 = Buffer.from(JSON.stringify(dataObj, null, 2)).toString('base64');

      const body = JSON.stringify({
        message: commitMessage,
        content: contentBase64,
        sha
      });

      const req = https.request({
        hostname: 'api.github.com',
        path: `/repos/${GITHUB_REPO}/contents/${filePath}`,
        method: 'PUT',
        headers: {
          'User-Agent': 'BDTv-Database-Sync',
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }, res => {
        resolve(res.statusCode === 200 || res.statusCode === 201);
      });

      req.on('error', () => resolve(false));
      req.write(body);
      req.end();
    } catch (e) {
      resolve(false);
    }
  });
}

// Background sync from GitHub on first cold start
async function initCloudSync() {
  if (hasSyncedFromGitHub) return;
  hasSyncedFromGitHub = true;
  try {
    const cloudChannels = await fetchGitHubFile(GITHUB_CHANNELS_PATH);
    if (cloudChannels && Array.isArray(cloudChannels.data) && cloudChannels.data.length > 0) {
      memoryStore.channels = cloudChannels.data;
    }
    const cloudSettings = await fetchGitHubFile(GITHUB_SETTINGS_PATH);
    if (cloudSettings && cloudSettings.data) {
      memoryStore.settings = { ...memoryStore.settings, ...cloudSettings.data };
    }
  } catch (e) {}
}

// Trigger initial async sync
initCloudSync();

module.exports = {
  getChannels() {
    return [...memoryStore.channels].sort((a, b) => (a.order || 0) - (b.order || 0));
  },

  async syncFromCloud() {
    await initCloudSync();
  },

  saveChannel(channel) {
    if (!channel.id) {
      channel.id = "ch-" + Date.now();
    }
    const idx = memoryStore.channels.findIndex(c => c.id === channel.id);
    if (idx >= 0) {
      memoryStore.channels[idx] = { ...memoryStore.channels[idx], ...channel };
    } else {
      channel.order = channel.order || memoryStore.channels.length + 1;
      channel.status = channel.status || "ONLINE";
      memoryStore.channels.push(channel);
    }

    // Persist permanently to GitHub Cloud Storage
    commitGitHubFile(GITHUB_CHANNELS_PATH, memoryStore.channels, `Save channel: ${channel.name}`);
    return channel;
  },

  deleteChannel(id) {
    const idx = memoryStore.channels.findIndex(c => c.id === id);
    if (idx >= 0) {
      const deleted = memoryStore.channels.splice(idx, 1)[0];
      // Persist deletion permanently to GitHub Cloud Storage
      commitGitHubFile(GITHUB_CHANNELS_PATH, memoryStore.channels, `Delete channel ID: ${id}`);
      return true;
    }
    return false;
  },

  getSettings() {
    return { ...memoryStore.settings };
  },

  updateSettings(newSettings) {
    memoryStore.settings = { ...memoryStore.settings, ...newSettings };
    // Persist settings permanently to GitHub Cloud Storage
    commitGitHubFile(GITHUB_SETTINGS_PATH, memoryStore.settings, 'Update site settings');
    return memoryStore.settings;
  },

  getVersion() {
    return { ...memoryStore.version };
  },

  updateVersion(newVersion) {
    memoryStore.version = {
      ...memoryStore.version,
      ...newVersion,
      updatedAt: new Date().toISOString()
    };
    return memoryStore.version;
  },

  getCustomers() {
    return [...memoryStore.customers];
  },

  saveCustomer(customer) {
    if (!customer.id) {
      customer.id = "cust-" + Date.now();
    }
    const idx = memoryStore.customers.findIndex(c => c.id === customer.id);
    if (idx >= 0) {
      memoryStore.customers[idx] = { ...memoryStore.customers[idx], ...customer };
    } else {
      memoryStore.customers.push(customer);
    }
    return customer;
  },

  getDevices() {
    return [...memoryStore.devices];
  },

  saveDevice(device) {
    const idx = memoryStore.devices.findIndex(d => d.id === device.id);
    if (idx >= 0) {
      memoryStore.devices[idx] = { ...memoryStore.devices[idx], ...device };
    } else {
      memoryStore.devices.push(device);
    }
    return device;
  },

  getReports() {
    return [...memoryStore.reports];
  },

  addReport(report) {
    report.id = "rep-" + Date.now();
    report.created_at = new Date().toISOString();
    report.status = "PENDING";
    memoryStore.reports.unshift(report);
    return report;
  },

  resolveReport(id) {
    const report = memoryStore.reports.find(r => r.id === id);
    if (report) {
      report.status = "RESOLVED";
      return true;
    }
    return false;
  }
};
