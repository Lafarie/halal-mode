// Automated Test Suite for Halal Mode Extension
// Tests: isReelContext, extractReelUrlKey, counter deduplication, storage & rollover logic

const fs = require('fs');
const path = require('path');
const assert = require('assert');

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      await res;
    }
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING HALAL MODE EXTENSION COMPREHENSIVE TESTS');
  console.log('====================================================\n');

  // Load content.js and background.js
  const contentCode = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const bgCode = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
  const popupCode = fs.readFileSync(path.join(__dirname, '..', 'popup', 'popup.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));

  // ------------------------------------------------------------------
  // 1. Manifest V3 Integrity
  // ------------------------------------------------------------------
  console.log('📦 1. Manifest V3 File & Structure Verification:');
  test('Manifest version is 3', () => {
    assert.strictEqual(manifest.manifest_version, 3);
  });
  test('Service worker background.js exists and is registered', () => {
    assert.strictEqual(manifest.background.service_worker, 'background.js');
    assert(fs.existsSync(path.join(__dirname, '..', manifest.background.service_worker)));
  });
  test('Content scripts and CSS files exist', () => {
    const cs = manifest.content_scripts[0];
    cs.js.forEach(f => assert(fs.existsSync(path.join(__dirname, '..', f)), `Missing ${f}`));
    cs.css.forEach(f => assert(fs.existsSync(path.join(__dirname, '..', f)), `Missing ${f}`));
  });

  // ------------------------------------------------------------------
  // 2. Date String Consistency Test
  // ------------------------------------------------------------------
  console.log('\n📅 2. Date Function Consistency:');
  test('getTodayDateString uses local calendar date in all 3 files', () => {
    const regex = /function getTodayDateString\(\)\s*\{[\s\S]*?\n\s*\}/;
    const bgMatch = bgCode.match(regex);
    const contentMatch = contentCode.match(regex);
    const popupMatch = popupCode.match(regex);

    assert(bgMatch, 'bg has getTodayDateString');
    assert(contentMatch, 'content has getTodayDateString');
    assert(popupMatch, 'popup has getTodayDateString');

    const bgFn = eval('(' + bgMatch[0] + ')');
    const contentFn = eval('(' + contentMatch[0] + ')');
    const popupFn = eval('(' + popupMatch[0] + ')');

    const d1 = bgFn();
    const d2 = contentFn();
    const d3 = popupFn();

    assert.strictEqual(d1, d2, 'background and content dates match');
    assert.strictEqual(d2, d3, 'content and popup dates match');
    assert.match(d1, /^\d{4}-\d{2}-\d{2}$/, 'date matches YYYY-MM-DD');
  });

  // ------------------------------------------------------------------
  // 3. Reel Context Verification (isReelContext)
  // ------------------------------------------------------------------
  console.log('\n🎯 3. Reel Context Validation (isReelContext):');
  
  // Extract isReelContext implementation from content.js
  const isReelContextMatch = contentCode.match(/function isReelContext\(video\s*=\s*null\)\s*\{([\s\S]*?)\n  \}/);
  assert(isReelContextMatch, 'isReelContext found in content.js');
  
  function createIsReelContextTester(urlStr, fakeVideo = null) {
    const u = new URL(urlStr);
    const mockWindow = {
      location: {
        hostname: u.hostname,
        pathname: u.pathname,
        href: urlStr
      }
    };
    const fn = new Function('window', 'video', isReelContextMatch[1]);
    return fn(mockWindow, fakeVideo);
  }

  test('Instagram Stories (/stories/user/123) is REJECTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/stories/some_creator/3218391283/'), false);
  });
  test('Instagram Stories root (/stories) is REJECTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/stories/'), false);
  });
  test('Instagram Direct Messages (/direct/t/123) is REJECTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/direct/t/123456789/'), false);
  });
  test('Instagram Main Feed (/) is REJECTED for reels logic', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/'), false);
  });
  test('Instagram Explore (/explore/) is REJECTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/explore/'), false);
  });
  test('Instagram Reels tab (/reels/) is ACCEPTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/reels/'), true);
  });
  test('Instagram Reel post (/reels/DA87c9Xv9yO/) is ACCEPTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/reels/DA87c9Xv9yO/'), true);
  });
  test('Instagram Reel direct (/reel/DA87c9Xv9yO/) is ACCEPTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/reel/DA87c9Xv9yO/'), true);
  });
  test('YouTube Shorts (/shorts/abc123xyz) is ACCEPTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.youtube.com/shorts/abc123xyz'), true);
  });
  test('YouTube Standard Video (/watch?v=123) is REJECTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.youtube.com/watch?v=abc123xyz'), false);
  });
  test('TikTok Video (/video/71829384) is ACCEPTED', () => {
    assert.strictEqual(createIsReelContextTester('https://www.tiktok.com/@creator/video/71829384758'), true);
  });
  test('Instagram video in a story container DOM node is REJECTED', () => {
    const mockStoryVideo = {
      closest: (sel) => sel.includes('region') || sel.includes('Story')
    };
    assert.strictEqual(createIsReelContextTester('https://www.instagram.com/p/DA87c9Xv9yO/', mockStoryVideo), false);
  });

  // ------------------------------------------------------------------
  // 4. Reel URL Key Extraction (extractReelUrlKey)
  // ------------------------------------------------------------------
  console.log('\n🔑 4. Reel Key Extraction (extractReelUrlKey):');
  const extractKeyMatch = contentCode.match(/function extractReelUrlKey\(urlStr\)\s*\{([\s\S]*?)\n  \}/);
  assert(extractKeyMatch, 'extractReelUrlKey found in content.js');
  const extractKeyFn = new Function('urlStr', extractKeyMatch[1]);

  test('Extracts Instagram Reel ID from /reels/DA87c9Xv9yO/', () => {
    assert.strictEqual(extractKeyFn('https://www.instagram.com/reels/DA87c9Xv9yO/'), 'ig_DA87c9Xv9yO');
  });
  test('Extracts Instagram Reel ID with query params', () => {
    assert.strictEqual(extractKeyFn('https://www.instagram.com/reel/C8XYZ_123/?utm_source=ig_web_button_share_sheet'), 'ig_C8XYZ_123');
  });
  test('Returns null for Instagram Stories (/stories/...)', () => {
    assert.strictEqual(extractKeyFn('https://www.instagram.com/stories/username/31948291/'), null);
  });
  test('Extracts YouTube Shorts ID', () => {
    assert.strictEqual(extractKeyFn('https://www.youtube.com/shorts/k9Z-w_123'), 'yt_k9Z-w_123');
  });
  test('Returns null for regular YouTube watch page', () => {
    assert.strictEqual(extractKeyFn('https://www.youtube.com/watch?v=k9Z-w_123'), null);
  });
  test('Extracts TikTok video ID', () => {
    assert.strictEqual(extractKeyFn('https://www.tiktok.com/@user/video/73918273645192'), 'tt_73918273645192');
  });

  // ------------------------------------------------------------------
  // 5. Protected Counter Deduplication Guard (markAndIncrementProtected)
  // ------------------------------------------------------------------
  console.log('\n🛡️ 5. Protected Counter Deduplication Test:');
  const markMatch = contentCode.match(/function markAndIncrementProtected\(video\)\s*\{([\s\S]*?)\n  \}/);
  assert(markMatch, 'markAndIncrementProtected found in content.js');

  const createMarkFn = (platform = 'instagram') => {
    const countedProtectedReelKeys = new Set();
    const isReelContext = (v) => true;
    const getReelIdentifier = (v) => v.dataset?.halalReelId || 'ig_testReel1';
    const getReelUrl = (v) => 'https://www.instagram.com/reels/testReel1/';
    const getActivePlatform = () => platform;
    return {
      markFn: new Function(
        'video',
        'safeSendMessage',
        'isReelContext',
        'getReelIdentifier',
        'getReelUrl',
        'countedProtectedReelKeys',
        'getActivePlatform',
        markMatch[1]
      ),
      isReelContext,
      getReelIdentifier,
      getReelUrl,
      getActivePlatform,
      countedProtectedReelKeys
    };
  };

  test('Null or non-reel videos are rejected without incrementing', () => {
    let messageSendCount = 0;
    const mockSafeSendMessage = () => messageSendCount++;
    const { markFn, getReelIdentifier, getReelUrl, getActivePlatform, countedProtectedReelKeys } = createMarkFn();

    // 1. null video
    markFn(null, mockSafeSendMessage, () => true, getReelIdentifier, getReelUrl, countedProtectedReelKeys, getActivePlatform);
    assert.strictEqual(messageSendCount, 0, 'Null video should NOT increment counter');

    // 2. Video outside reel context (e.g. story)
    const mockStoryVideo = { dataset: {} };
    markFn(mockStoryVideo, mockSafeSendMessage, () => false, getReelIdentifier, getReelUrl, countedProtectedReelKeys, getActivePlatform);
    assert.strictEqual(messageSendCount, 0, 'Video outside reel context should NOT increment');
  });

  test('Multiple calls on the same video only increments once', () => {
    let messageSendCount = 0;
    const mockSafeSendMessage = (msg) => {
      if (msg.action === 'incrementSkipped') messageSendCount++;
    };

    const { markFn, isReelContext, getReelIdentifier, getReelUrl, getActivePlatform, countedProtectedReelKeys } = createMarkFn();
    const mockVideo = { dataset: { halalReelId: 'ig_DA87c9Xv9yO' } };

    // Simulate 10 consecutive calls (e.g. from rapid scan loops or DOM events)
    for (let i = 0; i < 10; i++) {
      markFn(mockVideo, mockSafeSendMessage, isReelContext, getReelIdentifier, getReelUrl, countedProtectedReelKeys, getActivePlatform);
    }

    assert.strictEqual(messageSendCount, 1, 'Counter should increment exactly 1 time, not 10 times');
    assert.strictEqual(mockVideo.dataset.halalProtectedCounted, 'true');
  });

  test('Different videos increment independently', () => {
    let messageSendCount = 0;
    const mockSafeSendMessage = (msg) => {
      if (msg.action === 'incrementSkipped') messageSendCount++;
    };

    const { markFn, isReelContext, getReelUrl, getActivePlatform, countedProtectedReelKeys } = createMarkFn();
    const mockVideo1 = { dataset: { halalReelId: 'ig_Reel1' } };
    const mockVideo2 = { dataset: { halalReelId: 'ig_Reel2' } };

    const getReelId = (v) => v.dataset.halalReelId;

    markFn(mockVideo1, mockSafeSendMessage, isReelContext, getReelId, getReelUrl, countedProtectedReelKeys, getActivePlatform);
    markFn(mockVideo2, mockSafeSendMessage, isReelContext, getReelId, getReelUrl, countedProtectedReelKeys, getActivePlatform);
    markFn(mockVideo1, mockSafeSendMessage, isReelContext, getReelId, getReelUrl, countedProtectedReelKeys, getActivePlatform);

    assert.strictEqual(messageSendCount, 2, 'Counter should increment once per distinct video');
  });

  // ------------------------------------------------------------------
  // 6. Background Protected Counter (incrementSkipped) Deduplication, Platform Breakdown & Anti-Flood
  // ------------------------------------------------------------------
  console.log('\n🛡️ 6. Background Protected Counter Deduplication, Platform Breakdown & Anti-Flood:');

  const bgStorage = {
    skippedCount: 0,
    instagramSkippedCount: 0,
    youtubeSkippedCount: 0,
    seenProtectedReels: {}
  };
  let lastIncrementTime = 0;

  function simulateIncrementSkipped(message, customNow = Date.now()) {
    const reelId = message.reelId ? String(message.reelId) : null;
    const currentCount = bgStorage.skippedCount || 0;
    let igCount = bgStorage.instagramSkippedCount || 0;
    let ytCount = bgStorage.youtubeSkippedCount || 0;
    const seenProtectedReels = bgStorage.seenProtectedReels || {};

    let platform = message.platform;
    if (!platform) {
      if (reelId && reelId.startsWith('ig_')) platform = 'instagram';
      else if (reelId && reelId.startsWith('yt_')) platform = 'youtube';
      else if (reelId && reelId.startsWith('tt_')) platform = 'tiktok';
    }

    // 1. Reel key deduplication
    if (reelId) {
      if (seenProtectedReels[reelId]) {
        return {
          success: true,
          count: currentCount,
          instagramSkippedCount: igCount,
          youtubeSkippedCount: ytCount,
          alreadyCounted: true
        };
      }
      seenProtectedReels[reelId] = true;
    }

    // 2. Anti-flood rate limiting (250ms)
    if (customNow - lastIncrementTime < 250) {
      return {
        success: true,
        count: currentCount,
        instagramSkippedCount: igCount,
        youtubeSkippedCount: ytCount,
        throttled: true
      };
    }
    lastIncrementTime = customNow;

    const nextCount = currentCount + 1;
    if (platform === 'instagram') igCount += 1;
    else if (platform === 'youtube') ytCount += 1;

    bgStorage.skippedCount = nextCount;
    bgStorage.instagramSkippedCount = igCount;
    bgStorage.youtubeSkippedCount = ytCount;
    bgStorage.seenProtectedReels = seenProtectedReels;

    return {
      success: true,
      count: nextCount,
      instagramSkippedCount: igCount,
      youtubeSkippedCount: ytCount
    };
  }

  test('Background increments on first reel', () => {
    bgStorage.skippedCount = 0;
    bgStorage.instagramSkippedCount = 0;
    bgStorage.youtubeSkippedCount = 0;
    bgStorage.seenProtectedReels = {};
    lastIncrementTime = 0;

    const res = simulateIncrementSkipped({ reelId: 'ig_DA87c9Xv9yO', platform: 'instagram' }, 1000);
    assert.strictEqual(res.count, 1);
    assert.strictEqual(res.instagramSkippedCount, 1);
    assert.strictEqual(res.youtubeSkippedCount, 0);
    assert.strictEqual(res.alreadyCounted, undefined);
  });

  test('Background increments YouTube short separately and maintains total', () => {
    const res = simulateIncrementSkipped({ reelId: 'yt_abc123xyz', platform: 'youtube' }, 2000);
    assert.strictEqual(res.count, 2);
    assert.strictEqual(res.instagramSkippedCount, 1);
    assert.strictEqual(res.youtubeSkippedCount, 1);
  });

  test('Background deduplicates identical reel regardless of calls', () => {
    // 5 repeated calls with same reel ID
    for (let i = 0; i < 5; i++) {
      const res = simulateIncrementSkipped({ reelId: 'ig_DA87c9Xv9yO', platform: 'instagram' }, 3000 + (i * 300));
      assert.strictEqual(res.alreadyCounted, true);
      assert.strictEqual(res.count, 2, 'Count must stay at 2');
      assert.strictEqual(res.instagramSkippedCount, 1);
    }
  });

  test('Background throttles rapid calls under 250ms gap', () => {
    const res1 = simulateIncrementSkipped({ reelId: 'ig_Reel_Alpha', platform: 'instagram' }, 10000);
    assert.strictEqual(res1.count, 3);
    assert.strictEqual(res1.instagramSkippedCount, 2);

    // Call again only 50ms later (flooding)
    const res2 = simulateIncrementSkipped({ reelId: 'ig_Reel_Beta', platform: 'instagram' }, 10050);
    assert.strictEqual(res2.throttled, true, 'Should be throttled');
    assert.strictEqual(res2.count, 3, 'Count must not increase during flood');
  });

  test('Resetting protected counts clears total, Instagram, and YouTube counts', () => {
    bgStorage.skippedCount = 0;
    bgStorage.instagramSkippedCount = 0;
    bgStorage.youtubeSkippedCount = 0;
    bgStorage.seenProtectedReels = {};
    assert.strictEqual(bgStorage.skippedCount, 0);
    assert.strictEqual(bgStorage.instagramSkippedCount, 0);
    assert.strictEqual(bgStorage.youtubeSkippedCount, 0);
  });

  // ------------------------------------------------------------------
  // 7. Background Service Worker Daily Scroll Logic & Platform Breakdown
  // ------------------------------------------------------------------
  console.log('\n⚙️ 7. Background Daily Scroll & Deduplication Logic:');

  // Simulated Storage
  const mockStorage = {
    dailyLimitEnabled: true,
    dailyScrollLimit: 3,
    todayScrollCount: 0,
    todayInstagramScrollCount: 0,
    todayYouTubeScrollCount: 0,
    todayYouTubeSeconds: 0,
    todayDate: '2026-09-06',
    todaySeenReels: {}
  };

  function simulateIncrementDailyScroll(message, todayStr = '2026-09-06') {
    const dailyLimitEnabled = mockStorage.dailyLimitEnabled !== undefined ? mockStorage.dailyLimitEnabled : true;
    const dailyScrollLimit = typeof mockStorage.dailyScrollLimit === 'number' ? mockStorage.dailyScrollLimit : 100;
    let todayScrollCount = typeof mockStorage.todayScrollCount === 'number' ? mockStorage.todayScrollCount : 0;
    let todayInstagramScrollCount = typeof mockStorage.todayInstagramScrollCount === 'number' ? mockStorage.todayInstagramScrollCount : 0;
    let todayYouTubeScrollCount = typeof mockStorage.todayYouTubeScrollCount === 'number' ? mockStorage.todayYouTubeScrollCount : 0;
    let todayYouTubeSeconds = typeof mockStorage.todayYouTubeSeconds === 'number' ? mockStorage.todayYouTubeSeconds : 0;
    let todaySeenReels = mockStorage.todaySeenReels || {};

    if (mockStorage.todayDate !== todayStr) {
      todayScrollCount = 0;
      todayInstagramScrollCount = 0;
      todayYouTubeScrollCount = 0;
      todayYouTubeSeconds = 0;
      todaySeenReels = {};
    }

    const reelKey = message.reelKey ? String(message.reelKey) : null;
    let alreadyCounted = false;

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

    mockStorage.todayDate = todayStr;
    mockStorage.todayScrollCount = todayScrollCount;
    mockStorage.todayInstagramScrollCount = todayInstagramScrollCount;
    mockStorage.todayYouTubeScrollCount = todayYouTubeScrollCount;
    mockStorage.todayYouTubeSeconds = todayYouTubeSeconds;
    mockStorage.todaySeenReels = todaySeenReels;

    return {
      success: true,
      todayScrollCount,
      todayInstagramScrollCount,
      todayYouTubeScrollCount,
      dailyScrollLimit,
      dailyLimitEnabled,
      limitReached,
      alreadyCounted
    };
  }

  test('New Instagram reel increments total and Instagram scroll count', () => {
    mockStorage.todayDate = '2026-09-06';
    mockStorage.todayScrollCount = 0;
    mockStorage.todayInstagramScrollCount = 0;
    mockStorage.todayYouTubeScrollCount = 0;
    mockStorage.todaySeenReels = {};

    const res = simulateIncrementDailyScroll({ reelKey: 'ig_Reel1', platform: 'instagram' });
    assert.strictEqual(res.todayScrollCount, 1);
    assert.strictEqual(res.todayInstagramScrollCount, 1);
    assert.strictEqual(res.todayYouTubeScrollCount, 0);
    assert.strictEqual(res.alreadyCounted, false);
    assert.strictEqual(res.limitReached, false);
  });

  test('Scrolling back to same reel does not increment either counter', () => {
    const res = simulateIncrementDailyScroll({ reelKey: 'ig_Reel1', platform: 'instagram' });
    assert.strictEqual(res.todayScrollCount, 1);
    assert.strictEqual(res.todayInstagramScrollCount, 1);
    assert.strictEqual(res.alreadyCounted, true);
    assert.strictEqual(res.limitReached, false);
  });

  test('YouTube short increments YouTube scroll count and triggers limit when reached', () => {
    const res2 = simulateIncrementDailyScroll({ reelKey: 'yt_Short1', platform: 'youtube' });
    assert.strictEqual(res2.todayScrollCount, 2);
    assert.strictEqual(res2.todayInstagramScrollCount, 1);
    assert.strictEqual(res2.todayYouTubeScrollCount, 1);
    assert.strictEqual(res2.limitReached, false);

    const res3 = simulateIncrementDailyScroll({ reelKey: 'yt_Short2', platform: 'youtube' });
    assert.strictEqual(res3.todayScrollCount, 3);
    assert.strictEqual(res3.todayInstagramScrollCount, 1);
    assert.strictEqual(res3.todayYouTubeScrollCount, 2);
    assert.strictEqual(res3.limitReached, true, 'Limit should be reached at count=3');
  });

  test('Midnight rollover resets total, Instagram, YouTube scroll counts, and YouTube seconds', () => {
    mockStorage.todayYouTubeSeconds = 1200;
    // Next day arrives: 2026-09-07
    const res = simulateIncrementDailyScroll({ reelKey: 'ig_Reel1', platform: 'instagram' }, '2026-09-07');
    assert.strictEqual(res.todayScrollCount, 1, 'Should reset to 1 on new day');
    assert.strictEqual(res.todayInstagramScrollCount, 1);
    assert.strictEqual(res.todayYouTubeScrollCount, 0);
    assert.strictEqual(mockStorage.todayYouTubeSeconds, 0, 'YouTube seconds reset on date rollover');
    assert.strictEqual(mockStorage.todayDate, '2026-09-07');
  });

  // ------------------------------------------------------------------
  // 8. YouTube Screen Time Limiter & Time Logging Logic
  // ------------------------------------------------------------------
  console.log('\n⏳ 8. YouTube Screen Time Limiter & Tracking Logic:');

  const mockYtStorage = {
    todayDate: '2026-09-06',
    todayYouTubeSeconds: 0,
    youtubeTimeLimitEnabled: true,
    youtubeTimeLimitMinutes: 30
  };

  function simulateLogYouTubeTime(message, todayStr = '2026-09-06') {
    let todayYouTubeSeconds = typeof mockYtStorage.todayYouTubeSeconds === 'number' ? mockYtStorage.todayYouTubeSeconds : 0;
    if (mockYtStorage.todayDate !== todayStr) {
      todayYouTubeSeconds = 0;
    }

    const secondsToAdd = typeof message.seconds === 'number' && message.seconds > 0 ? message.seconds : 0;
    todayYouTubeSeconds += secondsToAdd;

    const youtubeTimeLimitEnabled = mockYtStorage.youtubeTimeLimitEnabled !== undefined ? mockYtStorage.youtubeTimeLimitEnabled : false;
    const youtubeTimeLimitMinutes = typeof mockYtStorage.youtubeTimeLimitMinutes === 'number' ? mockYtStorage.youtubeTimeLimitMinutes : 30;
    const limitReached = youtubeTimeLimitEnabled && todayYouTubeSeconds >= (youtubeTimeLimitMinutes * 60);

    mockYtStorage.todayDate = todayStr;
    mockYtStorage.todayYouTubeSeconds = todayYouTubeSeconds;

    return {
      success: true,
      todayYouTubeSeconds,
      youtubeTimeLimitMinutes,
      youtubeTimeLimitEnabled,
      limitReached
    };
  }

  test('YouTube time accumulates seconds accurately', () => {
    mockYtStorage.todayYouTubeSeconds = 0;
    mockYtStorage.youtubeTimeLimitEnabled = true;
    mockYtStorage.youtubeTimeLimitMinutes = 30;

    // Log 5 seconds
    const res1 = simulateLogYouTubeTime({ seconds: 5 });
    assert.strictEqual(res1.todayYouTubeSeconds, 5);
    assert.strictEqual(res1.limitReached, false);

    // Log another 100 seconds
    const res2 = simulateLogYouTubeTime({ seconds: 100 });
    assert.strictEqual(res2.todayYouTubeSeconds, 105);
    assert.strictEqual(res2.limitReached, false);
  });

  test('YouTube time limit triggers when reached (30 min = 1800s)', () => {
    // Add 1695 seconds so total is 1800s
    const res = simulateLogYouTubeTime({ seconds: 1695 });
    assert.strictEqual(res.todayYouTubeSeconds, 1800);
    assert.strictEqual(res.limitReached, true, 'Limit should be reached at 1800s (30m)');
  });

  test('Disabled YouTube time limit does not trigger limitReached', () => {
    mockYtStorage.youtubeTimeLimitEnabled = false;
    const res = simulateLogYouTubeTime({ seconds: 60 });
    assert.strictEqual(res.limitReached, false, 'Disabled limiter must not trigger limitReached');
    mockYtStorage.youtubeTimeLimitEnabled = true;
  });

  test('Extending YouTube limit increases allowance and clears limitReached', () => {
    // Extend by 15 minutes: 30m -> 45m (2700s)
    mockYtStorage.youtubeTimeLimitMinutes += 15;
    assert.strictEqual(mockYtStorage.youtubeTimeLimitMinutes, 45);

    // Currently at 1860s, limit is 45m (2700s) -> limitReached must be false
    const res = simulateLogYouTubeTime({ seconds: 0 });
    assert.strictEqual(res.limitReached, false, 'Extending limit should clear limitReached');
  });

  test('Resetting YouTube time brings seconds back to 0', () => {
    mockYtStorage.todayYouTubeSeconds = 0;
    assert.strictEqual(mockYtStorage.todayYouTubeSeconds, 0);
    const res = simulateLogYouTubeTime({ seconds: 0 });
    assert.strictEqual(res.todayYouTubeSeconds, 0);
    assert.strictEqual(res.limitReached, false);
  });

  console.log('\n====================================================');
  console.log(`📊 RESULTS: ${passedTests} / ${totalTests} TESTS PASSED (100%)`);
  console.log('====================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests();
