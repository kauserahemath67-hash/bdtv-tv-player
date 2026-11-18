// ==========================================
// BDTv Live IPTV Web Player Engine
// ==========================================

const INSTALLED_APP_VERSION = 123;
const DEFAULT_TV_LOGO = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 60 60'%3E%3Crect width='60' height='60' rx='12' fill='%231e293b'/%3E%3Ctext x='50%25' y='54%25' font-size='13' font-weight='bold' fill='%2394a3b8' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif'%3ETV%3C/text%3E%3C/svg%3E";

const FALLBACK_CHANNELS = [
  {
    id: "fb-1",
    name: "Al Jazeera English (Demo)",
    category: "International",
    logo: "https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Al_Jazeera_English_logo.svg/300px-Al_Jazeera_English_logo.svg.png",
    url: "https://live-hls-web-aje.getaj.net/AJE/03.m3u8"
  },
  {
    id: "fb-2",
    name: "NHK World Japan (Demo)",
    category: "International",
    logo: "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/NHK_World-Japan_logo.svg/300px-NHK_World-Japan_logo.svg.png",
    url: "https://b-nhkworld.akamaized.net/hls/live/2014412/nhkworld/playlist_720.m3u8"
  },
  {
    id: "fb-3",
    name: "Bangladesh Betar (Demo)",
    category: "Music & Radio",
    logo: "https://upload.wikimedia.org/wikipedia/en/thumb/1/15/Bangladesh_Betar_Logo.svg/300px-Bangladesh_Betar_Logo.svg.png",
    url: "https://betarlive.teletalk.com.bd/live/betar.m3u8"
  }
];

class IPTVPlayer {
  constructor() {
    this.video = document.getElementById('player');
    this.topBar = document.getElementById('top-bar');
    this.channelDrawer = document.getElementById('channel-drawer');
    this.drawerHandle = document.getElementById('drawer-handle');
    this.channelGrid = document.getElementById('channel-list');
    this.categoryBar = document.getElementById('category-bar');
    this.hud = document.getElementById('channel-hud');
    this.errorToast = document.getElementById('error-toast');
    this.errorToastTitle = document.getElementById('error-toast-title');
    this.errorToastTimeout = null;
    this.noticeBar = document.getElementById('notice-bar');
    this.noticeText = document.getElementById('notice-text');
    this.authModal = document.getElementById('auth-modal');

    this.channels = [];
    this.filteredChannels = [];
    this.currentCategory = 'All';
    this.currentIndex = -1;
    this.focusedIndex = 0;
    this.updateModalFocusIndex = 0;
    this.authModalFocusIndex = 0;
    this.hls = null;
    this.topBarTimeout = null;
    this.hudTimeout = null;
    this.isDrawerOpen = false;
    this.drawerAutoHideTimeout = null;
    this.isUserUnmuted = false;
    this.settings = {};
    this.useNativePlayer = false;
    this.currentPlayPath = 1;
    this.chainRetryCount = 0;
    this.lastDiagnostic = '';
    this.webWatchdog = null;

    this.init();
  }

  async init() {
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (bridge && typeof bridge.playNativeStream === 'function') {
      document.body.classList.add('native-player');
      this.useNativePlayer = true;
      console.log('[NativeEngine] Native ExoPlayer Media3 engine activated');
    }

    this.bindVideoEvents();
    this.bindEvents();
    this.bindRemoteKeys();
    this.bindTouchGestures();
    this.bindAudioUnlock();
    await this.autoRestoreSessionFromDevice();
    await this.loadSettings();
    await this.loadChannels();

    // Reload settings (Notice bar, VIP status) every 60 seconds
    setInterval(() => this.loadSettings(), 60 * 1000);

    // Real-time activity heartbeat every 25 seconds
    setInterval(() => this.sendHeartbeat(), 25000);

    // Subscription + device block watcher — check every 30 seconds during playback
    setInterval(() => this.checkSubscriptionLive(), 30 * 1000);
  }

  // Auto-restore customer session if device hardware ID is already registered
  async autoRestoreSessionFromDevice() {
    const custCode = localStorage.getItem('bdtv_cust_code');
    if (custCode && custCode.trim().length > 0) return;

    try {
      const devId = this.getDeviceId();
      if (!devId) return;

      const res = await fetch(`/api/devices?fingerprint=${encodeURIComponent(devId)}&_t=${Date.now()}`);
      if (!res.ok) return;
      const json = await res.json();
      if (json && json.success && json.registered && json.customer_code) {
        localStorage.setItem('bdtv_cust_code', json.customer_code);
        if (json.pin) localStorage.setItem('bdtv_cust_pin', json.pin);
      }
    } catch (e) {}
  }

  // 1. Load Settings (Notice, Ads, Subscription switch)
  async loadSettings() {
    try {
      const res = await fetch('/api/settings?_t=' + Date.now(), { cache: 'no-store' });
      const data = await res.json();
      if (data && data.success && data.data) {
        this.settings = data.data;

        // Notice Bar (Announcement)
        if (this.noticeBar && this.noticeText) {
          if (this.settings.notice_active && this.settings.notice_text) {
            this.noticeText.textContent = this.settings.notice_text;
            this.noticeBar.classList.remove('hidden');
          } else {
            this.noticeBar.classList.add('hidden');
          }
        }

        // Ads Injection
        this.renderAds(this.settings.ads || {});

        // VIP Subscription Restriction Check
        if (this.settings.subscription_restrictions_enabled) {
          const hasAccess = this.checkSubscriptionAccess();
          if (!hasAccess) {
            this.showVipLockModal();
          }
        } else {
          // If VIP mode was turned off by admin, close lock modal
          if (this.authModal && !this.authModal.classList.contains('hidden')) {
            this.authModal.classList.add('hidden');
          }
        }
      }
    } catch (e) {
      console.warn('Could not load settings:', e);
    }
  }

  renderAds(ads) {
    if (ads.top && ads.top.active) {
      const slot = document.getElementById('ad-top-slot');
      slot.innerHTML = ads.top.code;
      slot.classList.remove('hidden');
    }
    if (ads.below_player && ads.below_player.active) {
      const slot = document.getElementById('ad-below-slot');
      slot.innerHTML = ads.below_player.code;
      slot.classList.remove('hidden');
    }
    if (ads.infeed && ads.infeed.active) {
      const slot = document.getElementById('ad-infeed-slot');
      slot.innerHTML = ads.infeed.code;
      slot.classList.remove('hidden');
    }
    if (ads.footer && ads.footer.active) {
      const slot = document.getElementById('ad-footer-slot');
      slot.innerHTML = ads.footer.code;
      slot.classList.remove('hidden');
    }
  }

  getDeviceId() {
    // 1. Android Native App: Hardware-locked permanent Android ID (never changes across reinstall/update/network change)
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (bridge && typeof bridge.getDeviceId === 'function') {
      try {
        const nativeId = bridge.getDeviceId();
        if (nativeId && nativeId.trim().length > 3) {
          localStorage.setItem('bdtv_device_id', nativeId);
          return nativeId;
        }
      } catch (e) {}
    }

    // 2. Web browser fallback: persisted in localStorage
    let devId = localStorage.getItem('bdtv_device_id');
    if (!devId) {
      devId = 'dev-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
      localStorage.setItem('bdtv_device_id', devId);
    }
    return devId;
  }

  getDeviceInfo() {
    const ua = navigator.userAgent || '';
    let os = 'Unknown OS';
    if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    let browser = 'Unknown Browser';
    if (/Chrome|CriOS/i.test(ua) && !/Edge|OPR/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/Edge/i.test(ua)) browser = 'Edge';

    return {
      deviceId: this.getDeviceId(),
      deviceName: `${os} (${browser})`,
      os: os,
      browser: browser
    };
  }

  checkSubscriptionAccess() {
    const custCode = localStorage.getItem('bdtv_cust_code');
    const custPin  = localStorage.getItem('bdtv_cust_pin');
    if (!custCode || !custPin) {
      this.showVipLockModal();
      return false;
    }
    return true;
  }

  showVipLockModal(msg) {
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (bridge && typeof bridge.stopNativePlayer === 'function') {
      bridge.stopNativePlayer();
    }
    if (this.hls) {
      try { this.hls.stopLoad(); this.hls.destroy(); } catch {}
      this.hls = null;
    }
    this.video.pause();
    this.video.src = '';
    this.showBuffering(false);
    this.authModal.classList.remove('hidden');
    const errorDiv = document.getElementById('auth-error');
    if (msg && errorDiv) {
      errorDiv.textContent = msg;
      errorDiv.classList.remove('hidden');
    }
    this.authModalFocusIndex = 0;
    setTimeout(() => this.updateAuthModalFocus(), 100);
  }

  async checkAppUpdate() {
    return;
  }

  performSecureAppDownload() {
    return;
  }

  showUpdateModal() {
    return;
  }

