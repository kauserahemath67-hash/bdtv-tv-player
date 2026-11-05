// ==========================================
// BDTv Admin Dashboard Controller
// ==========================================

class AdminDashboard {
  constructor() {
    // Auto-clear expired token on load
    const exp = parseInt(localStorage.getItem('bdtv_admin_token_exp') || '0', 10);
    if (exp && Date.now() > exp) {
      localStorage.removeItem('bdtv_admin_token');
      localStorage.removeItem('bdtv_admin_token_exp');
    }
    this.token = localStorage.getItem('bdtv_admin_token');
    this.channels  = [];
    this.customers = [];
    this.devices   = [];
    this.playlists = [];
    this.settings  = {};
    this.previewHls = null;

    this.init();
  }

  // Central authenticated fetch — always sends admin token
  authFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return fetch(url, { ...options, headers });
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
      const email = (document.getElementById('admin-email-input').value || '').trim();
      const password = (document.getElementById('admin-password-input').value || '').trim();
      const errBox = document.getElementById('login-error');

      try {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (data.success && data.token) {
          this.token = data.token;
          localStorage.setItem('bdtv_admin_token', this.token);
          // Store expiry so we can auto-logout
          if (data.expiresAt) localStorage.setItem('bdtv_admin_token_exp', data.expiresAt);
          this.showDashboard();
        } else {
          errBox.textContent = data.message || 'ভুল ইমেইল বা পাসওয়ার্ড!';
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
    // Initialize AutoDetector
    this._scanResults = {};
    this.autoDetector = new AutoDetector(
      () => this.channels,
      (id, result) => {
        this._scanResults[id] = result;
        // Update badge in DOM without full re-render
        const badge = document.querySelector(`.status-badge[data-chid="${id}"]`);
        if (badge) {
          if (result === 'CHECKING') {
            badge.className = 'badge status-badge badge-checking';
            badge.textContent = '⏳ চেকিং...';
          } else if (result === 'ONLINE') {
            badge.className = 'badge status-badge badge-online';
            badge.textContent = '✅ ONLINE';
          } else {
            // Both OFFLINE and TIMEOUT are rendered as OFFLINE
            badge.className = 'badge status-badge badge-offline';
            badge.textContent = '❌ OFFLINE';
          }
        }
      },
      async (id, finalStatus) => {
        await this.updateChannelStatus(id, finalStatus === 'ONLINE' ? 'ONLINE' : 'OFFLINE');
      },
      (url, opts) => this.authFetch(url, opts),
      async () => {
        await this.loadChannels();
      }
    );
    this.bindAutoDetectorUI();
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

    // Quick scan buttons
    const btnQuickScan = document.getElementById('btn-quick-scan');
    if (btnQuickScan) btnQuickScan.addEventListener('click', () => this.runHealthScan());
    const btnRunHealthScan = document.getElementById('btn-run-health-scan');
    if (btnRunHealthScan) btnRunHealthScan.addEventListener('click', () => this.runHealthScan());
  }

  // 3. Load All Data
  async loadAllData() {
    await Promise.all([
      this.loadChannels(),
      this.loadSettings(),
      this.loadCustomers(),
      this.loadDevices(),
      this.loadActivity(),
      this.loadVersion(),
      this.loadPlaylists()
    ]);
    this.updateOverviewStats();

    // Poll live activity connections every 8s
    if (!this._activityPoller) {
      this._activityPoller = setInterval(() => {
        if (this.token && !document.getElementById('admin-app').classList.contains('hidden')) {
          this.loadActivity();
        }
      }, 8000);
    }
  }

  // 4. Channels Management
  async loadChannels() {
    try {
      // Admin must pass Bearer token so VIP lock does not block channel list
      const res = await this.authFetch('/api/channels');
      if (!res.ok) return;
      const json = await res.json();
      if (json && json.success) {
        this.channels = json.data || [];
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
      tr.dataset.chId = ch.id;
      const isOnline = ch.status === 'ONLINE';
      const scanStatus = this._scanResults && this._scanResults[ch.id];
      let statusBadgeClass = isOnline ? 'badge-online' : 'badge-offline';
      let statusText = isOnline ? '✅ ONLINE' : '❌ OFFLINE';
      if (scanStatus === 'CHECKING') {
        statusBadgeClass = 'badge-checking';
        statusText = '⏳ চেকিং...';
      } else if (scanStatus === 'ONLINE') {
        statusBadgeClass = 'badge-online';
        statusText = '✅ ONLINE';
      } else if (scanStatus === 'OFFLINE' || scanStatus === 'TIMEOUT') {
        statusBadgeClass = 'badge-offline';
        statusText = '❌ OFFLINE';
      }

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
          <span class="badge status-badge ${statusBadgeClass}" title="ক্লিক করে ONLINE/OFFLINE টগল করুন" style="cursor:pointer;" data-chid="${ch.id}" data-status="${ch.status || 'ONLINE'}">
            ${statusText} ${(!scanStatus && ch.response_time_ms) ? `(${ch.response_time_ms}ms)` : ''}
          </span>
        </td>
        <td>
          <button class="btn-action btn-preview" title="লাইভ টেস্ট করুন">▶️</button>
          <button class="btn-action btn-auto-detect" title="স্ট্রিম চেক করুন">🔍</button>
          <button class="btn-action btn-move-up" title="উপরে নিন">⬆️</button>
          <button class="btn-action btn-move-down" title="নিচে নিন">⬇️</button>
          <button class="btn-action btn-edit" title="এডিট">✏️</button>
          <button class="btn-action btn-delete" title="ডিলিট">🗑️</button>
        </td>
      `;

      // Preview Live Stream
      tr.querySelector('.btn-preview').addEventListener('click', () => this.openPreview(ch));

      // Per-channel Auto Detect
      tr.querySelector('.btn-auto-detect').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = '⏳';
        const result = await this.autoDetector.probeChannel(ch);
        btn.disabled = false;
        btn.textContent = '🔍';
        const finalStatus = (result === 'ONLINE') ? 'ONLINE' : 'OFFLINE';
        ch.status = finalStatus;
        ch.manual_override = true;
        if (this._scanResults) {
          this._scanResults[ch.id] = finalStatus;
        }
        const badge = tr.querySelector('.status-badge');
        if (badge) {
          badge.className = `badge status-badge ${finalStatus === 'ONLINE' ? 'badge-online' : 'badge-offline'}`;
          badge.textContent = finalStatus === 'ONLINE' ? '✅ ONLINE' : '❌ OFFLINE';
        }
        const statEl = document.getElementById('stat-online-channels');
        if (statEl) {
          statEl.textContent = this.channels.filter(c => c.status === 'ONLINE').length;
        }
        await this.updateChannelStatus(ch.id, finalStatus);
        this.showToast(`${ch.name}: ${finalStatus === 'ONLINE' ? '✅ ONLINE' : '❌ OFFLINE (টাইমআউট/বন্ধ)'}`, finalStatus === 'ONLINE' ? 'success' : 'info');
      });

      // Clickable status badge to toggle ONLINE/OFFLINE
      tr.querySelector('.status-badge').addEventListener('click', async (e) => {
        e.stopPropagation();
        const badge = e.currentTarget;
        const isCurrentlyOnline = ch.status === 'ONLINE';
        const newStatus = isCurrentlyOnline ? 'OFFLINE' : 'ONLINE';
        
        // Immediate local state update
        ch.status = newStatus;
        ch.manual_override = true;
        if (this._scanResults) {
          this._scanResults[ch.id] = newStatus;
        }

        // Instant DOM update so user sees it right away
        badge.className = `badge status-badge ${newStatus === 'ONLINE' ? 'badge-online' : 'badge-offline'}`;
        badge.textContent = newStatus === 'ONLINE' ? '✅ ONLINE' : '❌ OFFLINE';
        badge.dataset.status = newStatus;

        // Update online channels counter
        const statEl = document.getElementById('stat-online-channels');
        if (statEl) {
          statEl.textContent = this.channels.filter(c => c.status === 'ONLINE').length;
        }

        this.showToast(`${ch.name} স্ট্যাটাস ${newStatus} করা হয়েছে`, 'success');
        await this.updateChannelStatus(ch.id, newStatus);
      });

      // Move Up / Down
      tr.querySelector('.btn-move-up').addEventListener('click', () => this.moveChannelById(ch.id, -1));
      tr.querySelector('.btn-move-down').addEventListener('click', () => this.moveChannelById(ch.id, 1));

      // Edit
      tr.querySelector('.btn-edit').addEventListener('click', () => this.openEditChannel(ch));

      // Delete
      tr.querySelector('.btn-delete').addEventListener('click', () => this.deleteChannel(ch.id, ch.name));

      tbody.appendChild(tr);
    });

    document.getElementById('stat-total-channels').textContent = this.channels.length;
    document.getElementById('stat-online-channels').textContent = this.channels.filter(c => c.status === 'ONLINE').length;
  }

  // Update a single channel's status via API
  async updateChannelStatus(id, newStatus) {
    try {
      await this.authFetch('/api/channels', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: newStatus, manual_override: true })
      });
    } catch (e) {
      console.warn('updateChannelStatus error:', e);
    }
  }

  async moveChannelById(id, delta) {
    const index = this.channels.findIndex(c => c.id === id);
    if (index < 0) return;
    const newIdx = index + delta;
    if (newIdx < 0 || newIdx >= this.channels.length) return;

    const temp = this.channels[index];
    this.channels[index] = this.channels[newIdx];
    this.channels[newIdx] = temp;

    const orderList = this.channels.map((ch, idx) => ({ id: ch.id, order: idx + 1 }));
    try {
      await this.authFetch('/api/channels', {
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
      await this.authFetch(`/api/channels?id=${id}`, { method: 'DELETE' });
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
    const statusSelect = document.getElementById('form-ch-status');
    if (statusSelect) statusSelect.value = ch.status || 'ONLINE';
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

    const cleanUrl = ch.url.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
    if (Hls.isSupported() && cleanUrl.includes('.m3u8')) {
      this.previewHls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 10,
        maxBufferLength: 25,
        maxBufferSize: 60 * 1024 * 1024,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 15000,
        fragLoadingMaxRetry: 6,
        manifestLoadingMaxRetry: 6
      });
      this.previewHls.loadSource(cleanUrl);
      this.previewHls.attachMedia(video);
      this.previewHls.on(Hls.Events.MANIFEST_PARSED, () => {
        statusText.textContent = '✅ লাইভ স্ট্রিম সফলভাবে চলছে!';
        video.play().catch(() => {});
      });
      this.previewHls.on(Hls.Events.ERROR, (event, data) => {
        if (data && data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            try { this.previewHls.startLoad(); } catch (e) {}
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            try { this.previewHls.recoverMediaError(); } catch (e) {}
          } else {
            statusText.textContent = '⚠️ লাইভ স্ট্রিম চালাতে সমস্যা হচ্ছে!';
          }
        }
      });
    } else {
      video.src = cleanUrl;
      video.play().catch(() => {});
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
      const statusSelect = document.getElementById('form-ch-status');
      const existingCh = id ? this.channels.find(c => c.id === id) : null;
      const data = {
        id: id || undefined,
        name: document.getElementById('form-ch-name').value.trim(),
        category: document.getElementById('form-ch-category').value,
        logo: document.getElementById('form-ch-logo').value.trim(),
        url: document.getElementById('form-ch-url').value.trim(),
        status: statusSelect ? statusSelect.value : 'ONLINE',
        is_pinned: document.getElementById('form-ch-pinned').checked,
        manual_override: document.getElementById('form-ch-override').checked,
        order: existingCh && existingCh.order !== undefined ? existingCh.order : undefined
      };

      try {
        await this.authFetch('/api/channels', {
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

    // Customer Modal Bindings
    const btnAddCustomer = document.getElementById('btn-add-customer');
    if (btnAddCustomer) {
      btnAddCustomer.addEventListener('click', () => {
        document.getElementById('customer-modal-title').textContent = 'নতুন গ্রাহক যোগ করুন';
        document.getElementById('customer-form').reset();
        document.getElementById('cust-edit-id').value = '';
        document.getElementById('form-cust-code').value = 'BDTV-' + Math.floor(1000 + Math.random() * 9000);
        document.getElementById('form-cust-pin').value = Math.floor(1000 + Math.random() * 9000);
        const expDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        document.getElementById('form-cust-expiry').value = expDate.toISOString().split('T')[0];
        document.getElementById('customer-modal').classList.remove('hidden');
      });
    }

    const btnCloseCustModal = document.getElementById('btn-close-customer-modal');
    if (btnCloseCustModal) {
      btnCloseCustModal.addEventListener('click', () => {
        document.getElementById('customer-modal').classList.add('hidden');
      });
    }

    const custForm = document.getElementById('customer-form');
    if (custForm) {
      custForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('cust-edit-id').value;
        const payload = {
          id: id || undefined,
          customer_code: document.getElementById('form-cust-code').value.trim(),
          name: document.getElementById('form-cust-name').value.trim(),
          login_pin: document.getElementById('form-cust-pin').value.trim(),
          plan: document.getElementById('form-cust-plan').value.trim() || 'Monthly VIP',
          expires_at: document.getElementById('form-cust-expiry').value,
          max_devices: Number(document.getElementById('form-cust-max-dev').value) || 2,
          manual_block: document.getElementById('form-cust-block').checked,
          block_reason: document.getElementById('form-cust-block-reason').value.trim(),
          account_status: document.getElementById('form-cust-block').checked ? 'SUSPENDED' : 'ACTIVE'
        };

        try {
          const res = await this.authFetch('/api/customers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const json = await res.json();
          if (json.success) {
            document.getElementById('customer-modal').classList.add('hidden');
            alert('গ্রাহক সফলভাবে সংরক্ষণ করা হয়েছে!');
            await this.loadCustomers();
          } else {
            alert(json.message || 'গ্রাহক সংরক্ষণ ব্যর্থ হয়েছে!');
          }
        } catch (err) {
          alert('সার্ভার এরর! গ্রাহক সংরক্ষণ করা যায়নি।');
        }
      });
    }

    // Refresh Activity Button
    const btnRefreshAct = document.getElementById('btn-refresh-activity');
    if (btnRefreshAct) {
      btnRefreshAct.addEventListener('click', () => this.loadActivity());
    }

    // Preview Modal Close
    document.getElementById('btn-close-preview-modal').addEventListener('click', () => {
      const video = document.getElementById('admin-preview-player');
      video.pause();
      if (this.previewHls) this.previewHls.destroy();
      document.getElementById('preview-modal').classList.add('hidden');
    });

    // Channel Search
    document.getElementById('channel-search').addEventListener('input', () => this.renderChannelsTable());

    // Toggle Input Method in Playlist Tab
    const selectMethod = document.getElementById('select-input-method');
    const groupUrl = document.getElementById('group-playlist-url');
    const groupRaw = document.getElementById('group-playlist-raw');

    if (selectMethod) {
      selectMethod.addEventListener('change', () => {
        if (selectMethod.value === 'raw') {
          groupUrl.classList.add('hidden');
          groupRaw.classList.remove('hidden');
        } else {
          groupUrl.classList.remove('hidden');
          groupRaw.classList.add('hidden');
        }
      });
    }

    const diagnoseBox = document.getElementById('diagnose-result-box');
    const diagnoseContent = document.getElementById('diagnose-content');
    const btnCloseDiagnose = document.getElementById('btn-close-diagnose');
    if (btnCloseDiagnose) {
      btnCloseDiagnose.addEventListener('click', () => {
        diagnoseBox.classList.add('hidden');
      });
    }

    // Handler for Test URL & Diagnose
    const runInspection = async (action) => {
      const urlInput = document.getElementById('input-playlist-url');
      const rawInput = document.getElementById('input-playlist-raw');
      const isRaw = selectMethod && selectMethod.value === 'raw';
      const url = urlInput ? urlInput.value.trim() : '';
      const rawContent = rawInput ? rawInput.value.trim() : '';

      if (!isRaw && !url) {
        alert('দয়া করে একটি বৈধ Stream বা Playlist URL লিখুন!');
        return;
      }
      if (isRaw && !rawContent) {
        alert('দয়া করে M3U বা JSON কনটেন্ট পেস্ট করুন!');
        return;
      }

      diagnoseBox.classList.remove('hidden');
      diagnoseContent.innerHTML = `<span style="color:var(--yellow)">⏳ সার্ভার সংযোগ ও স্ট্রিম পরীক্ষা করা হচ্ছে... দয়া করে অপেক্ষা করুন...</span>`;

      try {
        const res = await this.authFetch('/api/playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: action || 'diagnose',
            url: isRaw ? '' : url,
            rawContent: isRaw ? rawContent : ''
          })
        });

        const json = await res.json();
        if (json.success) {
          let samplesHtml = '';
          if (json.sampleChannels && json.sampleChannels.length > 0) {
            samplesHtml = `
              <div style="margin-top: 10px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;">
                <strong style="color:#fff;">নমুনা চ্যানেলসমূহ (${json.sampleChannels.length} টি):</strong>
                <ul style="margin: 6px 0 0 18px; padding: 0;">
                  ${json.sampleChannels.map(c => `<li><strong>${c.name}</strong> (${c.category || 'General'}) - <span style="color:var(--green)">${c.url.substring(0, 45)}...</span></li>`).join('')}
                </ul>
              </div>
            `;
          }

          diagnoseContent.innerHTML = `
            <div style="display:flex; gap:16px; flex-wrap:wrap; margin-bottom:8px;">
              <div>✅ <strong>স্ট্যাটাস:</strong> <span style="color:var(--green)">HTTP ${json.httpStatus || 200} OK</span></div>
              <div>⚡ <strong>রেসপন্স টাইম:</strong> ${json.responseTimeMs || 0} ms</div>
              <div>📁 <strong>শনাক্ত ফরম্যাট:</strong> <span style="color:#ff3b30; font-weight:700;">${json.format}</span></div>
              <div>📺 <strong>পাওয়া গেছে:</strong> <span style="color:var(--green); font-weight:700;">${json.channelCount} টি চ্যানেল</span></div>
            </div>
            <p style="color:#fff;">${json.message}</p>
            ${samplesHtml}
          `;
        } else {
          diagnoseContent.innerHTML = `<span style="color:var(--red)">❌ ত্রুটি: ${json.message || 'সংযোগ স্থাপন ব্যর্থ হয়েছে।'}</span>`;
        }
      } catch (err) {
        diagnoseContent.innerHTML = `<span style="color:var(--red)">❌ ত্রুটি: সার্ভার রিকোয়েস্ট পাঠাতে ব্যর্থ হয়েছে।</span>`;
      }
    };

    const btnTest = document.getElementById('btn-test-url');
    if (btnTest) {
      btnTest.addEventListener('click', () => runInspection('test'));
    }

    const btnDiagnose = document.getElementById('btn-diagnose-url');
    if (btnDiagnose) {
      btnDiagnose.addEventListener('click', () => runInspection('diagnose'));
    }

    // Playlist Import Form Submission
    document.getElementById('playlist-import-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const isRaw = selectMethod && selectMethod.value === 'raw';
      const url = document.getElementById('input-playlist-url').value.trim();
      const rawContent = document.getElementById('input-playlist-raw').value.trim();
      const playlistName = document.getElementById('input-playlist-name').value.trim();
      const replaceExisting = document.getElementById('replace-existing-m3u').checked;

      if (!isRaw && !url) {
        alert('দয়া করে Playlist বা Stream URL লিখুন!');
        return;
      }
      if (isRaw && !rawContent) {
        alert('দয়া করে M3U বা JSON টেক্সট পেস্ট করুন!');
        return;
      }

      const submitBtn = document.getElementById('btn-import-submit');
      submitBtn.textContent = '⏳ ইমপোর্ট হচ্ছে...';
      submitBtn.disabled = true;

      try {
        const res = await this.authFetch('/api/playlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'import',
            url: isRaw ? '' : url,
            rawContent: isRaw ? rawContent : '',
            playlistName,
            replaceExisting
          })
        });

        const json = await res.json();
        alert(json.message);
        if (json.success) {
          // Save playlist metadata to the registry
          await this.authFetch('/api/playlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: playlistName || (isRaw ? 'Raw Import' : url),
              url: isRaw ? '' : url,
              format: json.format || 'AUTO',
              channelCount: json.importedCount || 0,
              active: true
            })
          });
          await this.loadChannels();
          await this.loadPlaylists();
          // Reset form
          document.getElementById('playlist-import-form').reset();
          document.getElementById('group-playlist-url').classList.remove('hidden');
          document.getElementById('group-playlist-raw').classList.add('hidden');
        }
      } catch (err) {
        alert('ইমপোর্ট ব্যর্থ হয়েছে! সার্ভার সংযোগ পরীক্ষা করুন।');
      } finally {
        submitBtn.textContent = '+ প্লেলিস্ট সেভ ও চ্যানেল ইমপোর্ট করুন';
        submitBtn.disabled = false;
      }
    });

    // M3U URL Copy
    const m3uUrl = `${window.location.origin}/playlist.m3u`;
    const exportInput = document.getElementById('m3u-export-url');
    if (exportInput) exportInput.value = m3uUrl;

    const btnCopy = document.getElementById('btn-copy-m3u');
    if (btnCopy) {
      btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(m3uUrl);
        this.showToast('✅ M3U প্লেলিস্ট লিংক কপি করা হয়েছে!', 'success');
      });
    }
  }

  // 7. Saved Playlists

  async loadPlaylists() {
    try {
      let list = [];
      // 1. Try /api/playlists
      const res = await this.authFetch('/api/playlists');
      if (res.ok) {
        const json = await res.json();
        if (json && json.success && Array.isArray(json.data)) list = json.data;
      }
      // 2. Try /api/playlist?action=list fallback
      if (list.length === 0) {
        try {
          const res2 = await this.authFetch('/api/playlist?action=list');
          if (res2.ok) {
            const json2 = await res2.json();
            if (json2 && json2.success && Array.isArray(json2.data)) list = json2.data;
          }
        } catch (_) {}
      }
      // 3. Fallback to settings.playlists
      if (list.length === 0 && this.settings && Array.isArray(this.settings.playlists) && this.settings.playlists.length > 0) {
        list = this.settings.playlists;
      }

      this.playlists = list;
      this.renderPlaylistsList();
    } catch (e) {
      console.warn('loadPlaylists error:', e);
      if (this.settings && Array.isArray(this.settings.playlists)) {
        this.playlists = this.settings.playlists;
        this.renderPlaylistsList();
      }
    }
  }

  renderPlaylistsList() {
    const container = document.getElementById('saved-playlists-list');
    const countEl   = document.getElementById('saved-playlists-count');
    if (!container) return;

    const list = this.playlists || [];
    if (countEl) countEl.textContent = list.length + ' টি প্লেলিস্ট';

    if (list.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:32px 0; color:var(--text-muted);">
          <div style="font-size:40px; margin-bottom:10px;">\u{1F4C2}</div>
          <p>এখনো কোনো প্লেলিস্ট সংরক্ষিত নেই।<br>উপরের ফর্মে URL দিয়ে ইমপোর্ট করুন।</p>
        </div>`;
      return;
    }

    container.innerHTML = list.map(pl => {
      const savedDate = pl.savedAt ? new Date(pl.savedAt).toLocaleString('bn-BD') : '—';
      const displayUrl = pl.url
        ? '<a href="' + pl.url + '" target="_blank" style="color:var(--primary-light); word-break:break-all; font-size:12px;">' + pl.url + '</a>'
        : '<span style="color:var(--text-muted); font-size:12px;">Raw/Manual Import</span>';

      return `
        <div class="playlist-row" id="plrow-${pl.id}" style="
          display:flex; align-items:center; gap:14px; flex-wrap:wrap;
          padding:14px 0; border-bottom:1px solid rgba(255,255,255,0.07);">

          <div style="flex-shrink:0; width:42px; height:42px; border-radius:10px;
            background:linear-gradient(135deg,#0066ff22,#00d2ff22);
            border:1px solid rgba(0,102,255,0.3);
            display:flex; align-items:center; justify-content:center; font-size:20px;">
            \u{1F4CB}
          </div>

          <div style="flex:1; min-width:200px;">
            <div style="font-weight:700; font-size:14px; color:#fff; margin-bottom:4px;">
              ${pl.name || 'অজানা প্লেলিস্ট'}
              <span style="margin-left:8px; font-size:11px; font-weight:500;
                background:rgba(0,210,255,0.15); color:#00d2ff;
                padding:2px 8px; border-radius:10px;">${pl.format || 'AUTO'}</span>
            </div>
            <div style="margin-bottom:3px;">${displayUrl}</div>
            <div style="font-size:11px; color:var(--text-muted);">
              \u{1F4FA} ${pl.channelCount || 0} টি চ্যানেল &nbsp;\u00B7&nbsp; \u{1F550} ${savedDate}
            </div>
          </div>

          <div style="display:flex; gap:8px; flex-shrink:0;">
            <button class="btn-refresh-pl btn-secondary-admin" data-id="${pl.id}" data-url="${encodeURIComponent(pl.url || '')}" data-name="${encodeURIComponent(pl.name || '')}" style="padding:6px 12px; font-size:12px;">
              🔄 রিফ্রেশ
            </button>
            <button class="btn-delete-pl" data-id="${pl.id}" data-name="${encodeURIComponent(pl.name || 'প্লেলিস্ট')}" style="padding:6px 12px; font-size:12px; background:rgba(255,59,48,0.15); border:1px solid rgba(255,59,48,0.4); color:#ff3b30; border-radius:8px; cursor:pointer;">
              🗑 মুছুন
            </button>
          </div>
        </div>`;
    }).join('');

    // Attach event listeners safely without escaping bugs
    container.querySelectorAll('.btn-refresh-pl').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const url = decodeURIComponent(btn.dataset.url || '');
        const name = decodeURIComponent(btn.dataset.name || '');
        this.refreshPlaylist(id, url, name);
      });
    });

    container.querySelectorAll('.btn-delete-pl').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const name = decodeURIComponent(btn.dataset.name || 'প্লেলিস্ট');
        this.deletePlaylist(id, name);
      });
    });
  }

  async deletePlaylist(id, name) {
    if (!confirm('"' + name + '" প্লেলিস্টটি তালিকা থেকে মুছে ফেলবেন?\n(চ্যানেলগুলো অপরিবর্তিত থাকবে)')) return;
    try {
      const res = await this.authFetch('/api/playlists?id=' + encodeURIComponent(id), { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        this.playlists = this.playlists.filter(p => p.id !== id);
        this.renderPlaylistsList();
        this.showToast('প্লেলিস্ট সফলভাবে মুছে ফেলা হয়েছে।', 'success');
      } else {
        this.showToast('মুছতে ব্যর্থ: ' + json.message, 'error');
      }
    } catch (e) {
      this.showToast('সংযোগ সমস্যা!', 'error');
    }
  }

  async refreshPlaylist(id, url, name) {
    if (!url) {
      this.showToast('এই প্লেলিস্টটির কোনো অনলাইন URL নেই।', 'error');
      return;
    }
    const btn = document.querySelector(`.btn-refresh-pl[data-id="${id}"]`);
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ রিফ্রেশ হচ্ছে...';
    }
    try {
      const res = await this.authFetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh', id, url, playlistName: name })
      });
      const json = await res.json();
      if (json.success) {
        this.showToast(json.message || `✅ ${json.updated || 0} টি চ্যানেল আপডেট, ${json.added || 0} টি নতুন যোগ হয়েছে।`, 'success');
        await this.loadChannels();
        await this.loadPlaylists();
      } else {
        this.showToast('রিফ্রেশ ব্যর্থ: ' + (json.message || 'অজানা ত্রুটি'), 'error');
      }
    } catch (e) {
      this.showToast('সার্ভার সংযোগ সমস্যা!', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🔄 রিফ্রেশ';
      }
    }
  }

  // 8. Health Scanner
  // 7. Health Scanner
  async runHealthScan() {
    const btns = [
      document.getElementById('btn-quick-scan'),
      document.getElementById('btn-run-health-scan')
    ].filter(Boolean);
    btns.forEach(b => { b.textContent = '⏳ স্ক্যান হচ্ছে...'; b.disabled = true; });

    try {
      const res = await this.authFetch('/api/health?auto_scan=1');
      const data = await res.json();
      if (data.success) {
        this.showToast(`✅ স্ক্যান সম্পন্ন! মোট ${data.total_scanned} টি চ্যানেল যাচাই করা হয়েছে।`, 'success');
        await this.loadChannels();
      }
    } catch (e) {
      this.showToast('স্ক্যান ব্যর্থ হয়েছে!', 'error');
    } finally {
      btns.forEach(b => {
        b.textContent = '⚡ হেলথ স্ক্যান চালান';
        b.disabled = false;
      });
    }
  }

  // 8b. Auto Detector UI Binding
  bindAutoDetectorUI() {
    const btnStart  = document.getElementById('ad-btn-start');
    const btnPause  = document.getElementById('ad-btn-pause');
    const btnResume = document.getElementById('ad-btn-resume');
    const btnStop   = document.getElementById('ad-btn-stop');
    if (!btnStart) return;

    btnStart.addEventListener('click', () => {
      this._scanResults = {};
      this.autoDetector.start();
    });
    btnPause.addEventListener('click',  () => this.autoDetector.pause());
    btnResume.addEventListener('click', () => this.autoDetector.resume());
    btnStop.addEventListener('click',   () => this.autoDetector.stop());
  }

  // 9. Customers & Subscriptions
  async loadCustomers() {
    try {
      const res = await this.authFetch('/api/customers');
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
          <button class="btn-action btn-edit-cust" title="এডিট">✏️</button>
          <button class="btn-action btn-extend" title="+৩০ দিন মেয়াদ বাড়ান">➕৩০ দিন</button>
          <button class="btn-action btn-delete-cust" title="মুছে ফেলুন">🗑️</button>
        </td>
      `;

      tr.querySelector('.btn-edit-cust').addEventListener('click', () => {
        document.getElementById('customer-modal-title').textContent = 'গ্রাহক তথ্য পরিবর্তন করুন';
        document.getElementById('cust-edit-id').value = c.id;
        document.getElementById('form-cust-code').value = c.customer_code || '';
        document.getElementById('form-cust-name').value = c.name || '';
        document.getElementById('form-cust-pin').value = c.login_pin || '';
        document.getElementById('form-cust-plan').value = c.plan || 'Monthly VIP';
        document.getElementById('form-cust-expiry').value = c.expires_at || '';
        document.getElementById('form-cust-max-dev').value = c.max_devices || 2;
        document.getElementById('form-cust-block').checked = Boolean(c.manual_block);
        document.getElementById('form-cust-block-reason').value = c.block_reason || '';
        document.getElementById('customer-modal').classList.remove('hidden');
      });

      tr.querySelector('.btn-extend').addEventListener('click', async () => {
        const btn = tr.querySelector('.btn-extend');
        btn.disabled = true;
        btn.textContent = '⏳...';
        try {
          const res = await this.authFetch('/api/subscriptions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customer_id: c.id, days_to_add: 30 })
          });
          const json = await res.json();
          if (json.success) {
            this.showToast(`✅ ${c.name} — মেয়াদ ৩০ দিন বাড়ানো হয়েছে! নতুন মেয়াদ: ${json.new_expiry}`, 'success');
            await this.loadCustomers();
          } else {
            this.showToast(`❌ ত্রুটি: ${json.message || 'মেয়াদ বাড়ানো যায়নি।'}`, 'error');
            btn.disabled = false;
            btn.textContent = '➕৩০ দিন';
          }
        } catch (err) {
          this.showToast('❌ নেটর্঵ার্ক ত্রুটি। পুনরায় চেষ্টা করুন।', 'error');
          btn.disabled = false;
          btn.textContent = '➕৩০ দিন';
        }
      });;

      tr.querySelector('.btn-delete-cust').addEventListener('click', async () => {
        if (!confirm(`'${c.name}' অ্যাকাউন্টটি মুছে ফেলতে চান?`)) return;
        await this.authFetch(`/api/customers?id=${c.id}`, { method: 'DELETE' });
        await this.loadCustomers();
      });

      tbody.appendChild(tr);
    });
  }

  // Real-Time Active Connections & Analytics
  async loadActivity() {
    try {
      const res = await this.authFetch('/api/activity');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        this.renderActivityTable(json.data);
      }
    } catch (e) {
      console.warn('Could not load activity:', e);
    }
  }

  renderActivityTable(activities) {
    const tbody = document.getElementById('activity-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!activities || activities.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:18px; color:#94A3B8;">কোনো সক্রিয় কানেকশন নেই।</td></tr>';
      return;
    }

    activities.forEach(item => {
      const tr = document.createElement('tr');
      const secondsAgo = Math.max(1, Math.round((Date.now() - (item.last_ping || Date.now())) / 1000));
      const timeStr = secondsAgo < 60 ? `${secondsAgo} সেকেন্ড আগে` : `${Math.round(secondsAgo / 60)} মিনিট আগে`;

      let uaLabel = item.user_agent;
      if (item.user_agent.includes('BDTv-Android-App') || item.user_agent.includes('BDTv-App')) {
        uaLabel = '📱 BDTv Android App';
      } else if (item.user_agent.includes('Android')) {
        uaLabel = '📱 Android TV / Mobile';
      } else if (item.user_agent.includes('Windows')) {
        uaLabel = '💻 Windows PC';
      } else if (item.user_agent.includes('Macintosh')) {
        uaLabel = '💻 macOS';
      } else if (item.user_agent.includes('iPhone') || item.user_agent.includes('iPad')) {
        uaLabel = '📱 iOS Device';
      }

      tr.innerHTML = `
        <td><strong><code>${item.ip}</code></strong></td>
        <td><span title="${item.user_agent}">${uaLabel}</span></td>
        <td><span class="badge badge-online">📺 ${item.channel_name || 'Live'}</span></td>
        <td><code style="font-size:11px; max-width:240px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${item.stream_url}">${item.stream_url}</code></td>
        <td><strong>${item.customer_code || 'Guest'}</strong></td>
        <td>${timeStr}</td>
        <td><span class="badge badge-online" style="background:#059669; color:#fff;">🟢 LIVE</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 10. Devices
  async loadDevices() {
    try {
      const res = await this.authFetch('/api/devices');
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

    if (!this.devices || this.devices.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:18px; color:#94A3B8;">কোনো নিবন্ধিত ডিভাইস পাওয়া যায়নি।</td></tr>`;
      return;
    }

    this.devices.forEach(d => {
      const tr = document.createElement('tr');
      const isBlocked = d.status === 'BLOCKED';

      tr.innerHTML = `
        <td>${d.customer_code || d.customer_id}</td>
        <td><strong>${d.device_name}</strong></td>
        <td>${d.os} / ${d.browser}</td>
        <td><code>${d.fingerprint.substring(0, 10)}...</code></td>
        <td>
          <span class="badge ${isBlocked ? 'badge-offline' : 'badge-online'}" 
                style="cursor:pointer; user-select:none;" 
                title="${isBlocked ? 'ক্লিক করে আনব্লক (Unblock) করুন' : 'ক্লিক করে ব্লক (Block) করুন'}">
            ${isBlocked ? '🚫 BLOCKED (আনব্লক)' : '✅ ACTIVE (ব্লক)'}
          </span>
        </td>
        <td>${d.last_active ? new Date(d.last_active).toLocaleString() : '—'}</td>
        <td>
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <button class="btn-toggle-dev" style="padding:6px 14px; font-size:12px; border-radius:6px; border:1px solid ${isBlocked ? '#22c55e' : '#f59e0b'}; background:${isBlocked ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)'}; color:${isBlocked ? '#22c55e' : '#f59e0b'}; cursor:pointer; font-weight:600; white-space:nowrap;">
              ${isBlocked ? '🔓 আনব্লক' : '🚫 ব্লক'}
            </button>
            <button class="btn-delete-dev" title="ডিভাইস মুছে ফেলুন" style="padding:6px 10px; font-size:14px; border-radius:6px; border:1px solid #ef4444; background:rgba(239,68,68,0.15); color:#ef4444; cursor:pointer;">
              🗑️
            </button>
          </div>
        </td>
      `;

      // Status Badge Click -> Toggle Block/Unblock
      const badge = tr.querySelector('.badge');
      const toggleBtn = tr.querySelector('.btn-toggle-dev');
      const deleteBtn = tr.querySelector('.btn-delete-dev');

      const toggleAction = async () => {
        const newAction = isBlocked ? 'unblock' : 'block';
        try {
          const res = await this.authFetch('/api/devices', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ device_id: d.id, action: newAction })
          });
          const json = await res.json();
          this.showToast(json.message || (isBlocked ? 'ডিভাইস আনব্লক করা হয়েছে!' : 'ডিভাইস ব্লক করা হয়েছে!'));
          await this.loadDevices();
        } catch (err) {
          this.showToast('সার্ভার এরর! স্ট্যাটাস পরিবর্তন করা যায়নি।');
        }
      };

      badge.addEventListener('click', toggleAction);
      toggleBtn.addEventListener('click', toggleAction);

      // Delete Device Click
      deleteBtn.addEventListener('click', async () => {
        try {
          const res = await this.authFetch(`/api/devices?device_id=${d.id}&action=delete`, { method: 'DELETE' });
          const json = await res.json();
          this.showToast(json.message || 'ডিভাইস মুছে ফেলা হয়েছে!');
          await this.loadDevices();
        } catch (err) {
          this.showToast('ডিভাইস মুছতে সমস্যা হয়েছে!');
        }
      });

      tbody.appendChild(tr);
    });
  }

  // Real-Time Active Connections & Analytics
  async loadActivity() {
    try {
      const res = await this.authFetch('/api/activity');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        this.renderActivityTable(json.data);
      }
    } catch (e) {
      console.warn('Could not load activity:', e);
    }
  }

  renderActivityTable(activities) {
    const tbody = document.getElementById('activity-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!activities || activities.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:18px; color:#94A3B8;">কোনো সক্রিয় কানেকশন নেই।</td></tr>';
      return;
    }

    activities.forEach(item => {
      const tr = document.createElement('tr');
      const secondsAgo = Math.max(1, Math.round((Date.now() - (item.last_ping || Date.now())) / 1000));
      const timeStr = secondsAgo < 60 ? `${secondsAgo} সেকেন্ড আগে` : `${Math.round(secondsAgo / 60)} মিনিট আগে`;

      let uaLabel = item.user_agent;
      if (item.user_agent.includes('BDTv-Android-App') || item.user_agent.includes('BDTv-App')) {
        uaLabel = '📱 BDTv Android App';
      } else if (item.user_agent.includes('Android')) {
        uaLabel = '📱 Android TV / Mobile';
      } else if (item.user_agent.includes('Windows')) {
        uaLabel = '💻 Windows PC';
      } else if (item.user_agent.includes('Macintosh')) {
        uaLabel = '💻 macOS';
      } else if (item.user_agent.includes('iPhone') || item.user_agent.includes('iPad')) {
        uaLabel = '📱 iOS Device';
      }

      tr.innerHTML = `
        <td><strong><code>${item.ip}</code></strong></td>
        <td><span title="${item.user_agent}">${uaLabel}</span></td>
        <td><span class="badge badge-online">📺 ${item.channel_name || 'Live'}</span></td>
        <td><code style="font-size:11px; max-width:240px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${item.stream_url}">${item.stream_url}</code></td>
        <td><strong>${item.customer_code || 'Guest'}</strong></td>
        <td>${timeStr}</td>
        <td><span class="badge badge-online" style="background:#059669; color:#fff;">🟢 LIVE</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  // 11. Settings & Ads
  async loadSettings() {
    try {
      const res = await this.authFetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        this.settings = json.data;

        // If playlists list is still empty, populate from settings.playlists
        if ((!this.playlists || this.playlists.length === 0) && Array.isArray(this.settings.playlists) && this.settings.playlists.length > 0) {
          this.playlists = this.settings.playlists;
          this.renderPlaylistsList();
        }

        document.getElementById('toggle-sub-restriction').checked = Boolean(this.settings.subscription_restrictions_enabled);
        document.getElementById('toggle-notice-active').checked = Boolean(this.settings.notice_active);

        document.getElementById('setting-notice-text').value = this.settings.notice_text || '';
        document.getElementById('setting-notice-active').checked = Boolean(this.settings.notice_active);

        if (this.settings.admin_email) {
          const emailInput = document.getElementById('setting-admin-email');
          if (emailInput) emailInput.value = this.settings.admin_email;
        }

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
      await this.authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_restrictions_enabled: e.target.checked })
      });
      alert('সাবস্ক্রিপশন মোড আপডেট হয়েছে!');
    });

    document.getElementById('toggle-notice-active').addEventListener('change', async (e) => {
      await this.authFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notice_active: e.target.checked })
      });
    });

    // Save Settings
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
      const email = (document.getElementById('setting-admin-email').value || '').trim();
      const password = (document.getElementById('setting-admin-password').value || '').trim();
      const payload = {
        notice_text: document.getElementById('setting-notice-text').value.trim(),
        notice_active: document.getElementById('setting-notice-active').checked
      };
      if (email) payload.admin_email = email;
      if (password) {
        payload.admin_password = password;
        payload.admin_pin = password;
      }

      try {
        const res = await this.authFetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json = await res.json();
        if (json.success) {
          alert('জিমেইল ও পাসওয়ার্ড সফলভাবে সংরক্ষিত হয়েছে!');
          document.getElementById('setting-admin-password').value = '';
        } else {
          alert('সেভ ব্যর্থ: ' + (json.error || json.message));
        }
      } catch (err) {
        alert('সার্ভার এরর!');
      }
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

      await this.authFetch('/api/settings', {
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
      const res = await this.authFetch('/api/version');
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

      await this.authFetch('/api/version', {
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
  }

  showToast(message, type = 'info') {
    // Remove existing toast if any
    const existing = document.getElementById('admin-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'admin-toast';
    const colors = {
      success: 'rgba(52,199,89,0.15)',
      error:   'rgba(255,59,48,0.15)',
      info:    'rgba(10,132,255,0.15)'
    };
    const borders = {
      success: 'rgba(52,199,89,0.5)',
      error:   'rgba(255,59,48,0.5)',
      info:    'rgba(10,132,255,0.5)'
    };
    toast.style.cssText = `
      position: fixed; bottom: 28px; right: 28px; z-index: 9999;
      background: ${colors[type] || colors.info};
      border: 1px solid ${borders[type] || borders.info};
      color: #fff; padding: 14px 22px; border-radius: 12px;
      font-size: 14px; font-weight: 500; max-width: 400px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.4);
      backdrop-filter: blur(12px); opacity: 0;
      transition: opacity 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.opacity = '1'; });
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

}

