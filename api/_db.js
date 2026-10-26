const fs = require('fs');
const path = require('path');

// Memory store fallback for Serverless environment
let memoryStore = {
  channels: null,
  settings: null,
  version: null,
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

// Safe file reader
function readJsonFile(relPath, defaultData) {
  try {
    const fullPath = path.join(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.warn(`Could not read ${relPath}, using fallback:`, err.message);
  }
  return defaultData;
}

// Safe file writer (when local filesystem is writable)
function writeJsonFile(relPath, data) {
  try {
    const fullPath = path.join(process.cwd(), relPath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    // Vercel serverless filesystem is read-only at runtime outside /tmp
    return false;
  }
}

// Initialize base data
function initData() {
  if (!memoryStore.channels) {
    memoryStore.channels = readJsonFile('data/initial-channels.json', []);
  }
  if (!memoryStore.settings) {
    memoryStore.settings = readJsonFile('data/settings.json', {
      site_title: "BDTv Live",
      admin_pin: "123456",
      subscription_restrictions_enabled: false,
      notice_text: "Welcome to BDTv Live Player",
      notice_active: true,
      ads: {}
    });
  }
  if (!memoryStore.version) {
    memoryStore.version = readJsonFile('data/version.json', {
      versionCode: 105,
      versionName: "2.1.0",
      apkUrl: "https://bdtv.free.je/BDTv.apk"
    });
  }
}

initData();

module.exports = {
  // Channels
  getChannels() {
    initData();
    return [...memoryStore.channels].sort((a, b) => (a.order || 0) - (b.order || 0));
  },
  saveChannel(channel) {
    initData();
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
    writeJsonFile('data/initial-channels.json', memoryStore.channels);
    return channel;
  },
  deleteChannel(id) {
    initData();
    memoryStore.channels = memoryStore.channels.filter(c => c.id !== id);
    writeJsonFile('data/initial-channels.json', memoryStore.channels);
    return true;
  },
  reorderChannels(orderList) {
    // orderList: [{ id, order }]
    initData();
    orderList.forEach(item => {
      const ch = memoryStore.channels.find(c => c.id === item.id);
      if (ch) ch.order = item.order;
    });
    writeJsonFile('data/initial-channels.json', memoryStore.channels);
    return memoryStore.channels;
  },
  updateChannelHealth(id, status, response_time_ms) {
    initData();
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
    initData();
    return { ...memoryStore.settings };
  },
  updateSettings(newSettings) {
    initData();
    memoryStore.settings = { ...memoryStore.settings, ...newSettings };
    writeJsonFile('data/settings.json', memoryStore.settings);
    return memoryStore.settings;
  },

  // Version
  getVersion() {
    initData();
    return { ...memoryStore.version };
  },
  updateVersion(newVersion) {
    initData();
    memoryStore.version = { ...memoryStore.version, ...newVersion, updatedAt: new Date().toISOString() };
    writeJsonFile('data/version.json', memoryStore.version);
    return memoryStore.version;
  },

  // Customers / Users
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
    // device: { customer_id, fingerprint, device_name, os, browser }
    const existing = memoryStore.devices.find(d => d.customer_id === device.customer_id && d.fingerprint === device.fingerprint);
    if (existing) {
      existing.last_active = new Date().toISOString();
      return { allowed: existing.status === 'ACTIVE', device: existing };
    }
    
    // Check max devices for this customer
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
