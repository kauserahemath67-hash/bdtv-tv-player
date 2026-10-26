// ==========================================
// BDTv Admin Dashboard Controller
// ==========================================

class AdminDashboard {
  constructor() {
    this.token = localStorage.getItem('bdtv_admin_token');
    this.channels = [];
    this.customers = [];
    this.devices = [];
    this.reports = [];
    this.settings = {};
    this.previewHls = null;

    this.init();
  }

  async init() {
    this.bindLogin();
    if (this.token) {
      const valid = await this.verifySession();
      if (valid) {
        this.showDashboard();
      } else {
        this.showLogin();
      }
    } else {
      this.showLogin();
    }
  }

  // 1. Authentication
  async verifySession() {
    try {
      const res = await fetch('/api/auth', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      const data = await res.json();
      return data.authenticated;
    } catch (e) {
      return false;
    }
  }

  bindLogin() {
    document.getElementById('admin-login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pin = document.getElementById('admin-pin-input').value.trim();
      const errBox = document.getElementById('login-error');

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await res.json();
        if (data.success && data.token) {
          this.token = data.token;
          localStorage.setItem('bdtv_admin_token', this.token);
          this.showDashboard();
        } else {
          errBox.textContent = data.message || 'ভুল পিন!';
          errBox.classList.remove('hidden');
        }
      } catch (err) {
        errBox.textContent = 'সার্ভার এরর!';
        errBox.classList.remove('hidden');
      }
    });

