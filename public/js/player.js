// ==========================================
// BDTv Live IPTV Web Player Engine
// ==========================================

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
  }

  async checkAppUpdate() {
    try {
      const res = await fetch('/api/version');
      if (!res.ok) return;
      const json = await res.json();
      if (!json || !json.versionCode) return;

      const installedVersion = Number(localStorage.getItem('bdtv_app_version') || '108');
      if (json.versionCode > installedVersion || json.forceUpdate) {
        // আপডেট আছে — টপ বার বাটন দেখাও
        const dlBtn = document.getElementById('btn-download-app');
        if (dlBtn) {
          dlBtn.href = json.apkUrl || '/BDTv.apk';
          dlBtn.classList.remove('hidden');
        }
        this.showUpdateModal(json);
      } else {
        // আপডেট নেই — বাটন লুকিয়ে রাখো
        const dlBtn = document.getElementById('btn-download-app');
        if (dlBtn) dlBtn.classList.add('hidden');
      }
    } catch (e) {}
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

    const closeBtn = document.getElementById('btn-close-update');
    const laterBtn = document.getElementById('btn-update-later');
    const dismiss = () => {
      modal.classList.add('hidden');
      localStorage.setItem('bdtv_app_version', info.versionCode);
    };
    if (closeBtn) closeBtn.onclick = dismiss;
    if (laterBtn) laterBtn.onclick = dismiss;
    if (dlBtn) {
      dlBtn.onclick = (e) => {
        localStorage.setItem('bdtv_app_version', info.versionCode);
        const bridge = window.AndroidApp || window.AndroidBridge;
        if (bridge && typeof bridge.startAppUpdate === 'function') {
          e.preventDefault();
          bridge.startAppUpdate(info.apkUrl || 'https://bdtv-app.vercel.app/BDTv.apk');
        }
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
      const url = `/api/channels?code=${encodeURIComponent(custCode)}&pin=${encodeURIComponent(custPin)}`;
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
      if (this.settings.subscription_restrictions_enabled && (!custCode || !custPin)) {
        this.showVipLockModal();
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
    if (cat === 'All') {
      this.filteredChannels = [...this.channels];
    } else {
      this.filteredChannels = this.channels.filter(c => c.category && c.category.toLowerCase() === cat.toLowerCase());
    }
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
        <div class="ch-category-badge">${ch.category || 'General'}</div>
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
      lowLatencyMode: false,          // Avoid micro-buffer stalls on standard CDN streams!
      backBufferLength: 10,           // Don't waste RAM caching past 10s on TV/mobile
      maxBufferLength: 20,            // Buffer 20 seconds ahead
      maxMaxBufferLength: 40,         // Up to 40 seconds max
      maxBufferSize: 30 * 1024 * 1024,// 30 MB buffer limit
      liveSyncDurationCount: 4,       // 4 segments live sync for maximum buffer stability
      liveMaxLatencyDurationCount: 8, // Allow up to 8 segments without forced skipping
      maxBufferHole: 0.5,             // Jump across any 0.5s gaps seamlessly without freezing
      highBufferWatchdogPeriod: 2,
      nudgeOffset: 0.2,
      nudgeMaxRetry: 5,
      fragLoadingTimeOut: 20000,      // 20s fragment timeout
      manifestLoadingTimeOut: 15000,
      startFragPrefetch: true,        // Prefetch first fragment for instant start!
      capLevelToPlayerSize: true
    });

    this.hls.attachMedia(this.video);

    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.showBuffering(false);
      this.hideError();
      this.attemptPlay();
    });

    this.hls.on(Hls.Events.FRAG_BUFFERED, () => {
      this.showBuffering(false);
    });

    // Activate first audio track if not active
    this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
      if (data && data.audioTracks && data.audioTracks.length > 0) {
        if (this.hls.audioTrack === -1) {
          this.hls.audioTrack = 0;
        }
      }
    });

    this.hls.on(Hls.Events.ERROR, (event, data) => {
      console.warn('HLS Event Error:', data);
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            console.log('HLS Network error, attempting recovery...');
            this.hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            console.log('HLS Media error, attempting recovery...');
            this.hls.recoverMediaError();
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

    // 1. Instantly STOP old stream & destroy old HLS pipeline (Prevents audio bleed/overlap completely!)
    this.video.pause();
    if (this.hls) {
      try {
        this.hls.stopLoad();
        this.hls.destroy();
      } catch (e) {}
      this.hls = null;
    }
    this.video.removeAttribute('src');
    this.video.load(); // Flushes all hardware audio/video decoders & buffers!

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

    // 3. Start fresh clean stream
    const isM3u8 = channel.url.includes('.m3u8') || channel.url.includes('/hls') || channel.url.includes('/mono') || channel.url.includes('playlist');
    if (Hls.isSupported() && isM3u8) {
      this.initHLS();
      this.hls.loadSource(channel.url);
    } else {
      this.video.src = channel.url;
      this.attemptPlay();
    }

    this.renderChannelGrid();
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
    }, 2500);
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

  // 8. Drawer Controls (Persistent Shelf: NEVER auto-hides while user scrolls or browses)
  // Closed ONLY when:
  // a) User clicks on video player screen area
  // b) User selects and plays a specific channel
  // c) User explicitly clicks "Channels" toggle button in top bar
  openDrawer() {
    this.isDrawerOpen = true;
    this.channelDrawer.classList.add('open');
    this.topBar.classList.remove('fade-out');
    clearTimeout(this.topBarTimeout);
    this.updateCardFocus();
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
      if (idx === this.focusedIndex) {
        card.classList.add('focused');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        card.classList.remove('focused');
      }
    });
  }

  // 9. Android TV Remote Control Logic
  bindRemoteKeys() {
    window.addEventListener('keydown', (e) => {
      const key = e.key;

      switch (key) {
        case 'ArrowUp':
          e.preventDefault();
          if (!this.isDrawerOpen) {
            this.openDrawer();
          } else {
            // Navigate focus backward by grid columns (approx 4)
            this.focusedIndex = Math.max(0, this.focusedIndex - 4);
            this.updateCardFocus();
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (this.isDrawerOpen) {
            const maxIdx = this.filteredChannels.length - 1;
            this.focusedIndex = Math.min(maxIdx, this.focusedIndex + 4);
            this.updateCardFocus();
          } else {
            this.openDrawer();
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (this.isDrawerOpen) {
            this.focusedIndex = Math.max(0, this.focusedIndex - 1);
            this.updateCardFocus();
          } else {
            // Instant channel switch previous
            const prevIndex = (this.currentIndex - 1 + this.filteredChannels.length) % this.filteredChannels.length;
            this.focusedIndex = prevIndex;
            this.playChannel(prevIndex);
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (this.isDrawerOpen) {
            const maxIdx = this.filteredChannels.length - 1;
            this.focusedIndex = Math.min(maxIdx, this.focusedIndex + 1);
            this.updateCardFocus();
          } else {
            // Instant channel switch next
            const nextIndex = (this.currentIndex + 1) % this.filteredChannels.length;
            this.focusedIndex = nextIndex;
            this.playChannel(nextIndex);
          }
          break;

        case 'Enter':
        case 'Select':
          e.preventDefault();
          if (this.isDrawerOpen) {
            this.playChannel(this.focusedIndex);
            this.closeDrawer();
          } else {
            // Play/Pause when drawer is closed
            if (this.video.paused) this.video.play();
            else this.video.pause();
            this.triggerTopBar();
          }
          break;

        case 'Escape':
        case 'Back':
        case 'BrowserBack':
          if (this.isDrawerOpen) {
            e.preventDefault();
            this.closeDrawer();
          }
          break;

        case 'm':
        case 'M':
        case 'AudioVolumeMute':
          e.preventDefault();
          this.toggleSound();
          break;

        case '+':
        case '=':
        case 'AudioVolumeUp':
          e.preventDefault();
          this.video.muted = false;
          this.video.volume = Math.min(1.0, this.video.volume + 0.1);
          this.isUserUnmuted = true;
          this.updateSoundButtonUI();
          this.showUnmuteBanner(false);
          this.flashSoundHUD(`🔊 ভলিউম: ${Math.round(this.video.volume * 100)}%`);
          break;

        case '-':
        case '_':
        case 'AudioVolumeDown':
          e.preventDefault();
          this.video.volume = Math.max(0.0, this.video.volume - 0.1);
          this.flashSoundHUD(`🔉 ভলিউম: ${Math.round(this.video.volume * 100)}%`);
          break;
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

    // Category pills
    this.categoryBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.cat-pill');
      if (!btn) return;
      this.categoryBar.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      this.focusedIndex = 0;
      this.filterChannels(btn.dataset.cat);
      this.resetDrawerAutoHide();
    });

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


    // VIP Login form
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = document.getElementById('input-customer-code').value.trim();
      const pin = document.getElementById('input-customer-pin').value.trim();
      const errorDiv = document.getElementById('auth-error');

      try {
        const res = await fetch(`/api/customers?code=${encodeURIComponent(code)}&pin=${encodeURIComponent(pin)}`);
        const json = await res.json();
        if (json.success) {
          localStorage.setItem('bdtv_cust_code', code);
          localStorage.setItem('bdtv_cust_pin', pin);
          this.authModal.classList.add('hidden');
          if (errorDiv) errorDiv.classList.add('hidden');
          const bridge = window.AndroidBridge || window.AndroidApp;
          if (bridge && typeof bridge.showToast === 'function') {
            bridge.showToast('অভিনন্দন! আপনার ভিআইপি সাবস্ক্রিপশন সফলভাবে আনলক হয়েছে।');
          }
          await this.loadChannels();
        } else {
          errorDiv.textContent = json.message || 'ভুল কোড বা পিন নম্বর।';
          errorDiv.classList.remove('hidden');
        }
      } catch (err) {
        errorDiv.textContent = 'সার্ভার সংযোগ সমস্যা। আবার চেষ্টা করুন।';
        errorDiv.classList.remove('hidden');
      }
    });
  }

  sendHeartbeat() {
    try {
      const currentCh = this.channels && this.channels[this.currentIndex];
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
  if (window.iptvPlayer && window.iptvPlayer.isDrawerOpen) {
    window.iptvPlayer.closeDrawer();
    return true; // handled
  }
  const drawer = document.getElementById('channel-drawer');
  if (drawer && drawer.classList.contains('open')) {
    drawer.classList.remove('open');
    return true; // handled
  }
  return false; // let Android WebView handle default
};

// Start Player on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  window.iptvPlayer = new IPTVPlayer();
});
