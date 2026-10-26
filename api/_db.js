// Embedded default channels to guarantee 100% availability in any Serverless environment
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
    "response_time_ms": 130,
    "manual_override": false
  }
];

const defaultSettings = {
  site_title: "BDTv Live - Premium IPTV Web Player",
  notice_text: "স্বাগতম BDTv লাইভ প্লেয়ারে! যেকোনো টিভি চ্যানেল সহজে উপভোগ করুন।",
  notice_active: true,
  subscription_restrictions_enabled: false,
  default_max_devices: 2,
  expiry_warning_days: 3,
  admin_pin: "123456",
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

module.exports = {
  getChannels() {
    return [...memoryStore.channels].sort((a, b) => (a.order || 0) - (b.order || 0));
  },
  saveChannel(channel) {
    if (!channel.id) {
      channel.id = "ch-" + Date.now();
    }
    const idx = memoryStore.channels.findIndex(c => c.id === channel.id);
    if (idx >= 0) {
      memoryStore.channels[idx] = { ...memoryStore.channels[idx], ...channel };
    } else {
      channel.order = channel.order || (memoryStore.channels.length + 1);
      memoryStore.channels.push(channel);
    }
    return channel;
  },
  deleteChannel(id) {
    memoryStore.channels = memoryStore.channels.filter(c => c.id !== id);
    return true;
  },
  reorderChannels(orderList) {
    orderList.forEach(item => {
      const ch = memoryStore.channels.find(c => c.id === item.id);
      if (ch) ch.order = item.order;
    });
    return memoryStore.channels;
  },
  updateChannelHealth(id, status, response_time_ms) {
    const ch = memoryStore.channels.find(c => c.id === id);
    if (ch) {
      if (!ch.manual_override) {
        ch.status = status;
      }
      ch.response_time_ms = response_time_ms;
    }
    return ch;
  },
  getSettings() {
    return { ...memoryStore.settings };
  },
  updateSettings(newSettings) {
    memoryStore.settings = { ...memoryStore.settings, ...newSettings };
    return memoryStore.settings;
  },
  getVersion() {
    return { ...memoryStore.version };
  },
  updateVersion(newVersion) {
    memoryStore.version = { ...memoryStore.version, ...newVersion, updatedAt: new Date().toISOString() };
    return memoryStore.version;
  },
  getCustomers() {
    return memoryStore.customers;
  },
  saveCustomer(cust) {
    if (!cust.id) {
      cust.id = "cust-" + Date.now();
      cust.first_seen = new Date().toISOString();
    }
    cust.last_seen = new Date().toISOString();
    const idx = memoryStore.customers.findIndex(c => c.id === cust.id);
    if (idx >= 0) {
      memoryStore.customers[idx] = { ...memoryStore.customers[idx], ...cust };
    } else {
      memoryStore.customers.push(cust);
    }
    return cust;
  },
  deleteCustomer(id) {
    memoryStore.customers = memoryStore.customers.filter(c => c.id !== id);
    return true;
  },
  findCustomer(code, pin) {
    return memoryStore.customers.find(c => c.customer_code === code && (!pin || c.login_pin === pin));
  },
  getDevices(customerId) {
    if (customerId) {
      return memoryStore.devices.filter(d => d.customer_id === customerId);
    }
    return memoryStore.devices;
  },
  registerDevice(device) {
    const existing = memoryStore.devices.find(d => d.customer_id === device.customer_id && d.fingerprint === device.fingerprint);
    if (existing) {
      existing.last_active = new Date().toISOString();
      return { allowed: existing.status === 'ACTIVE', device: existing };
    }
    
    const cust = memoryStore.customers.find(c => c.id === device.customer_id);
    const maxLimit = cust ? (cust.max_devices || 2) : 2;
    const currentActive = memoryStore.devices.filter(d => d.customer_id === device.customer_id && d.status === 'ACTIVE');

    const newDev = {
      id: "dev-" + Date.now(),
      customer_id: device.customer_id,
      fingerprint: device.fingerprint,
      device_name: device.device_name || "Unknown Device",
      os: device.os || "Unknown OS",
      browser: device.browser || "Unknown Browser",
      status: currentActive.length < maxLimit ? "ACTIVE" : "BLOCKED",
      created_at: new Date().toISOString(),
      last_active: new Date().toISOString()
    };
    memoryStore.devices.push(newDev);
    return {
      allowed: newDev.status === 'ACTIVE',
      device: newDev,
      message: newDev.status === 'BLOCKED' ? `ডিভাইস লিমিট (${maxLimit}) অতিক্রম করেছে।` : 'ডিভাইস অনুমোদিত।'
    };
  },
  revokeDevice(deviceId) {
    const dev = memoryStore.devices.find(d => d.id === deviceId);
    if (dev) {
      dev.status = 'REVOKED';
    }
    return dev;
  },
  getReports() {
    return memoryStore.reports;
  },
  addReport(report) {
    const newReport = {
      id: "rep-" + Date.now(),
      channel_id: report.channel_id,
      channel_name: report.channel_name,
      error_message: report.error_message || "Stream not loading",
      user_agent: report.user_agent,
      status: "PENDING",
      created_at: new Date().toISOString()
    };
    memoryStore.reports.unshift(newReport);
    return newReport;
  },
  resolveReport(id) {
    const rep = memoryStore.reports.find(r => r.id === id);
    if (rep) rep.status = "RESOLVED";
    return rep;
  }
};
