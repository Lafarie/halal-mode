// Halal Mode - Popup Logic
// Powered by Gemini Vision AI with Tolerance Slider & Physical List Memory

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const masterToggle = document.getElementById('masterToggle');
  const btnModeBlur = document.getElementById('btnModeBlur');
  const btnModeSkip = document.getElementById('btnModeSkip');
  const modeDescription = document.getElementById('modeDescription');
  const btnPopupManualBlur = document.getElementById('btnPopupManualBlur');
  const btnPopupUnblur = document.getElementById('btnPopupUnblur');
  const btnPopupSkip = document.getElementById('btnPopupSkip');
  const reelLiveTag = document.getElementById('reelLiveTag');

  // Slider elements
  const toleranceSlider = document.getElementById('toleranceSlider');
  const toleranceBadge = document.getElementById('toleranceBadge');
  const sliderPercentage = document.getElementById('sliderPercentage');
  const toleranceDesc = document.getElementById('toleranceDesc');

  // Physical cache elements
  const cacheHiddenCount = document.getElementById('cacheHiddenCount');
  const cacheAllowedCount = document.getElementById('cacheAllowedCount');
  const cacheTotalCount = document.getElementById('cacheTotalCount');
  const cacheTotalBadge = document.getElementById('cacheTotalBadge');
  const btnViewCache = document.getElementById('btnViewCache');
  const btnQuickExportCsv = document.getElementById('btnQuickExportCsv');
  const btnClearCache = document.getElementById('btnClearCache');

  // Modal elements
  const cacheModal = document.getElementById('cacheModal');
  const btnCloseCacheModal = document.getElementById('btnCloseCacheModal');
  const btnModalClose = document.getElementById('btnModalClose');
  const btnModalClear = document.getElementById('btnModalClear');
  const btnModalExportCsv = document.getElementById('btnModalExportCsv');
  const btnModalExportJson = document.getElementById('btnModalExportJson');
  const btnModalExport = document.getElementById('btnModalExport');
  const cacheSearchInput = document.getElementById('cacheSearchInput');
  const cacheListContainer = document.getElementById('cacheListContainer');
  const modalSubCount = document.getElementById('modalSubCount');
  const filterTabAll = document.getElementById('filterTabAll');
  const filterTabHidden = document.getElementById('filterTabHidden');
  const filterTabAllowed = document.getElementById('filterTabAllowed');

  // Settings elements
  const apiKeyInput = document.getElementById('apiKeyInput');
  const btnEditKey = document.getElementById('btnEditKey');
  const preScanToggle = document.getElementById('preScanToggle');
  const shieldModeToggle = document.getElementById('shieldModeToggle');
  const removeSkippedToggle = document.getElementById('removeSkippedToggle');
  const toastToggle = document.getElementById('toastToggle');
  const skippedCountEl = document.getElementById('skippedCount');
  const resetBtn = document.getElementById('resetBtn');

  // Daily Scroll Limit elements
  const dailyLimitToggle = document.getElementById('dailyLimitToggle');
  const limitStatusPill = document.getElementById('limitStatusPill');
  const limitProgressStat = document.getElementById('limitProgressStat');
  const limitProgressBar = document.getElementById('limitProgressBar');
  const dailyLimitInput = document.getElementById('dailyLimitInput');
  const btnLimitMinus = document.getElementById('btnLimitMinus');
  const btnLimitPlus = document.getElementById('btnLimitPlus');
  const btnResetToday = document.getElementById('btnResetToday');
  const limitChips = document.querySelectorAll('.limit-chip');

  // Load current settings from chrome.storage.local
  const data = await chrome.storage.local.get([
    'enabled',
    'apiKey',
    'actionMode',
    'cornerTolerance',
    'preScanEnabled',
    'shieldMode',
    'removeSkippedFromFeed',
    'dailyLimitEnabled',
    'dailyScrollLimit',
    'todayScrollCount',
    'todayDate',
    'showToast',
    'skippedCount',
    'physicalList'
  ]);

  masterToggle.checked = data.enabled !== undefined ? data.enabled : true;
  preScanToggle.checked = data.preScanEnabled !== undefined ? data.preScanEnabled : true;
  shieldModeToggle.checked = data.shieldMode !== undefined ? data.shieldMode : true;
  if (removeSkippedToggle) {
    removeSkippedToggle.checked = data.removeSkippedFromFeed !== undefined ? data.removeSkippedFromFeed : true;
  }
  toastToggle.checked = data.showToast !== undefined ? data.showToast : true;

  const currentKey = data.apiKey || '';
  apiKeyInput.value = currentKey;
  updateAiStatus(currentKey);

  // Daily Limit state
  let currentDailyLimitEnabled = data.dailyLimitEnabled !== undefined ? data.dailyLimitEnabled : true;
  let currentDailyLimit = typeof data.dailyScrollLimit === 'number' ? data.dailyScrollLimit : 100;
  let currentTodayCount = data.todayScrollCount || 0;

  // Check if date rolled over
  const todayStr = getTodayDateString();
  if (data.todayDate && data.todayDate !== todayStr) {
    currentTodayCount = 0;
    await chrome.storage.local.set({ todayDate: todayStr, todayScrollCount: 0, todaySeenReels: {} });
  }

  function updateDailyLimitUI(enabled, limit, todayCount) {
    if (dailyLimitToggle) dailyLimitToggle.checked = enabled;

    if (limitStatusPill) {
      if (enabled) {
        limitStatusPill.textContent = 'Active';
        limitStatusPill.className = 'limit-status-pill';
      } else {
        limitStatusPill.textContent = 'Disabled';
        limitStatusPill.className = 'limit-status-pill disabled';
      }
    }

    if (dailyLimitInput) {
      dailyLimitInput.value = limit;
      dailyLimitInput.disabled = !enabled;
    }

    const pct = Math.min(100, Math.round((todayCount / limit) * 100)) || 0;
    if (limitProgressStat) {
      limitProgressStat.textContent = `${todayCount} / ${limit} Reels (${pct}%)`;
    }

    if (limitProgressBar) {
      limitProgressBar.style.width = `${pct}%`;
      limitProgressBar.className = 'limit-progress-bar';
      if (pct >= 100) {
        limitProgressBar.classList.add('danger');
      } else if (pct >= 75) {
        limitProgressBar.classList.add('warning');
      }
    }

    if (limitChips) {
      limitChips.forEach(chip => {
        const val = Number(chip.dataset.limit);
        chip.classList.toggle('active', val === limit);
      });
    }
  }

  updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);

  // Handle action mode (default 'blur')
  const currentMode = (data.actionMode === 'skip' || data.actionMode === 'remove') ? 'skip' : 'blur';
  updateModeUI(currentMode);

  // Counter
  const count = data.skippedCount || 0;
  skippedCountEl.textContent = count.toLocaleString();

  // Tolerance Slider
  const currentTolerance = typeof data.cornerTolerance === 'number' ? data.cornerTolerance : 0;
  toleranceSlider.value = currentTolerance;
  updateToleranceUI(currentTolerance);

  // Physical Cache Stats
  updateCacheStats(data.physicalList || {});

  function updateModeUI(mode) {
    if (mode === 'skip') {
      btnModeSkip.classList.add('active');
      btnModeBlur.classList.remove('active');
      modeDescription.textContent = 'Blurs video 100% instantly with dark shield, removes skipped reels from scroll feed, and advances to next reel.';
    } else {
      btnModeBlur.classList.add('active');
      btnModeSkip.classList.remove('active');
      modeDescription.textContent = 'Blurs video 100% with dark shield. Voice continues playing, with an Unblur button on the screen.';
    }
  }

  function updateToleranceUI(val) {
    sliderPercentage.textContent = `${val}%`;
    if (val === 0) {
      toleranceBadge.textContent = '0% • Strict';
      toleranceBadge.className = 'tolerance-badge strict';
      toleranceDesc.innerHTML = '🚫 <strong>0% (Strict)</strong>: Any girl on screen is hidden immediately (even in corner or background).';
    } else if (val <= 30) {
      toleranceBadge.textContent = `${val}% • Very Strict`;
      toleranceBadge.className = 'tolerance-badge very-strict';
      toleranceDesc.innerHTML = `🔒 <strong>${val}% (Very Strict)</strong>: Only tiny corner or distant background allowed. Noticeable faces hidden.`;
    } else if (val <= 60) {
      toleranceBadge.textContent = `${val}% • Balanced`;
      toleranceBadge.className = 'tolerance-badge balanced';
      toleranceDesc.innerHTML = `⚖️ <strong>${val}% (Balanced)</strong>: Girl in corner or background is OK. Primary subject is hidden.`;
    } else if (val <= 85) {
      toleranceBadge.textContent = `${val}% • Lenient`;
      toleranceBadge.className = 'tolerance-badge lenient';
      toleranceDesc.innerHTML = `👀 <strong>${val}% (Lenient)</strong>: Corner & moderate background allowed. Only primary focal subject is hidden.`;
    } else {
      toleranceBadge.textContent = `${val}% • Permissive`;
      toleranceBadge.className = 'tolerance-badge permissive';
      toleranceDesc.innerHTML = `🔓 <strong>${val}% (Permissive)</strong>: Only close-up / full-screen focal female faces are hidden.`;
    }
  }

  function updateCacheStats(list) {
    const entries = Object.values(list || {});
    const total = entries.length;
    const hidden = entries.filter(r => r.verdict === 'hidden').length;
    const allowed = entries.filter(r => r.verdict === 'allowed').length;

    cacheHiddenCount.textContent = hidden.toLocaleString();
    cacheAllowedCount.textContent = allowed.toLocaleString();
    cacheTotalCount.textContent = total.toLocaleString();
    cacheTotalBadge.textContent = `${total} Saved`;
    modalSubCount.textContent = `${total} Reels Saved in Memory`;
  }

  let currentModalFilter = 'all';

  function getReelWebUrl(item) {
    if (item.url && item.url.startsWith('http')) return item.url;
    if (!item.reelId) return null;
    if (item.reelId.startsWith('ig_')) return `https://www.instagram.com/reel/${item.reelId.slice(3)}/`;
    if (item.reelId.startsWith('yt_')) return `https://www.youtube.com/shorts/${item.reelId.slice(3)}`;
    if (item.reelId.startsWith('tt_')) return `https://www.tiktok.com/@video/${item.reelId.slice(3)}`;
    return null;
  }

  function renderCacheList(list, filterText = '') {
    cacheListContainer.innerHTML = '';
    let entries = Object.values(list || {});

    // Filter by tab (all / hidden / allowed)
    if (currentModalFilter === 'hidden') {
      entries = entries.filter(e => e.verdict === 'hidden');
    } else if (currentModalFilter === 'allowed') {
      entries = entries.filter(e => e.verdict === 'allowed');
    }

    if (filterText) {
      const q = filterText.toLowerCase();
      entries = entries.filter(e =>
        (e.reelId && e.reelId.toLowerCase().includes(q)) ||
        (e.url && e.url.toLowerCase().includes(q)) ||
        (e.platform && e.platform.toLowerCase().includes(q)) ||
        (e.reason && e.reason.toLowerCase().includes(q)) ||
        (e.verdict && e.verdict.toLowerCase().includes(q)) ||
        (e.location && e.location.toLowerCase().includes(q))
      );
    }

    if (entries.length === 0) {
      cacheListContainer.innerHTML = `
        <div class="cache-empty">
          <p>${filterText ? 'No reels match your search.' : (currentModalFilter === 'hidden' ? 'No blurred reels saved yet.' : 'Physical list is empty.')}</p>
        </div>
      `;
      return;
    }

    // Sort newest first
    entries.sort((a, b) => (b.timestamp || b.savedAt || 0) - (a.timestamp || a.savedAt || 0));

    entries.forEach(item => {
      const isHidden = item.verdict === 'hidden';
      const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      const dateStr = item.timestamp ? new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
      const webUrl = getReelWebUrl(item);

      let platform = item.platform;
      if (!platform) {
        if (webUrl && webUrl.includes('instagram.com') || (item.reelId && item.reelId.startsWith('ig_'))) platform = 'Instagram';
        else if (webUrl && webUrl.includes('youtube.com') || (item.reelId && item.reelId.startsWith('yt_'))) platform = 'YouTube Shorts';
        else if (webUrl && webUrl.includes('tiktok.com') || (item.reelId && item.reelId.startsWith('tt_'))) platform = 'TikTok';
        else platform = 'Web Video';
      }
      const platformClass = platform.toLowerCase().replace(/\s+/g, '-');

      const card = document.createElement('div');
      card.className = `cache-item ${isHidden ? 'is-hidden' : 'is-allowed'}`;

      const linkDisplay = webUrl
        ? webUrl.replace(/^https?:\/\/(www\.)?/, '')
        : (item.reelId || 'Reel');

      const linkHtml = webUrl
        ? `<div class="cache-item-url-row">
             <span class="cache-platform-badge ${platformClass}">${escapeHtml(platform)}</span>
             <a href="${webUrl}" target="_blank" class="cache-item-link" title="${escapeHtml(webUrl)}">${escapeHtml(linkDisplay)} ↗</a>
             <button type="button" class="btn-item-copy" title="Copy Direct URL" data-url="${escapeHtml(webUrl)}">📋</button>
           </div>`
        : `<div class="cache-item-url-row">
             <span class="cache-platform-badge ${platformClass}">${escapeHtml(platform)}</span>
             <span class="cache-item-id">${escapeHtml(item.reelId)}</span>
           </div>`;

      const metaParts = [];
      if (item.confidence) metaParts.push(`${item.confidence}% match`);
      if (item.prominence) metaParts.push(`Prominence: ${item.prominence}%`);
      if (item.location && item.location !== 'none') metaParts.push(`Loc: ${item.location}`);

      card.innerHTML = `
        <div class="cache-item-left">
          <span class="cache-verdict-badge ${item.verdict}">
            ${isHidden ? '🚫 Blurred' : '✅ Allowed'}
          </span>
          <div class="cache-item-details">
            ${linkHtml}
            <span class="cache-item-reason">${escapeHtml(item.reason || (isHidden ? 'Female detected' : 'Allowed / Safe'))}</span>
            ${metaParts.length ? `<span class="cache-item-meta" style="font-size: 9px; color: #64748B;">${escapeHtml(metaParts.join(' • '))}</span>` : ''}
          </div>
        </div>
        <div class="cache-item-right">
          <span class="cache-item-time" title="${dateStr}">${timeStr}</span>
          <button type="button" class="btn-item-toggle" data-id="${escapeHtml(item.reelId)}" title="Flip between Blurred and Allowed">
            ${isHidden ? 'Allow' : 'Blur'}
          </button>
          <button type="button" class="btn-item-del" data-id="${escapeHtml(item.reelId)}" title="Delete entry">
            ✕
          </button>
        </div>
      `;

      // Copy direct URL button handler
      const copyBtn = card.querySelector('.btn-item-copy');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetUrl = copyBtn.dataset.url;
          if (navigator.clipboard && targetUrl) {
            navigator.clipboard.writeText(targetUrl);
            copyBtn.textContent = '✓';
            setTimeout(() => { copyBtn.textContent = '📋'; }, 1200);
          }
        });
      }

      card.querySelector('.btn-item-toggle').addEventListener('click', async (e) => {
        e.stopPropagation();
        const res = await chrome.runtime.sendMessage({ action: 'togglePhysicalItem', reelId: item.reelId });
        if (res && res.success) {
          const { physicalList = {} } = await chrome.storage.local.get('physicalList');
          updateCacheStats(physicalList);
          renderCacheList(physicalList, cacheSearchInput.value.trim());
        }
      });

      card.querySelector('.btn-item-del').addEventListener('click', async (e) => {
        e.stopPropagation();
        await chrome.runtime.sendMessage({ action: 'deletePhysicalItem', reelId: item.reelId });
        const { physicalList = {} } = await chrome.storage.local.get('physicalList');
        updateCacheStats(physicalList);
        renderCacheList(physicalList, cacheSearchInput.value.trim());
      });

      cacheListContainer.appendChild(card);
    });
  }

  // Filter tabs click
  function setModalFilter(filter) {
    currentModalFilter = filter;
    [filterTabAll, filterTabHidden, filterTabAllowed].forEach(tab => {
      if (tab) tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    chrome.storage.local.get('physicalList').then(({ physicalList = {} }) => {
      renderCacheList(physicalList, cacheSearchInput.value.trim());
    });
  }

  if (filterTabAll) filterTabAll.addEventListener('click', () => setModalFilter('all'));
  if (filterTabHidden) filterTabHidden.addEventListener('click', () => setModalFilter('hidden'));
  if (filterTabAllowed) filterTabAllowed.addEventListener('click', () => setModalFilter('allowed'));

  // CSV Cell escaping (RFC 4180)
  function escapeCsvCell(val) {
    if (val === null || val === undefined) return '';
    let str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      str = '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  // Export Physical Database to CSV (.csv file for Excel / Google Sheets)
  function exportPhysicalListToCsv(physicalList) {
    const entries = Object.values(physicalList || {});
    if (entries.length === 0) {
      alert('Physical database is currently empty. No records to export yet.');
      return;
    }

    entries.sort((a, b) => (b.timestamp || b.savedAt || 0) - (a.timestamp || a.savedAt || 0));

    const headers = [
      'Platform',
      'Reel ID',
      'Direct URL',
      'Verdict',
      'Reason',
      'Female Detected',
      'Confidence %',
      'Prominence %',
      'Location',
      'Date',
      'Time',
      'ISO Timestamp'
    ];

    const rows = entries.map(item => {
      const d = item.timestamp ? new Date(item.timestamp) : new Date();
      const dateStr = d.toISOString().slice(0, 10);
      const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const webUrl = getReelWebUrl(item) || '';

      let platform = item.platform || 'Web Video';
      if (!item.platform) {
        if (webUrl.includes('instagram.com') || (item.reelId && item.reelId.startsWith('ig_'))) platform = 'Instagram';
        else if (webUrl.includes('youtube.com') || (item.reelId && item.reelId.startsWith('yt_'))) platform = 'YouTube Shorts';
        else if (webUrl.includes('tiktok.com') || (item.reelId && item.reelId.startsWith('tt_'))) platform = 'TikTok';
      }

      return [
        escapeCsvCell(platform),
        escapeCsvCell(item.reelId || ''),
        escapeCsvCell(webUrl),
        escapeCsvCell(item.verdict || 'hidden'),
        escapeCsvCell(item.reason || ''),
        escapeCsvCell(item.hasWoman !== undefined ? (item.hasWoman ? 'Yes' : 'No') : (item.verdict === 'hidden' ? 'Yes' : 'No')),
        escapeCsvCell(item.confidence || 100),
        escapeCsvCell(item.prominence !== undefined ? item.prominence : (item.verdict === 'hidden' ? 80 : 0)),
        escapeCsvCell(item.location || 'none'),
        escapeCsvCell(dateStr),
        escapeCsvCell(timeStr),
        escapeCsvCell(d.toISOString())
      ].join(',');
    });

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `halal-mode-database-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Export to JSON file
  function exportPhysicalListToJson(physicalList) {
    const items = Object.values(physicalList || {});
    if (items.length === 0) {
      alert('Physical database is currently empty.');
      return;
    }
    const jsonStr = JSON.stringify(items, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `halal-mode-database-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Bind Export Buttons
  if (btnQuickExportCsv) {
    btnQuickExportCsv.addEventListener('click', async () => {
      const { physicalList = {} } = await chrome.storage.local.get('physicalList');
      exportPhysicalListToCsv(physicalList);
    });
  }

  if (btnModalExportCsv) {
    btnModalExportCsv.addEventListener('click', async () => {
      const { physicalList = {} } = await chrome.storage.local.get('physicalList');
      exportPhysicalListToCsv(physicalList);
    });
  }

  if (btnModalExportJson) {
    btnModalExportJson.addEventListener('click', async () => {
      const { physicalList = {} } = await chrome.storage.local.get('physicalList');
      exportPhysicalListToJson(physicalList);
    });
  } else if (btnModalExport) {
    btnModalExport.addEventListener('click', async () => {
      const { physicalList = {} } = await chrome.storage.local.get('physicalList');
      exportPhysicalListToJson(physicalList);
    });
  }

  // Tolerance Slider listeners
  toleranceSlider.addEventListener('input', (e) => {
    updateToleranceUI(Number(e.target.value));
  });

  toleranceSlider.addEventListener('change', async (e) => {
    const val = Number(e.target.value);
    await chrome.storage.local.set({ cornerTolerance: val });
  });

  // Physical List Modal Open/Close
  btnViewCache.addEventListener('click', async () => {
    const { physicalList = {} } = await chrome.storage.local.get('physicalList');
    currentModalFilter = 'all';
    if (filterTabAll) filterTabAll.classList.add('active');
    if (filterTabHidden) filterTabHidden.classList.remove('active');
    if (filterTabAllowed) filterTabAllowed.classList.remove('active');
    renderCacheList(physicalList, '');
    cacheSearchInput.value = '';
    cacheModal.style.display = 'flex';
  });

  btnCloseCacheModal.addEventListener('click', () => {
    cacheModal.style.display = 'none';
  });

  btnModalClose.addEventListener('click', () => {
    cacheModal.style.display = 'none';
  });

  cacheSearchInput.addEventListener('input', async (e) => {
    const { physicalList = {} } = await chrome.storage.local.get('physicalList');
    renderCacheList(physicalList, e.target.value.trim());
  });

  // Clear Physical List
  async function performClearCache() {
    await chrome.storage.local.set({ physicalList: {} });
    updateCacheStats({});
    renderCacheList({}, '');
  }

  btnClearCache.addEventListener('click', async () => {
    if (confirm('Clear physical memory list? Videos will be scanned afresh on next visit.')) {
      await performClearCache();
    }
  });

  btnModalClear.addEventListener('click', async () => {
    if (confirm('Clear all saved reels from memory?')) {
      await performClearCache();
    }
  });

  // Segmented control clicks (Blur vs Skip)
  btnModeBlur.addEventListener('click', async () => {
    updateModeUI('blur');
    await chrome.storage.local.set({ actionMode: 'blur' });
  });

  btnModeSkip.addEventListener('click', async () => {
    updateModeUI('skip');
    await chrome.storage.local.set({ actionMode: 'skip' });
  });

  // Check active tab reel state on popup load
  function isRestrictedTabUrl(url) {
    if (!url) return false;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('edge://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('devtools://') ||
      url.startsWith('about:') ||
      url.startsWith('view-source:')
    );
  }

  // Check active tab reel state on popup load
  async function checkActiveReelState() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (isRestrictedTabUrl(tab.url)) {
        if (reelLiveTag) {
          reelLiveTag.textContent = 'Tab Ready';
          reelLiveTag.className = 'reel-live-tag';
        }
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'getCurrentReelState' }, (res) => {
        if (chrome.runtime.lastError) {
          // Explicitly access chrome.runtime.lastError to clear it and prevent Chrome extension error badge
          if (reelLiveTag) {
            reelLiveTag.textContent = 'Tab Ready';
            reelLiveTag.className = 'reel-live-tag';
          }
          return;
        }

        if (res && res.hasVideo) {
          if (res.isBlurred) {
            if (reelLiveTag) {
              reelLiveTag.textContent = '🔒 Reel Blurred';
              reelLiveTag.className = 'reel-live-tag blurred';
            }
            btnPopupUnblur.classList.add('highlight');
            btnPopupManualBlur.classList.remove('highlight');
          } else {
            if (reelLiveTag) {
              reelLiveTag.textContent = '👁️ Reel Visible';
              reelLiveTag.className = 'reel-live-tag playing';
            }
            btnPopupManualBlur.classList.add('highlight');
            btnPopupUnblur.classList.remove('highlight');
          }
        } else {
          if (reelLiveTag) {
            reelLiveTag.textContent = 'Feed Ready';
            reelLiveTag.className = 'reel-live-tag';
          }
        }
      });
    } catch (e) {
      console.warn('Could not query active tab state:', e);
    }
  }

  checkActiveReelState();

  // Quick action: Manual Blur on active tab (for missed scans)
  btnPopupManualBlur.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (isRestrictedTabUrl(tab.url)) {
        if (reelLiveTag) reelLiveTag.textContent = 'Not on video feed';
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'manualBlurCurrent' }, async (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[Halal Mode] Manual blur note:', chrome.runtime.lastError.message);
          if (reelLiveTag) {
            reelLiveTag.textContent = 'Refresh tab to connect';
            reelLiveTag.className = 'reel-live-tag';
          }
          btnPopupManualBlur.textContent = '⚠️ Refresh Tab';
          setTimeout(() => {
            btnPopupManualBlur.textContent = '🔒 Manual Blur';
          }, 1800);
          return;
        }

        if (res && res.success) {
          if (reelLiveTag) {
            reelLiveTag.textContent = res.type === 'photo' ? '🔒 Photo Blurred' : '🔒 Reel Blurred';
            reelLiveTag.className = 'reel-live-tag blurred';
          }
          btnPopupManualBlur.textContent = '✅ Blurred!';
          btnPopupUnblur.classList.add('highlight');
          btnPopupManualBlur.classList.remove('highlight');

          // Refresh physical list stats
          const { physicalList = {} } = await chrome.storage.local.get('physicalList');
          updateCacheStats(physicalList);

          setTimeout(() => {
            btnPopupManualBlur.textContent = '🔒 Manual Blur';
          }, 1500);
        } else {
          if (reelLiveTag) {
            reelLiveTag.textContent = res?.error || 'No media on screen';
            reelLiveTag.className = 'reel-live-tag';
          }
        }
      });
    } catch (e) {
      console.warn('Manual blur tab message error:', e);
    }
  });

  // Quick action: Unblur reel in active tab
  btnPopupUnblur.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (isRestrictedTabUrl(tab.url)) {
        if (reelLiveTag) reelLiveTag.textContent = 'Not on video feed';
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'unblurCurrent' }, async (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[Halal Mode] Unblur note:', chrome.runtime.lastError.message);
          if (reelLiveTag) {
            reelLiveTag.textContent = 'Refresh tab to connect';
            reelLiveTag.className = 'reel-live-tag';
          }
          btnPopupUnblur.textContent = '⚠️ Refresh Tab';
          setTimeout(() => {
            btnPopupUnblur.textContent = '👁️ Unblur';
          }, 1800);
          return;
        }

        if (res && res.success) {
          if (reelLiveTag) {
            reelLiveTag.textContent = '👁️ Unblurred';
            reelLiveTag.className = 'reel-live-tag playing';
          }
          btnPopupUnblur.textContent = '✅ Unblurred!';
          btnPopupManualBlur.classList.add('highlight');
          btnPopupUnblur.classList.remove('highlight');

          // Refresh physical list stats
          const { physicalList = {} } = await chrome.storage.local.get('physicalList');
          updateCacheStats(physicalList);

          setTimeout(() => {
            btnPopupUnblur.textContent = '👁️ Unblur';
          }, 1500);
        }
      });
    } catch (e) {
      console.warn('Tab message error:', e);
    }
  });

  // Quick action: Physically scroll down to next reel
  btnPopupSkip.addEventListener('click', async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (isRestrictedTabUrl(tab.url)) {
        if (reelLiveTag) reelLiveTag.textContent = 'Not on video feed';
        return;
      }

      chrome.tabs.sendMessage(tab.id, { action: 'skipCurrent' }, (res) => {
        if (chrome.runtime.lastError) {
          console.warn('[Halal Mode] Skip note:', chrome.runtime.lastError.message);
          if (reelLiveTag) {
            reelLiveTag.textContent = 'Refresh tab to connect';
            reelLiveTag.className = 'reel-live-tag';
          }
          btnPopupSkip.textContent = '⚠️ Refresh Tab';
          setTimeout(() => {
            btnPopupSkip.textContent = '⏭️ Skip Reel';
          }, 1800);
          return;
        }

        if (reelLiveTag) reelLiveTag.textContent = '⏭️ Scrolled';
        btnPopupSkip.textContent = '⏭️ Next!';
        setTimeout(() => {
          btnPopupSkip.textContent = '⏭️ Skip Reel';
          checkActiveReelState();
        }, 700);
      });
    } catch (e) {
      console.warn('Tab message error:', e);
    }
  });

  // AI Status indicator
  function updateAiStatus(key) {
    const aiDot = document.querySelector('.ai-dot');
    const aiLabel = document.querySelector('.ai-status-row .setting-label');
    if (!aiLabel) return;

    if (key && key.trim().length > 0) {
      if (aiDot) aiDot.style.background = '#10B981';
      aiLabel.textContent = 'Gemini Vision AI: Active';
    } else {
      if (aiDot) aiDot.style.background = '#F59E0B';
      aiLabel.textContent = 'Offline AI Mode (Add Gemini Key)';
    }
  }

  // API Key handling
  let isEditing = false;
  btnEditKey.addEventListener('click', async () => {
    if (!isEditing) {
      apiKeyInput.type = 'text';
      btnEditKey.textContent = 'Save Key';
      apiKeyInput.focus();
      isEditing = true;
    } else {
      const newKey = apiKeyInput.value.trim();
      await chrome.storage.local.set({ apiKey: newKey });
      updateAiStatus(newKey);
      apiKeyInput.type = 'password';
      btnEditKey.textContent = 'Edit Key';
      isEditing = false;
    }
  });

  apiKeyInput.addEventListener('change', async (e) => {
    const newKey = e.target.value.trim();
    await chrome.storage.local.set({ apiKey: newKey });
    updateAiStatus(newKey);
  });

  masterToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ enabled: e.target.checked });
  });

  preScanToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ preScanEnabled: e.target.checked });
  });

  shieldModeToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ shieldMode: e.target.checked });
  });

  if (removeSkippedToggle) {
    removeSkippedToggle.addEventListener('change', async (e) => {
      await chrome.storage.local.set({ removeSkippedFromFeed: e.target.checked });
    });
  }

  toastToggle.addEventListener('change', async (e) => {
    await chrome.storage.local.set({ showToast: e.target.checked });
  });

  // Daily Scroll Limit listeners
  if (dailyLimitToggle) {
    dailyLimitToggle.addEventListener('change', async (e) => {
      currentDailyLimitEnabled = e.target.checked;
      await chrome.storage.local.set({ dailyLimitEnabled: currentDailyLimitEnabled });
      updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);
    });
  }

  if (dailyLimitInput) {
    dailyLimitInput.addEventListener('change', async (e) => {
      let val = Math.max(10, Math.min(1000, Number(e.target.value) || 100));
      currentDailyLimit = val;
      e.target.value = val;
      await chrome.storage.local.set({ dailyScrollLimit: val });
      updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);
    });
  }

  if (btnLimitMinus) {
    btnLimitMinus.addEventListener('click', async () => {
      let val = Math.max(10, currentDailyLimit - 10);
      currentDailyLimit = val;
      await chrome.storage.local.set({ dailyScrollLimit: val });
      updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);
    });
  }

  if (btnLimitPlus) {
    btnLimitPlus.addEventListener('click', async () => {
      let val = Math.min(1000, currentDailyLimit + 10);
      currentDailyLimit = val;
      await chrome.storage.local.set({ dailyScrollLimit: val });
      updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);
    });
  }

  if (btnResetToday) {
    btnResetToday.addEventListener('click', async () => {
      if (confirm("Reset today's scroll count back to 0?")) {
        currentTodayCount = 0;
        await chrome.storage.local.set({ todayScrollCount: 0, todaySeenReels: {} });
        updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, 0);
      }
    });
  }

  if (limitChips) {
    limitChips.forEach(chip => {
      chip.addEventListener('click', async () => {
        const val = Number(chip.dataset.limit);
        if (val) {
          currentDailyLimit = val;
          await chrome.storage.local.set({ dailyScrollLimit: val });
          updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);
        }
      });
    });
  }

  resetBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ skippedCount: 0, seenProtectedReels: {} });
    skippedCountEl.textContent = '0';
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes.skippedCount) {
      skippedCountEl.textContent = (changes.skippedCount.newValue || 0).toLocaleString();
    }
    if (changes.physicalList) {
      updateCacheStats(changes.physicalList.newValue || {});
    }
    if (changes.dailyLimitEnabled !== undefined || changes.dailyScrollLimit !== undefined || changes.todayScrollCount !== undefined) {
      if (changes.dailyLimitEnabled !== undefined) currentDailyLimitEnabled = changes.dailyLimitEnabled.newValue;
      if (changes.dailyScrollLimit !== undefined) currentDailyLimit = changes.dailyScrollLimit.newValue;
      if (changes.todayScrollCount !== undefined) currentTodayCount = changes.todayScrollCount.newValue;
      updateDailyLimitUI(currentDailyLimitEnabled, currentDailyLimit, currentTodayCount);
    }
  });
});
