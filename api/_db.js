const fs = require('fs');
const path = require('path');

// Direct require so Vercel bundler bundles the JSON files into Serverless functions
let defaultChannels = [];
let defaultSettings = {
  site_title: "BDTv Live",
  admin_pin: "123456",
  subscription_restrictions_enabled: false,
  notice_text: "Welcome to BDTv Live Player",
  notice_active: true,
  ads: {}
};
let defaultVersion = {
  versionCode: 105,
  versionName: "2.1.0",
  apkUrl: "https://bdtv.free.je/BDTv.apk"
};

try {
  defaultChannels = require('../data/initial-channels.json');
} catch (e) {
  try {
    defaultChannels = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/initial-channels.json'), 'utf8'));
  } catch (e2) {}
}

try {
  defaultSettings = require('../data/settings.json');
} catch (e) {}

try {
  defaultVersion = require('../data/version.json');
} catch (e) {}

// Memory store for Serverless environment
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
  // Channels
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

  // Settings
  getSettings() {
    return { ...memoryStore.settings };
  },
  updateSettings(newSettings) {
    memoryStore.settings = { ...memoryStore.settings, ...newSettings };
    return memoryStore.settings;
  },

  // Version
  getVersion() {
    return { ...memoryStore.version };
  },
  updateVersion(newVersion) {
    memoryStore.version = { ...memoryStore.version, ...newVersion, updatedAt: new Date().toISOString() };
    return memoryStore.version;
  },

  // Customers
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

  // Devices
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

  // Reports
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