  getInitialChannelIndex() {
    let targetId = '';
    let targetName = '';
    try {
      targetId = localStorage.getItem('bdtv_last_channel_id') || '';
      targetName = localStorage.getItem('bdtv_last_channel_name') || '';
    } catch (_) {}

    if (!targetId && !targetName) {
      const bridge = window.AndroidBridge || window.AndroidApp;
      if (bridge && typeof bridge.getLastPlayedChannel === 'function') {
        try {
          const raw = bridge.getLastPlayedChannel();
          if (raw) {
            const parsed = JSON.parse(raw);
            targetId = parsed.id || '';
            targetName = parsed.name || '';
          }
        } catch (_) {}
      }
    }

    if (targetId || targetName) {
      const found = this.filteredChannels.findIndex(c =>
        (targetId && (c.id === targetId || String(c.id) === String(targetId))) ||
        (targetName && c.name === targetName)
      );
      if (found >= 0) return found;
    }
    return 0;
  }

  // 2. Fetch Channels (Instant Secure Cache + Auto Background Sync)
  async loadChannels() {
    const custCode = localStorage.getItem('bdtv_cust_code') || '';
    const custPin  = localStorage.getItem('bdtv_cust_pin') || '';

    // If VIP mode enabled and user has no credentials, prompt modal and do not load
    if (this.settings.subscription_restrictions_enabled && (!custCode || !custPin)) {
      this.showVipLockModal();
      return;
    }

    // Helper: Secure Obfuscated Storage (prevents casual tampering & inspection)
    const encodeCache = (data) => {
      try {
        return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
      } catch (e) {
        return null;
      }
    };
    const decodeCache = (str) => {
      try {
        return JSON.parse(decodeURIComponent(escape(atob(str))));
      } catch (e) {
        return null;
      }
    };
    const normalizeChannels = (items) => {
      if (!Array.isArray(items)) return [];
      return items.reduce((result, channel) => {
        if (!channel || typeof channel !== 'object') return result;
        const url = String(channel.play_url || channel.url || channel.backup_url || '').trim();
        const status = String(channel.status || 'ONLINE').trim().toUpperCase();
        if (!url || status !== 'ONLINE') return result;
        result.push(Object.assign({}, channel, { url, play_url: url }));
        return result;
      }, []);
    };

    // STEP 1: Instant load from Native Android Storage / offline cache (0 millisecond delay!)
    let hasLoadedFromCache = false;
    try {
      const bridge = window.AndroidBridge || window.AndroidApp;
      if (bridge && typeof bridge.getCachedChannelsJson === 'function') {
        const nativeCache = bridge.getCachedChannelsJson();
        if (nativeCache && nativeCache.length > 10) {
          const parsed = normalizeChannels(JSON.parse(nativeCache));
          if (parsed.length > 0) {
            this.channels = parsed;
            this.filterChannels(this.currentCategory || 'All');
            hasLoadedFromCache = true;
            if (this.currentIndex < 0 && this.channels.length > 0) {
              this.playChannel(this.getInitialChannelIndex());
            }
          }
        }
      }
    } catch (e) {
      console.warn('Native cache read error:', e);
    }

    if (!hasLoadedFromCache) {
      try {
        const rawCache = localStorage.getItem('_bdtv_secure_ch_v2');
        if (rawCache) {
          const cached = normalizeChannels(decodeCache(rawCache));
          if (cached.length > 0) {
            this.channels = cached;
            this.filterChannels(this.currentCategory || 'All');
            hasLoadedFromCache = true;
            if (this.currentIndex < 0 && this.channels.length > 0) {
              this.playChannel(this.getInitialChannelIndex());
            }
          }
        }
      } catch (e) {
        console.warn('Browser cache read error:', e);
      }
    }

    // 1a: Bundled seed fallback if cache is EMPTY or unreadable
    if (!hasLoadedFromCache) {
      try {
        let seedRes = await fetch('channels.json').catch(() => null);
        if (!seedRes || !seedRes.ok) {
          seedRes = await fetch('channels_seed.json').catch(() => null);
        }
        if (seedRes && seedRes.ok) {
          const seedData = await seedRes.json();
          const seedChannels = normalizeChannels(Array.isArray(seedData) ? seedData : (seedData.data || []));
          if (seedChannels.length > 0) {
            this.channels = seedChannels;
            this.filterChannels(this.currentCategory || 'All');
            hasLoadedFromCache = true;
            try {
              localStorage.setItem('_bdtv_secure_ch_v2', encodeCache(seedChannels));
            } catch (_) {}
            if (this.currentIndex < 0 && this.channels.length > 0) {
              this.playChannel(this.getInitialChannelIndex());
            }
          }
        }
      } catch (e) {
        console.warn('Seed channel fetch error:', e);
      }
    }

    if (!hasLoadedFromCache) {
      this.showBuffering(true);
    }

    // STEP 2: Background Fetch from Server to guarantee instant channel & stream updates
    try {
      const devInfo = this.getDeviceInfo();
      const url = `/api/channels?code=${encodeURIComponent(custCode)}&pin=${encodeURIComponent(custPin)}&device_id=${encodeURIComponent(devInfo.deviceId)}&_t=${Date.now()}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.vip_locked) {
        this.showVipLockModal(json.message);
        return;
      }

      const serverChannels = normalizeChannels(json.data);
      if (json.success && serverChannels.length > 0) {
        const currentPlaying = (this.currentIndex >= 0 && this.filteredChannels.length > 0)
          ? this.filteredChannels[this.currentIndex]
          : null;

        // Check if server channels are different from current channels (links updated, new added)
        const cacheStr = encodeCache(serverChannels);
        if (cacheStr) {
          try { localStorage.setItem('_bdtv_secure_ch_v2', cacheStr); } catch (e) {}
        }

        const hasRealChanges = !hasLoadedFromCache ||
          this.channels.length !== serverChannels.length ||
          this.channels.some((c, i) => {
            const sc = serverChannels[i];
            return !sc || c.id !== sc.id || c.url !== sc.url || c.logo !== sc.logo || c.name !== sc.name;
          });

        if (hasRealChanges) {
          this.channels = serverChannels;
          this.filterChannels(this.currentCategory || 'All');

          // If playing channel's stream URL changed on server, refresh stream silently!
          if (currentPlaying) {
            const updatedCh = this.channels.find(c => c.id === currentPlaying.id || c.name === currentPlaying.name);
            if (updatedCh && updatedCh.url !== currentPlaying.url) {
              console.log('[LiveSync] Stream URL updated from server, refreshing stream...');
              const currentPos = this.filteredChannels.findIndex(c => c.id === updatedCh.id || c.name === updatedCh.name);
              if (currentPos >= 0) {
                this.playChannel(currentPos);
              }
            }
          } else if (!hasLoadedFromCache && this.channels.length > 0) {
            this.playChannel(this.getInitialChannelIndex());
          }
        } else {
          // Channels are identical to local cache — keep data reference without re-rendering DOM
          this.channels = serverChannels;
        }
      } else {
        if (!hasLoadedFromCache) throw new Error('No channels from API');
      }
    } catch (err) {
      if (this.settings.subscription_restrictions_enabled && !hasLoadedFromCache) {
        this.showVipLockModal('সার্ভার সংযোগ সমস্যা। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
        return;
      }
      if (!hasLoadedFromCache) {
        console.warn('Fallback to demo channels:', err);
        this.channels = FALLBACK_CHANNELS;
        this.filterChannels('All');
        if (this.channels.length > 0) {
          this.playChannel(this.getInitialChannelIndex());
        }
      }
    }
  }

  // 3. Filter Channels
  filterChannels(cat) {
    this.currentCategory = cat;

    // Remember the currently-playing channel before filter changes the array
    const playingChannel = (this.currentIndex >= 0 && this.filteredChannels.length > 0)
      ? this.filteredChannels[this.currentIndex]
      : null;

    if (cat === 'All') {
      this.filteredChannels = [...this.channels];
    } else {
      this.filteredChannels = this.channels.filter(c => c.category && c.category.toLowerCase() === cat.toLowerCase());
    }

    // Re-sync currentIndex so the playing channel stays correctly tracked in the new array
    if (playingChannel) {
      const newIdx = this.filteredChannels.findIndex(c => c.id === playingChannel.id || c.url === playingChannel.url);
      this.currentIndex = newIdx >= 0 ? newIdx : -1;
    } else {
      this.currentIndex = -1;
    }

    // Keep focusedIndex in bounds; default to the playing channel position
    this.focusedIndex = this.currentIndex >= 0 ? this.currentIndex : 0;
    if (this.focusedIndex >= this.filteredChannels.length) this.focusedIndex = 0;

    this.renderChannelGrid();
  }

  initLogoObserver() {
    if (this.logoObserver) {
      try { this.logoObserver.disconnect(); } catch (e) {}
    }
    const drawerInner = document.querySelector('.drawer-inner');
    if ('IntersectionObserver' in window) {
      this.logoObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const dataSrc = img.dataset.src;
            if (dataSrc && img.src !== dataSrc) {
              img.src = dataSrc;
              img.removeAttribute('data-src');
            }
            observer.unobserve(img);
          }
        });
      }, {
        root: drawerInner || null,
        rootMargin: '350px 0px 350px 0px',
        threshold: 0.01
      });
    } else {
      this.logoObserver = null;
    }
  }

  renderChannelGrid() {
    this.channelGrid.innerHTML = '';
    if (!this.filteredChannels.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'channel-empty';
      emptyState.textContent = 'চ্যানেল লোড হয়নি। ইন্টারনেট পরীক্ষা করে আবার অ্যাপ খুলুন।';
      this.channelGrid.appendChild(emptyState);
      return;
    }
    const fragment = document.createDocumentFragment();
    this.initLogoObserver();

    this.filteredChannels.forEach((ch, idx) => {
      const card = document.createElement('div');
      card.className = `channel-card ${idx === this.focusedIndex ? 'focused' : ''} ${idx === this.currentIndex ? 'active-playing' : ''}`;
      card.tabIndex = 0;
      card.dataset.index = idx;

      // Logo strictly bound 1-to-1 with channel data from /api/channels (prevents any logo mix-up)
      const hasLogo = Boolean(ch.logo && ch.logo.trim());
      const logoSrc = hasLogo ? ch.logo.trim() : DEFAULT_TV_LOGO;

      // First 24 cards load immediately with their logo URL
      // Remaining cards load on-demand as user scrolls drawer to conserve bandwidth
      const isInitialBatch = idx < 24;
      const initialSrc = isInitialBatch ? logoSrc : DEFAULT_TV_LOGO;
      const dataSrcAttr = (!isInitialBatch && hasLogo) ? `data-src="${logoSrc}"` : '';

      card.innerHTML = `
        <div class="ch-logo-wrap">
          <img src="${initialSrc}" ${dataSrcAttr} alt="${ch.name}" referrerpolicy="no-referrer" decoding="async" onerror="this.onerror=null;this.src='${DEFAULT_TV_LOGO}'">
        </div>
        <div class="ch-title">${ch.name}</div>
      `;

      card.addEventListener('click', () => {
        this.focusedIndex = idx;
        this.updateCardFocus();
        this.playChannel(idx);
        this.closeDrawer();
      });

      if (!isInitialBatch && this.logoObserver && hasLogo) {
        const img = card.querySelector('img');
        if (img) this.logoObserver.observe(img);
      }

      fragment.appendChild(card);
    });

    this.channelGrid.appendChild(fragment);

    try {
      const bridge = window.AndroidBridge || window.AndroidApp;
      if (bridge && typeof bridge.onChannelGridReady === 'function') {
        bridge.onChannelGridReady();
      }
    } catch (_) {}
  }

  // Disable auto captions/subtitles across video element and HLS
  disableCaptions() {
    try {
      if (this.video && this.video.textTracks) {
        for (let i = 0; i < this.video.textTracks.length; i++) {
          this.video.textTracks[i].mode = 'disabled';
        }
      }
      if (this.hls) {
        this.hls.subtitleDisplay = false;
        this.hls.subtitleTrack = -1;
      }
    } catch (e) {}
  }

  // 4. Video Events & HLS.js Live Streaming Engine
  bindVideoEvents() {
    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => {
      this.showBuffering(false);
      this.hideError();
      this.disableCaptions();
      if (this.video.muted && !this.isUserUnmuted) {
        this.showUnmuteBanner(true);
      } else {
        this.showUnmuteBanner(false);
      }
      this.updateSoundButtonUI();
    });
    this.video.addEventListener('loadedmetadata', () => {
      this.disableCaptions();
    });
    if (this.video.textTracks) {
      this.video.textTracks.addEventListener('addtrack', () => {
        this.disableCaptions();
      });
    }
    this.video.addEventListener('timeupdate', () => {
      if (this.video && this.video.currentTime > 0) {
        this.showBuffering(false);
      }
    });
    this.video.addEventListener('volumechange', () => {
      this.updateSoundButtonUI();
    });
    this.video.addEventListener('error', () => {
      const ch = this.filteredChannels[this.currentIndex];
      this.showError(ch ? ch.name : '');
    });
  }

  initHLS() {
    if (!Hls.isSupported()) return;

    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
      enableWebVTT: false,
      enableCEA708Captions: false,
      renderTextTracksNatively: false,
      backBufferLength: 10,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1024 * 1024,
      maxBufferHole: 0.8,              // Seamlessly bridges micro-gaps without freezing
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.1,
      nudgeMaxRetry: 5,
      fragLoadingTimeOut: 20000,
      manifestLoadingTimeOut: 15000,
      fragLoadingMaxRetry: 5,
      manifestLoadingMaxRetry: 5,
      levelLoadingMaxRetry: 5,
      startFragPrefetch: true,
      autoStartLoad: true
    });

    this.hls.attachMedia(this.video);

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.disableCaptions();
      this.hideError();
      this.attemptPlay();
    });

    this.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
      this.disableCaptions();
    });

    this.hls.on(Hls.Events.FRAG_BUFFERED, () => {
      if (this.video && this.video.currentTime > 0) {
        this.showBuffering(false);
      }
    });

    // Buffer stall recovery: when HLS detects no progress, restart loading
    this.hls.on(Hls.Events.ERROR, (event, data) => {
      if (!data.fatal && data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
        console.log('[BufferStall] Non-fatal stall detected — restarting load');
        try { this.hls.startLoad(); } catch(e) {}
      }
    });

    // Activate and ensure audio track is bound
    this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
      if (data && data.audioTracks && data.audioTracks.length > 0) {
        if (this.hls.audioTrack === -1 || this.hls.audioTrack === undefined) {
          this.hls.audioTrack = 0;
        }
      }
    });

    this.hls.on(Hls.Events.AUDIO_TRACK_LOADED, (event, data) => {
      // Un-mute if user already unmuted
      if (this.isUserUnmuted && this.video.muted) {
        this.video.muted = false;
      }
    });

    let mediaRecoveryCount = 0;
    let networkRecoveryCount = 0;

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('HLS Event Error:', data.details, data.fatal ? '[FATAL]' : '[non-fatal]');

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            networkRecoveryCount++;
            console.log(`HLS Network error (${networkRecoveryCount}), retrying...`);
            if (networkRecoveryCount <= 3) {
              this.hls.startLoad();
            } else if (networkRecoveryCount === 4) {
              // Try Server HLS Proxy fallback if not already using proxy!
              const ch = this.filteredChannels[this.currentIndex];
              if (ch && !ch.use_proxy && ch.id) {
                console.log('[AutoProxyFallback] Stream blocked or CORS failed, switching to Server HLS Proxy...');
                networkRecoveryCount = 0;
                ch.use_proxy = true;
                const proxyUrl = `/api/proxy?ch=${encodeURIComponent(ch.id)}`;
                try { this.hls.destroy(); } catch(e) {}
                this.hls = null;
                this.initHLS();
                this.hls.loadSource(proxyUrl);
              } else {
                // Feature 2: Auto-failover — try backup_url before full reload
                const backupUrl = ch && (ch.backup_url || ch.backupUrl);
                if (backupUrl) {
                  console.log('Switching to backup stream URL...');
                  networkRecoveryCount = 0;
                  const cleanBackup = backupUrl.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
                  try { this.hls.destroy(); } catch(e) {}
                  this.hls = null;
                  this.initHLS();
                  this.hls.loadSource(cleanBackup);
                } else {
                  // No backup URL — do a full channel reload after short delay
                  setTimeout(() => {
                    networkRecoveryCount = 0;
                    if (this.filteredChannels[this.currentIndex]) {
                      this.playChannel(this.currentIndex);
                    }
                  }, 2000);
                }
              }
            } else {
              setTimeout(() => {
                networkRecoveryCount = 0;
                if (this.filteredChannels[this.currentIndex]) {
                  this.playChannel(this.currentIndex);
                }
              }, 2000);
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            mediaRecoveryCount++;
            console.log(`HLS Media error (${mediaRecoveryCount}), auto-recovering audio/video...`);
            if (mediaRecoveryCount <= 3) {
              this.hls.recoverMediaError();
            } else {
              this.hls.swapAudioCodec();
              this.hls.recoverMediaError();
              mediaRecoveryCount = 0;
            }
            break;
          default: {
            const ch = this.filteredChannels[this.currentIndex];
            this.showError(ch ? ch.name : '');
            break;
          }
        }
      }
    });
  }

  // Audio Playback & Unmute Handling
  attemptPlay() {
    this.video.muted = false;
    this.video.volume = 1.0;

    const p = this.video.play();
    if (p !== undefined) {
      p.then(() => {
        this.isUserUnmuted = true;
        this.showUnmuteBanner(false);
        this.updateSoundButtonUI();
      }).catch((err) => {
        console.warn('Direct unmuted play blocked, falling back to muted autoplay:', err);
        this.video.muted = true;
        this.video.play().then(() => {
          this.showUnmuteBanner(true);
          this.updateSoundButtonUI();
        }).catch(e => console.error('Play totally failed:', e));
      });
    }
  }

  unmuteAudio() {
    this.isUserUnmuted = true;
    this.video.muted = false;
    this.video.volume = 1.0;
    this.showUnmuteBanner(false);
    this.updateSoundButtonUI();
  }

  toggleSound() {
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (this.video.muted) {
      this.unmuteAudio();
      if (bridge && typeof bridge.setNativeVolume === 'function') {
        bridge.setNativeVolume(1.0);
      }
    } else {
      this.video.muted = true;
      this.showUnmuteBanner(false);
      this.updateSoundButtonUI();
      if (bridge && typeof bridge.setNativeVolume === 'function') {
        bridge.setNativeVolume(0.0);
      }
    }
  }

  // Auto-sync listener triggered by Native ChannelSyncManager
  onChannelsSynced(newChannelsJson) {
    try {
      const channels = (typeof newChannelsJson === 'string') ? JSON.parse(newChannelsJson) : newChannelsJson;
      if (Array.isArray(channels) && channels.length > 0) {
        console.log('[AutoSync] Channels dynamically updated from server:', channels.length);
        const currentPlaying = (this.currentIndex >= 0 && this.filteredChannels.length > 0)
          ? this.filteredChannels[this.currentIndex]
          : null;

        this.channels = channels;
        this.filterChannels(this.currentCategory || 'All');

        if (currentPlaying) {
          const updatedCh = this.channels.find(c => c.id === currentPlaying.id || c.name === currentPlaying.name);
          const oldUrl = currentPlaying.play_url || currentPlaying.url;
          const newUrl = updatedCh ? (updatedCh.play_url || updatedCh.url) : null;
          if (updatedCh && newUrl !== oldUrl) {
            console.log('[AutoSync] Stream setting updated for active channel, refreshing...');
            const newPos = this.filteredChannels.findIndex(c => c.id === updatedCh.id || c.name === updatedCh.name);
            if (newPos >= 0) this.playChannel(newPos);
          }
        }
      }
    } catch (e) {
      console.warn('onChannelsSynced parse error:', e);
    }
  }

  showUnmuteBanner(show) {
    const banner = document.getElementById('unmute-banner');
    if (!banner) return;
    if (show && this.video.muted && !this.isUserUnmuted) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  updateSoundButtonUI() {
    const btn = document.getElementById('btn-sound-toggle');
    if (!btn) return;
    if (this.video.muted) {
      btn.innerHTML = '🔇 সাউন্ড অফ';
      btn.classList.add('muted');
      btn.title = 'সাউন্ড চালু করতে ক্লিক করুন';
    } else {
      btn.innerHTML = '🔊 সাউন্ড';
      btn.classList.remove('muted');
      btn.title = 'সাউন্ড বন্ধ করতে ক্লিক করুন';
    }
  }

  flashSoundHUD(msg) {
    // Disabled as requested by user — no middle popup
  }

  bindAudioUnlock() {
    const unlock = () => {
      if (this.video && this.video.muted && !this.isUserUnmuted) {
        this.unmuteAudio();
      }
    };
    ['click', 'touchstart', 'touchend', 'keydown'].forEach(evt => {
      document.addEventListener(evt, unlock, { passive: true });
    });
  }

  // 5. Play Specific Channel
  playChannel(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.filteredChannels.length) return;
    this.currentIndex = index;
    const channel = this.filteredChannels[index];

    // Section 12 Smart Memory: Persist last played channel ID & name
    try {
      if (channel.id) localStorage.setItem('bdtv_last_channel_id', channel.id);
      if (channel.name) localStorage.setItem('bdtv_last_channel_name', channel.name);
    } catch (_) {}

    // Reset isolation: Start full chain fresh on every channel switch!
    this.currentPlayPath = 1;
    this.chainRetryCount = 0;
    this.lastDiagnostic = '';
    clearTimeout(this.webWatchdog);

    // 1. Instantly STOP old stream, hide error dialog, show buffering
    this.hideError();
    this.showBuffering(true);
    this.video.pause();
    if (this.hls) {
      try { this.hls.stopLoad(); this.hls.destroy(); } catch (e) {}
      this.hls = null;
    }

    // 2. Update Top Bar & HUD
    document.getElementById('top-channel-name').textContent = channel.name;
    const topLogo = document.getElementById('top-channel-logo');
    if (channel.logo && channel.logo.trim()) {
      topLogo.referrerPolicy = 'no-referrer';
      topLogo.src = channel.logo.trim();
      topLogo.onerror = function() { this.src = DEFAULT_TV_LOGO; };
      topLogo.classList.remove('hidden');
    } else {
      topLogo.classList.add('hidden');
    }

    this.flashHUD(channel);
    this.showBuffering(true);
    this.sendHeartbeat();
    this.hideError();

    // 3. Native Media3 Playback Engine (Path 1: Direct Native with Per-Channel Headers)
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (this.useNativePlayer && bridge && typeof bridge.playNativeStream === 'function') {
      document.body.classList.add('native-player');
      this.video.pause();
      this.video.src = '';
      if (this.hls) {
        try { this.hls.destroy(); } catch (e) {}
        this.hls = null;
      }

      // Direct raw play_url with headers
      const rawPlayUrl = channel.play_url || channel.url;
      const cleanUrl = rawPlayUrl.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
      const headers = channel.headers || {};

      console.log(`[libmpv] Starting for ${channel.name}: ${cleanUrl}`);
      const backupUrl = channel.backup_url || '';
      bridge.playNativeStream(cleanUrl, JSON.stringify(headers), backupUrl, channel.name);

      this.updateCardFocus();
      this.triggerTopBar();
      return;
    }

    // Fallback: Web HTML5 / HLS.js Player (for browser or non-native mode)
    document.body.classList.remove('native-player');
    this.disableCaptions();
    const rawUrl = (channel.use_proxy && channel.id)
      ? (/^\/api\/proxy/.test(channel.url) ? channel.url : `/api/proxy?ch=${encodeURIComponent(channel.id)}`)
      : channel.url;
    const cleanUrl = rawUrl.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
    const isM3u8 = cleanUrl.includes('.m3u8') || cleanUrl.includes('/hls') || cleanUrl.includes('/mono') || cleanUrl.includes('playlist') || cleanUrl.includes('/api/proxy');
    if (Hls.isSupported() && isM3u8) {
      this.initHLS();
      this.hls.loadSource(cleanUrl);
    } else {
      this.video.src = cleanUrl;
      this.attemptPlay();
    }

    this.updateCardFocus();
    this.triggerTopBar();
  }

  // Dual-Path Fallback Controller (Triggered by Native ExoPlayer Manager)
  onNativePathFailed(diagnostic) {
    const ch = this.filteredChannels[this.currentIndex];
    if (!ch) return;

    console.warn(`[DualPath] Path ${this.currentPlayPath} failed for ${ch.name}: ${diagnostic}`);

    if (this.currentPlayPath === 1) {
      // Step 2: Automatically try Path 2 (Server Proxy in Native ExoPlayer)
      this.currentPlayPath = 2;
      this.lastDiagnostic = `Path 1 (Direct): ${diagnostic}`;

      // Show ONLY buffering during recovery — NO error dialog flash!
      this.showBuffering(true);
      this.hideError();

      const rawProxy = (/^\/api\/proxy/.test(ch.url) ? ch.url : `/api/proxy?ch=${encodeURIComponent(ch.id)}`);
      const fullProxy = rawProxy.startsWith('http') ? rawProxy : `https://bdtv-app.vercel.app${rawProxy}`;

      console.log(`[Path 2: Native Proxy] Automatically switching to proxy for ${ch.name}: ${fullProxy}`);
      const bridge = window.AndroidBridge || window.AndroidApp;
      if (bridge && typeof bridge.playNativeStream === 'function') {
        bridge.playNativeStream(fullProxy, "{}");
      } else {
        this.onNativePathFailed(diagnostic);
      }
    } else if (this.currentPlayPath === 2) {
      // Step 3: Automatically fall back to Path 3 (Web HLS.js with Server Proxy)
      this.currentPlayPath = 3;
      this.lastDiagnostic = `Path 2 (Proxy Native): ${diagnostic}`;

      // Show ONLY buffering during recovery — NO error dialog!
      this.showBuffering(true);
      this.hideError();

      const bridge = window.AndroidBridge || window.AndroidApp;
      if (bridge && typeof bridge.stopNativePlayer === 'function') {
        bridge.stopNativePlayer();
      }

      document.body.classList.remove('native-player');

      const rawProxy = (/^\/api\/proxy/.test(ch.url) ? ch.url : `/api/proxy?ch=${encodeURIComponent(ch.id)}`);
      const fullProxy = rawProxy.startsWith('http') ? rawProxy : `https://bdtv-app.vercel.app${rawProxy}`;

      console.log(`[Path 3: Web HLS.js Proxy] Automatically falling back to HLS.js for ${ch.name}: ${fullProxy}`);
      this.playInWebHls(fullProxy);
    } else {
      // Step 4: All paths exhausted (~15-20s total elapsed)
      this.onAllPathsFailed();
    }
  }

