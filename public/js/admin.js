// ==========================================
// BDTv Admin Dashboard Controller
// ==========================================

class AdminDashboard {
  constructor() {
    this.token = localStorage.getItem('bdtv_admin_token');
    this.channels  = [];
    this.customers = [];
    this.devices   = [];
    this.playlists = [];
    this.settings  = {};
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
      const headers = {};
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
      const res = await fetch('/api/channels', { headers });
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
          const res = await fetch('/api/customers', {
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
        const res = await fetch('/api/playlist', {
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
        const res = await fetch('/api/playlist', {
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
          await fetch('/api/playlists', {
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
        alert('M3U প্লেলিস্ট লিংক কপি করা হয়েছে!');
      });
    }
  }

  // 7. Saved Playlists

  async loadPlaylists() {
    try {
      const res = await fetch('/api/playlists');
      if (!res.ok) return;
      const json = await res.json();
      if (json && json.success) {
        this.playlists = json.data || [];
        this.renderPlaylistsList();
      }
    } catch (e) {
      console.warn('loadPlaylists error:', e);
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
            <button class="btn-reimport-pl btn-secondary-admin" data-id="${pl.id}" data-url="${encodeURIComponent(pl.url || '')}" data-name="${encodeURIComponent(pl.name || '')}" style="padding:6px 12px; font-size:12px;">
              🔄 রি-ইমপোর্ট
            </button>
            <button class="btn-delete-pl" data-id="${pl.id}" data-name="${encodeURIComponent(pl.name || 'প্লেলিস্ট')}" style="padding:6px 12px; font-size:12px; background:rgba(255,59,48,0.15); border:1px solid rgba(255,59,48,0.4); color:#ff3b30; border-radius:8px; cursor:pointer;">
              🗑 মুছুন
            </button>
          </div>
        </div>`;
    }).join('');

    // Attach event listeners safely without escaping bugs
    container.querySelectorAll('.btn-reimport-pl').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const url = decodeURIComponent(btn.dataset.url || '');
        const name = decodeURIComponent(btn.dataset.name || '');
        this.reimportPlaylist(id, url, name);
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
      const res = await fetch('/api/playlists?id=' + encodeURIComponent(id), { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        this.playlists = this.playlists.filter(p => p.id !== id);
        this.renderPlaylistsList();
      } else {
        alert('মুছতে ব্যর্থ: ' + json.message);
      }
    } catch (e) {
      alert('সংযোগ সমস্যা!');
    }
  }

  async reimportPlaylist(id, url, name) {
    if (!url) { alert('এই প্লেলিস্টটির URL নেই (Manual Import)।'); return; }
    if (!confirm('"'  + name + '" আবার ইমপোর্ট করবেন?\nনতুন চ্যানেলগুলো বিদ্যমান তালিকায় যোগ হবে।')) return;
    try {
      const res = await fetch('/api/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', url, playlistName: name, replaceExisting: false })
      });
      const json = await res.json();
      alert(json.message);
      if (json.success) {
        await fetch('/api/playlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name, url, format: json.format, channelCount: json.importedCount, active: true })
        });
        await this.loadChannels();
        await this.loadPlaylists();
      }
    } catch (e) {
      alert('রি-ইমপোর্ট ব্যর্থ হয়েছে।');
    }
  }

  // 8. Health Scanner
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

  // Real-Time Active Connections & Analytics
  async loadActivity() {
    try {
      const res = await fetch('/api/activity');
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

  // Real-Time Active Connections & Analytics
  async loadActivity() {
    try {
      const res = await fetch('/api/activity');
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
      const res = await fetch('/api/settings');
      const json = await res.json();
      if (json.success) {
        this.settings = json.data;

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
        const res = await fetch('/api/settings', {
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
  }
}

// Start Admin on Load
document.addEventListener('DOMContentLoaded', () => {
  window.adminDashboard = new AdminDashboard();
});
