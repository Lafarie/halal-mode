# Chrome Web Store Listing — Halal Mode

> Last Updated: 2026-09-06

## Store Listing

**Extension Name** [REQUIRED]
Halal Mode - Smart Video Skip

**Short Description** [REQUIRED]
Auto-skips Instagram Reels, YouTube Shorts, and TikTok when female faces appear on screen. Pure on-device AI.

**Detailed Description** [REQUIRED]
Halal Mode helps you maintain a mindful, modest, and distraction-free video viewing experience on Instagram Reels, YouTube Shorts, and TikTok.

Key Features:
- Intelligent Gemini Vision AI & Neural Engine: Detects women anywhere on screen with custom strictness & corner tolerance slider.
- Zero-Visibility Scroll Pre-Shield: Ensures upcoming reels have 0% opacity and impenetrable blur while scrolling, preventing accidental glimpses before AI verification completes.
- Scroll Feed Removal: Physically collapses skipped and blurred reels from the scroll container so you never have to scroll past them.
- Permanent Physical List Memory: Remembers previously classified reels with instant verdict and CSV / JSON export support.
- On-Screen & Popup Unblur Controls: Choose between 100% impenetrable blur shield with unblur controls or instant auto-skip.
- Cross-Platform Support: Works smoothly on Instagram Reels, YouTube Shorts, and TikTok across Chromium browsers.

How to use it:
1. Install the extension.
2. Click the Halal Mode icon in your toolbar to customize detection sensitivity, action mode (Blur vs Auto-Skip), and feed removal.
3. Browse Instagram Reels, YouTube Shorts, or TikTok normally. The extension will shield incoming reels and remove skipped content from your feed.

Privacy Notice:
Halal Mode connects directly to Google Gemini Vision AI or local on-device machine learning models. Zero personal data or browsing history is collected or sold.

**Category** [REQUIRED]
Social & Communication

**Single Purpose** [REQUIRED]
Automatically detects and skips video reels when female faces appear on screen to support modesty in browsing.

**Primary Language** [REQUIRED]
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|---|---|---|---|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Screenshot 1 [REQUIRED] | 1280×800 or 640×400 | ⬜ Not created | |
| Screenshot 2 [RECOMMENDED] | 1280×800 or 640×400 | ⬜ Not created | |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Not created | |
| Marquee Promo Tile | 1400×560 | ⬜ Not created | |

## Permissions Justification

| Permission | Type | Justification |
|---|---|---|
| `storage` | permissions | Saves user preferences such as sensitivity threshold, shield mode state, physical list memory, and skipped video counter locally. |
| `tabs` | permissions | Needed for screen capture fallback (`captureVisibleTab`) when cross-origin canvas reading is restricted on video feeds. |
| `declarativeNetRequest` | permissions | Modifies media response headers to allow cross-origin video frame extraction for client-side AI analysis. |
| `https://*.instagram.com/*` | host_permissions | Injects content script to monitor, shield, and skip Instagram Reels. |
| `https://*.tiktok.com/*` | host_permissions | Injects content script to monitor, shield, and skip TikTok videos. |
| `https://*.youtube.com/*` | host_permissions | Injects content script to monitor, shield, and skip YouTube Shorts. |
| `https://*.cdninstagram.com/*` | host_permissions | Allows CORS header rules on Instagram media CDN. |
| `https://*.fbcdn.net/*` | host_permissions | Allows CORS header rules on Meta video delivery CDN. |
| `https://generativelanguage.googleapis.com/*` | host_permissions | Connects directly to Google Gemini Vision AI endpoint for real-time video frame classification. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

All visual analysis and machine learning inferences occur directly through user-configured Gemini Vision API or on-device fallback. No user data, video content, or browsing history is collected, stored remotely, or transmitted.

### Certification

- [x] This extension does not sell user data.
- [x] This extension does not use or transfer user data for purposes unrelated to the item's single purpose.
- [x] This extension does not use or transfer user data to determine creditworthiness or for lending purposes.

## Version History

### 1.1.0 — 2026-09-06
- Added Zero-Visibility Scroll Pre-Shield: 0% opacity and 80px blur during scrolling and pre-scanning so no frame flashes during scroll transitions.
- Added Scroll Feed Removal: Physically collapses skipped/hidden reel cards (0px height, display: none) so they are completely removed from the scroll list.
- Added cover image and thumbnail poster shielding to prevent preview images from showing during scroll.
- Enhanced Instagram native "Navigate to next reel" button trigger with full pointer and mouse dispatch.
- Added Physical List Memory with CSV / JSON export and database management drawer.

### 1.0.0 — 2026-09-05
- Initial release with on-device face & gender classification pipeline.
- Added instant auto-skip for Instagram Reels, YouTube Shorts, and TikTok.
- Added Shield Mode with pre-scan blur protection.
- Added sleek popup dashboard with stats counter, sensitivity slider, and platform support.