  playInWebHls(url) {
    this.video.pause();
    if (this.hls) {
      try { this.hls.stopLoad(); this.hls.destroy(); } catch (e) {}
      this.hls = null;
    }
    this.disableCaptions();

    if (Hls.isSupported()) {
      this.initHLS();
      clearTimeout(this.webWatchdog);
      this.webWatchdog = setTimeout(() => {
        if (this.currentPlayPath === 3 && (this.video.paused || this.video.currentTime === 0)) {
          this.lastDiagnostic = `Path 3 (Web HLS.js): Timeout loading stream`;
          this.onAllPathsFailed();
        }
      }, 8000);

      this.hls.loadSource(url);
    } else {
      this.video.src = url;
      this.attemptPlay();
    }
  }

  onAllPathsFailed() {
    clearTimeout(this.webWatchdog);
    const ch = this.filteredChannels[this.currentIndex];
    const chName = ch ? ch.name : 'চ্যানেল';
    console.error(`[AllPathsFailed] All recovery paths exhausted for ${chName}. Last diagnostic: ${this.lastDiagnostic}`);

    this.showBuffering(false);
    this.showError(chName);
  }

  // 6. Flash TV Channel Switch HUD (Disabled — top bar already displays channel at the top)
  flashHUD(channel) {
    // Disabled as requested by user — top bar displays channel name cleanly
  }