// Start Admin on Load
document.addEventListener('DOMContentLoaded', () => {
  window.adminDashboard = new AdminDashboard();
});

// ==========================================
// AutoDetector — Client-side HLS Stream Health Checker
// ==========================================
class AutoDetector {
  constructor(getChannels, onProgress, onSave, authFetch, onComplete) {
    this.getChannels = getChannels; // () => channels array
    this.onProgress  = onProgress;  // (id, 'CHECKING'|'ONLINE'|'OFFLINE'|'TIMEOUT') => void
    this.onSave      = onSave;      // (id, finalStatus) => Promise
    this.authFetch   = authFetch;   // Authenticated fetch function
    this.onComplete  = onComplete;  // Callback when scan completes
    this.status      = 'IDLE';      // IDLE | RUNNING | PAUSED | STOPPED | DONE
    this._paused     = false;
    this._stopped    = false;
    this._pauseResolve = null;
    this.counters    = { total: 0, done: 0, online: 0, offline: 0, timeout: 0 };
    this._logLines   = [];
  }

  _log(icon, msg) {
    this._logLines.unshift(`${icon} ${msg}`);
    if (this._logLines.length > 200) this._logLines.pop();
    const box = document.getElementById('ad-log-box');
    if (box) box.innerHTML = this._logLines.map(l => `<div>${l}</div>`).join('');
  }

