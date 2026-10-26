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
    this.settings = {};

    this.init();
  }

  async init() {
    this.initHLS();
    this.bindEvents();
    this.bindRemoteKeys();
    this.bindTouchGestures();
    await this.loadSettings();
    await this.loadChannels();
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
    if (!custCode) {
      this.authModal.classList.remove('hidden');
    }
  }

  // 2. Fetch Channels (API -> Fallback)
  async loadChannels() {
    this.showBuffering(true);
    try {
      const res = await fetch('/api/channels');
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        this.channels = json.data;
      } else {
        throw new Error('No channels from API');
      }
    } catch (err) {
      console.warn('Fallback to demo channels:', err);
      this.channels = FALLBACK_CHANNELS;
    }

    this.filterChannels('All');
    if (this.channels.length > 0) {
      this.playChannel(0);
      // Floating channel shelf auto-shows on load, then auto-hides after 5s
      setTimeout(() => this.openDrawer(5000), 600);
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
        setTimeout(() => this.closeDrawer(), 800);
      });

      this.channelGrid.appendChild(card);
    });
  }

  // 4. HLS.js Live Streaming Engine
  initHLS() {
    if (Hls.isSupported()) {
      this.hls = new Hls({
        lowLatencyMode: true,
        enableWorker: true,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 5
      });

      this.hls.attachMedia(this.video);

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.showBuffering(false);
        this.hideError();
        this.video.play().catch(() => {
          // Fallback to muted autoplay if browser blocks audio
          this.video.muted = true;
          this.video.play();
        });
      });

      this.hls.on(Hls.Events.ERROR, (event, data) => {
        console.warn('HLS Event Error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              this.hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              this.hls.recoverMediaError();
              break;
            default:
              this.showError('লাইভ সম্প্রচার লোড করা সম্ভব হয়নি।');
              break;
          }
        }
      });
    }

    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => {
      this.showBuffering(false);
      this.hideError();
    });
    this.video.addEventListener('error', () => {
      this.showError('প্লেব্যাক এরর: ভিডিও প্লে করা যায়নি।');
    });
  }

  // 5. Play Specific Channel
  playChannel(index) {
    if (index < 0 || index >= this.filteredChannels.length) return;
    this.currentIndex = index;
    const channel = this.filteredChannels[index];

    // Update Top Bar & HUD
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
    this.hideError();

    // Stream playback
    if (this.hls && channel.url.includes('.m3u8')) {
      this.hls.loadSource(channel.url);
    } else {
      this.video.src = channel.url;
      this.video.play().catch(() => {
        this.video.muted = true;
        this.video.play();
      });
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

  // 8. Drawer Controls (Floating Channel Shelf with Auto-Hide)
  openDrawer(duration = 4500) {
    this.isDrawerOpen = true;
    this.channelDrawer.classList.add('open');
    this.topBar.classList.remove('fade-out');
    clearTimeout(this.topBarTimeout);
    clearTimeout(this.drawerAutoHideTimeout);
    this.updateCardFocus();

    if (duration > 0) {
      this.drawerAutoHideTimeout = setTimeout(() => {
        this.closeDrawer();
      }, duration);
    }
  }

  closeDrawer() {
    this.isDrawerOpen = false;
    this.channelDrawer.classList.remove('open');
    clearTimeout(this.drawerAutoHideTimeout);
    this.triggerTopBar();
  }

  resetDrawerAutoHide(duration = 4500) {
    if (this.isDrawerOpen) {
      clearTimeout(this.drawerAutoHideTimeout);
      this.drawerAutoHideTimeout = setTimeout(() => {
        this.closeDrawer();
      }, duration);
    }
  }

  toggleDrawer() {
    if (this.isDrawerOpen) this.closeDrawer();
    else this.openDrawer(4500);
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
            this.openDrawer(4500);
          } else {
            // Navigate focus backward by grid columns (approx 4)
            this.focusedIndex = Math.max(0, this.focusedIndex - 4);
            this.updateCardFocus();
            this.resetDrawerAutoHide();
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (this.isDrawerOpen) {
            const maxIdx = this.filteredChannels.length - 1;
            this.focusedIndex = Math.min(maxIdx, this.focusedIndex + 4);
            this.updateCardFocus();
            this.resetDrawerAutoHide();
          } else {
            this.openDrawer(4500);
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (this.isDrawerOpen) {
            this.focusedIndex = Math.max(0, this.focusedIndex - 1);
            this.updateCardFocus();
            this.resetDrawerAutoHide();
          } else {
            // Instant channel switch previous and flash floating drawer briefly
            const prevIndex = (this.currentIndex - 1 + this.filteredChannels.length) % this.filteredChannels.length;
            this.focusedIndex = prevIndex;
            this.playChannel(prevIndex);
            this.openDrawer(3500);
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (this.isDrawerOpen) {
            const maxIdx = this.filteredChannels.length - 1;
            this.focusedIndex = Math.min(maxIdx, this.focusedIndex + 1);
            this.updateCardFocus();
            this.resetDrawerAutoHide();
          } else {
            // Instant channel switch next and flash floating drawer briefly
            const nextIndex = (this.currentIndex + 1) % this.filteredChannels.length;
            this.focusedIndex = nextIndex;
            this.playChannel(nextIndex);
            this.openDrawer(3500);
          }
          break;

        case 'Enter':
        case 'Select':
          e.preventDefault();
          if (this.isDrawerOpen) {
            this.playChannel(this.focusedIndex);
            setTimeout(() => this.closeDrawer(), 800);
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
      }
    });
  }

  // 10. Mobile Touch Gestures
  bindTouchGestures() {
    let startY = 0;
    let endY = 0;

    window.addEventListener('touchstart', (e) => {
      startY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      endY = e.changedTouches[0].clientY;
      const diffY = startY - endY;

      // Swipe Up: Open drawer
      if (diffY > 60 && !this.isDrawerOpen) {
        this.openDrawer();
      }
      // Swipe Down: Close drawer
      else if (diffY < -60 && this.isDrawerOpen) {
        this.closeDrawer();
      }
    }, { passive: true });
  }

  // 11. Event Listeners (Clicks, PiP, Category, Error Retry)
  bindEvents() {
    // Tap video screen to toggle top bar & floating channels
    document.getElementById('video-wrapper').addEventListener('click', (e) => {
      if (e.target.closest('#channel-drawer') || e.target.closest('#top-bar')) return;
      if (this.isDrawerOpen) {
        this.closeDrawer();
      } else {
        this.triggerTopBar();
        this.openDrawer(4500);
      }
    });

    this.drawerHandle.addEventListener('click', () => this.toggleDrawer());

    // Channels Pill Button in Top Bar
    const btnToggleChannels = document.getElementById('btn-toggle-channels');
    if (btnToggleChannels) {
      btnToggleChannels.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleDrawer();
      });
    }

    // Keep floating drawer active on interaction
    this.channelDrawer.addEventListener('mousemove', () => this.resetDrawerAutoHide());
    this.channelDrawer.addEventListener('touchstart', () => this.resetDrawerAutoHide(), { passive: true });

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
    document.getElementById('btn-pip').addEventListener('click', async () => {
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
        } else if (this.video !== document.pictureInPictureElement) {
          this.closeDrawer();
          this.hud.classList.add('hidden');
          await this.video.requestPictureInPicture();
        }
      } catch (err) {
        alert('আপনার ব্রাউজারে পিকচার-ইন-পিকচার সাপোর্ট করে না।');
      }
    });

    // Error Retry & Next Channel
    document.getElementById('btn-retry').addEventListener('click', () => {
      this.playChannel(this.currentIndex);
    });

    document.getElementById('btn-next-channel').addEventListener('click', () => {
      const nextIndex = (this.currentIndex + 1) % this.filteredChannels.length;
      this.playChannel(nextIndex);
    });

    // Report Channel
    document.getElementById('btn-report').addEventListener('click', async () => {
      const currentCh = this.filteredChannels[this.currentIndex];
      if (!currentCh) return;
      const msg = prompt(`'${currentCh.name}' চ্যানেলটিতে কি সমস্যা হচ্ছে?`, 'স্ট্রিম আটকে গেছে / লোড হচ্ছে না');
      if (msg) {
        try {
          await fetch('/api/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channel_id: currentCh.id,
              channel_name: currentCh.name,
              error_message: msg
            })
          });
          alert('রিপোর্ট সফলভাবে জমা হয়েছে। আমরা শীঘ্রই এটি সমাধান করব!');
        } catch (e) {
          alert('রিপোর্ট পাঠাতে ব্যর্থ হয়েছে।');
        }
      }
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
          this.authModal.classList.add('hidden');
          alert('অভিনন্দন! আপনার সাবস্ক্রিপশন সফলভাবে যাচাই হয়েছে।');
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
