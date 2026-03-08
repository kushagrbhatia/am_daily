# Video Region Crop — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect the main `<video>` element on the page via DOM, crop the screenshot to that region before sending to GPT, so promotions and sidebars are excluded from classification.

**Architecture:** Content script detects `<video>` bounds and sends them to background via message passing. Background stores bounds per tab and passes them to the screenshot manager. Screenshot manager crops using `OffscreenCanvas` (available in service workers) before the image is sent to the API. Falls back to full screenshot if no video found or crop fails.

**Tech Stack:** Chrome Extension MV3, OffscreenCanvas API, `createImageBitmap` (service worker safe), MutationObserver

---

## Context: Key Files

- `automute-extension/content/content.js` — currently nearly empty, just handles PING
- `automute-extension/background.js` — `captureAndAnalyze()` at line 432-501, `handleMessage()` at line 212, constructor at line 8
- `automute-extension/utils/screenshot.js` — `captureTab()` at line 21, `optimizeImage()` at line 154 (skips in service worker — no DOM)

**Critical constraint:** `background.js` runs as a service worker — no `document`, no `document.createElement('canvas')`. Must use `OffscreenCanvas` and `createImageBitmap` instead.

---

### Task 1: Content Script — Video Element Detection

**Files:**
- Modify: `automute-extension/content/content.js`

No automated tests for content scripts. Manual verification in Task 3.

**Step 1: Replace content.js with video detection logic**

Replace the entire file with:

```javascript
// AutoMute content script — detects video element bounds and reports to background
(function () {
  'use strict';

  let lastBounds = null;
  let observer = null;

  /**
   * Find the largest visible <video> element and send its bounds to background.
   * Sends VIDEO_BOUNDS_CLEARED if none found.
   */
  function detectAndReport() {
    const videos = Array.from(document.querySelectorAll('video'));

    const visible = videos.filter(v => {
      const rect = v.getBoundingClientRect();
      return (
        rect.width > 100 &&
        rect.height > 100 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight + rect.height && // allow partially visible
        rect.right <= window.innerWidth + rect.width
      );
    });

    if (visible.length === 0) {
      if (lastBounds !== null) {
        lastBounds = null;
        chrome.runtime.sendMessage({ type: 'VIDEO_BOUNDS_CLEARED' }).catch(() => {});
      }
      return;
    }

    // Pick largest by area
    const largest = visible.reduce((a, b) => {
      const aRect = a.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      return aRect.width * aRect.height >= bRect.width * bRect.height ? a : b;
    });

    const rect = largest.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };

    // Only send if bounds changed meaningfully (>5px difference)
    if (
      lastBounds &&
      Math.abs(bounds.x - lastBounds.x) < 5 &&
      Math.abs(bounds.y - lastBounds.y) < 5 &&
      Math.abs(bounds.width - lastBounds.width) < 5 &&
      Math.abs(bounds.height - lastBounds.height) < 5
    ) {
      return; // No significant change
    }

    lastBounds = bounds;
    chrome.runtime.sendMessage({ type: 'VIDEO_BOUNDS_UPDATED', bounds }).catch(() => {});
  }

  /**
   * Watch for DOM changes (videos added/removed/resized).
   */
  function startObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => detectAndReport());
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  // Run on load
  detectAndReport();
  startObserver();

  // Re-run on SPA navigation
  window.addEventListener('popstate', () => { lastBounds = null; detectAndReport(); });
  document.addEventListener('yt-navigate-finish', () => { lastBounds = null; detectAndReport(); });

  // Handle PING from background (connectivity check)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PING') {
      sendResponse({ status: 'pong' });
    }
  });

  console.log('AutoMute content script loaded (video detection active)');
})();
```

**Step 2: Commit**

```bash
cd /Users/kushagrbhatia/Desktop/automute_step_by_step
git add automute-extension/content/content.js
git commit -m "feat: detect video element bounds in content script"
```

---

### Task 2: Background — Store Video Bounds Per Tab

**Files:**
- Modify: `automute-extension/background.js`

Three changes to make:

**Step 1: Add `videoBoundsMap` to constructor**

In the constructor (line 8), after `this.maxHistorySize = 50;`, add:

```javascript
// Video bounds detected by content script, keyed by tabId
this.videoBoundsMap = new Map();
```

**Step 2: Handle VIDEO_BOUNDS_UPDATED and VIDEO_BOUNDS_CLEARED messages**

In `handleMessage()`, after the `YOUTUBE_AD_END` case (before `default:`), add:

```javascript
        case 'VIDEO_BOUNDS_UPDATED':
          if (sender?.tab?.id) {
            this.videoBoundsMap.set(sender.tab.id, message.bounds);
            this.log('debug', `Video bounds updated for tab ${sender.tab.id}`, message.bounds);
          }
          sendResponse({ success: true });
          break;

        case 'VIDEO_BOUNDS_CLEARED':
          if (sender?.tab?.id) {
            this.videoBoundsMap.delete(sender.tab.id);
            this.log('debug', `Video bounds cleared for tab ${sender.tab.id}`);
          }
          sendResponse({ success: true });
          break;
```

**Step 3: Clear bounds when tab closes or navigates**

In `handleTabRemoved()` (line 803), after `audioController.handleTabRemoved(tabId);`, add:

```javascript
    this.videoBoundsMap.delete(tabId);
```