  _updateUI() {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('ad-count-total',   this.counters.total);
    set('ad-count-done',    this.counters.done);
    set('ad-count-online',  this.counters.online);
    set('ad-count-offline', this.counters.offline);
    set('ad-count-timeout', this.counters.timeout);

    const progressBar = document.getElementById('ad-progress-bar');
    if (progressBar && this.counters.total > 0) {
      progressBar.style.width = Math.round(this.counters.done / this.counters.total * 100) + '%';
    }

    const btnStart  = document.getElementById('ad-btn-start');
    const btnPause  = document.getElementById('ad-btn-pause');
    const btnResume = document.getElementById('ad-btn-resume');
    const btnStop   = document.getElementById('ad-btn-stop');
    if (!btnStart) return;

    const s = this.status;
    btnStart.disabled  = (s === 'RUNNING' || s === 'PAUSED');
    btnPause.disabled  = (s !== 'RUNNING');
    btnResume.disabled = (s !== 'PAUSED');
    btnStop.disabled   = (s === 'IDLE' || s === 'DONE' || s === 'STOPPED');

    const statusEl = document.getElementById('ad-status-text');
    if (statusEl) {
      const map = { IDLE:'💤 প্রস্তুত', RUNNING:'🔄 স্ক্যান চলছে...', PAUSED:'⏸ বিরতি', STOPPED:'⏹ বন্ধ', DONE:'✅ সম্পন্ন' };
      statusEl.textContent = map[s] || s;
    }
  }

