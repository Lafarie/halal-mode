// Background Service Worker for Halal Mode (MV3)
// Powered by Gemini Vision AI with Blur & Auto-Skip modes

function getTodayDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const DEFAULT_SETTINGS = {
  enabled: true,
  apiKey: "",             // Configured by user in popup settings or loaded from storage
  modelName: "gemini-3.5-flash-lite",
  aiProvider: "gemini",
  actionMode: "blur",     // 'blur' (heavy blur + on-screen unblur) or 'skip' (auto-skip reel)
  preScanEnabled: true,
  shieldMode: true,
  removeSkippedFromFeed: true, // Remove / collapse skipped reels from scroll feed
  dailyLimitEnabled: true,     // Mindful daily scroll limit
  dailyScrollLimit: 100,       // Default 100 reels per day
  todayScrollCount: 0,         // Counter for today
  todayInstagramScrollCount: 0,// Instagram reels scrolled today
  todayYouTubeScrollCount: 0,  // YouTube shorts scrolled today
  todayDate: getTodayDateString(),
  todaySeenReels: {},          // Unique reel IDs counted today
  todayYouTubeSeconds: 0,      // Seconds spent using YouTube today
  youtubeTimeLimitEnabled: false, // Optional daily YouTube time limit
  youtubeTimeLimitMinutes: 30, // Default 30 min limit when enabled
  cornerTolerance: 0,     // 0 = Strict (No girls anywhere on screen), 50 = Corner OK, up to 100
  sensitivity: 65,
  scanIntervalMs: 800,
  showToast: true,
  skippedCount: 0,
  instagramSkippedCount: 0,    // Total protected reels on Instagram
  youtubeSkippedCount: 0,      // Total protected shorts on YouTube
  seenProtectedReels: {},      // Unique reel IDs counted as protected (prevents runaway loops)
  physicalList: {},       // Permanent registry of scanned reels (Reel ID -> verdict & metadata)
  platforms: {
    instagram: true,
    youtube: true,
    tiktok: true
  }
};

// Initialize settings on install or update
chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const toInit = {};

  for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
    if (current[key] === undefined) {
      toInit[key] = val;
    }
  }

  // Migrate 'remove' mode to 'skip'
  if (current.actionMode === 'remove') {
    toInit.actionMode = 'skip';
  }

  // Ensure cornerTolerance exists
  if (current.cornerTolerance === undefined) {
    toInit.cornerTolerance = 0;
  }

  // Ensure removeSkippedFromFeed exists
  if (current.removeSkippedFromFeed === undefined) {
    toInit.removeSkippedFromFeed = true;
  }

  // Ensure daily scroll limit exists
  if (current.dailyLimitEnabled === undefined) {
    toInit.dailyLimitEnabled = true;
  }
  if (current.dailyScrollLimit === undefined) {
    toInit.dailyScrollLimit = 100;
  }
  if (current.todayScrollCount === undefined) {
    toInit.todayScrollCount = 0;
  }
  if (current.todayDate === undefined) {
    toInit.todayDate = getTodayDateString();
  }
  if (current.todaySeenReels === undefined) {
    toInit.todaySeenReels = {};
  }
  if (current.seenProtectedReels === undefined) {
    toInit.seenProtectedReels = {};
  }

  // Ensure physicalList exists
  if (current.physicalList === undefined) {
    toInit.physicalList = {};
  }

  if (Object.keys(toInit).length > 0) {
    await chrome.storage.local.set(toInit);
  }

  await updateBadge(current.enabled !== undefined ? current.enabled : DEFAULT_SETTINGS.enabled);
  console.log('[Halal Mode] Service worker ready with Gemini Vision AI & Physical Reel Memory.');
});