    document.getElementById('btn-logout').addEventListener('click', () => {
      localStorage.removeItem('bdtv_admin_token');
      location.reload();
    });
  }

  showLogin() {
    document.getElementById('login-modal').classList.remove('hidden');
    document.getElementById('admin-app').classList.add('hidden');
  }

  showDashboard() {
    document.getElementById('login-modal').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    this.bindNav();
    this.bindModals();
    this.loadAllData();
  }

  // 2. Navigation
  bindNav() {
    const tabs = document.querySelectorAll('.nav-item');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById(target).classList.add('active');

        // Update header
        const pageTitle = document.getElementById('page-title');
        pageTitle.textContent = tab.textContent.trim();
      });
    });

    // Quick scan button
    document.getElementById('btn-quick-scan').addEventListener('click', () => this.runHealthScan());
    document.getElementById('btn-run-health-scan').addEventListener('click', () => this.runHealthScan());
  }

  // 3. Load All Data
  async loadAllData() {
    await Promise.all([
      this.loadChannels(),
      this.loadSettings(),
      this.loadCustomers(),
      this.loadDevices(),
      this.loadReports(),
      this.loadVersion()
    ]);
    this.updateOverviewStats();
  }

  // 4. Channels Management
  async loadChannels() {
    try {
      const res = await fetch('/api/channels');
      const json = await res.json();
      if (json.success) {
        this.channels = json.data;
        this.renderChannelsTable();
      }
    } catch (e) {
      console.error(e);
    }
  }

  renderChannelsTable() {
    const tbody = document.getElementById('channels-table-body');
    tbody.innerHTML = '';

    const searchTerm = (document.getElementById('channel-search').value || '').toLowerCase();
    const filtered = this.channels.filter(c => c.name.toLowerCase().includes(searchTerm) || c.category.toLowerCase().includes(searchTerm));

    filtered.forEach((ch, idx) => {
      const tr = document.createElement('tr');
      const isOnline = ch.status === 'ONLINE';

      tr.innerHTML = `
        <td><strong>#${ch.order || (idx + 1)}</strong></td>
        <td><img src="${ch.logo || 'https://via.placeholder.com/32'}" class="table-logo" alt="" onerror="this.src='https://via.placeholder.com/32'"></td>
        <td>
          <strong>${ch.name}</strong>
          ${ch.manual_override ? '<span class="badge" style="background:#555;color:#fff;font-size:9px;">MANUAL</span>' : ''}
        </td>
        <td><span class="badge" style="background:rgba(255,255,255,0.08);">${ch.category || 'General'}</span></td>
        <td>${ch.is_pinned ? '⭐ পিনড' : '—'}</td>
        <td>
          <span class="badge ${isOnline ? 'badge-online' : 'badge-offline'}">
            ${ch.status || 'ONLINE'} ${ch.response_time_ms ? `(${ch.response_time_ms}ms)` : ''}
          </span>
        </td>
        <td>
          <button class="btn-action btn-preview" title="লাইভ টেস্ট করুন">▶️</button>
          <button class="btn-action btn-move-up" title="উপরে নিন">⬆️</button>
          <button class="btn-action btn-move-down" title="নিচে নিন">⬇️</button>
          <button class="btn-action btn-edit" title="এডিট">✏️</button>
          <button class="btn-action btn-delete" title="ডিলিট">🗑️</button>
        </td>
      `;

      // Preview Live Stream
      tr.querySelector('.btn-preview').addEventListener('click', () => this.openPreview(ch));

      // Move Up / Down
      tr.querySelector('.btn-move-up').addEventListener('click', () => this.moveChannel(idx, -1));
      tr.querySelector('.btn-move-down').addEventListener('click', () => this.moveChannel(idx, 1));

      // Edit
      tr.querySelector('.btn-edit').addEventListener('click', () => this.openEditChannel(ch));

      // Delete
      tr.querySelector('.btn-delete').addEventListener('click', () => this.deleteChannel(ch.id, ch.name));

      tbody.appendChild(tr);
    });

    document.getElementById('stat-total-channels').textContent = this.channels.length;
    document.getElementById('stat-online-channels').textContent = this.channels.filter(c => c.status === 'ONLINE').length;
  }

  async moveChannel(index, delta) {
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= this.channels.length) return;

    const temp = this.channels[index];
    this.channels[index] = this.channels[newIdx];
    this.channels[newIdx] = temp;

    const orderList = this.channels.map((ch, idx) => ({ id: ch.id, order: idx + 1 }));
    try {
      await fetch('/api/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderList })
      });
      await this.loadChannels();
    } catch (e) {
      alert('ক্রম পরিবর্তন ব্যর্থ হয়েছে');
    }
  }

  async deleteChannel(id, name) {
    if (!confirm(`আপনি কি নিশ্চিতভাবে '${name}' চ্যানেলটি মুছে ফেলতে চান?`)) return;
    try {
      await fetch(`/api/channels?id=${id}`, { method: 'DELETE' });
      await this.loadChannels();
    } catch (e) {
      alert('চ্যানেল মুছে ফেলা যায়নি');
    }
  }

  openEditChannel(ch) {
    document.getElementById('channel-modal-title').textContent = 'চ্যানেল এডিট করুন';
    document.getElementById('channel-edit-id').value = ch.id;
    document.getElementById('form-ch-name').value = ch.name;
    document.getElementById('form-ch-category').value = ch.category || 'News';
    document.getElementById('form-ch-logo').value = ch.logo || '';
    document.getElementById('form-ch-url').value = ch.url;
    document.getElementById('form-ch-pinned').checked = Boolean(ch.is_pinned);
    document.getElementById('form-ch-override').checked = Boolean(ch.manual_override);

    document.getElementById('channel-modal').classList.remove('hidden');
  }

  // 5. Live Preview Modal
  openPreview(ch) {
    document.getElementById('preview-modal-title').textContent = `লাইভ টেস্ট: ${ch.name}`;
    const video = document.getElementById('admin-preview-player');
    const statusText = document.getElementById('preview-status-text');
    statusText.textContent = `কানেক্ট হচ্ছে: ${ch.url}`;

    if (this.previewHls) {
      this.previewHls.destroy();
    }

    if (Hls.isSupported() && ch.url.includes('.m3u8')) {
      this.previewHls = new Hls();
      this.previewHls.loadSource(ch.url);
      this.previewHls.attachMedia(video);
      this.previewHls.on(Hls.Events.MANIFEST_PARSED, () => {
        statusText.textContent = '✅ লাইভ স্ট্রিম সফলভাবে চলছে!';
        video.play();
      });
      this.previewHls.on(Hls.Events.ERROR, () => {
        statusText.textContent = '⚠️ লাইভ স্ট্রিম চালাতে সমস্যা হচ্ছে!';
      });
    } else {
      video.src = ch.url;
      video.play();
    }

    document.getElementById('preview-modal').classList.remove('hidden');
  }

  // 6. M3U Playlist Handling
  bindModals() {
    // Channel Modal
    document.getElementById('btn-add-channel').addEventListener('click', () => {
      document.getElementById('channel-modal-title').textContent = 'নতুন চ্যানেল যোগ করুন';
      document.getElementById('channel-form').reset();
      document.getElementById('channel-edit-id').value = '';
      document.getElementById('channel-modal').classList.remove('hidden');
    });

    document.getElementById('btn-close-channel-modal').addEventListener('click', () => {
      document.getElementById('channel-modal').classList.add('hidden');
    });

    document.getElementById('channel-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('channel-edit-id').value;
      const data = {
        id: id || undefined,
        name: document.getElementById('form-ch-name').value.trim(),
        category: document.getElementById('form-ch-category').value,
        logo: document.getElementById('form-ch-logo').value.trim(),
        url: document.getElementById('form-ch-url').value.trim(),
        is_pinned: document.getElementById('form-ch-pinned').checked,
        manual_override: document.getElementById('form-ch-override').checked
      };

      try {
        await fetch('/api/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        document.getElementById('channel-modal').classList.add('hidden');
        await this.loadChannels();
      } catch (err) {
        alert('চ্যানেল সেভ করা যায়নি!');
      }
    });

    // Preview Modal Close
    document.getElementById('btn-close-preview-modal').addEventListener('click', () => {
      const video = document.getElementById('admin-preview-player');
      video.pause();
      if (this.previewHls) this.previewHls.destroy();
      document.getElementById('preview-modal').classList.add('hidden');
    });

    // Channel Search
    document.getElementById('channel-search').addEventListener('input', () => this.renderChannelsTable());

    // Playlist Import Form
    document.getElementById('playlist-import-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('input-m3u-url').value.trim();
      const rawContent = document.getElementById('input-m3u-raw').value.trim();
      const replaceExisting = document.getElementById('replace-existing-m3u').checked;

      if (!url && !rawContent) {
        alert('দয়া করে M3U URL অথবা টেক্সট দিন!');
        return;
      }

      try {
        const res = await fetch('/api/playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, rawContent, replaceExisting })
        });
        const json = await res.json();
        alert(json.message);
        if (json.success) {
          await this.loadChannels();
        }
      } catch (err) {
        alert('ইমপোর্ট ব্যর্থ হয়েছে!');
      }
    });

    // M3U URL Copy
    const m3uUrl = `${window.location.origin}/playlist.m3u`;
    document.getElementById('m3u-export-url').value = m3uUrl;
    document.getElementById('btn-copy-m3u').addEventListener('click', () => {
      navigator.clipboard.writeText(m3uUrl);
      alert('M3U প্লেলিস্ট লিংক কপি করা হয়েছে!');
    });
  }

  // 7. Health Scanner
  async runHealthScan() {
    const btn = document.getElementById('btn-quick-scan');
    btn.textContent = '⏳ স্ক্যান হচ্ছে...';
    btn.disabled = true;

    try {
      const res = await fetch('/api/health?auto_scan=1');
      const data = await res.json();
      if (data.success) {
        alert(`স্ক্যান সম্পন্ন! মোট ${data.total_scanned} টি চ্যানেল যাচাই করা হয়েছে।`);
        await this.loadChannels();
      }
    } catch (e) {
      alert('স্ক্যান ব্যর্থ হয়েছে!');
    } finally {
      btn.textContent = '⚡ হেলথ স্ক্যান চালান';
      btn.disabled = false;
    }
  }

  // 8. User Reports
  async loadReports() {
    try {
      const res = await fetch('/api/report');
      const json = await res.json();
      if (json.success) {
        this.reports = json.data;
        this.renderReportsTable();
      }
    } catch (e) {}
  }

  renderReportsTable() {
    const tbody = document.getElementById('reports-table-body');
    tbody.innerHTML = '';
    const pending = this.reports.filter(r => r.status === 'PENDING');
    document.getElementById('stat-pending-reports').textContent = pending.length;

    this.reports.forEach(r => {
      const tr = document.createElement('tr');
      const isPending = r.status === 'PENDING';
      tr.innerHTML = `
        <td>${new Date(r.created_at).toLocaleString('bn-BD')}</td>
        <td><strong>${r.channel_name || 'Unknown'}</strong></td>
        <td>${r.error_message}</td>
        <td><span class="badge ${isPending ? 'badge-pending' : 'badge-online'}">${r.status}</span></td>
        <td>
          ${isPending ? `<button class="btn-secondary-admin btn-resolve">সমাধান চিহ্নিত করুন</button>` : '—'}
        </td>
      `;

      if (isPending) {
        tr.querySelector('.btn-resolve').addEventListener('click', async () => {
          await fetch('/api/report', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: r.id })
          });
          await this.loadReports();
        });
      }

      tbody.appendChild(tr);
    });
  }

  // 9. Customers & Subscriptions
  async loadCustomers() {
    try {
      const res = await fetch('/api/customers');
      const json = await res.json();
      if (json.success) {
        this.customers = json.data;
        this.renderCustomersTable();
      }
    } catch (e) {}
  }

  renderCustomersTable() {
    const tbody = document.getElementById('customers-table-body');
    tbody.innerHTML = '';
    document.getElementById('stat-total-customers').textContent = this.customers.length;

    this.customers.forEach(c => {
      const tr = document.createElement('tr');
      const isBlocked = c.manual_block || c.account_status !== 'ACTIVE';

      tr.innerHTML = `
        <td><strong>${c.customer_code}</strong></td>
        <td>${c.name}</td>
        <td><code>${c.login_pin}</code></td>
        <td>${c.plan || 'Standard'}</td>
        <td>${c.expires_at || '—'}</td>
        <td><span class="badge ${isBlocked ? 'badge-offline' : 'badge-online'}">${c.account_status}</span></td>
        <td>${c.max_devices || 2} টি</td>
        <td>
          <button class="btn-action btn-extend" title="+৩০ দিন মেয়াদ বাড়ান">➕৩০ দিন</button>
          <button class="btn-action btn-delete-cust" title="মুছে ফেলুন">🗑️</button>
        </td>
      `;

      tr.querySelector('.btn-extend').addEventListener('click', async () => {
        await fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_id: c.id, days_to_add: 30 })
        });
        alert('মেয়াদ ৩০ দিন বাড়ানো হয়েছে!');
        await this.loadCustomers();
      });

      tr.querySelector('.btn-delete-cust').addEventListener('click', async () => {
        if (!confirm(`'${c.name}' অ্যাকাউন্টটি মুছে ফেলতে চান?`)) return;
        await fetch(`/api/customers?id=${c.id}`, { method: 'DELETE' });
        await this.loadCustomers();
      });

      tbody.appendChild(tr);
    });
  }

  // 10. Devices
  async loadDevices() {
    try {
      const res = await fetch('/api/devices');
      const json = await res.json();
      if (json.success) {
        this.devices = json.data;
        this.renderDevicesTable();
      }
    } catch (e) {}
  }

  renderDevicesTable() {
    const tbody = document.getElementById('devices-table-body');
    tbody.innerHTML = '';

    this.devices.forEach(d => {
      const tr = document.createElement('tr');
      const isActive = d.status === 'ACTIVE';

      tr.innerHTML = `
        <td>${d.customer_id}</td>
        <td><strong>${d.device_name}</strong></td>
        <td>${d.os} / ${d.browser}</td>
        <td><code>${d.fingerprint.substring(0, 10)}...</code></td>
        <td><span class="badge ${isActive ? 'badge-online' : 'badge-offline'}">${d.status}</span></td>
        <td>${new Date(d.last_active).toLocaleString()}</td>
        <td>
          ${isActive ? `<button class="btn-secondary-admin btn-revoke-dev">বাতিল করুন</button>` : '—'}
        </td>
      `;

      if (isActive) {
        tr.querySelector('.btn-revoke-dev').addEventListener('click', async () => {
          await fetch(`/api/devices?device_id=${d.id}`, { method: 'DELETE' });
          await this.loadDevices();
        });
      }

      tbody.appendChild(tr);
    });
  }

  // 11. Settings & Ads
  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        this.settings = json.data;

        document.getElementById('toggle-sub-restriction').checked = Boolean(this.settings.subscription_restrictions_enabled);
        document.getElementById('toggle-notice-active').checked = Boolean(this.settings.notice_active);

        document.getElementById('setting-notice-text').value = this.settings.notice_text || '';
        document.getElementById('setting-notice-active').checked = Boolean(this.settings.notice_active);

        const ads = this.settings.ads || {};
        if (ads.top) {
          document.getElementById('ad-top-active').checked = Boolean(ads.top.active);
          document.getElementById('ad-top-code').value = ads.top.code || '';
        }
        if (ads.below_player) {
          document.getElementById('ad-below-active').checked = Boolean(ads.below_player.active);
          document.getElementById('ad-below-code').value = ads.below_player.code || '';
        }
        if (ads.infeed) {
          document.getElementById('ad-infeed-active').checked = Boolean(ads.infeed.active);
          document.getElementById('ad-infeed-code').value = ads.infeed.code || '';
        }
        if (ads.footer) {
          document.getElementById('ad-footer-active').checked = Boolean(ads.footer.active);
          document.getElementById('ad-footer-code').value = ads.footer.code || '';
        }
      }
    } catch (e) {}

    // Quick toggle bindings
    document.getElementById('toggle-sub-restriction').addEventListener('change', async (e) => {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_restrictions_enabled: e.target.checked })
      });
      alert('সাবস্ক্রিপশন মোড আপডেট হয়েছে!');
    });

    document.getElementById('toggle-notice-active').addEventListener('change', async (e) => {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice_active: e.target.checked })
      });
    });

    // Save Settings
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
      const newPin = document.getElementById('setting-admin-pin').value.trim();
      const payload = {
        notice_text: document.getElementById('setting-notice-text').value.trim(),
        notice_active: document.getElementById('setting-notice-active').checked
      };
      if (newPin) payload.admin_pin = newPin;

      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert('সেটিংস সফলভাবে সংরক্ষিত হয়েছে!');
    });

    // Save Ads
    document.getElementById('btn-save-ads').addEventListener('click', async () => {
      const ads = {
        top: {
          active: document.getElementById('ad-top-active').checked,
          code: document.getElementById('ad-top-code').value
        },
        below_player: {
          active: document.getElementById('ad-below-active').checked,
          code: document.getElementById('ad-below-code').value
        },
        infeed: {
          active: document.getElementById('ad-infeed-active').checked,
          code: document.getElementById('ad-infeed-code').value
        },
        footer: {
          active: document.getElementById('ad-footer-active').checked,
          code: document.getElementById('ad-footer-code').value
        }
      };

      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ads })
      });
      alert('বিজ্ঞাপন কনফিগারেশন সংরক্ষিত হয়েছে!');
    });
  }

  // 12. App Version & APK
  async loadVersion() {
    try {
      const res = await fetch('/api/version');
      const v = await res.json();
      document.getElementById('ver-code').value = v.versionCode || 100;
      document.getElementById('ver-name').value = v.versionName || '1.0.0';
      document.getElementById('ver-apk-url').value = v.apkUrl || '';
      document.getElementById('ver-title').value = v.updateTitle || '';
      document.getElementById('ver-changelog').value = Array.isArray(v.changelog) ? v.changelog.join('\n') : '';
      document.getElementById('ver-force').checked = Boolean(v.forceUpdate);
    } catch (e) {}

    document.getElementById('version-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        versionCode: Number(document.getElementById('ver-code').value),
        versionName: document.getElementById('ver-name').value.trim(),
        apkUrl: document.getElementById('ver-apk-url').value.trim(),
        updateTitle: document.getElementById('ver-title').value.trim(),
        changelog: document.getElementById('ver-changelog').value.split('\n').filter(Boolean),
        forceUpdate: document.getElementById('ver-force').checked
      };

      await fetch('/api/version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      alert('অ্যাপ ভার্সন আপডেট সফল হয়েছে!');
    });
  }

  updateOverviewStats() {
    document.getElementById('stat-total-channels').textContent = this.channels.length;
    document.getElementById('stat-online-channels').textContent = this.channels.filter(c => c.status === 'ONLINE').length;
    document.getElementById('stat-total-customers').textContent = this.customers.length;
    document.getElementById('stat-pending-reports').textContent = this.reports.filter(r => r.status === 'PENDING').length;
  }
}

// Start Admin on Load
document.addEventListener('DOMContentLoaded', () => {
  window.adminDashboard = new AdminDashboard();
});