  async probeChannel(ch, timeoutMs = 6000) {
    if (!ch || !ch.url) return 'OFFLINE';

    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;top:-9999px';
      document.body.appendChild(video);

      let settled = false;
      let hlsInstance = null;

      const done = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          video.pause();
          video.removeAttribute('src');
          video.load();
        } catch (_) {}
        if (hlsInstance) { try { hlsInstance.destroy(); } catch (_) {} }
        if (video.parentNode) { video.parentNode.removeChild(video); }
        resolve(result);
      };

      const timer = setTimeout(() => done('TIMEOUT'), timeoutMs);

      const tryNative = () => {
        video.src = ch.url;
        video.addEventListener('loadeddata', () => done('ONLINE'), { once: true });
        video.addEventListener('canplay',    () => done('ONLINE'), { once: true });
        video.addEventListener('playing',    () => done('ONLINE'), { once: true });
        video.addEventListener('error',      () => done('OFFLINE'), { once: true });
        video.play().catch(() => {});
      };

      if (ch.url.includes('.m3u8') && typeof Hls !== 'undefined' && Hls.isSupported()) {
        try {
          hlsInstance = new Hls({
            enableWorker: false,
            debug: false,
            manifestLoadingTimeOut: timeoutMs,
            manifestLoadingMaxRetry: 1
          });
          hlsInstance.loadSource(ch.url);
          hlsInstance.attachMedia(video);

          // Fast detection: if manifest parsed or level loaded, it's definitely ONLINE!
          hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => done('ONLINE'));
          hlsInstance.on(Hls.Events.LEVEL_LOADED, () => done('ONLINE'));
          hlsInstance.on(Hls.Events.ERROR, (evt, data) => {
            if (data && data.fatal) done('OFFLINE');
          });

          video.addEventListener('loadeddata', () => done('ONLINE'), { once: true });
          video.addEventListener('canplay',    () => done('ONLINE'), { once: true });
          video.addEventListener('playing',    () => done('ONLINE'), { once: true });
          video.addEventListener('error',      () => done('OFFLINE'), { once: true });
        } catch (_) {
          tryNative();
        }
      } else {
        tryNative();
      }
    });
  }

  _waitIfPaused() {
    if (!this._paused) return Promise.resolve();
    return new Promise(resolve => { this._pauseResolve = resolve; });
  }

  async start() {
    if (this.status === 'RUNNING') return;
    this._stopped = false;
    this._paused  = false;
    this.status   = 'RUNNING';
    this._logLines = [];
    const channels = this.getChannels();
    this.counters  = { total: channels.length, done: 0, online: 0, offline: 0, timeout: 0 };
    this._updateUI();

    this._log('🚀', `স্ক্যান শুরু হয়েছে — মোট ${channels.length} টি চ্যানেল`);

    const changedUpdates = [];

    const flushUpdates = async () => {
      if (changedUpdates.length === 0) return;
      const toSend = [...changedUpdates];
      changedUpdates.length = 0;
      this._log('💾', `${toSend.length} টি পরিবর্তিত চ্যানেলের স্ট্যাটাস ক্লাউডে সেভ হচ্ছে...`);
      try {
        const fetcher = this.authFetch || (window.adminApp ? window.adminApp.authFetch.bind(window.adminApp) : fetch);
        const res = await fetcher('/api/channels', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batchUpdates: toSend })
        });
        const json = await res.json();
        if (json.success) {
          this._log('☁️', 'ডাটাবেস সফলভাবে আপডেট হয়েছে!');
        } else {
          this._log('⚠️', 'ডাটাবেস সেভ ব্যর্থ: ' + (json.message || ''));
        }
      } catch (err) {
        this._log('⚠️', 'ডাটাবেস সেভ করতে সমস্যা হয়েছে: ' + err.message);
      }
    };

    for (let i = 0; i < channels.length; i++) {
      if (this._stopped) break;
      await this._waitIfPaused();
      if (this._stopped) break;

      const ch = channels[i];

      // CRITICAL: If channel is ALREADY marked OFFLINE:
      // NEVER automatically turn it back ONLINE! It stays locked as OFFLINE.
      // Admin must manually click the badge or edit the channel if they want to reactivate it.
      if (ch.status === 'OFFLINE') {
        this.counters.done++;
        this.counters.offline++;
        this._log('🔒', `[${i+1}/${channels.length}] ${ch.name} — অফলাইন (লকড: এডমিন ম্যানুয়ালি অন না করা পর্যন্ত অফলাইন থাকবে)`);
        this.onProgress(ch.id, 'OFFLINE');
        this._updateUI();
        continue;
      }

      this._log('⏳', `[${i+1}/${channels.length}] চেক করছি: ${ch.name}`);
      this.onProgress(ch.id, 'CHECKING');
      this._updateUI();

      const result = await this.probeChannel(ch);
      this.counters.done++;

      const isOnline = (result === 'ONLINE');
      const finalStatus = isOnline ? 'ONLINE' : 'OFFLINE';

      if (isOnline) {
        this.counters.online++;
        this._log('✅', `ONLINE — ${ch.name}`);
      } else {
        // Both OFFLINE and TIMEOUT are strictly OFFLINE!
        this.counters.offline++;
        if (result === 'TIMEOUT') {
          this.counters.timeout++;
          this._log('⏱❌', `TIMEOUT — ${ch.name} (অফলাইন হিসেবে চিহ্নিত)`);
        } else {
          this._log('❌', `OFFLINE — ${ch.name}`);
        }
      }

      // Always pass finalStatus ('ONLINE' or 'OFFLINE') so badge turns red ❌ OFFLINE immediately
      this.onProgress(ch.id, finalStatus);

      if (ch.status !== finalStatus) {
        ch.status = finalStatus;
        changedUpdates.push({ id: ch.id, status: finalStatus, manual_override: true });
      }

      this._updateUI();

      // Auto-flush every 3 channel changes so changes are saved to cloud immediately
      if (changedUpdates.length >= 3) {
        await flushUpdates();
      }

      // Small inter-channel delay so browser stays smooth
      await new Promise(r => setTimeout(r, 200));
    }

    // Flush any remaining updates
    if (changedUpdates.length > 0) {
      await flushUpdates();
    }

    if (!this._stopped) {
      this.status = 'DONE';
      this._log('🏁', `স্ক্যান সম্পন্ন! Online: ${this.counters.online} | Offline: ${this.counters.offline} | Timeout: ${this.counters.timeout}`);
    } else {
      this.status = 'STOPPED';
      this._log('⏹', 'ব্যবহারকারী স্ক্যান বন্ধ করেছেন।');
    }
    this._updateUI();

    if (this.onComplete) {
      try { await this.onComplete(); } catch (e) {}
    }
  }

  pause() {
    if (this.status !== 'RUNNING') return;
    this._paused = true;
    this.status  = 'PAUSED';
    this._log('⏸', 'স্ক্যান বিরতিতে রাখা হয়েছে।');
    this._updateUI();
  }

  resume() {
    if (this.status !== 'PAUSED') return;
    this._paused = false;
    this.status  = 'RUNNING';
    this._log('▶️', 'স্ক্যান পুনরায় শুরু হয়েছে।');
    if (this._pauseResolve) { this._pauseResolve(); this._pauseResolve = null; }
    this._updateUI();
  }

  stop() {
    this._stopped = true;
    this._paused  = false;
    if (this._pauseResolve) { this._pauseResolve(); this._pauseResolve = null; }
    this.status = 'STOPPED';
    this._log('⏹', 'স্ক্যান থামানো হয়েছে।');
    this._updateUI();
  }
}