// Update extension icon badge
async function updateBadge(enabled, count = null) {
  try {
    if (!enabled) {
      await chrome.action.setBadgeText({ text: 'OFF' });
      await chrome.action.setBadgeBackgroundColor({ color: '#6B7280' });
      return;
    }

    if (count !== null && count > 0) {
      const badgeText = count > 999 ? `${Math.floor(count / 1000)}k` : String(count);
      await chrome.action.setBadgeText({ text: badgeText });
      await chrome.action.setBadgeBackgroundColor({ color: '#10B981' });
    } else {
      await chrome.action.setBadgeText({ text: 'AI' });
      await chrome.action.setBadgeBackgroundColor({ color: '#059669' });
    }
  } catch (err) {
    console.error('[Halal Mode] Failed to update badge:', err);
  }
}

// React to storage changes
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== 'local') return;

  if (changes.enabled) {
    const { skippedCount = 0 } = await chrome.storage.local.get('skippedCount');
    await updateBadge(changes.enabled.newValue, skippedCount);
  } else if (changes.skippedCount) {
    const { enabled = true } = await chrome.storage.local.get('enabled');
    if (enabled) {
      await updateBadge(true, changes.skippedCount.newValue);
    }
  }
});

// Gemini Vision Classifier
async function classifyWithGemini(base64Data, apiKey) {
  if (!apiKey) {
    return { success: false, error: "No API key configured", fallbackToLocal: true };
  }

  const cleanBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
  const mimeType = base64Data.includes("image/png") ? "image/png" : "image/jpeg";

  const candidateModels = ["gemini-3.5-flash-lite", "gemini-flash-latest", "gemini-3.6-flash"];
  const prompt = `Analyze this video frame strictly for the presence of women or girls.
Rules:
1. Detect any woman or girl anywhere in the frame (including face, body, dancers, full-screen, background, or corner).
2. Set "has_woman" to true if ANY female person is present, false otherwise.
3. Estimate "prominence" as a percentage (0 to 100):
   - 0-25%: Tiny, distant background, or small corner/edge snippet.
   - 26-60%: Moderate/secondary presence or noticeable corner subject.
   - 61-100%: Primary focal subject, close-up, or full screen.
4. Set "location": "corner" | "background" | "center" | "full_screen" | "none".
5. Set "confidence" (0-100).
6. Set "reason" (short 5-10 word explanation).

Output ONLY JSON in this format:
{"has_woman": boolean, "confidence": number, "prominence": number, "location": "corner"|"background"|"center"|"full_screen"|"none", "reason": string}`;

  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: cleanBase64 } }
            ]
          }],
          generationConfig: {
            response_mime_type: "application/json",
            max_output_tokens: 150,
            temperature: 0.1
          }
        })
      });

      if (res.status === 503 || res.status === 429) {
        console.warn(`[Halal Mode] Model ${model} busy (${res.status}), trying next candidate...`);
        continue;
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        console.warn(`[Halal Mode] Model ${model} returned error:`, res.status, errData);
        continue;
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) continue;

      try {
        const parsed = JSON.parse(text);
        const confidence = typeof parsed.confidence === 'number'
          ? (parsed.confidence <= 1 ? Math.round(parsed.confidence * 100) : Math.round(parsed.confidence))
          : 100;
        const prominence = typeof parsed.prominence === 'number'
          ? (parsed.prominence <= 1 ? Math.round(parsed.prominence * 100) : Math.round(parsed.prominence))
          : (parsed.has_woman ? 80 : 0);
        const location = typeof parsed.location === 'string'
          ? parsed.location.toLowerCase().trim()
          : (parsed.has_woman ? 'center' : 'none');

        return {
          success: true,
          has_woman: Boolean(parsed.has_woman),
          confidence: confidence,
          prominence: prominence,
          location: location,
          reason: parsed.reason || "",
          modelUsed: model
        };
      } catch (e) {
        const hasWoman = text.toLowerCase().includes('"has_woman": true') || text.toLowerCase().includes('has_woman: true');
        return {
          success: true,
          has_woman: hasWoman,
          confidence: 95,
          prominence: hasWoman ? 80 : 0,
          location: hasWoman ? 'center' : 'none',
          reason: "",
          modelUsed: model
        };
      }
    } catch (err) {
      console.warn(`[Halal Mode] Fetch error with model ${model}:`, err);
    }
  }

  return { success: false, error: "All AI models unavailable", fallbackToLocal: true };
}