  // 7. Auto-hide Top Bar
  triggerTopBar() {
    this.topBar.classList.remove('fade-out');
    clearTimeout(this.topBarTimeout);
    this.topBarTimeout = setTimeout(() => {
      if (!this.isDrawerOpen) {
        this.topBar.classList.add('fade-out');
      }
    }, 3500);
  }

  // Modal State Helpers & Remote Focus Handlers
  isUpdateModalOpen() {
    const modal = document.getElementById('update-modal');
    return modal && !modal.classList.contains('hidden');
  }

  isAuthModalOpen() {
    return this.authModal && !this.authModal.classList.contains('hidden');
  }

  isExpiryScreenOpen() {
    const overlay = document.getElementById('expiry-lock-overlay');
    // overlay is created dynamically with display:flex, no 'hidden' class used
    return !!(overlay && overlay.isConnected && overlay.style.display !== 'none');
  }

  updateUpdateModalFocus() {
    const ids = ['btn-update-download', 'btn-update-later', 'btn-close-update'];
    ids.forEach((id, index) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (index === this.updateModalFocusIndex) {
        el.classList.add('focused');
        el.focus();
      } else {
        el.classList.remove('focused');
      }
    });
  }

  handleUpdateModalKey(e) {
    const key = e.key;
    const keyCode = e.keyCode || e.which;
    // TV remote keycodes: LEFT=21, RIGHT=22, UP=19, DOWN=20, OK=23, BACK=4
    const isLeft  = key === 'ArrowLeft'  || keyCode === 21 || keyCode === 37;
    const isRight = key === 'ArrowRight' || keyCode === 22 || keyCode === 39;
    const isUp    = key === 'ArrowUp'    || keyCode === 19 || keyCode === 38;
    const isDown  = key === 'ArrowDown'  || keyCode === 20 || keyCode === 40;
    const isOk    = key === 'Enter' || key === 'Select' || key === 'Accept' || keyCode === 13 || keyCode === 23 || keyCode === 66;
    const isBack  = key === 'Escape' || key === 'Back' || key === 'BrowserBack' || keyCode === 27 || keyCode === 4;

    // Layout:  [আপডেট করুন(0)]  [পরে করুন(1)]   ✕(2) top-right
    // Left/Right: toggle between Download(0) <-> Later(1)
    if (isLeft || isRight) {
      e.preventDefault();
      // Only toggle between 0 and 1 (bottom row)
      if (this.updateModalFocusIndex <= 1) {
        this.updateModalFocusIndex = this.updateModalFocusIndex === 0 ? 1 : 0;
      } else {
        this.updateModalFocusIndex = 0; // from close → go to download
      }
      this.updateUpdateModalFocus();
      return true;
    }
    // Up: from bottom buttons → close button (if visible)
    if (isUp) {
      e.preventDefault();
      const closeBtn = document.getElementById('btn-close-update');
      if (closeBtn && closeBtn.style.display !== 'none') {
        this.updateModalFocusIndex = 2; // Close ✕ button
      } else {
        this.updateModalFocusIndex = 1; // Later button (if no close)
      }
      this.updateUpdateModalFocus();
      return true;
    }
    // Down: from close → download button
    if (isDown) {
      e.preventDefault();
      this.updateModalFocusIndex = 0; // Download button
      this.updateUpdateModalFocus();
      return true;
    }
    // OK / Enter / D-Pad Center: activate focused button
    if (isOk) {
      e.preventDefault();
      const ids = ['btn-update-download', 'btn-update-later', 'btn-close-update'];
      const id = ids[this.updateModalFocusIndex];
      const el = document.getElementById(id);
      if (el) el.click();
      return true;
    }
    // Back / Escape: dismiss modal (same as পরে করুন or ✕)
    if (isBack) {
      e.preventDefault();
      const closeBtn = document.getElementById('btn-close-update');
      const laterBtn = document.getElementById('btn-update-later');
      // Use later or close, whichever is visible
      if (laterBtn && laterBtn.style.display !== 'none') {
        laterBtn.click();
      } else if (closeBtn && closeBtn.style.display !== 'none') {
        closeBtn.click();
      }
      return true;
    }
    e.preventDefault();
    return true;
  }

  updateAuthModalFocus() {
    const codeInput = document.getElementById('input-customer-code');
    const pinInput = document.getElementById('input-customer-pin');
    const submitBtn = document.getElementById('btn-auth-submit') || (this.authModal ? this.authModal.querySelector('button[type="submit"]') : null);
    const elements = [codeInput, pinInput, submitBtn];

    elements.forEach((el, index) => {
      if (!el) return;
      if (index === this.authModalFocusIndex) {
        el.classList.add('focused');
        try {
          el.focus();
          if (el.tagName === 'INPUT') {
            const len = el.value.length;
            if (typeof el.setSelectionRange === 'function') {
              el.setSelectionRange(len, len);
            }
          }
        } catch {}

        // ✅ KEYBOARD RULE:
        // - INPUT focused → always show keyboard
        // - BUTTON focused → do NOT hide keyboard! user may still need to type
        // - keyboard only hides on: Back key OR successful submit
        const bridge = window.AndroidBridge || window.AndroidApp;
        if (el.tagName === 'INPUT') {
          if (bridge && typeof bridge.showKeyboard === 'function') {
            bridge.showKeyboard();
          }
        }
        // ❌ REMOVED: do NOT call bridge.hideKeyboard() when button gets focus
      } else {
        el.classList.remove('focused');
      }
    });
  }

  handleAuthModalKey(e) {
    const key = e.key;
    const keyCode = e.keyCode || e.which;

    const isUp    = key === 'ArrowUp'    || keyCode === 19 || keyCode === 38;
    const isDown  = key === 'ArrowDown'  || keyCode === 20 || keyCode === 40;
    const isLeft  = key === 'ArrowLeft'  || keyCode === 21 || keyCode === 37;
    const isRight = key === 'ArrowRight' || keyCode === 22 || keyCode === 39;
    const isOk    = key === 'Enter' || key === 'Select' || key === 'Go' || key === 'Accept' || keyCode === 13 || keyCode === 23 || keyCode === 66;
    const isBack  = key === 'Escape' || key === 'Back' || key === 'BrowserBack' || keyCode === 27 || keyCode === 4;

    // Left/Right: allow natural text cursor movement inside input fields, do NOT preventDefault
    if (isLeft || isRight) {
      // Only intercept if focus is on the submit button (no text cursor there)
      if (this.authModalFocusIndex === 2) {
        e.preventDefault();
        // On button, left/right does nothing special
      }
      return true; // consume event so main handler doesn't switch channels
    }

    if (isUp) {
      e.preventDefault();
      this.authModalFocusIndex = Math.max(0, this.authModalFocusIndex - 1);
      this.updateAuthModalFocus();
      return true;
    }

    if (isDown) {
      e.preventDefault();
      this.authModalFocusIndex = Math.min(2, this.authModalFocusIndex + 1);
      this.updateAuthModalFocus();
      return true;
    }

    if (isOk) {
      e.preventDefault();
      if (this.authModalFocusIndex === 0) {
        // From customer code: if filled, go to PIN; else stay
        const codeInput = document.getElementById('input-customer-code');
        if (codeInput && codeInput.value.trim()) {
          this.authModalFocusIndex = 1;
          this.updateAuthModalFocus();
        } else {
          this.updateAuthModalFocus(); // re-focus code input
        }
      } else if (this.authModalFocusIndex === 1) {
        // From PIN: if filled, submit directly
        const pinInput = document.getElementById('input-customer-pin');
        if (pinInput && pinInput.value.trim()) {
          this.submitAuthForm();
        } else {
          this.authModalFocusIndex = 2;
          this.updateAuthModalFocus();
        }
      } else {
        // On submit button → submit
        this.submitAuthForm();
      }
      return true;
    }

    if (isBack) {
      // Back key: hide keyboard, then close modal
      const bridge = window.AndroidBridge || window.AndroidApp;
      if (bridge && typeof bridge.hideKeyboard === 'function') {
        bridge.hideKeyboard();
      }
      if (this.authModal) {
        this.authModal.classList.add('hidden');
      }
      return true;
    }

    return false;
  }

  // 8. Drawer Controls (Persistent Shelf: NEVER auto-hides while user scrolls or browses)
  openDrawer() {
    this.isDrawerOpen = true;
    document.body.classList.add('drawer-open');
    this.channelDrawer.classList.add('open');
    this.topBar.classList.remove('fade-out');
    clearTimeout(this.topBarTimeout);

    // Sync focusedIndex with current playing channel
    if (this.currentIndex >= 0 && this.currentIndex < this.filteredChannels.length) {
      this.focusedIndex = this.currentIndex;
    } else {
      this.focusedIndex = 0;
    }
    this.updateCardFocus();
    this.triggerVisibleLogos();
    setTimeout(() => this.updateCardFocus(), 100);
    setTimeout(() => this.updateCardFocus(), 300);
  }

  triggerVisibleLogos() {
    const unobservedImgs = this.channelGrid.querySelectorAll('img[data-src]');
    if (!unobservedImgs.length) return;
    const drawerInner = document.querySelector('.drawer-inner');
    const containerTop = drawerInner ? drawerInner.scrollTop : 0;
    const containerBottom = containerTop + (drawerInner ? drawerInner.clientHeight : window.innerHeight) + 400;

    unobservedImgs.forEach(img => {
      const card = img.closest('.channel-card');
      if (!card) return;
      const top = card.offsetTop;
      if (top <= containerBottom) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        if (this.logoObserver) {
          try { this.logoObserver.unobserve(img); } catch (e) {}
        }
      }
    });
  }

  closeDrawer() {
    this.isDrawerOpen = false;
    document.body.classList.remove('drawer-open');
    this.channelDrawer.classList.remove('open');
    this.triggerTopBar();
  }

  resetDrawerAutoHide() {
    // Disabled auto-hide by design so user can scroll uninterrupted
  }

  toggleDrawer() {
    if (this.isDrawerOpen) this.closeDrawer();
    else this.openDrawer();
  }

  updateCardFocus() {
    const cards = this.channelGrid.querySelectorAll('.channel-card');
    cards.forEach((card, idx) => {
      // focused = keyboard/mouse highlight
      if (idx === this.focusedIndex) {
        card.classList.add('focused');
        card.focus({ preventScroll: true });
        card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
      } else {
        card.classList.remove('focused');
      }
      // active-playing = currently streaming channel (must match currentIndex, NOT focusedIndex)
      if (idx === this.currentIndex) {
        card.classList.add('active-playing');
      } else {
        card.classList.remove('active-playing');
      }
    });
  }

  moveChannelFocusVertically(direction) {
    const channelCount = this.filteredChannels.length;
    if (!channelCount) return;

    const columns = window.getComputedStyle(this.channelGrid).gridTemplateColumns
      .split(/\s+/)
      .filter(Boolean).length || 1;
    const maxIndex = channelCount - 1;
    const currentRow = Math.floor(this.focusedIndex / columns);
    const currentColumn = this.focusedIndex % columns;
    const maxRow = Math.floor(maxIndex / columns);
    const targetRow = Math.max(0, Math.min(maxRow, currentRow + direction));
    const targetRowEnd = Math.min(maxIndex, (targetRow + 1) * columns - 1);

    this.focusedIndex = Math.min(targetRow * columns + currentColumn, targetRowEnd);
    this.updateCardFocus();
  }

  // 9. Android TV Remote Control Logic
  bindRemoteKeys() {
    window.addEventListener('keydown', (e) => {
      const key = e.key;
      const keyCode = e.keyCode || e.which;

      const isUp = key === 'ArrowUp' || keyCode === 19 || keyCode === 38;
      const isDown = key === 'ArrowDown' || keyCode === 20 || keyCode === 40;
      const isLeft = key === 'ArrowLeft' || keyCode === 21 || keyCode === 37;
      const isRight = key === 'ArrowRight' || keyCode === 22 || keyCode === 39;
      const isOk = key === 'Enter' || key === 'Select' || key === 'Go' || key === 'Accept' || keyCode === 13 || keyCode === 23 || keyCode === 66;
      const isBack = key === 'Escape' || key === 'Back' || key === 'BrowserBack' || keyCode === 27 || keyCode === 4;
      const isChannelUp = key === 'ChannelUp' || key === 'MediaTrackNext' || key === 'PageUp' || keyCode === 166 || keyCode === 33;
      const isChannelDown = key === 'ChannelDown' || key === 'MediaTrackPrevious' || key === 'PageDown' || keyCode === 167 || keyCode === 34;
      const isMenu = key === 'Menu' || key === 'Guide' || keyCode === 82 || keyCode === 462;
      const isPlayPause = key === 'MediaPlayPause' || key === 'MediaPlay' || key === 'MediaPause' || keyCode === 179 || keyCode === 85;

      // Priority 1: Update Modal Key Interception
      if (this.isUpdateModalOpen()) {
        if (this.handleUpdateModalKey(e)) return;
      }

      // Priority 2: VIP Auth Modal Key Interception
      if (this.isAuthModalOpen()) {
        if (this.handleAuthModalKey(e)) return;
      }

      // Priority 3: Expiry Screen Interception
      if (this.isExpiryScreenOpen()) {
        e.preventDefault();
        // Any key → focus the relogin button; OK/Enter → click it; Back → same (can't escape expiry)
        const btn = document.getElementById('expiry-relogin-btn');
        if (btn) {
          btn.classList.add('focused');
          btn.focus();
          if (isOk || isBack) btn.click();
        }
        return;
      }

      // Priority 4: Active input element on screen (don't switch channels on Left/Right)
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        if (isLeft || isRight) {
          return; // Let user edit input text naturally
        }
      }

      if ((!Array.isArray(this.filteredChannels) || this.filteredChannels.length === 0)
          && (isLeft || isRight || isChannelUp || isChannelDown)) {
        e.preventDefault();
        return;
      }

      // --- D-Pad UP: Open drawer or move channel focus up ---
      if (isUp) {
        e.preventDefault();
        if (!this.isDrawerOpen) {
          this.openDrawer();
        } else {
          this.moveChannelFocusVertically(-1);
        }
        return;
      }

      // --- D-Pad DOWN: Open drawer or move channel focus down ---
      if (isDown) {
        e.preventDefault();
        if (this.isDrawerOpen) {
          this.moveChannelFocusVertically(1);
        } else {
          this.openDrawer();
        }
        return;
      }

      // --- D-Pad LEFT: Move card left in drawer OR zap previous channel ---
      if (isLeft) {
        e.preventDefault();
        if (this.isDrawerOpen) {
          this.focusedIndex = Math.max(0, this.focusedIndex - 1);
          this.updateCardFocus();
        } else {
          const prevIndex = (this.currentIndex - 1 + this.filteredChannels.length) % this.filteredChannels.length;
          this.focusedIndex = prevIndex;
          this.playChannel(prevIndex);
        }
        return;
      }

      // --- D-Pad RIGHT: Move card right in drawer OR zap next channel ---
      if (isRight) {
        e.preventDefault();
        if (this.isDrawerOpen) {
          const maxIdx = this.filteredChannels.length - 1;
          this.focusedIndex = Math.min(maxIdx, this.focusedIndex + 1);
          this.updateCardFocus();
        } else {
          const nextIndex = (this.currentIndex + 1) % this.filteredChannels.length;
          this.focusedIndex = nextIndex;
          this.playChannel(nextIndex);
        }
        return;
      }

      // --- Channel Up ---
      if (isChannelUp) {
        e.preventDefault();
        const nextIndex = (this.currentIndex + 1) % this.filteredChannels.length;
        this.focusedIndex = nextIndex;
        this.playChannel(nextIndex);
        return;
      }

      // --- Channel Down ---
      if (isChannelDown) {
        e.preventDefault();
        const prevIndex = (this.currentIndex - 1 + this.filteredChannels.length) % this.filteredChannels.length;
        this.focusedIndex = prevIndex;
        this.playChannel(prevIndex);
        return;
      }

      // --- Menu / Guide ---
      if (isMenu) {
        e.preventDefault();
        this.toggleDrawer();
        return;
      }

      // --- Media Play/Pause ---
      if (isPlayPause) {
        e.preventDefault();
        if (this.video.paused) this.video.play();
        else this.video.pause();
        return;
      }

      // --- OK / Enter / Select ---
      if (isOk) {
        e.preventDefault();
        if (this.isErrorToastVisible()) {
          this.hideError();
          this.playChannel(this.currentIndex);
          return;
        }
        if (this.isDrawerOpen) {
          this.playChannel(this.focusedIndex);
          this.closeDrawer();
        } else {
          this.openDrawer();
        }
        return;
      }

      // --- Back / Escape ---
      if (isBack) {
        if (this.isDrawerOpen) {
          e.preventDefault();
          this.closeDrawer();
          return;
        }
      }

      // --- Volume / Mute ---
      if (key === 'm' || key === 'M' || key === 'AudioVolumeMute' || keyCode === 164) {
        e.preventDefault();
        this.toggleSound();
        return;
      }

      if (key === '+' || key === '=' || key === 'AudioVolumeUp' || keyCode === 24) {
        e.preventDefault();
        this.video.muted = false;
        this.video.volume = Math.min(1.0, this.video.volume + 0.1);
        this.isUserUnmuted = true;
        this.updateSoundButtonUI();
        this.showUnmuteBanner(false);
        this.flashSoundHUD(`🔊 ভলিউম: ${Math.round(this.video.volume * 100)}%`);
        return;
      }

      if (key === '-' || key === '_' || key === 'AudioVolumeDown' || keyCode === 25) {
        e.preventDefault();
        this.video.volume = Math.max(0.0, this.video.volume - 0.1);
        this.flashSoundHUD(`🔉 ভলিউম: ${Math.round(this.video.volume * 100)}%`);
        return;
      }
    });
  }

  // 10. Mobile Touch Gestures
  bindTouchGestures() {
    let startY = 0;

    // ✅ শুধুমাত্র video-wrapper এ swipe gesture নেওয়া হবে
    // Drawer-এর ভেতরে যা হোক — এখানে আসবেই না, তাই close হওয়ার প্রশ্ন নেই
    const videoWrapper = document.getElementById('video-wrapper');
    if (!videoWrapper) return;

    videoWrapper.addEventListener('touchstart', (e) => {
      // Drawer-এর ভেতরে touch শুরু হলে ignore করো
      if (e.target.closest('#channel-drawer')) return;
      startY = e.touches[0].clientY;
    }, { passive: true });

    videoWrapper.addEventListener('touchend', (e) => {
      // Drawer-এর ভেতরে touch শেষ হলে ignore করো
      if (e.target.closest('#channel-drawer')) return;
      if (startY === 0) return;

      const endY = e.changedTouches[0].clientY;
      const diffY = startY - endY;
      startY = 0;

      // Swipe Up (আঙুল নিচ→উপর): Drawer খোলো
      if (diffY > 60 && !this.isDrawerOpen) {
        this.openDrawer();
      }
      // Swipe Down (আঙুল উপর→নিচ): Drawer বন্ধ করো
      // কিন্তু শুধু video area থেকে — drawer থেকে নয়
      else if (diffY < -60 && this.isDrawerOpen) {
        this.closeDrawer();
      }
    }, { passive: true });
  }

  // 11. Event Listeners (Clicks, PiP, Category, Error Retry)
  bindEvents() {
    // Tap video screen area: hides drawer if open, or toggles top bar
    document.getElementById('video-wrapper').addEventListener('click', (e) => {
      if (e.target.closest('#channel-drawer') || e.target.closest('#top-bar')) return;
      if (this.isDrawerOpen) {
        this.closeDrawer();
      } else {
        this.triggerTopBar();
      }
    });

    this.drawerHandle.addEventListener('click', () => this.toggleDrawer());

    // User interaction (mouse move or touch) to reveal top bar
    let activityDebounce = null;
    const handleUserInteraction = () => {
      if (activityDebounce) return;
      activityDebounce = setTimeout(() => { activityDebounce = null; }, 150);
      this.triggerTopBar();
    };
    window.addEventListener('mousemove', handleUserInteraction, { passive: true });
    window.addEventListener('touchstart', handleUserInteraction, { passive: true });

    // Sound Toggle Pill Button in Top Bar
    const btnSound = document.getElementById('btn-sound-toggle');
    if (btnSound) {
      btnSound.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleSound();
      });
    }

    // Floating Unmute Banner Click
    const unmuteBanner = document.getElementById('unmute-banner');
    if (unmuteBanner) {
      unmuteBanner.addEventListener('click', (e) => {
        e.stopPropagation();
        this.unmuteAudio();
      });
    }

    // Channels Pill Button in Top Bar
    const btnToggleChannels = document.getElementById('btn-toggle-channels');
    if (btnToggleChannels) {
      btnToggleChannels.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDrawer();
      });
    }

    // Keep floating drawer active on interaction & stop propagation to prevent accidental close
    this.channelDrawer.addEventListener('click', (e) => {
      e.stopPropagation();
    });
    this.channelDrawer.addEventListener('touchstart', (e) => {
      e.stopPropagation();
      this.resetDrawerAutoHide();
    }, { passive: true });
    this.channelDrawer.addEventListener('touchend', (e) => {
      e.stopPropagation();
    }, { passive: true });
    this.channelDrawer.addEventListener('mousemove', () => this.resetDrawerAutoHide());

    // Category pills (if present)
    if (this.categoryBar) {
      this.categoryBar.addEventListener('click', (e) => {
        const btn = e.target.closest('.cat-pill');
        if (!btn) return;
        this.categoryBar.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        this.focusedIndex = 0;
        this.filterChannels(btn.dataset.cat);
        this.resetDrawerAutoHide();
      });
    }

    // PiP Button
    const btnPip = document.getElementById('btn-pip');
    if (btnPip) {
      btnPip.addEventListener('click', async () => {
        // Native Android Bridge PiP
        const bridge = window.AndroidBridge || window.AndroidApp;
        if (bridge && typeof bridge.enterPip === 'function') {
          this.closeDrawer();
          this.hud.classList.add('hidden');
          bridge.enterPip();
          return;
        }

        // Web HTML5 PiP fallback
        try {
          if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
          } else if (this.video && this.video !== document.pictureInPictureElement) {
            this.closeDrawer();
            this.hud.classList.add('hidden');
            if (typeof this.video.requestPictureInPicture === 'function') {
              await this.video.requestPictureInPicture();
            }
          }
        } catch (err) {
          console.warn('PiP error / not supported:', err);
        }
      });
    }

    // Error Toast Retry on tap / click
    if (this.errorToast) {
      this.errorToast.addEventListener('click', () => {
        this.hideError();
        this.playChannel(this.currentIndex);
      });
    }


    // VIP Login form bindings & TV Remote OK support
    const authForm = document.getElementById('auth-form');
    if (authForm) {
      authForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitAuthForm();
      });
    }

    const submitBtn = document.getElementById('btn-auth-submit');
    if (submitBtn) {
      submitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.submitAuthForm();
      });
    }

    const codeInput = document.getElementById('input-customer-code');
    const pinInput = document.getElementById('input-customer-pin');

    if (codeInput) {
      codeInput.addEventListener('keydown', (e) => {
        const keyCode = e.keyCode || e.which;
        if (e.key === 'Enter' || keyCode === 13 || keyCode === 23 || keyCode === 66) {
          e.preventDefault();
          this.authModalFocusIndex = 1;
          this.updateAuthModalFocus();
        }
      });
    }

    if (pinInput) {
      pinInput.addEventListener('keydown', (e) => {
        const keyCode = e.keyCode || e.which;
        if (e.key === 'Enter' || keyCode === 13 || keyCode === 23 || keyCode === 66) {
          e.preventDefault();
          this.submitAuthForm();
        }
      });
    }
  }

  async submitAuthForm() {
    const codeInput = document.getElementById('input-customer-code');
    const pinInput = document.getElementById('input-customer-pin');
    const submitBtn = document.getElementById('btn-auth-submit');
    const errorDiv = document.getElementById('auth-error');

    const code = (codeInput ? codeInput.value : '').trim();
    const pin = (pinInput ? pinInput.value : '').trim();

    if (!code) {
      if (errorDiv) {
        errorDiv.textContent = 'গ্রাহক কোড লিখুন।';
        errorDiv.classList.remove('hidden');
      }
      this.authModalFocusIndex = 0;
      this.updateAuthModalFocus();
      return;
    }

    if (!pin) {
      if (errorDiv) {
        errorDiv.textContent = 'লগইন পিন লিখুন।';
        errorDiv.classList.remove('hidden');
      }
      this.authModalFocusIndex = 1;
      this.updateAuthModalFocus();
      return;
    }

    // Hide soft keyboard on TV/Mobile
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (bridge && typeof bridge.hideKeyboard === 'function') {
      bridge.hideKeyboard();
    }

    // Set Loading state on submit button
    const origBtnText = submitBtn ? submitBtn.textContent : 'আনলক করুন';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'যাচাই করা হচ্ছে...';
    }
    if (errorDiv) errorDiv.classList.add('hidden');

    try {
      const res = await fetch(`/api/customers?code=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}`);
      const json = await res.json();
      if (json.success) {
        const cust = json.data;
        const devInfo = this.getDeviceInfo();

        // Validate device limit with server
        const devRes = await fetch('/api/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customer_id: cust.id,
            customer_code: cust.customer_code,
            fingerprint: devInfo.deviceId,
            device_name: devInfo.deviceName,
            os: devInfo.os,
            browser: devInfo.browser
          })
        });
        const devJson = await devRes.json();

        if (!devJson.success) {
          if (errorDiv) {
            errorDiv.textContent = devJson.message || `সর্বোচ্চ ডিভাইস সীমা (${cust.max_devices || 2} টি) পূরণ হয়ে গেছে!`;
            errorDiv.classList.remove('hidden');
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = origBtnText;
          }
          return;
        }

        localStorage.setItem('bdtv_cust_code', code);
        localStorage.setItem('bdtv_cust_pin', pin);
        this.authModal.classList.add('hidden');
        if (errorDiv) errorDiv.classList.add('hidden');
        if (bridge && typeof bridge.showToast === 'function') {
          bridge.showToast('অভিনন্দন! আপনার ভিআইপি সাবস্ক্রিপশন সফলভাবে আনলক হয়েছে।');
        }
        await this.loadChannels();
      } else {
        if (errorDiv) {
          errorDiv.textContent = json.message || 'ভুল কোড বা পিন নম্বর।';
          errorDiv.classList.remove('hidden');
        }
      }
    } catch (err) {
      if (errorDiv) {
        errorDiv.textContent = 'সার্ভার সংযোগ সমস্যা। আবার চেষ্টা করুন।';
        errorDiv.classList.remove('hidden');
      }
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = origBtnText;
      }
    }
  }

  async checkSubscriptionLive() {
    if (!this.settings || !this.settings.subscription_restrictions_enabled) return;
    const custCode = localStorage.getItem('bdtv_cust_code');
    const custPin  = localStorage.getItem('bdtv_cust_pin');
    if (!custCode || !custPin) {
      this.showVipLockModal();
      return;
    }
    try {
      const deviceId = this.getDeviceId();
      const res = await fetch(
        `/api/channels?code=${encodeURIComponent(custCode)}&pin=${encodeURIComponent(custPin)}&device_id=${encodeURIComponent(deviceId)}&_ts=${Date.now()}`,
        { cache: 'no-store' }
      );
      const json = await res.json();

      // ── Device blocked by admin ──
      if (res.status === 403 || json.device_blocked) {
        this._stopPlayback();
        this.showExpiryLockScreen(json.message || '🚫 আপনার ডিভাইস ব্লক করা হয়েছে।<br>বিস্তারিত জানতে যোগাযোগ করুন:');
        return;
      }

      // ── Subscription expired / VIP locked ──
      if (json.vip_locked) {
        this._stopPlayback();
        this.showExpiryLockScreen(json.message);
      }
    } catch (e) {
      // Network error — do NOT lock (give benefit of doubt)
      console.warn('Live check failed (network):', e);
    }
  }

  // Internal helper — stop HLS + video immediately
  _stopPlayback() {
    if (this.hls) {
      try { this.hls.stopLoad(); this.hls.destroy(); } catch {}
      this.hls = null;
    }
    if (this.video) {
      this.video.pause();
      this.video.src = '';
    }
  }

  showExpiryLockScreen(message) {
    // Remove existing overlay if any
    const existing = document.getElementById('expiry-lock-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'expiry-lock-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 99999;
      background: rgba(0,0,0,0.96);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center; padding: 32px;
      font-family: 'Hind Siliguri', sans-serif;
    `;
    overlay.innerHTML = `
      <div style="font-size:64px; margin-bottom:16px;">🔒</div>
      <h2 style="color:#ff3b30; font-size:22px; margin:0 0 12px 0; font-weight:700;">সাবস্ক্রিপশন মেয়াদ শেষ</h2>
      <p style="color:#ccc; font-size:15px; margin:0 0 18px 0; max-width:340px; line-height:1.6;">
        ${message || 'আপনার সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে।<br>অনুগ্রহ করে নবায়ন করুন।'}
      </p>
      <div style="
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.18);
        padding: 10px 22px;
        border-radius: 12px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        gap: 10px;
      ">
        <span style="font-size: 20px;">📞</span>
        <span style="color:#ddd; font-size: 15px;">যোগাযোগ:</span>
        <a href="tel:01629666467" style="color: #00d2ff; font-size: 18px; font-weight: 700; text-decoration: none; letter-spacing: 0.5px;">01629666467</a>
      </div>
      <button id="expiry-relogin-btn" style="
        background: linear-gradient(135deg,#e50914,#ff6b35);
        color:#fff; border:3px solid transparent; padding:14px 32px;
        border-radius:12px; font-size:16px; font-weight:700;
        cursor:pointer; font-family:inherit; outline:none;
        transition: border-color 0.2s, transform 0.1s;
      ">🔄 লগইন করুন</button>
    `;
    document.body.appendChild(overlay);

    const reloginBtn = document.getElementById('expiry-relogin-btn');

    // Auto-focus the button so TV remote OK works immediately
    setTimeout(() => {
      if (reloginBtn) {
        reloginBtn.classList.add('focused');
        reloginBtn.style.borderColor = '#ffeb3b';
        reloginBtn.style.transform = 'scale(1.05)';
        reloginBtn.focus();
      }
    }, 150);

    reloginBtn.onclick = () => {
      localStorage.removeItem('bdtv_cust_code');
      localStorage.removeItem('bdtv_cust_pin');
      overlay.remove();
      this.showVipLockModal(message || 'সাবস্ক্রিপশনের মেয়াদ শেষ হয়ে গেছে।');
    };
  }

  sendHeartbeat() {
    try {
      const currentCh = this.filteredChannels && this.filteredChannels[this.currentIndex];
      const payload = {
        channel_name: currentCh ? currentCh.name : 'BDTv Player',
        stream_url: currentCh ? currentCh.url : '—',
        customer_code: localStorage.getItem('bdtv_cust_code') || '',
        device_id: this.getDeviceId()
      };
      fetch('/api/activity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Fingerprint': payload.device_id
        },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch {}
  }

  showBuffering(show) {
    const channel = (this.filteredChannels && this.filteredChannels[this.currentIndex]) ||
                    (this.channels && this.channels[this.currentIndex]);
    const name = channel ? (channel.name || '') : '';
    if (typeof window.bdtvShowBuffering === 'function') {
      window.bdtvShowBuffering(Boolean(show), name);
    }
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (bridge && typeof bridge.setChannelLoading === 'function') {
      bridge.setChannelLoading(Boolean(show), name);
    }
  }

  isErrorToastVisible() {
    return false;
  }

  showError(channelName) {
    // Permanently disabled for a clean, professional TV app interface
    this.hideError();
  }

  hideError() {
    if (this.errorToastTimeout) {
      clearTimeout(this.errorToastTimeout);
      this.errorToastTimeout = null;
    }
    if (this.errorToast) {
      this.errorToast.classList.add('hidden');
    }
  }
}

// 12. Android Back Button Native Bridge
window.handleAndroidBack = function() {
  const player = window.iptvPlayer;
  if (!player) return false;

  // Priority 1: Auth modal open → close it
  if (player.isAuthModalOpen && player.isAuthModalOpen()) {
    const bridge = window.AndroidBridge || window.AndroidApp;
    if (bridge && typeof bridge.hideKeyboard === 'function') bridge.hideKeyboard();
    if (player.authModal) player.authModal.classList.add('hidden');
    return true;
  }

  // Priority 2: Update modal open → dismiss it (if not forceUpdate)
  if (player.isUpdateModalOpen && player.isUpdateModalOpen()) {
    const laterBtn = document.getElementById('btn-update-later');
    const closeBtn = document.getElementById('btn-close-update');
    if (laterBtn && laterBtn.style.display !== 'none') { laterBtn.click(); return true; }
    if (closeBtn && closeBtn.style.display !== 'none') { closeBtn.click(); return true; }
    return true; // forceUpdate — block back
  }

  // Priority 3: Expiry screen → can't go back, force relogin
  if (player.isExpiryScreenOpen && player.isExpiryScreenOpen()) {
    const btn = document.getElementById('expiry-relogin-btn');
    if (btn) btn.click();
    return true;
  }

  // Priority 4: Drawer open → close it
  if (player.isDrawerOpen) {
    player.closeDrawer();
    return true;
  }

  const drawer = document.getElementById('channel-drawer');
  if (drawer && drawer.classList.contains('open')) {
    drawer.classList.remove('open');
    return true;
  }

  return false; // let Android WebView handle default (exit app)
};

// Start Player on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  window.iptvPlayer = new IPTVPlayer();
});