In `handleTabUpdated()` (line 815), after `this.currentTabUrl = changeInfo.url;`, add:

```javascript
      // Clear cached video bounds — new page may have different layout
      this.videoBoundsMap.delete(tabId);
```

**Step 4: Pass bounds to screenshot manager in captureAndAnalyze()**

In `captureAndAnalyze()` (line 452-454), replace:

```javascript
      const screenshotStart = Date.now();
      const base64Image = await screenshotManager.captureTab(this.currentTabId);
      const screenshotTime = Date.now() - screenshotStart;
```

With:

```javascript
      const screenshotStart = Date.now();
      const videoBounds = this.videoBoundsMap.get(this.currentTabId);
      const captureOptions = videoBounds ? { cropBounds: videoBounds } : {};
      const base64Image = await screenshotManager.captureTab(this.currentTabId, captureOptions);
      const screenshotTime = Date.now() - screenshotStart;
```

And update the log line after (line 460) to include crop info:

```javascript
      const cropInfo = videoBounds ? ` [cropped to video ${videoBounds.width}x${videoBounds.height}]` : ' [full screenshot]';
      this.log('debug', `Screenshot captured in ${screenshotTime}ms (${Math.round(base64Image.length / 1024)}KB)${cropInfo}`);
```

**Step 5: Commit**

```bash
git add automute-extension/background.js
git commit -m "feat: store video bounds per tab, pass to screenshot manager"
```

---

### Task 3: Screenshot Manager — Crop to Video Region

**Files:**
- Modify: `automute-extension/utils/screenshot.js`

**Step 1: Add `cropImage()` method to `ScreenshotManager`**

Add this method to the `ScreenshotManager` class, after `calculateOptimalDimensions()` (line 255) and before `processQueue()` (line 260):

```javascript
  /**
   * Crop base64 image to a specific region using OffscreenCanvas.
   * Safe to call in service worker context (no document needed).
   * Returns cropped base64, or null if crop fails (caller falls back to full image).
   * @param {string} base64 - Original base64 JPEG
   * @param {{ x: number, y: number, width: number, height: number }} bounds - Crop region
   * @returns {Promise<string|null>} Cropped base64, or null on failure
   */
  async cropImage(base64, bounds) {
    try {
      // Decode base64 → Blob
      const byteChars = atob(base64);
      const byteNums = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteNums], { type: 'image/jpeg' });

      // createImageBitmap is available in service workers
      const bitmap = await createImageBitmap(blob);

      // Clamp bounds to actual image dimensions
      const x = Math.max(0, Math.round(bounds.x));
      const y = Math.max(0, Math.round(bounds.y));
      const width = Math.min(Math.round(bounds.width), bitmap.width - x);
      const height = Math.min(Math.round(bounds.height), bitmap.height - y);

      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid crop dimensions: ${width}x${height}`);
      }

      // OffscreenCanvas is available in service workers
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

      // Export to blob → base64
      const croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      const arrayBuffer = await croppedBlob.arrayBuffer();
      const croppedBytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < croppedBytes.length; i++) {
        binary += String.fromCharCode(croppedBytes[i]);
      }

      bitmap.close(); // Free memory
      return btoa(binary);

    } catch (error) {
      console.warn('cropImage failed, will use full screenshot:', error.message);
      return null;
    }
  }
```

**Step 2: Integrate crop into `captureTab()`**

In `captureTab()`, replace the existing `optimizeImage` call (line 68):

```javascript
      // Optimize image
      const optimizedBase64 = await this.optimizeImage(base64Data, captureId);
```

With:

```javascript
      // Crop to video region if bounds were provided
      let imageToProcess = base64Data;
      if (options.cropBounds) {
        const cropped = await this.cropImage(base64Data, options.cropBounds);
        if (cropped) {
          imageToProcess = cropped;
          console.log(`Screenshot cropped to video region: ${options.cropBounds.width}x${options.cropBounds.height}px`);
        } else {
          console.warn('Crop failed, using full screenshot');
        }
      }

      // Optimize image
      const optimizedBase64 = await this.optimizeImage(imageToProcess, captureId);
```

**Step 3: Commit**

```bash
git add automute-extension/utils/screenshot.js
git commit -m "feat: add cropImage() to screenshot manager, crop to video region"
```

---

### Task 4: Manual Verification

Load the updated extension and verify end-to-end.

**Step 1: Load extension in Chrome**

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select `automute-extension/` folder
4. If already loaded, click the refresh icon

**Step 2: Verify video detection on ESPN**

1. Open `espn.com` and start a video
2. Open the popup → click Monitor on the ESPN tab
3. Open the logs (click "Show logs")
4. Look for log entries containing `[cropped to video` with dimensions
5. Expected: `Screenshot captured in Xms (YKB) [cropped to video 640x360]` (or similar)

**Step 3: Verify fallback on non-video page**

1. Open `google.com`
2. Monitor it
3. In logs, expect: `Screenshot captured in Xms (YKB) [full screenshot]`

**Step 4: Verify Supabase stores cropped images**

1. Go to Supabase Storage → `screenshots` bucket
2. Download one image
3. Confirm it shows only the video area, not the full browser viewport

**Step 5: Commit verification note**

```bash
git add -A
git commit -m "feat: video region crop complete — DOM detection + OffscreenCanvas crop"
```