let lastIncrementSkippedTime = 0;

// Message Dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.action === 'captureTab') {
        const windowId = sender.tab?.windowId;
        if (!windowId) {
          sendResponse({ success: false, error: 'No sender window ID' });
          return;
        }

        const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
          format: 'jpeg',
          quality: 60
        });

        sendResponse({ success: true, dataUrl });
      } else if (message.action === 'classifyFrame') {
        const settings = await chrome.storage.local.get(['apiKey']);
        const apiKey = settings.apiKey ? settings.apiKey.trim() : "";

        if (!apiKey) {
          sendResponse({ success: false, error: "No API key configured", fallbackToLocal: true });
          return;
        }

        const result = await classifyWithGemini(message.dataUrl, apiKey);
        sendResponse(result);
      } else if (message.action === 'incrementSkipped') {
        const now = Date.now();
        const reelId = message.reelId ? String(message.reelId) : null;

        const data = await chrome.storage.local.get([
          'skippedCount',
          'instagramSkippedCount',
          'youtubeSkippedCount',
          'seenProtectedReels'
        ]);
        const currentCount = typeof data.skippedCount === 'number' ? data.skippedCount : 0;
        let instagramSkippedCount = typeof data.instagramSkippedCount === 'number' ? data.instagramSkippedCount : 0;
        let youtubeSkippedCount = typeof data.youtubeSkippedCount === 'number' ? data.youtubeSkippedCount : 0;
        let seenProtectedReels = data.seenProtectedReels || {};

        // 1. Reel key deduplication: if this reel was already counted as protected, do NOT count it again!
        if (reelId) {
          if (seenProtectedReels[reelId]) {
            sendResponse({
              success: true,
              count: currentCount,
              instagramSkippedCount,
              youtubeSkippedCount,
              alreadyCounted: true
            });
            return;
          }
          seenProtectedReels[reelId] = true;
        }

        // 2. Anti-flood rate limiting: never allow more than 1 increment per 250ms
        if (now - lastIncrementSkippedTime < 250) {
          sendResponse({
            success: true,
            count: currentCount,
            instagramSkippedCount,
            youtubeSkippedCount,
            throttled: true
          });
          return;
        }
        lastIncrementSkippedTime = now;

        // Determine platform
        let platform = message.platform;
        if (!platform) {
          if (reelId && reelId.startsWith('ig_')) platform = 'instagram';
          else if (reelId && reelId.startsWith('yt_')) platform = 'youtube';
          else if (reelId && reelId.startsWith('tt_')) platform = 'tiktok';
          else if (message.url && message.url.includes('instagram.com')) platform = 'instagram';
          else if (message.url && message.url.includes('youtube.com')) platform = 'youtube';
          else if (message.url && message.url.includes('tiktok.com')) platform = 'tiktok';
        }

        const nextCount = currentCount + 1;
        if (platform === 'instagram') {
          instagramSkippedCount += 1;
        } else if (platform === 'youtube') {
          youtubeSkippedCount += 1;
        }

        await chrome.storage.local.set({
          skippedCount: nextCount,
          instagramSkippedCount,
          youtubeSkippedCount,
          seenProtectedReels
        });
        sendResponse({
          success: true,
          count: nextCount,
          instagramSkippedCount,
          youtubeSkippedCount
        });
      } else if (message.action === 'resetSkippedCount') {
        await chrome.storage.local.set({
          skippedCount: 0,
          instagramSkippedCount: 0,
          youtubeSkippedCount: 0,
          seenProtectedReels: {}
        });
        await updateBadge(true, 0);
        sendResponse({
          success: true,
          count: 0,
          instagramSkippedCount: 0,
          youtubeSkippedCount: 0
        });
      } else if (message.action === 'incrementDailyScroll') {
        const todayStr = getTodayDateString();
        const data = await chrome.storage.local.get([
          'dailyLimitEnabled',
          'dailyScrollLimit',
          'todayScrollCount',
          'todayInstagramScrollCount',
          'todayYouTubeScrollCount',
          'todayYouTubeSeconds',
          'todayDate',
          'todaySeenReels'
        ]);

        const dailyLimitEnabled = data.dailyLimitEnabled !== undefined ? data.dailyLimitEnabled : true;
        const dailyScrollLimit = typeof data.dailyScrollLimit === 'number' ? data.dailyScrollLimit : 100;
        let todayScrollCount = typeof data.todayScrollCount === 'number' ? data.todayScrollCount : 0;
        let todayInstagramScrollCount = typeof data.todayInstagramScrollCount === 'number' ? data.todayInstagramScrollCount : 0;
        let todayYouTubeScrollCount = typeof data.todayYouTubeScrollCount === 'number' ? data.todayYouTubeScrollCount : 0;
        let todayYouTubeSeconds = typeof data.todayYouTubeSeconds === 'number' ? data.todayYouTubeSeconds : 0;
        let todaySeenReels = data.todaySeenReels || {};

        if (data.todayDate !== todayStr) {
          todayScrollCount = 0;
          todayInstagramScrollCount = 0;
          todayYouTubeScrollCount = 0;
          todayYouTubeSeconds = 0;
          todaySeenReels = {};
        }

        const reelKey = message.reelKey ? String(message.reelKey) : null;
        let alreadyCounted = false;

        // Determine platform
        let platform = message.platform;
        if (!platform) {
          if (reelKey && reelKey.startsWith('ig_')) platform = 'instagram';
          else if (reelKey && reelKey.startsWith('yt_')) platform = 'youtube';
          else if (reelKey && reelKey.startsWith('tt_')) platform = 'tiktok';
        }

        if (reelKey) {
          if (todaySeenReels[reelKey]) {
            alreadyCounted = true;
          } else {
            todaySeenReels[reelKey] = true;
            todayScrollCount += 1;
            if (platform === 'instagram') todayInstagramScrollCount += 1;
            else if (platform === 'youtube') todayYouTubeScrollCount += 1;
          }
        } else {
          todayScrollCount += 1;
          if (platform === 'instagram') todayInstagramScrollCount += 1;
          else if (platform === 'youtube') todayYouTubeScrollCount += 1;
        }

        const limitReached = dailyLimitEnabled && todayScrollCount >= dailyScrollLimit;

        await chrome.storage.local.set({
          todayDate: todayStr,
          todayScrollCount,
          todayInstagramScrollCount,
          todayYouTubeScrollCount,
          todayYouTubeSeconds,
          todaySeenReels
        });

        sendResponse({
          success: true,
          todayScrollCount,
          todayInstagramScrollCount,
          todayYouTubeScrollCount,
          dailyScrollLimit,
          dailyLimitEnabled,
          limitReached,
          alreadyCounted
        });
      } else if (message.action === 'getDailyScrollData') {
        const todayStr = getTodayDateString();
        const data = await chrome.storage.local.get([
          'dailyLimitEnabled',
          'dailyScrollLimit',
          'todayScrollCount',
          'todayInstagramScrollCount',
          'todayYouTubeScrollCount',
          'todayDate',
          'todaySeenReels'
        ]);

        const dailyLimitEnabled = data.dailyLimitEnabled !== undefined ? data.dailyLimitEnabled : true;
        const dailyScrollLimit = typeof data.dailyScrollLimit === 'number' ? data.dailyScrollLimit : 100;
        let todayScrollCount = typeof data.todayScrollCount === 'number' ? data.todayScrollCount : 0;
        let todayInstagramScrollCount = typeof data.todayInstagramScrollCount === 'number' ? data.todayInstagramScrollCount : 0;
        let todayYouTubeScrollCount = typeof data.todayYouTubeScrollCount === 'number' ? data.todayYouTubeScrollCount : 0;
        let todaySeenReels = data.todaySeenReels || {};

        if (data.todayDate !== todayStr) {
          todayScrollCount = 0;
          todayInstagramScrollCount = 0;
          todayYouTubeScrollCount = 0;
          todaySeenReels = {};
          await chrome.storage.local.set({
            todayDate: todayStr,
            todayScrollCount: 0,
            todayInstagramScrollCount: 0,
            todayYouTubeScrollCount: 0,
            todaySeenReels: {}
          });
        }

        const limitReached = dailyLimitEnabled && todayScrollCount >= dailyScrollLimit;
        sendResponse({
          success: true,
          todayScrollCount,
          todayInstagramScrollCount,
          todayYouTubeScrollCount,
          dailyScrollLimit,
          dailyLimitEnabled,
          todayDate: todayStr,
          limitReached
        });
      } else if (message.action === 'resetTodayScrollCount') {
        const todayStr = getTodayDateString();
        await chrome.storage.local.set({
          todayDate: todayStr,
          todayScrollCount: 0,
          todayInstagramScrollCount: 0,
          todayYouTubeScrollCount: 0,
          todaySeenReels: {}
        });
        sendResponse({
          success: true,
          todayScrollCount: 0,
          todayInstagramScrollCount: 0,
          todayYouTubeScrollCount: 0
        });
      } else if (message.action === 'extendDailyScrollLimit') {
        const amount = typeof message.amount === 'number' ? message.amount : 15;
        const data = await chrome.storage.local.get(['dailyScrollLimit']);
        const currentLimit = typeof data.dailyScrollLimit === 'number' ? data.dailyScrollLimit : 100;
        const newLimit = currentLimit + amount;
        await chrome.storage.local.set({ dailyScrollLimit: newLimit });
        sendResponse({ success: true, newLimit });
      } else if (message.action === 'logYouTubeTime') {
        const todayStr = getTodayDateString();
        const data = await chrome.storage.local.get([
          'todayDate',
          'todayYouTubeSeconds',
          'youtubeTimeLimitEnabled',
          'youtubeTimeLimitMinutes'
        ]);

        let todayYouTubeSeconds = typeof data.todayYouTubeSeconds === 'number' ? data.todayYouTubeSeconds : 0;
        if (data.todayDate !== todayStr) {
          todayYouTubeSeconds = 0;
        }

        const secondsToAdd = typeof message.seconds === 'number' && message.seconds > 0 ? message.seconds : 0;
        todayYouTubeSeconds += secondsToAdd;

        const youtubeTimeLimitEnabled = data.youtubeTimeLimitEnabled !== undefined ? data.youtubeTimeLimitEnabled : false;
        const youtubeTimeLimitMinutes = typeof data.youtubeTimeLimitMinutes === 'number' ? data.youtubeTimeLimitMinutes : 30;
        const limitReached = youtubeTimeLimitEnabled && todayYouTubeSeconds >= (youtubeTimeLimitMinutes * 60);

        await chrome.storage.local.set({
          todayDate: todayStr,
          todayYouTubeSeconds
        });

        sendResponse({
          success: true,
          todayYouTubeSeconds,
          youtubeTimeLimitMinutes,
          youtubeTimeLimitEnabled,
          limitReached
        });
      } else if (message.action === 'getYouTubeTimeData') {
        const todayStr = getTodayDateString();
        const data = await chrome.storage.local.get([
          'todayDate',
          'todayYouTubeSeconds',
          'youtubeTimeLimitEnabled',
          'youtubeTimeLimitMinutes'
        ]);

        let todayYouTubeSeconds = typeof data.todayYouTubeSeconds === 'number' ? data.todayYouTubeSeconds : 0;
        if (data.todayDate !== todayStr) {
          todayYouTubeSeconds = 0;
          await chrome.storage.local.set({ todayDate: todayStr, todayYouTubeSeconds: 0 });
        }

        const youtubeTimeLimitEnabled = data.youtubeTimeLimitEnabled !== undefined ? data.youtubeTimeLimitEnabled : false;
        const youtubeTimeLimitMinutes = typeof data.youtubeTimeLimitMinutes === 'number' ? data.youtubeTimeLimitMinutes : 30;
        const limitReached = youtubeTimeLimitEnabled && todayYouTubeSeconds >= (youtubeTimeLimitMinutes * 60);

        sendResponse({
          success: true,
          todayYouTubeSeconds,
          youtubeTimeLimitMinutes,
          youtubeTimeLimitEnabled,
          limitReached
        });
      } else if (message.action === 'resetTodayYouTubeTime') {
        const todayStr = getTodayDateString();
        await chrome.storage.local.set({ todayDate: todayStr, todayYouTubeSeconds: 0 });
        sendResponse({ success: true, todayYouTubeSeconds: 0 });
      } else if (message.action === 'setYouTubeTimeLimit') {
        const toSet = {};
        if (typeof message.enabled === 'boolean') toSet.youtubeTimeLimitEnabled = message.enabled;
        if (typeof message.minutes === 'number') toSet.youtubeTimeLimitMinutes = Math.max(1, message.minutes);
        await chrome.storage.local.set(toSet);
        sendResponse({ success: true, ...toSet });
      } else if (message.action === 'extendYouTubeTimeLimit') {
        const amount = typeof message.amount === 'number' ? message.amount : 15;
        const data = await chrome.storage.local.get(['youtubeTimeLimitMinutes']);
        const currentLimit = typeof data.youtubeTimeLimitMinutes === 'number' ? data.youtubeTimeLimitMinutes : 30;
        const newLimit = currentLimit + amount;
        await chrome.storage.local.set({ youtubeTimeLimitMinutes: newLimit });
        sendResponse({ success: true, newLimit });
      } else if (message.action === 'getSettings') {
        const settings = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
        sendResponse({ success: true, settings: { ...DEFAULT_SETTINGS, ...settings } });
      } else if (message.action === 'saveToPhysicalList') {
        const { record } = message;
        if (record && record.reelId) {
          const { physicalList = {} } = await chrome.storage.local.get('physicalList');
          physicalList[record.reelId] = {
            ...record,
            savedAt: Date.now()
          };

          // Limit cache to 3,000 items (oldest first)
          const keys = Object.keys(physicalList);
          if (keys.length > 3000) {
            keys.sort((a, b) => (physicalList[a].savedAt || 0) - (physicalList[b].savedAt || 0));
            const toRemove = keys.slice(0, keys.length - 3000);
            for (const k of toRemove) delete physicalList[k];
          }

          await chrome.storage.local.set({ physicalList });
          sendResponse({ success: true, total: Object.keys(physicalList).length });
        } else {
          sendResponse({ success: false, error: 'Invalid record' });
        }
      } else if (message.action === 'getPhysicalList') {
        const { physicalList = {} } = await chrome.storage.local.get('physicalList');
        sendResponse({ success: true, list: physicalList });
      } else if (message.action === 'clearPhysicalList') {
        await chrome.storage.local.set({ physicalList: {} });
        sendResponse({ success: true });
      } else if (message.action === 'deletePhysicalItem') {
        const { reelId } = message;
        const { physicalList = {} } = await chrome.storage.local.get('physicalList');
        if (physicalList[reelId]) {
          delete physicalList[reelId];
          await chrome.storage.local.set({ physicalList });
        }
        sendResponse({ success: true });
      } else if (message.action === 'togglePhysicalItem') {
        const { reelId } = message;
        const { physicalList = {} } = await chrome.storage.local.get('physicalList');
        if (physicalList[reelId]) {
          const prev = physicalList[reelId].verdict;
          physicalList[reelId].verdict = prev === 'hidden' ? 'allowed' : 'hidden';
          physicalList[reelId].reason = `Manually marked ${physicalList[reelId].verdict}`;
          physicalList[reelId].savedAt = Date.now();
          await chrome.storage.local.set({ physicalList });
        }
        sendResponse({ success: true, item: physicalList[reelId] });
      } else {
        sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (err) {
      console.error('[Halal Mode] Message error:', err);
      sendResponse({ success: false, error: err.message, fallbackToLocal: true });
    }
  })();

  return true;
});
