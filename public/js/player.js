// ==========================================
// BDTv Live IPTV Web Player Engine
// ==========================================

const INSTALLED_APP_VERSION = 123;

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
    this.bufferingOverlay = document.getElementById('buffering-overlay');
    this.errorOverlay = document.getElementById('error-overlay');
    this.errorMessage = document.getElementById('error-message');
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

    this.init();
  }

  async init() {
    this.bindVideoEvents();
    this.bindEvents();
    this.bindRemoteKeys();
    this.bindTouchGestures();
    this.bindAudioUnlock();
    await this.loadSettings();
    await this.loadChannels();
    this.checkAppUpdate();

    // Real-time activity heartbeat every 25 seconds
    setInterval(() => this.sendHeartbeat(), 25000);

    // Subscription + device block watcher — check every 30 seconds during playback
    setInterval(() => this.checkSubscriptionLive(), 30 * 1000);
  }

  // 1. Load Settings (Notice, Ads, Subscription switch)
  async loadSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success && data.data) {
        this.settings = data.data;

        // Notice Bar
        if (this.settings.notice_active && this.settings.notice_text) {
          this.noticeText.textContent = this.settings.notice_text;
          this.noticeBar.classList.remove('hidden');
        }

        // Ads Injection
        this.renderAds(this.settings.ads || {});

        // Check subscription restriction
        if (this.settings.subscription_restrictions_enabled) {
          this.checkSubscriptionAccess();
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
    try {
      const res = await fetch('/api/version?t=' + Date.now());
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !json.versionCode) return;

      const bridge = window.AndroidApp || window.AndroidBridge;

      // 1. Android অ্যাপে — Native Bridge থেকে সরাসরি ইন্সটল্ড ভার্সন কোড পড়ো
      const nativeVersion = bridge && typeof bridge.getAppVersionCode === 'function'
        ? Number(bridge.getAppVersionCode())
        : 0;

      let installedVersion = 0;
      if (nativeVersion > 0) {
        // Android অ্যাপের ভেতর থেকে খোলা — সত্যিকারের ইন্সটল্ড কোড ব্যবহার করো
        installedVersion = nativeVersion;
      } else {
        // Browser / WebView fallback
        const savedVersion = Number(localStorage.getItem('bdtv_app_version'));
        installedVersion = Math.max(
          INSTALLED_APP_VERSION,
          Number.isFinite(savedVersion) ? savedVersion : 0
        );
      }

      // 2. ইতিমধ্যে এই ভার্সনের পপআপ dismiss করা হয়েছে কিনা চেক করো
      //    (শুধু browser mode-এ প্রযোজ্য, force update এ এটা bypass হবে)
      const dismissedVersion = Number(localStorage.getItem('bdtv_update_dismissed'));
      const alreadyDismissed = dismissedVersion >= json.versionCode;

      // 3. সার্ভারে নতুন ভার্সন নেই → সব বাটন লুকাও
      if (installedVersion >= json.versionCode) {
        const dlBtn = document.getElementById('btn-download-app');
        if (dlBtn) dlBtn.classList.add('hidden');
        return;
      }

      // 4. নতুন ভার্সন আছে → টপ বার বাটন দেখাও
      const dlBtn = document.getElementById('btn-download-app');
      if (dlBtn) {
        dlBtn.href = json.apkUrl || '/BDTv.apk';
        dlBtn.classList.remove('hidden');
      }

      // 5. Force Update: dismiss করলেও পপআপ আসবে
      //    Normal Update: আগে dismiss করা থাকলে চুপ থাকো
      if (json.forceUpdate || !alreadyDismissed) {
        this.showUpdateModal(json);
      }

    } catch (e) {
      console.warn('checkAppUpdate error:', e);
    }
  }

  showUpdateModal(info) {
    const modal = document.getElementById('update-modal');
    if (!modal) return;
    const titleEl = document.getElementById('update-modal-title');
    const verEl = document.getElementById('update-modal-version');
    const listEl = document.getElementById('update-changelog-list');
    const dlBtn = document.getElementById('btn-update-download');

    if (titleEl && info.updateTitle) titleEl.textContent = info.updateTitle;
    if (verEl && info.versionName) verEl.textContent = `v${info.versionName}`;
    if (dlBtn && info.apkUrl) dlBtn.href = info.apkUrl;

    if (listEl && info.changelog && Array.isArray(info.changelog)) {
      listEl.innerHTML = info.changelog.map(item => `<li>${item}</li>`).join('');
    }

    modal.classList.remove('hidden');
    this.updateModalFocusIndex = 0;
    setTimeout(() => this.updateUpdateModalFocus(), 100);

    const closeBtn = document.getElementById('btn-close-update');
    const laterBtn = document.getElementById('btn-update-later');

    const dismiss = () => {
      modal.classList.add('hidden');
      // forceUpdate হলে dismiss save করো না — পরেরবারও দেখাবে
      if (!info.forceUpdate) {
        localStorage.setItem('bdtv_update_dismissed', info.versionCode);
      }
    };

    // forceUpdate হলে X বাটন ও পরে করুন লুকাও
    if (info.forceUpdate) {
      if (closeBtn) closeBtn.style.display = 'none';
      if (laterBtn) laterBtn.style.display = 'none';
    } else {
      if (closeBtn) { closeBtn.style.display = ''; closeBtn.onclick = dismiss; }
      if (laterBtn) { laterBtn.style.display = ''; laterBtn.onclick = dismiss; }
    }

    if (dlBtn) {
      dlBtn.onclick = (e) => {
        localStorage.setItem('bdtv_update_dismissed', info.versionCode);
        const bridge = window.AndroidApp || window.AndroidBridge;
        if (bridge && typeof bridge.startAppUpdate === 'function') {
          e.preventDefault();
          bridge.startAppUpdate(info.apkUrl || 'https://bdtv-app.vercel.app/BDTv.apk');
        }
        modal.classList.add('hidden');
      };
    }
  }

  // 2. Fetch Channels (API -> Fallback)
  async loadChannels() {
    this.showBuffering(true);
    const custCode = localStorage.getItem('bdtv_cust_code') || '';
    const custPin  = localStorage.getItem('bdtv_cust_pin') || '';

    // If VIP mode enabled and user has no credentials, prompt modal and do not load
    if (this.settings.subscription_restrictions_enabled && (!custCode || !custPin)) {
      this.showVipLockModal();
      return;
    }

    try {
      const devInfo = this.getDeviceInfo();
      const url = `/api/channels?code=${encodeURIComponent(custCode)}&pin=${encodeURIComponent(custPin)}&device_id=${encodeURIComponent(devInfo.deviceId)}`;
      const res = await fetch(url);
      const json = await res.json();

      if (json.vip_locked) {
        this.showVipLockModal(json.message);
        return;
      }

      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        this.channels = json.data;
      } else {
        throw new Error('No channels from API');
      }
    } catch (err) {
      // SECURITY: If VIP/subscription mode is ON, NEVER show fallback demo channels
      if (this.settings.subscription_restrictions_enabled) {
        this.showVipLockModal('সার্ভার সংযোগ সমস্যা। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
        return;
      }
      console.warn('Fallback to demo channels:', err);
      this.channels = FALLBACK_CHANNELS;
    }

    this.filterChannels('All');
    if (this.channels.length > 0) {
      this.playChannel(0);
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

  renderChannelGrid() {
    this.channelGrid.innerHTML = '';
    this.filteredChannels.forEach((ch, idx) => {
      const card = document.createElement('div');
      card.className = `channel-card ${idx === this.focusedIndex ? 'focused' : ''} ${idx === this.currentIndex ? 'active-playing' : ''}`;
      card.tabIndex = 0;
      card.dataset.index = idx;

      card.innerHTML = `
        <div class="ch-logo-wrap">
          <img src="${ch.logo || 'https://via.placeholder.com/60x60?text=TV'}" alt="${ch.name}" onerror="this.src='https://via.placeholder.com/60x60?text=TV'">
        </div>
        <div class="ch-title">${ch.name}</div>
      `;

      card.addEventListener('click', () => {
        this.focusedIndex = idx;
        this.updateCardFocus();
        this.playChannel(idx);
        this.closeDrawer();
      });

      this.channelGrid.appendChild(card);
    });
  }

  // 4. Video Events & HLS.js Live Streaming Engine
  bindVideoEvents() {
    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => {
      this.showBuffering(false);
      this.hideError();
      if (this.video.muted && !this.isUserUnmuted) {
        this.showUnmuteBanner(true);
      } else {
        this.showUnmuteBanner(false);
      }
      this.updateSoundButtonUI();
    });
    this.video.addEventListener('timeupdate', () => {
      if (this.video && this.video.currentTime > 0) {
        this.showBuffering(false);
      }
    });
    this.video.addEventListener('volumechange', () => {
      this.updateSoundButtonUI();
    });
    this.video.addEventListener('error', () => {
      this.showError('প্লেব্যাক এরর: ভিডিও প্লে করা যায়নি।');
    });
  }

  initHLS() {
    if (!Hls.isSupported()) return;

    this.hls = new Hls({
      enableWorker: true,
      lowLatencyMode: false,
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
      this.hideError();
      this.attemptPlay();
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
              // Feature 2: Auto-failover — try backup_url before full reload
              const ch = this.filteredChannels[this.currentIndex];
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
          default:
            this.showError('লাইভ সম্প্রচার লোড করা সম্ভব হয়নি।');
            break;
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
    this.flashSoundHUD('🔊 সাউন্ড চালু (১০০%)');
  }

  toggleSound() {
    if (this.video.muted) {
      this.unmuteAudio();
    } else {
      this.video.muted = true;
      this.showUnmuteBanner(false);
      this.updateSoundButtonUI();
      this.flashSoundHUD('🔇 সাউন্ড মিউট');
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
    const hud = document.getElementById('channel-hud');
    if (!hud) return;
    document.getElementById('hud-channel-name').textContent = msg;
    document.getElementById('hud-channel-cat').textContent = 'অডিও ভলিউম';
    const logo = document.getElementById('hud-channel-logo');
    if (logo) logo.classList.add('hidden');
    hud.classList.remove('hidden');
    clearTimeout(this.hudTimeout);
    this.hudTimeout = setTimeout(() => hud.classList.add('hidden'), 2200);
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
    if (index < 0 || index >= this.filteredChannels.length) return;
    this.currentIndex = index;
    const channel = this.filteredChannels[index];

    // 1. Instantly STOP old stream & show buffering overlay immediately (no blank black freeze!)
    this.showBuffering(true);
    this.video.pause();
    if (this.hls) {
      try {
        this.hls.stopLoad();
        this.hls.destroy();
      } catch (e) {}
      this.hls = null;
    }

    // 2. Update Top Bar & HUD
    document.getElementById('top-channel-name').textContent = channel.name;
    const topLogo = document.getElementById('top-channel-logo');
    if (channel.logo) {
      topLogo.src = channel.logo;
      topLogo.classList.remove('hidden');
    } else {
      topLogo.classList.add('hidden');
    }

    this.flashHUD(channel);
    this.showBuffering(true);
    this.sendHeartbeat();
    this.hideError();

    // 3. Clean stream URL & Start fresh clean stream
    const cleanUrl = channel.url.replace(/([?&])nocache=\d+(&|$)/, '$1').replace(/[?&]$/, '');
    const isM3u8 = cleanUrl.includes('.m3u8') || cleanUrl.includes('/hls') || cleanUrl.includes('/mono') || cleanUrl.includes('playlist');
    if (Hls.isSupported() && isM3u8) {
      this.initHLS();
      this.hls.loadSource(cleanUrl);
    } else {
      this.video.src = cleanUrl;
      this.attemptPlay();
    }

    // Update card highlights without full re-render (prevents wrong-channel visual bug)
    this.updateCardFocus();
    this.triggerTopBar();
  }

  // 6. Flash TV Channel Switch HUD
  flashHUD(channel) {
    document.getElementById('hud-channel-name').textContent = channel.name;
    document.getElementById('hud-channel-cat').textContent = channel.category || 'Live TV';
    const hudLogo = document.getElementById('hud-channel-logo');
    if (channel.logo) {
      hudLogo.src = channel.logo;
      hudLogo.classList.remove('hidden');
    } else {
      hudLogo.classList.add('hidden');
    }

    this.hud.classList.remove('hidden');
    clearTimeout(this.hudTimeout);
    this.hudTimeout = setTimeout(() => {
      this.hud.classList.add('hidden');
    }, 1800);
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
    setTimeout(() => this.updateCardFocus(), 100);
    setTimeout(() => this.updateCardFocus(), 300);
  }

  closeDrawer() {
    this.isDrawerOpen = false;
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

    // Error Retry & Next Channel
    document.getElementById('btn-retry').addEventListener('click', () => {
      this.playChannel(this.currentIndex);
    });

    document.getElementById('btn-next-channel').addEventListener('click', () => {
      const nextIndex = (this.currentIndex + 1) % this.filteredChannels.length;
      this.playChannel(nextIndex);
    });


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
        customer_code: localStorage.getItem('bdtv_cust_code') || 'Guest'
      };
      fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch {}
  }

  showBuffering(show) {
    if (show) this.bufferingOverlay.classList.remove('hidden');
    else this.bufferingOverlay.classList.add('hidden');
  }

  showError(msg) {
    this.showBuffering(false);
    this.errorMessage.textContent = msg || 'লাইভ সম্প্রচার লোড করা সম্ভব হয়নি।';
    this.errorOverlay.classList.remove('hidden');
  }

  hideError() {
    this.errorOverlay.classList.add('hidden');
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
