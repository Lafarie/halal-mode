// Halal Mode - Content Script
// Powered by Gemini Vision AI with On-Screen & Popup Unblur Controls + Skip or Blur modes

(() => {
  // State
  let settings = {
    enabled: true,
    apiKey: "",
    aiProvider: 'gemini',
    actionMode: 'blur', // 'blur' (heavy blur + on-screen unblur) or 'skip' (auto-skip reel)
    preScanEnabled: true,
    shieldMode: true,
    removeSkippedFromFeed: true, // Remove / collapse skipped reels from scroll feed
    dailyLimitEnabled: true,
    dailyScrollLimit: 100,
    todayScrollCount: 0,
    todayDate: "",
    cornerTolerance: 0, // 0 = Strict (No girls anywhere on screen), 50 = Corner OK, up to 100
    sensitivity: 65,
    scanIntervalMs: 800,
    showToast: true
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Helper: Verify that the current page/element is strictly a Reel (Instagram Reels, YouTube Shorts, TikTok)
  // Absolutely excludes Instagram Stories, Direct Messages, profile pages, etc.
  function isReelContext(video = null) {
    const host = window.location.hostname || '';
    const path = window.location.pathname || '';

    // 1. Instagram: strictly reels only!
    if (host.includes('instagram.com')) {
      // Explicitly reject stories, direct messages, accounts/settings
      if (path.startsWith('/stories') || path.startsWith('/direct') || path.startsWith('/accounts')) {
        return false;
      }
      // Reject any story elements in DOM if video is provided
      if (video) {
        if (video.closest('section[role="region"]') || 
            video.closest('section[role="dialog"]') ||
            video.closest('div[role="dialog"]') ||
            video.closest('div[data-story-id]') || 
            video.closest('div[aria-label*="Story"]') || 
            video.closest('div[aria-label*="story"]') ||
            video.closest('div[aria-label*="Stories"]') ||
            video.closest('div[aria-label*="stories"]')) {
          return false;
        }
      }
      // Instagram Reels paths
      if (path.startsWith('/reels') || path.startsWith('/reel')) {
        return true;
      }
      return false;
    }

    // 2. YouTube: strictly Shorts only
    if (host.includes('youtube.com')) {
      return path.startsWith('/shorts');
    }

    // 3. TikTok: all short-form videos
    if (host.includes('tiktok.com')) {
      return true;
    }

    return false;
  }

  const countedProtectedReelKeys = new Set();

  // Deduplicated increment helper to prevent runaway counter loops
  function markAndIncrementProtected(video) {
    if (!video || !isReelContext(video)) return;

    const reelId = getReelIdentifier(video);
    const reelUrl = getReelUrl(video);
    const key = reelId || reelUrl;

    if (key && countedProtectedReelKeys.has(key)) {
      return;
    }

    if (video.dataset && video.dataset.halalProtectedCounted === 'true') {
      return;
    }

    if (video.dataset) {
      video.dataset.halalProtectedCounted = 'true';
    }
    if (key) {
      countedProtectedReelKeys.add(key);
    }

    safeSendMessage({
      action: 'incrementSkipped',
      reelId: key,
      url: reelUrl
    });
  }

  // Sync state classes to HTML & Body for zero-visibility CSS pre-shielding
  function updateBodyClasses() {
    const targets = [document.documentElement, document.body].filter(Boolean);
    const shouldBeActive = settings.enabled && isReelContext();
    targets.forEach(t => {
      if (shouldBeActive) {
        t.classList.add('halal-active');
        if (settings.shieldMode) {
          t.classList.add('halal-shield-mode');
        } else {
          t.classList.remove('halal-shield-mode');
        }
      } else {
        t.classList.remove('halal-active', 'halal-shield-mode');
      }
    });
  }

  let physicalList = {}; // Permanent reel memory (reelId -> record)
  let isModelLoaded = false;
  let isScanning = false;
  let isPreScanning = false;
  let currentActiveVideo = null;
  let scanTimer = null;
  let preScanTimer = null;
  let statusPill = null;
  let toastEl = null;

  // 720x1280 vertical canvas
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = 720;
  offscreenCanvas.height = 1280;
  const offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });

  // 1. UI Elements (Status Pill & Toast)
  function setupUI() {
    if (document.getElementById('halal-status-pill')) return;

    statusPill = document.createElement('div');
    statusPill.id = 'halal-status-pill';
    statusPill.className = 'halal-status-pill';
    statusPill.innerHTML = `
      <svg class="status-icon" viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 9.06-7 10.18-3.87-1.12-7-5.51-7-10.18V6.3l7-3.12z"/>
      </svg>
      <span class="status-text">Gemini Vision AI Active</span>
    `;
    document.body.appendChild(statusPill);

    toastEl = document.createElement('div');
    toastEl.id = 'halal-skip-toast';
    toastEl.className = 'halal-skip-toast';
    toastEl.innerHTML = `
      <span class="toast-badge">Shield</span>
      <span class="toast-text">Video blurred (Face detected)</span>
    `;
    document.body.appendChild(toastEl);
  }

  function showStatus(text, isSkipping = false, durationMs = 1500) {
    if (!statusPill) return;
    const textSpan = statusPill.querySelector('.status-text');
    if (textSpan) textSpan.textContent = text;

    statusPill.classList.toggle('skipping', isSkipping);
    statusPill.classList.add('visible');

    setTimeout(() => {
      if (statusPill && !isScanning) {
        statusPill.classList.remove('visible');
      }
    }, durationMs);
  }

  function showToastNotification(msg) {
    if (!settings.showToast || !toastEl) return;
    const textSpan = toastEl.querySelector('.toast-text');
    if (textSpan) textSpan.textContent = msg;

    toastEl.classList.add('show');
    setTimeout(() => {
      if (toastEl) toastEl.classList.remove('show');
    }, 1800);
  }

  // 1.1 Daily Scroll Limit Mindful Curtain & Break Screen
  function getTodayDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function isDailyLimitReached() {
    if (!settings.enabled || !settings.dailyLimitEnabled) return false;
    const todayStr = getTodayDateString();
    if (settings.todayDate && settings.todayDate !== todayStr) {
      settings.todayScrollCount = 0;
      settings.todayDate = todayStr;
      return false;
    }
    const limit = typeof settings.dailyScrollLimit === 'number' ? settings.dailyScrollLimit : 100;
    return (settings.todayScrollCount || 0) >= limit;
  }

  function pauseAllVideos() {
    try {
      const videos = document.querySelectorAll('video');
      for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        try {
          if (!v.paused) v.pause();
        } catch (e) {}
      }
    } catch (e) {}
  }

  let isCurtainActive = false;

  function showDailyLimitCurtain() {
    if (!document.body) return;

    if (!isCurtainActive) {
      isCurtainActive = true;
      pauseAllVideos();
    }

    let curtain = document.getElementById('halal-limit-curtain');
    if (!curtain) {
      curtain = document.createElement('div');
      curtain.id = 'halal-limit-curtain';
      curtain.className = 'halal-limit-curtain';
      curtain.innerHTML = `
        <div class="halal-limit-card">
          <div class="halal-limit-icon-wrap">
            <span class="halal-limit-moon">🌙</span>
          </div>
          <div class="halal-limit-pill">Daily Scroll Limit Reached</div>
          <h2 class="halal-limit-title">Time for a Mindful Break</h2>
          <p class="halal-limit-desc">
            You've reached your daily limit of <strong class="halal-limit-target-num">100</strong> reels today.
            Take a pause, rest your mind, and safeguard your time.
          </p>
          <div class="halal-limit-stat-bar">
            <div class="halal-limit-stat-info">
              <span>Today's Reels</span>
              <span class="halal-limit-count-stat">100 / 100</span>
            </div>
            <div class="halal-limit-track">
              <div class="halal-limit-fill" style="width: 100%;"></div>
            </div>
          </div>
          <div class="halal-limit-actions">
            <button class="halal-limit-btn-break" id="halal-limit-break-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
              </svg>
              <span>Pause &amp; Rest</span>
            </button>
            <button class="halal-limit-btn-extend" id="halal-limit-extend-btn">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
              </svg>
              <span>+15 More Reels</span>
            </button>
          </div>
          <p class="halal-limit-tip">You can adjust or disable this limit anytime in the Halal Mode extension popup.</p>
        </div>
      `;
      document.body.appendChild(curtain);

      const breakBtn = curtain.querySelector('#halal-limit-break-btn');
      if (breakBtn) {
        breakBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          pauseAllVideos();
          breakBtn.innerHTML = `<span>Paused 🌿 Time to Rest</span>`;
          breakBtn.style.opacity = '0.85';
          try {
            window.close();
          } catch (err) {}
        });
      }

      const extendBtn = curtain.querySelector('#halal-limit-extend-btn');
      if (extendBtn) {
        extendBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          extendBtn.disabled = true;
          extendBtn.innerHTML = `<span>Extending...</span>`;
          safeSendMessage({ action: 'extendDailyScrollLimit', amount: 15 }, (resp) => {
            if (resp && resp.success) {
              settings.dailyScrollLimit = resp.newLimit;
              removeDailyLimitCurtain();
              showToastNotification(`Daily limit extended to ${resp.newLimit} reels (+15)`);
              if (currentActiveVideo) {
                try { currentActiveVideo.play(); } catch (err) {}
              }
            } else {
              removeDailyLimitCurtain();
            }
          });
        });
      }
    }

    const targetNum = curtain.querySelector('.halal-limit-target-num');
    const countStat = curtain.querySelector('.halal-limit-count-stat');
    const limit = typeof settings.dailyScrollLimit === 'number' ? settings.dailyScrollLimit : 100;
    const count = settings.todayScrollCount || limit;
    if (targetNum) targetNum.textContent = limit;
    if (countStat) countStat.textContent = `${count} / ${limit}`;

    curtain.classList.add('active');
  }

  function removeDailyLimitCurtain() {
    isCurtainActive = false;
    const curtain = document.getElementById('halal-limit-curtain');
    if (curtain) {
      curtain.classList.remove('active');
    }
  }

  function checkAndEnforceDailyLimit() {
    if (isDailyLimitReached()) {
      showDailyLimitCurtain();
    } else {
      removeDailyLimitCurtain();
    }
  }

  // 1.2 URL-based Reel Navigation & Daily Limit Tracking Engine
  let lastTrackedReelUrl = "";
  let lastTrackedReelKey = null;

  function extractReelUrlKey(urlStr) {
    try {
      const url = new URL(urlStr || window.location.href);
      const path = url.pathname || "";

      // Instagram Reels: /reel/CODE/ or /reels/CODE/ or /p/CODE/
      const igMatch = path.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/i);
      if (igMatch) return `ig_${igMatch[2]}`;

      // YouTube Shorts: /shorts/CODE
      const ytMatch = path.match(/\/shorts\/([A-Za-z0-9_-]+)/i);
      if (ytMatch) return `yt_${ytMatch[1]}`;

      // TikTok: /video/CODE
      const ttMatch = path.match(/\/video\/(\d+)/i);
      if (ttMatch) return `tt_${ttMatch[1]}`;

      return null;
    } catch (e) {
      return null;
    }
  }

  function checkUrlForReelNavigation(fallbackReelId = null) {
    if (!isReelContext()) {
      lastTrackedReelKey = null;
      lastTrackedReelUrl = window.location.href;
      updateBodyClasses();
      return;
    }

    updateBodyClasses();
    const currentHref = window.location.href;
    const currentKey = extractReelUrlKey(currentHref) || fallbackReelId;

    if (!currentKey) return;

    if (currentKey === lastTrackedReelKey) return;

    lastTrackedReelUrl = currentHref;
    lastTrackedReelKey = currentKey;
    console.log('[Halal Mode] 🧭 URL/Reel navigation detected:', currentKey);

    // If daily limit is already reached: pause active video and display mindful curtain
    if (isDailyLimitReached()) {
      pauseAllVideos();
      showDailyLimitCurtain();
      return;
    }

    // Count this unique reel navigation
    if (settings.enabled && settings.dailyLimitEnabled) {
      safeSendMessage({ action: 'incrementDailyScroll', reelKey: currentKey }, (resp) => {
        if (resp && resp.success) {
          settings.todayScrollCount = resp.todayScrollCount;
          settings.dailyScrollLimit = resp.dailyScrollLimit;
          settings.dailyLimitEnabled = resp.dailyLimitEnabled;
          if (resp.limitReached) {
            pauseAllVideos();
            showDailyLimitCurtain();
          }
        }
      });
    }
  }

  // 2. Load Local Models (as fallback)
  async function loadModels() {
    try {
      if (typeof faceapi === 'undefined') {
        setTimeout(loadModels, 200);
        return;
      }

      const modelUrl = chrome.runtime.getURL('models');
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
        faceapi.nets.ageGenderNet.loadFromUri(modelUrl)
      ]);

      isModelLoaded = true;
      console.log('[Halal Mode] Local fallback neural nets loaded!');
      showStatus('Gemini Vision AI Active', false, 2000);
    } catch (err) {
      console.warn('[Halal Mode] Local model load note:', err);
    }
  }

  // 2.5 Reel Identification & Physical Memory List Engine
  function getReelIdentifier(video) {
    if (!video) return null;
    if (video.dataset.halalReelId) return video.dataset.halalReelId;

    let reelId = null;

    // Instagram: Check reel container for link to /reel/ or /p/
    const container = findVideoContainer(video) || video.closest('article') || video.parentElement;
    if (container) {
      const link = container.querySelector('a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"]');
      if (link && link.getAttribute('href')) {
        const m = link.getAttribute('href').match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/);
        if (m) reelId = `ig_${m[2]}`;
      }
    }

    // Instagram direct URL
    if (!reelId && window.location.pathname) {
      const m = window.location.pathname.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/);
      if (m) reelId = `ig_${m[2]}`;
    }

    // YouTube Shorts
    if (!reelId) {
      const ytMatch = window.location.pathname.match(/\/shorts\/([A-Za-z0-9_-]+)/);
      if (ytMatch) {
        reelId = `yt_${ytMatch[1]}`;
      } else {
        const ytRenderer = video.closest('ytd-reel-video-renderer');
        if (ytRenderer?.id) reelId = `yt_${ytRenderer.id}`;
      }
    }

    // TikTok
    if (!reelId) {
      const ttMatch = window.location.pathname.match(/\/video\/([0-9]+)/);
      if (ttMatch) {
        reelId = `tt_${ttMatch[1]}`;
      } else if (container) {
        const ttLink = container.querySelector('a[href*="/video/"]');
        if (ttLink) {
          const m = ttLink.getAttribute('href').match(/\/video\/([0-9]+)/);
          if (m) reelId = `tt_${m[1]}`;
        }
      }
    }

    // Fallback: stable media source path
    if (!reelId && (video.currentSrc || video.src)) {
      try {
        const u = new URL(video.currentSrc || video.src);
        const parts = u.pathname.split('/').filter(Boolean);
        const lastPart = parts[parts.length - 1] || parts[parts.length - 2];
        if (lastPart && lastPart.length >= 6) {
          reelId = `vid_${lastPart.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30)}`;
        }
      } catch (e) {}
    }

    if (reelId) {
      video.dataset.halalReelId = reelId;
    }

    return reelId;
  }

  // Extract canonical full URL for physical tracking and database view
  function getReelUrl(video) {
    if (!video) return window.location.href;

    // 1. Instagram: Container link to /reel/ or /p/
    const container = findVideoContainer(video) || video.closest('article') || video.parentElement;
    if (container) {
      const link = container.querySelector('a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"]');
      if (link && link.getAttribute('href')) {
        const href = link.getAttribute('href');
        return href.startsWith('http') ? href : `https://www.instagram.com${href.startsWith('/') ? '' : '/'}${href}`;
      }
    }

    // 2. Instagram: Current address bar
    if (window.location.pathname.match(/\/(reel|reels|p)\/([A-Za-z0-9_-]+)/)) {
      return window.location.href;
    }

    // 3. YouTube Shorts container
    const ytRenderer = video.closest('ytd-reel-video-renderer');
    if (ytRenderer) {
      const ytLink = ytRenderer.querySelector('a[href*="/shorts/"]');
      if (ytLink && ytLink.getAttribute('href')) {
        const href = ytLink.getAttribute('href');
        return href.startsWith('http') ? href : `https://www.youtube.com${href}`;
      }
    }
    if (window.location.pathname.includes('/shorts/')) {
      return window.location.href;
    }

    // 4. TikTok container
    if (container) {
      const ttLink = container.querySelector('a[href*="/video/"]');
      if (ttLink && ttLink.getAttribute('href')) {
        const href = ttLink.getAttribute('href');
        return href.startsWith('http') ? href : `https://www.tiktok.com${href}`;
      }
    }
    if (window.location.pathname.includes('/video/')) {
      return window.location.href;
    }

    // 5. Build canonical URL from reelId if available
    const reelId = video.dataset.halalReelId || getReelIdentifier(video);
    if (reelId) {
      if (reelId.startsWith('ig_')) return `https://www.instagram.com/reel/${reelId.slice(3)}/`;
      if (reelId.startsWith('yt_')) return `https://www.youtube.com/shorts/${reelId.slice(3)}`;
      if (reelId.startsWith('tt_')) return `https://www.tiktok.com/@video/${reelId.slice(3)}`;
    }

    return window.location.href;
  }

  // Check physical list before scanning to avoid duplicate API calls
  function checkPhysicalList(video) {
    if (!video || !isReelContext(video)) return false;
    const reelId = getReelIdentifier(video);
    const reelUrl = getReelUrl(video);
    if (!reelId && !reelUrl) return false;

    let cached = null;
    if (reelId && physicalList[reelId]) {
      cached = physicalList[reelId];
    } else if (reelUrl) {
      cached = Object.values(physicalList).find(r => r.url === reelUrl);
    }

    if (!cached) return false;

    console.log(`[Halal Mode] ⚡ Found in Physical List (${cached.reelId || reelId}): verdict="${cached.verdict}", reason="${cached.reason || ''}"`);
    video.dataset.halalCached = 'true';

    if (cached.verdict === 'hidden') {
      if (settings.actionMode === 'skip' && settings.removeSkippedFromFeed) {
        collapseReelCard(video);
        markAndIncrementProtected(video);
        showToastNotification('⏭️ Removed skipped reel from scroll feed');
        showStatus('Skipped', true, 1200);
        return true;
      }
      applyProtection(video, cached.confidence, `${cached.reason || 'Woman detected'} (Saved in Memory)`, false);
      return true;
    } else if (cached.verdict === 'allowed') {
      video.dataset.halalPreScanned = 'safe';
      video.dataset.halalUserVerified = 'true';
      clearPreScanShield(video);
      return true;
    }

    return false;
  }

  // Evaluate if frame should be hidden according to tolerance slider
  // 0% tolerance = Strict (no girls anywhere on screen)
  // >0% tolerance = Corner/background tolerance percentage
  function shouldHideVideo(evalResult) {
    if (!evalResult || !evalResult.womanDetected) {
      return false;
    }

    // Zero tolerance: Any girl anywhere on screen is hidden
    if (settings.cornerTolerance === 0) {
      return true;
    }

    const location = (evalResult.location || 'center').toLowerCase().trim();
    const prominence = typeof evalResult.prominence === 'number' ? evalResult.prominence : 75;

    // Corner / Background tolerance check
    if (location === 'corner' || location === 'background') {
      if (prominence <= settings.cornerTolerance) {
        console.log(`[Halal Mode] 🕊️ Allowed: Girl in ${location} (${prominence}% prominence) within tolerance (${settings.cornerTolerance}%)`);
        return false;
      }
      return true;
    }

    // Center or full-screen focal subject
    return true;
  }

  // Persist reel classification to physical list (stored in chrome.storage.local)
  async function saveReelToPhysicalList(video, verdict, evalResult = {}) {
    const reelId = getReelIdentifier(video);
    if (!reelId) return;

    const fullUrl = getReelUrl(video);
    let platform = 'Web Video';
    if (reelId.startsWith('ig_') || fullUrl.includes('instagram.com')) platform = 'Instagram';
    else if (reelId.startsWith('yt_') || fullUrl.includes('youtube.com')) platform = 'YouTube Shorts';
    else if (reelId.startsWith('tt_') || fullUrl.includes('tiktok.com')) platform = 'TikTok';

    const record = {
      reelId,
      url: fullUrl,
      platform,
      verdict, // 'hidden' or 'allowed'
      hasWoman: Boolean(evalResult.womanDetected),
      confidence: evalResult.highestConfidence || 100,
      prominence: evalResult.prominence || (evalResult.womanDetected ? 80 : 0),
      location: evalResult.location || (evalResult.womanDetected ? 'center' : 'none'),
      reason: evalResult.reason || (verdict === 'hidden' ? 'Woman detected' : 'Allowed / Safe'),
      timestamp: Date.now()
    };

    physicalList[reelId] = record;

    try {
      await chrome.runtime.sendMessage({
        action: 'saveToPhysicalList',
        record
      });
    } catch (e) {
      console.warn('[Halal Mode] Physical list sync note:', e);
    }
  }

  // 3. Container & Video Resolvers
  function findVideoContainer(video) {
    let el = video.parentElement;
    let candidate = el;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (rect.height >= 300 && rect.width >= 150) {
        candidate = el;
        if (
          el.tagName === 'ARTICLE' ||
          el.getAttribute('role') === 'presentation' ||
          el.querySelector('svg[aria-label="Like"]') ||
          el.parentElement?.querySelector('svg[aria-label="Like"]')
        ) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return candidate || video.parentElement;
  }

  function findReelCard(video) {
    if (!video) return null;

    // 1. YouTube Shorts renderer
    const ytCard = video.closest('ytd-reel-video-renderer');
    if (ytCard) return ytCard;

    // 2. TikTok container
    const ttCard = video.closest('[data-e2e="recommend-list-item-container"]') ||
                   video.closest('div[class*="DivItemContainer"]');
    if (ttCard) return ttCard;

    // 3. Instagram: article or role="presentation"
    const igArticle = video.closest('article');
    if (igArticle) return igArticle;

    const igPres = video.closest('div[role="presentation"]');
    if (igPres && igPres.clientHeight > 300) return igPres;

    // 4. Traversal for tall slide child of scroller or snap item
    let current = video.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      if (
        current.tagName === 'ARTICLE' ||
        current.getAttribute('role') === 'presentation' ||
        (current.clientHeight > 350 && current.parentElement && current.parentElement.children.length > 1)
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return video.closest('article') || video.parentElement;
  }

  // Physically collapses & removes a skipped reel from the scroll container
  function collapseReelCard(video) {
    if (!video) return null;
    const card = findReelCard(video);
    if (!card) return null;

    console.log('[Halal Mode] 🚫 Collapsing & removing reel from scroll feed:', getReelIdentifier(video));

    try {
      video.pause();
      video.muted = true;
    } catch (e) {}

    video.classList.add('halal-reel-removed');
    video.setAttribute('data-halal-removed', 'true');
    video.dataset.halalRemoved = 'true';

    const elementsToCollapse = [card];

    // If card is inside a single-child outer slide container, collapse outer wrapper too
    let p = card.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const isScrollContainer = (p.scrollHeight > p.clientHeight && p.clientHeight > 400) ||
                                (window.getComputedStyle(p).scrollSnapType && window.getComputedStyle(p).scrollSnapType !== 'none');
      if (isScrollContainer) {
        break;
      }
      if (p.children.length === 1 && p.clientHeight > 300) {
        elementsToCollapse.push(p);
        p = p.parentElement;
      } else {
        break;
      }
    }

    elementsToCollapse.forEach(el => {
      el.classList.add('halal-reel-removed');
      el.setAttribute('data-halal-removed', 'true');
      el.dataset.halalRemoved = 'true';
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('height', '0px', 'important');
      el.style.setProperty('min-height', '0px', 'important');
      el.style.setProperty('max-height', '0px', 'important');
      el.style.setProperty('margin', '0px', 'important');
      el.style.setProperty('padding', '0px', 'important');
      el.style.setProperty('border', 'none', 'important');
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('visibility', 'hidden', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
      el.style.setProperty('overflow', 'hidden', 'important');
      el.style.setProperty('position', 'absolute', 'important');
      el.style.setProperty('top', '-99999px', 'important');
      el.style.setProperty('left', '-99999px', 'important');
      el.style.setProperty('width', '0px', 'important');
    });

    return card;
  }

  // Restores a collapsed reel back into the scroll feed (e.g. when unblurred by user)
  function uncollapseReelCard(video) {
    if (!video) return;
    const card = findReelCard(video);
    const elementsToRestore = [video];
    if (card) {
      elementsToRestore.push(card);
      let p = card.parentElement;
      while (p && p !== document.body && p !== document.documentElement) {
        if (p.classList.contains('halal-reel-removed') || p.getAttribute('data-halal-removed') === 'true') {
          elementsToRestore.push(p);
          p = p.parentElement;
        } else {
          break;
        }
      }
    }

    elementsToRestore.forEach(el => {
      el.classList.remove('halal-reel-removed');
      el.removeAttribute('data-halal-removed');
      delete el.dataset.halalRemoved;
      el.style.removeProperty('display');
      el.style.removeProperty('height');
      el.style.removeProperty('min-height');
      el.style.removeProperty('max-height');
      el.style.removeProperty('margin');
      el.style.removeProperty('padding');
      el.style.removeProperty('border');
      el.style.removeProperty('opacity');
      el.style.removeProperty('visibility');
      el.style.removeProperty('pointer-events');
      el.style.removeProperty('overflow');
      el.style.removeProperty('position');
      el.style.removeProperty('top');
      el.style.removeProperty('left');
      el.style.removeProperty('width');
    });
  }

  function getActiveVideo(forceSearch = false) {
    if (!isReelContext()) return null;
    if (document.hidden && !forceSearch) return null;

    const videos = Array.from(document.querySelectorAll('video')).filter(
      v => !v.classList.contains('halal-reel-removed') &&
           v.dataset.halalRemoved !== 'true' &&
           !v.closest('.halal-reel-removed') &&
           !v.closest('[data-halal-removed="true"]')
    );
    if (videos.length === 0) return null;

    const viewportCenterY = window.innerHeight / 2;

    // 1. Look for playing, visible video
    for (const vid of videos) {
      const rect = vid.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0 && rect.width > 50 && rect.height > 50;
      if (isVisible && !vid.paused && vid.readyState >= 1) {
        return vid;
      }
    }

    // 2. Look for any visible video on screen (even if paused)
    for (const vid of videos) {
      const rect = vid.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0 && rect.width > 50 && rect.height > 50;
      if (isVisible) {
        return vid;
      }
    }

    // 3. Fallback to video closest to viewport center
    let closestVid = null;
    let minDistance = Infinity;

    for (const vid of videos) {
      const rect = vid.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) continue;
      const vidCenterY = rect.top + rect.height / 2;
      const dist = Math.abs(vidCenterY - viewportCenterY);
      if (dist < minDistance) {
        minDistance = dist;
        closestVid = vid;
      }
    }

    return closestVid || videos[0] || null;
  }

  // 4. Capture Frame (720x1280 Letterboxed)
  async function captureVideoFrame(video) {
    if (!video || video.readyState < 2) return null;

    const vw = video.videoWidth || 720;
    const vh = video.videoHeight || 1280;

    const targetW = 720;
    const targetH = 1280;

    if (offscreenCanvas.width !== targetW || offscreenCanvas.height !== targetH) {
      offscreenCanvas.width = targetW;
      offscreenCanvas.height = targetH;
    }

    try {
      offscreenCtx.fillStyle = '#000000';
      offscreenCtx.fillRect(0, 0, targetW, targetH);

      const scale = Math.min(targetW / vw, targetH / vh);
      const drawW = Math.round(vw * scale);
      const drawH = Math.round(vh * scale);
      const drawX = Math.round((targetW - drawW) / 2);
      const drawY = Math.round((targetH - drawH) / 2);

      offscreenCtx.drawImage(video, drawX, drawY, drawW, drawH);
      return offscreenCanvas;
    } catch (canvasErr) {
      try {
        const response = await chrome.runtime.sendMessage({ action: 'captureTab' });
        if (response && response.success && response.dataUrl) {
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              offscreenCtx.fillStyle = '#000000';
              offscreenCtx.fillRect(0, 0, targetW, targetH);

              const rect = video.getBoundingClientRect();
              const dpr = window.devicePixelRatio || 1;

              const cropX = Math.max(0, Math.round(rect.left * dpr));
              const cropY = Math.max(0, Math.round(rect.top * dpr));
              const cropW = Math.min(img.naturalWidth - cropX, Math.round(rect.width * dpr));
              const cropH = Math.min(img.naturalHeight - cropY, Math.round(rect.height * dpr));

              if (cropW > 50 && cropH > 50) {
                offscreenCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
              } else {
                offscreenCtx.drawImage(img, 0, 0, targetW, targetH);
              }

              resolve(offscreenCanvas);
            };
            img.onerror = () => resolve(null);
            img.src = response.dataUrl;
          });
        }
      } catch (tabErr) {
        console.warn('[Halal Mode] Tab capture fallback error:', tabErr);
      }
      return null;
    }
  }

  // 5. Hard Inline Blur (React-Proof)
  function applyHardBlur(video) {
    video.setAttribute('data-halal-blurred', 'true');
    video.dataset.halalBlurred = 'true';
    video.style.setProperty('filter', 'blur(80px) brightness(0.02)', 'important');
    video.style.setProperty('-webkit-filter', 'blur(80px) brightness(0.02)', 'important');
    video.style.setProperty('opacity', '0.02', 'important');
    video.style.setProperty('transform', 'scale(1.08)', 'important');
  }

  function protectVideoStyles(video) {
    if (video._halalObserver) return;

    video._halalObserver = new MutationObserver(() => {
      if (video.getAttribute('data-halal-blurred') === 'true') {
        if (video.style.opacity !== '0.02' || !video.style.filter.includes('blur')) {
          applyHardBlur(video);
        }
      }
    });

    video._halalObserver.observe(video, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  function applyPreScanShield(video) {
    if (!video) return;
    video.setAttribute('data-halal-shield', 'true');
    video.dataset.halalShield = 'true';
    video.style.setProperty('filter', 'blur(80px) brightness(0.01)', 'important');
    video.style.setProperty('-webkit-filter', 'blur(80px) brightness(0.01)', 'important');
    video.style.setProperty('opacity', '0', 'important');

    const card = findReelCard(video);
    if (card) {
      card.setAttribute('data-halal-card-unverified', 'true');
    }
  }

  function clearPreScanShield(video) {
    if (!video) return;
    video.removeAttribute('data-halal-shield');
    delete video.dataset.halalShield;

    const card = findReelCard(video);
    if (card) {
      card.removeAttribute('data-halal-card-unverified');
      card.setAttribute('data-halal-card-safe', 'true');
    }

    if (video.getAttribute('data-halal-blurred') !== 'true') {
      video.style.removeProperty('filter');
      video.style.removeProperty('-webkit-filter');
      video.style.removeProperty('opacity');
    }
  }

  // Safe runtime message sender that prevents unhandled promise rejections
  function safeSendMessage(message, callback) {
    try {
      if (!chrome.runtime?.id) return;
      const res = chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          return;
        }
        if (callback) callback(response);
      });
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
    } catch (e) {}
  }

  // Helper: Simulate native user click with full pointer/mouse sequence for React apps (Instagram, YouTube, TikTok)
  function triggerElementClick(element) {
    if (!element) return false;
    try {
      if (typeof element.focus === 'function') element.focus();

      const pointerEvents = ['pointerdown', 'pointerup'];
      for (const evtName of pointerEvents) {
        try {
          const EvtClass = (typeof PointerEvent !== 'undefined') ? PointerEvent : MouseEvent;
          element.dispatchEvent(new EvtClass(evtName, {
            bubbles: true,
            cancelable: true,
            view: window,
            buttons: 1,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true
          }));
        } catch (pe) {}
      }

      const mouseEvents = ['mousedown', 'mouseup', 'click'];
      for (const evtName of mouseEvents) {
        try {
          element.dispatchEvent(new MouseEvent(evtName, {
            bubbles: true,
            cancelable: true,
            view: window,
            buttons: 1
          }));
        } catch (me) {}
      }

      if (typeof element.click === 'function') {
        element.click();
      }
      return true;
    } catch (err) {
      console.warn('[Halal Mode] Click dispatch error:', err);
      return false;
    }
  }

  // 6. ACTION: Scroll / Advance to Next Reel
  function scrollToNextReel(video = null, record = false) {
    if (!isReelContext(video)) return;
    console.log('[Halal Mode] ⏭️ Skipping to next reel...');

    const activeVid = video || currentActiveVideo || getActiveVideo(true);

    if (activeVid) {
      // Keep default blur active while navigating to next reel
      applyHardBlur(activeVid);
      protectVideoStyles(activeVid);
      try {
        activeVid.pause();
      } catch (e) {}

      if (record) {
        saveReelToPhysicalList(activeVid, 'hidden', {
          womanDetected: true,
          highestConfidence: 99,
          reason: 'Skipped by user'
        });
      }

      // If feed removal is enabled: collapse the skipped reel card from scroll feed
      if (settings.removeSkippedFromFeed) {
        setTimeout(() => {
          collapseReelCard(activeVid);
        }, 120);
      }
    }

    let advanced = false;

    // Strategy 1 (Top Priority): Click Instagram's exact native next reel button
    // Selector provided: div[aria-label="Navigate to next reel"][role="button"] with path d="M12 17.502..."
    const igNextBtn = document.querySelector('div[aria-label="Navigate to next reel"][role="button"]') ||
                      document.querySelector('[aria-label="Navigate to next reel"]') ||
                      document.querySelector('[aria-label="Navigate to next reel" i]');

    if (igNextBtn) {
      console.log('[Halal Mode] 🎯 Instagram native next reel button found! Triggering click...');
      advanced = triggerElementClick(igNextBtn);
    }

    // Instagram SVG path fallback (path d starts with "M12 17.502")
    if (!advanced) {
      const allPaths = document.querySelectorAll('svg path');
      for (const p of allPaths) {
        const d = p.getAttribute('d') || '';
        if (d.startsWith('M12 17.502') || d.includes('17.502a1 1 0 0 1-.707-.293l-9-9.004')) {
          const btn = p.closest('div[role="button"]') || p.closest('button') || p.closest('[tabindex="0"]');
          if (btn) {
            console.log('[Halal Mode] 🎯 Instagram next button found via SVG path! Triggering click...');
            advanced = triggerElementClick(btn);
            if (advanced) break;
          }
        }
      }
    }

    // Strategy 2: YouTube Shorts & TikTok native advance buttons
    if (!advanced) {
      // YouTube Shorts: Down button
      const ytDownBtn = document.querySelector('button#navigation-button-down') ||
                        document.querySelector('ytd-reel-video-renderer #down-button button') ||
                        document.querySelector('ytd-shorts [aria-label*="Next video" i]');
      if (ytDownBtn) {
        console.log('[Halal Mode] 🎯 YouTube Shorts next button found! Triggering click...');
        advanced = triggerElementClick(ytDownBtn);
      }
    }

    if (!advanced) {
      // TikTok down / next arrow
      const ttNextBtn = document.querySelector('button[data-e2e="arrow-right"]') ||
                        document.querySelector('button[aria-label*="Next video" i]');
      if (ttNextBtn) {
        console.log('[Halal Mode] 🎯 TikTok next button found! Triggering click...');
        advanced = triggerElementClick(ttNextBtn);
      }
    }

    // Generic down/next aria-label or title buttons
    if (!advanced) {
      const candidateButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
      for (const btn of candidateButtons) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        if (
          aria === 'navigate to next reel' || aria.includes('next reel') ||
          aria === 'down chevron' || aria.includes('next video') ||
          title.includes('next reel') || title.includes('next video')
        ) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            console.log('[Halal Mode] 🎯 Candidate next button found:', aria || title);
            advanced = triggerElementClick(btn);
            if (advanced) break;
          }
        }
      }
    }

    // If native button click succeeded, notify and return early!
    if (advanced) {
      showToastNotification('⏭️ Advanced to next reel');
      showStatus('Skipped', true, 1500);
      return;
    }

    // Strategy 3 (Fallback): Smooth scroll to next video element in DOM
    console.log('[Halal Mode] ⚠️ Native button not found, running scroll fallbacks...');
    const allVideos = Array.from(document.querySelectorAll('video')).filter(v => {
      const rect = v.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });

    if (activeVid && allVideos.length > 1) {
      const idx = allVideos.indexOf(activeVid);
      if (idx !== -1 && idx < allVideos.length - 1) {
        const nextVid = allVideos[idx + 1];
        const nextCard = findReelCard(nextVid) || nextVid;
        nextCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        advanced = true;
      }
    }

    // Strategy 4 (Fallback): Dispatch native keyboard ArrowDown & PageDown events
    const dispatchKey = (key, keyCode) => {
      const eventOpts = {
        key,
        code: key,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window
      };
      const targets = [document.activeElement, activeVid, document.body, window, document];
      targets.forEach(t => {
        if (t && t.dispatchEvent) {
          try {
            t.dispatchEvent(new KeyboardEvent('keydown', eventOpts));
            t.dispatchEvent(new KeyboardEvent('keypress', eventOpts));
            t.dispatchEvent(new KeyboardEvent('keyup', eventOpts));
          } catch (e) {}
        }
      });
    };

    dispatchKey('ArrowDown', 40);
    dispatchKey('PageDown', 34);

    // Strategy 5 (Fallback): Physical window/container scroll
    function findScrollParent(node) {
      if (!node) return null;
      let parent = node.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const style = window.getComputedStyle(parent);
        const overflowY = style.overflowY;
        if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return null;
    }

    const scrollParent = findScrollParent(activeVid) || findScrollParent(document.querySelector('article')) || document.scrollingElement || window;
    const scrollAmount = window.innerHeight || 800;

    try {
      if (scrollParent && scrollParent.scrollBy) {
        scrollParent.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      } else {
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
      }
    } catch (e) {
      window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    }

    // Strategy 6 (Fallback): Synthetic WheelEvent
    try {
      const wheelEvt = new WheelEvent('wheel', {
        deltaY: 700,
        deltaMode: 0,
        bubbles: true,
        cancelable: true
      });
      (activeVid || document.body).dispatchEvent(wheelEvt);
    } catch (e) {}

    showToastNotification('⏭️ Scrolled to next reel');
    showStatus('Skipped', true, 1500);
  }

  function skipReel(video, record = true) {
    if (video) {
      applyHardBlur(video);
      protectVideoStyles(video);
    }
    scrollToNextReel(video, record);
  }

  // Helper to locate active photo / image post if no video is currently mounted in DOM
  function findActiveImagePost() {
    const articles = Array.from(document.querySelectorAll('article, div[role="presentation"], div[role="dialog"]'));
    const viewportCenterY = window.innerHeight / 2;

    for (const art of articles) {
      const rect = art.getBoundingClientRect();
      const isVisible = rect.top < window.innerHeight && rect.bottom > 0 && rect.width > 150 && rect.height > 150;
      if (isVisible) {
        const img = art.querySelector('img[style*="object-fit"], img.x5yr21d, img[srcset], img');
        if (img) return { container: art, media: img };
      }
    }

    const allImgs = Array.from(document.querySelectorAll('img')).filter(img => {
      const r = img.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0 && r.width > 200 && r.height > 200;
    });

    if (allImgs.length > 0) {
      return { container: allImgs[0].closest('article') || allImgs[0].parentElement, media: allImgs[0] };
    }

    return null;
  }

  // Manual Blur Action (for missed scans, user override, videos and photo posts)
  function manualBlurCurrent(reason = 'Manually blurred by user') {
    const video = currentActiveVideo || getActiveVideo(true);
    if (video) {
      console.log('[Halal Mode] 🔒 Manual blur applied to reel:', getReelIdentifier(video));
      video.dataset.halalUserVerified = 'false';
      saveReelToPhysicalList(video, 'hidden', {
        womanDetected: true,
        highestConfidence: 100,
        reason: reason
      });
      applyProtection(video, 100, reason, false);
      showToastNotification('🔒 Manually blurred & saved to list');
      return { success: true, type: 'video', reelId: getReelIdentifier(video) };
    }

    // Fallback: Photo/image post on Instagram / web
    const imgTarget = findActiveImagePost();
    if (imgTarget && imgTarget.media) {
      console.log('[Halal Mode] 🔒 Manual blur applied to image post');
      const img = imgTarget.media;
      const container = imgTarget.container || img.parentElement;
      img.style.setProperty('filter', 'blur(60px) brightness(0.2)', 'important');
      img.style.setProperty('opacity', '0.02', 'important');
      img.dataset.halalBlurred = 'true';

      if (container) {
        if (window.getComputedStyle(container).position === 'static') {
          container.style.setProperty('position', 'relative', 'important');
        }
        const existing = container.querySelector('.halal-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.className = 'halal-overlay';
        overlay.innerHTML = `
          <div class="halal-overlay-card">
            <div class="halal-overlay-icon">
              <svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 9.06-7 10.18-3.87-1.12-7-5.51-7-10.18V6.3l7-3.12z"/></svg>
            </div>
            <h3 class="halal-overlay-title">Photo Blurred</h3>
            <p class="halal-overlay-subtitle">${escapeHtml(reason || 'Manually blurred')}</p>
            <div class="halal-overlay-buttons">
              <button class="halal-btn-unblur" id="halalUnblurImgBtn">Unblur Photo</button>
            </div>
          </div>
        `;
        container.appendChild(overlay);
        overlay.querySelector('#halalUnblurImgBtn').addEventListener('click', (e) => {
          e.stopPropagation();
          img.style.removeProperty('filter');
          img.style.removeProperty('opacity');
          overlay.remove();
        });
      }

      showToastNotification('🔒 Photo manually blurred');
      return { success: true, type: 'photo', reelId: 'photo_post' };
    }

    console.warn('[Halal Mode] No active video or photo found for manual blur');
    return { success: false, error: 'No video or photo found on screen' };
  }

  // 7. ACTION: 100% Impenetrable Blur Shield with On-Screen Buttons & Auto-Skip
  function applyProtection(video, confidence = null, reason = '', record = true) {
    if (!video || !isReelContext(video)) return;
    console.log(`[Halal Mode] 🛡️ Applying blur protection (mode=${settings.actionMode})...`);
    video.dataset.halalBlurred = 'true';
    video.setAttribute('data-halal-blurred', 'true');

    if (record) {
      saveReelToPhysicalList(video, 'hidden', { womanDetected: true, highestConfidence: confidence || 95, reason });
    }

    // Always apply default hard blur and MutationObserver protection
    applyHardBlur(video);
    protectVideoStyles(video);

    const container = findVideoContainer(video);
    if (container) {
      if (window.getComputedStyle(container).position === 'static') {
        container.style.setProperty('position', 'relative', 'important');
      }

      let overlay = container.querySelector('.halal-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'halal-overlay';

        const confText = reason
          ? reason
          : (confidence ? `Gemini AI Verified (${confidence}% confidence)` : 'Woman detected on screen');

        overlay.innerHTML = `
          <div class="halal-overlay-card">
            <div class="halal-overlay-icon">
              <svg viewBox="0 0 24 24">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 9.06-7 10.18-3.87-1.12-7-5.51-7-10.18V6.3l7-3.12z"/>
              </svg>
            </div>
            <h3 class="halal-overlay-title">Video Blurred</h3>
            <p class="halal-overlay-subtitle">${escapeHtml(confText)}</p>
            <span class="halal-audio-note">🔊 Audio continues playing normally</span>
            <div class="halal-overlay-buttons">
              <button class="halal-btn-unblur" id="halalUnblurBtn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                Unblur Video
              </button>
              <button class="halal-btn-skip" id="halalSkipBtn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                Skip to Next Reel
              </button>
            </div>
          </div>
        `;

        container.appendChild(overlay);

        // On-screen Unblur button
        overlay.querySelector('#halalUnblurBtn').addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          unblurVideoForUser(video, container, overlay);
        });

        // On-screen Skip button
        overlay.querySelector('#halalSkipBtn').addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          overlay.remove();
          scrollToNextReel(video, false);
        });
      }
    }

    markAndIncrementProtected(video);

    // When auto-skip is ON: keep default blur active AND advance immediately to next reel!
    if (settings.actionMode === 'skip') {
      if (settings.removeSkippedFromFeed) {
        collapseReelCard(video);
      }
      showToastNotification('🔒 Video blurred & auto-skipping...');
      showStatus('Skipping', true, 1800);
      scrollToNextReel(video, false);
    } else {
      showToastNotification('Video blurred (Gemini AI)');
      showStatus('Blurred', true, 1800);
    }
  }

  // Unblur logic for user verification
  function unblurVideoForUser(video, container, overlay) {
    uncollapseReelCard(video);

    video.removeAttribute('data-halal-blurred');
    video.dataset.halalBlurred = 'false';
    video.dataset.halalUserVerified = 'true';

    const card = findReelCard(video);
    if (card) {
      card.removeAttribute('data-halal-card-unverified');
      card.setAttribute('data-halal-card-safe', 'true');
    }

    if (video._halalObserver) {
      video._halalObserver.disconnect();
      video._halalObserver = null;
    }

    video.style.removeProperty('filter');
    video.style.removeProperty('-webkit-filter');
    video.style.removeProperty('opacity');
    video.style.removeProperty('transform');

    if (overlay) overlay.remove();
    showToastNotification('Video unblurred for verification');

    // Remember in physical list so user never has to unblur it again
    saveReelToPhysicalList(video, 'allowed', { womanDetected: false, reason: 'Manually unblurred by user' });

    // Floating Re-blur button in corner
    const reblurBtn = document.createElement('button');
    reblurBtn.className = 'halal-reblur-btn';
    reblurBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 2.18l7 3.12v4.7c0 4.67-3.13 9.06-7 10.18-3.87-1.12-7-5.51-7-10.18V6.3l7-3.12z"/>
      </svg>
      <span>Re-blur</span>
    `;

    reblurBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      video.dataset.halalUserVerified = 'false';
      reblurBtn.remove();
      saveReelToPhysicalList(video, 'hidden', { womanDetected: true, reason: 'Manually re-blurred by user' });
      applyProtection(video, 100, 'Manually re-blurred by user', false);
    });

    if (container) container.appendChild(reblurBtn);
  }

  // 8. AI EVALUATION: Gemini Vision + Local Fallback
  async function evaluateFrame(inputCanvas) {
    try {
      const dataUrl = inputCanvas.toDataURL('image/jpeg', 0.65);
      const aiResponse = await chrome.runtime.sendMessage({
        action: 'classifyFrame',
        dataUrl: dataUrl
      });

      if (aiResponse && aiResponse.success) {
        console.log(`[Halal Mode] 🤖 Gemini AI verdict: woman=${aiResponse.has_woman} (${aiResponse.confidence}%), loc=${aiResponse.location || 'center'} (${aiResponse.prominence || 0}%), reason: "${aiResponse.reason}"`);
        return {
          womanDetected: Boolean(aiResponse.has_woman),
          highestConfidence: aiResponse.confidence || 100,
          prominence: typeof aiResponse.prominence === 'number' ? aiResponse.prominence : (aiResponse.has_woman ? 80 : 0),
          location: aiResponse.location || (aiResponse.has_woman ? 'center' : 'none'),
          reason: aiResponse.reason || '',
          provider: 'gemini'
        };
      }
    } catch (apiErr) {
      console.warn('[Halal Mode] Gemini API call error, using local fallback:', apiErr);
    }

    // Local Fallback
    if (isModelLoaded) {
      const detectorOptions = new faceapi.TinyFaceDetectorOptions({
        inputSize: 416,
        scoreThreshold: 0.25
      });

      const detections = await faceapi
        .detectAllFaces(inputCanvas, detectorOptions)
        .withAgeAndGender();

      let womanDetected = false;
      let highestConfidence = 0;
      let prominence = 0;
      let location = 'center';

      if (detections && detections.length > 0) {
        for (const det of detections) {
          const gender = det.gender;
          const prob = det.genderProbability;

          if (gender === 'female') {
            const minProb = detections.length > 1 ? 0.45 : (settings.sensitivity / 100);
            if (prob >= minProb) {
              womanDetected = true;
              highestConfidence = Math.max(highestConfidence, Math.round(prob * 100));

              if (det.detection && det.detection.box) {
                const box = det.detection.box;
                const canvasArea = inputCanvas.width * inputCanvas.height;
                const faceArea = box.width * box.height;
                const faceProminence = Math.min(100, Math.round((faceArea / canvasArea) * 400));
                prominence = Math.max(prominence, faceProminence);

                const isNearEdgeX = (box.x < inputCanvas.width * 0.2) || (box.x + box.width > inputCanvas.width * 0.8);
                const isNearEdgeY = (box.y < inputCanvas.height * 0.2) || (box.y + box.height > inputCanvas.height * 0.8);
                if (isNearEdgeX || isNearEdgeY || prominence < 15) {
                  location = 'corner';
                }
              }
            }
          } else if (gender === 'male' && prob < 0.54 && settings.sensitivity <= 70) {
            womanDetected = true;
            highestConfidence = Math.max(highestConfidence, Math.round((1 - prob) * 100));
            location = 'center';
            prominence = 70;
          }
        }
      }

      return {
        womanDetected,
        highestConfidence,
        prominence,
        location,
        reason: womanDetected ? (location === 'corner' ? 'Corner female face detected' : 'Female face detected') : '',
        provider: 'local'
      };
    }

    return { womanDetected: false, highestConfidence: 0, prominence: 0, location: 'none', reason: '', provider: 'none' };
  }

  // 9. Pre-Scanning Engine (Upcoming Reels)
  function getUpcomingVideos() {
    if (document.hidden) return [];

    const allVideos = Array.from(document.querySelectorAll('video')).filter(
      v => !v.classList.contains('halal-reel-removed') &&
           v.dataset.halalRemoved !== 'true' &&
           !v.closest('.halal-reel-removed') &&
           !v.closest('[data-halal-removed="true"]')
    );
    if (allVideos.length <= 1) return [];

    return allVideos.filter(v => 
      v !== currentActiveVideo &&
      !v.dataset.halalPreScanned &&
      !v.dataset.halalBlurred &&
      v.dataset.halalUserVerified !== 'true'
    );
  }

  async function preScanVideo(video) {
    if (!settings.enabled || !settings.preScanEnabled || !isReelContext(video)) return;
    if (isPreScanning || isScanning || document.hidden) return;
    if (video.dataset.halalPreScanned || video.dataset.halalScanning === 'true') return;

    // Check physical list memory first!
    if (checkPhysicalList(video)) return;

    if (video.readyState < 2) {
      video.addEventListener('loadeddata', () => preScanVideo(video), { once: true });
      return;
    }

    isPreScanning = true;
    video.dataset.halalScanning = 'true';

    try {
      const frame1 = await captureVideoFrame(video);
      if (frame1) {
        const res = await evaluateFrame(frame1);
        const shouldHide = shouldHideVideo(res);

        if (shouldHide) {
          console.log(`[Halal Mode] 🛡️ PRE-SCAN detected woman (${res.highestConfidence}%, ${res.location}) - Blurring & Protecting.`);
          video.dataset.halalPreScanned = 'female';
          saveReelToPhysicalList(video, 'hidden', res);

          // If in auto-skip mode and feed removal enabled: collapse upcoming reel from scroll ahead of time!
          if (settings.actionMode === 'skip' && settings.removeSkippedFromFeed) {
            collapseReelCard(video);
            console.log('[Halal Mode] ⏭️ Pre-scan collapsed upcoming reel with woman from scroll feed ahead of scroll.');
            return;
          }

          applyProtection(video, res.highestConfidence, res.reason, false);
          return;
        } else {
          saveReelToPhysicalList(video, 'allowed', res);
          video.dataset.halalPreScanned = 'safe';
          clearPreScanShield(video);
          console.log('[Halal Mode] ✅ PRE-SCAN: Reel safe or allowed by tolerance.');
        }
      }
    } catch (err) {
      console.warn('[Halal Mode] Pre-scan error:', err);
    } finally {
      video.dataset.halalScanning = 'false';
      isPreScanning = false;
    }
  }

  function schedulePreScan() {
    if (!settings.enabled || !settings.preScanEnabled || document.hidden || !isReelContext()) return;
    if (isPreScanning || isScanning) return;

    const upcoming = getUpcomingVideos();
    if (upcoming.length > 0) {
      preScanVideo(upcoming[0]);
    }
  }

  // 10. Real-time Analysis Engine (Active Reel)
  async function analyzeVideo(video, isInitialCheck = false) {
    if (!settings.enabled || isScanning || document.hidden || !isReelContext(video)) return;
    if (video.dataset.halalUserVerified === 'true') return;
    if (video.dataset.halalBlurred === 'true') {
      if (video.style.opacity !== '0.02') applyHardBlur(video);
      return;
    }

    // Check physical list memory first to prevent duplicate AI scans
    if (checkPhysicalList(video)) return;

    if (video.readyState < 2) return;

    isScanning = true;

    try {
      const input = await captureVideoFrame(video);
      if (!input) {
        isScanning = false;
        return;
      }

      const res = await evaluateFrame(input);
      const shouldHide = shouldHideVideo(res);

      if (shouldHide) {
        console.log(`[Halal Mode] 🛡️ Woman detected (${res.highestConfidence}%, loc=${res.location}, prominence=${res.prominence}%) - Blurring & Protecting!`);
        applyProtection(video, res.highestConfidence, res.reason, true);
      } else {
        saveReelToPhysicalList(video, 'allowed', res);
        if (isInitialCheck && settings.shieldMode) {
          clearPreScanShield(video);
        }
      }
    } catch (err) {
      console.warn('[Halal Mode] Scan error:', err);
    } finally {
      isScanning = false;
    }
  }

  // 11. Initial Burst Scan
  function triggerBurstScan(video) {
    if (!video || video.dataset.halalBlurred === 'true') return;

    if (video.readyState >= 2) {
      analyzeVideo(video, true);
    } else {
      video.addEventListener('loadeddata', () => analyzeVideo(video, true), { once: true });
    }

    setTimeout(() => {
      if (video && !video.paused && video.dataset.halalBlurred !== 'true' && video.dataset.halalUserVerified !== 'true') {
        analyzeVideo(video, false);
      }
    }, 200);
  }

  // 12. Video Lifecycle Monitoring
  function onNewVideoActive(video) {
    if (!video || !isReelContext(video) || video === currentActiveVideo) return;
    if (video.classList.contains('halal-reel-removed') || video.closest('.halal-reel-removed')) return;

    // Check URL or element reel identifier
    const reelId = getReelIdentifier(video);
    checkUrlForReelNavigation(reelId);

    // 1. Check daily scroll limit before continuing
    if (isDailyLimitReached()) {
      try { video.pause(); } catch (e) {}
      showDailyLimitCurtain();
      return;
    }

    if (currentActiveVideo && currentActiveVideo.dataset.halalBlurred !== 'true') {
      clearPreScanShield(currentActiveVideo);
    }

    currentActiveVideo = video;

    // Check physical list memory immediately before any scanning or shielding!
    if (checkPhysicalList(video)) {
      setTimeout(schedulePreScan, 500);
      return;
    }

    if (video.dataset.halalPreScanned === 'female') {
      console.log('[Halal Mode] Reel was pre-scanned as female. Blurring & Protecting!');
      applyProtection(video, null, 'Pre-scanned as female', false);
      setTimeout(schedulePreScan, 500);
      return;
    }

    if (video.dataset.halalPreScanned === 'safe') {
      console.log('[Halal Mode] Reel was pre-scanned as safe. Instant playback!');
      clearPreScanShield(video);
      setTimeout(schedulePreScan, 500);
      return;
    }

    if (
      settings.enabled &&
      settings.shieldMode &&
      video.dataset.halalUserVerified !== 'true' &&
      video.dataset.halalBlurred !== 'true'
    ) {
      applyPreScanShield(video);
    }

    triggerBurstScan(video);
    setTimeout(schedulePreScan, 700);
  }

  // 13. CPU-Conscious Polling Loop
  function startPlaybackLoop() {
    if (scanTimer) clearInterval(scanTimer);
    if (preScanTimer) clearInterval(preScanTimer);

    scanTimer = setInterval(() => {
      if (!settings.enabled || document.hidden || !isReelContext()) return;

      if (isDailyLimitReached()) {
        if (currentActiveVideo && !currentActiveVideo.paused) {
          try { currentActiveVideo.pause(); } catch (e) {}
        }
        showDailyLimitCurtain();
        return;
      }

      const activeVid = getActiveVideo();
      if (activeVid) {
        if (activeVid !== currentActiveVideo) {
          onNewVideoActive(activeVid);
        } else if (!activeVid.paused) {
          if (activeVid.dataset.halalBlurred === 'true') {
            if (activeVid.style.opacity !== '0.02') applyHardBlur(activeVid);
          } else if (activeVid.dataset.halalUserVerified !== 'true') {
            analyzeVideo(activeVid, false);
          }
        }
      }
    }, settings.scanIntervalMs);

    preScanTimer = setInterval(() => {
      if (settings.enabled && settings.preScanEnabled && !document.hidden && !isDailyLimitReached() && isReelContext()) {
        schedulePreScan();
      }
    }, 1800);
  }

  // Pre-shield and check physical list memory on all incoming video & card elements
  function processIncomingMediaElements() {
    if (!settings.enabled || isDailyLimitReached() || !isReelContext()) return;

    const allVideos = Array.from(document.querySelectorAll('video'));
    for (const vid of allVideos) {
      if (!isReelContext(vid)) continue;
      if (vid.dataset.halalRemoved === 'true' || vid.classList.contains('halal-reel-removed')) {
        continue;
      }

      // If already verified safe, pre-scanned, blurred, or cached, skip
      if (
        vid.dataset.halalPreScanned ||
        vid.dataset.halalUserVerified === 'true' ||
        vid.dataset.halalBlurred === 'true' ||
        vid.dataset.halalCached === 'true'
      ) {
        continue;
      }

      const card = findReelCard(vid);
      if (card && settings.shieldMode) {
        card.setAttribute('data-halal-card-unverified', 'true');
      }

      // Immediately apply pre-shield blur with zero opacity
      if (settings.shieldMode && vid.dataset.halalBlurred !== 'true') {
        applyPreScanShield(vid);
      }

      // Fast check physical list memory
      checkPhysicalList(vid);
    }
  }

  function observeDOM() {
    document.addEventListener('play', (e) => {
      if (e.target.tagName === 'VIDEO' && isReelContext(e.target)) {
        onNewVideoActive(e.target);
      }
    }, true);

    // Navigation listeners for SPA URL changes
    window.addEventListener('popstate', () => checkUrlForReelNavigation(), true);
    window.addEventListener('hashchange', () => checkUrlForReelNavigation(), true);

    // Lightweight 250ms periodic URL check (catches internal pushState/replaceState instantly)
    setInterval(checkUrlForReelNavigation, 250);

    // Throttled DOM mutation observer (prevents layout thrashing & tab freezing)
    let domDebounce = null;
    const observer = new MutationObserver(() => {
      if (!settings.enabled || document.hidden || isDailyLimitReached() || !isReelContext()) return;
      if (domDebounce) return;

      domDebounce = setTimeout(() => {
        domDebounce = null;
        if (!settings.enabled || document.hidden || isDailyLimitReached() || !isReelContext()) return;
        processIncomingMediaElements();
        const activeVid = getActiveVideo();
        if (activeVid && activeVid !== currentActiveVideo) {
          onNewVideoActive(activeVid);
        }
      }, 250);
    });

    const target = document.body || document.documentElement;
    if (target) {
      observer.observe(target, { childList: true, subtree: true });
    }
    processIncomingMediaElements();
  }

  // Hotkey listener: Press 'B' or 'H' to manually blur active reel immediately
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
    if (e.key === 'b' || e.key === 'B' || e.key === 'h' || e.key === 'H') {
      console.log(`[Halal Mode] ⌨️ Hotkey '${e.key}' pressed: triggering manual blur`);
      manualBlurCurrent(`Manually blurred (Hotkey ${e.key.toUpperCase()})`);
    }
  }, true);

  // 14. Message Receiver from Extension Popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getCurrentReelState') {
      const video = currentActiveVideo || getActiveVideo(true);
      if (video) {
        const isBlurred = video.getAttribute('data-halal-blurred') === 'true' || video.dataset.halalBlurred === 'true';
        const reelId = getReelIdentifier(video);
        sendResponse({
          success: true,
          hasVideo: true,
          isBlurred: Boolean(isBlurred),
          reelId: reelId || 'active_reel'
        });
      } else {
        sendResponse({ success: true, hasVideo: false, isBlurred: false, reelId: null });
      }
    } else if (message.action === 'manualBlurCurrent') {
      const res = manualBlurCurrent('Manually blurred via popup');
      sendResponse(res);
    } else if (message.action === 'unblurCurrent') {
      const video = currentActiveVideo || getActiveVideo(true);
      if (video) {
        const container = findVideoContainer(video);
        const overlay = container?.querySelector('.halal-overlay');
        unblurVideoForUser(video, container, overlay);
        sendResponse({ success: true, isBlurred: false });
      } else {
        sendResponse({ success: false, error: 'No active video found' });
      }
    } else if (message.action === 'toggleUnblurCurrent') {
      const video = currentActiveVideo || getActiveVideo(true);
      if (video) {
        const isBlurred = video.getAttribute('data-halal-blurred') === 'true' || video.dataset.halalBlurred === 'true';
        const container = findVideoContainer(video);
        const overlay = container?.querySelector('.halal-overlay');

        if (isBlurred) {
          unblurVideoForUser(video, container, overlay);
          sendResponse({ success: true, isBlurred: false });
        } else {
          manualBlurCurrent('Manually blurred via popup');
          sendResponse({ success: true, isBlurred: true });
        }
      } else {
        sendResponse({ success: false, error: 'No active video found' });
      }
    } else if (message.action === 'skipCurrent') {
      const video = currentActiveVideo || getActiveVideo(true);
      if (video && settings.removeSkippedFromFeed) {
        collapseReelCard(video);
      }
      scrollToNextReel(video, false);
      sendResponse({ success: true });
    } else if (message.action === 'getDailyScrollStatus') {
      sendResponse({
        success: true,
        dailyLimitEnabled: settings.dailyLimitEnabled,
        dailyScrollLimit: settings.dailyScrollLimit,
        todayScrollCount: settings.todayScrollCount,
        isLimitReached: isDailyLimitReached()
      });
    }
    return true;
  });

  // 15. Initialization
  async function init() {
    setupUI();

    try {
      const stored = await chrome.storage.local.get([
        'enabled',
        'apiKey',
        'aiProvider',
        'actionMode',
        'preScanEnabled',
        'shieldMode',
        'removeSkippedFromFeed',
        'dailyLimitEnabled',
        'dailyScrollLimit',
        'todayScrollCount',
        'todayDate',
        'cornerTolerance',
        'sensitivity',
        'scanIntervalMs',
        'showToast',
        'physicalList'
      ]);
      settings = { ...settings, ...stored };
      if (stored.physicalList) {
        physicalList = stored.physicalList;
      }
    } catch (e) {
      console.warn('[Halal Mode] Storage load error:', e);
    }

    updateBodyClasses();
    checkAndEnforceDailyLimit();

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;

      if (changes.enabled !== undefined) settings.enabled = changes.enabled.newValue;
      if (changes.apiKey) settings.apiKey = changes.apiKey.newValue;
      if (changes.aiProvider) settings.aiProvider = changes.aiProvider.newValue;
      if (changes.actionMode) settings.actionMode = changes.actionMode.newValue;
      if (changes.preScanEnabled !== undefined) settings.preScanEnabled = changes.preScanEnabled.newValue;
      if (changes.shieldMode !== undefined) settings.shieldMode = changes.shieldMode.newValue;
      if (changes.removeSkippedFromFeed !== undefined) settings.removeSkippedFromFeed = changes.removeSkippedFromFeed.newValue;
      if (changes.dailyLimitEnabled !== undefined) {
        settings.dailyLimitEnabled = changes.dailyLimitEnabled.newValue;
        checkAndEnforceDailyLimit();
      }
      if (changes.dailyScrollLimit !== undefined) {
        settings.dailyScrollLimit = changes.dailyScrollLimit.newValue;
        checkAndEnforceDailyLimit();
      }
      if (changes.todayScrollCount !== undefined) {
        settings.todayScrollCount = changes.todayScrollCount.newValue;
        checkAndEnforceDailyLimit();
      }
      if (changes.todayDate !== undefined) {
        settings.todayDate = changes.todayDate.newValue;
        checkAndEnforceDailyLimit();
      }
      if (changes.cornerTolerance !== undefined) settings.cornerTolerance = changes.cornerTolerance.newValue;
      if (changes.physicalList) physicalList = changes.physicalList.newValue || {};
      if (changes.sensitivity) settings.sensitivity = changes.sensitivity.newValue;
      if (changes.scanIntervalMs) {
        settings.scanIntervalMs = changes.scanIntervalMs.newValue;
        startPlaybackLoop();
      }
      if (changes.showToast !== undefined) settings.showToast = changes.showToast.newValue;

      updateBodyClasses();

      if (!settings.enabled && currentActiveVideo) {
        currentActiveVideo.removeAttribute('data-halal-blurred');
        currentActiveVideo.style.removeProperty('filter');
        currentActiveVideo.style.removeProperty('-webkit-filter');
        currentActiveVideo.style.removeProperty('opacity');
        const container = findVideoContainer(currentActiveVideo);
        const overlay = container?.querySelector('.halal-overlay');
        if (overlay) overlay.remove();
      }
    });

    await loadModels();
    observeDOM();
    startPlaybackLoop();
    checkUrlForReelNavigation();

    console.log('[Halal Mode] Extension running with On-Screen & Popup Unblur + Skip/Blur options.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
