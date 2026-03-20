# YouTube UI Feedback — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Update the popup classification display in real-time when YouTube ads are detected and muted via DOM (no screenshot needed).

**Architecture:** When `YOUTUBE_AD_START` fires in background.js, set `this.lastClassification` to a synthetic ad object (`shouldMute: true`). When `YOUTUBE_AD_END` fires, reset it to a non-muting object. The popup already polls `GET_STATUS` every 2-3 seconds and calls `updateClassificationDisplay(lastClassification)` — so no popup changes are needed. The classification box will show 🔇 with a red background during YouTube ads, and revert when the ad ends.

**Tech Stack:** Chrome Extension MV3, existing popup polling model (no new message types needed)

---

## Context: Key Files

- `automute-extension/background.js` — `YOUTUBE_AD_START` handler at line 265, `YOUTUBE_AD_END` handler at line 275, `lastClassification` set in `handleClassificationResult()` at line 551
- `automute-extension/popup/popup.js` — `updateClassificationDisplay()` at line 136, called at line 465 only when `lastClassification` is non-null

**How the popup works:**
1. Popup polls `GET_STATUS` every 2–3 seconds
2. Background returns `lastClassification` in the status object (line 921)
3. Popup calls `updateClassificationDisplay(lastClassification)` if non-null (line 465)
4. `updateClassificationDisplay` shows 🔇 + red background if `lastClassification.shouldMute === true`

**Why YouTube UI is blank today:** `lastClassification` is only set in `handleClassificationResult()`, which is only called from `captureAndAnalyze()`. YouTube tabs skip the screenshot loop entirely (return mode `'youtube_dom'` at line 351), so `lastClassification` stays `null` forever.

---

### Task 1: Set `lastClassification` in YouTube Ad Handlers

**Files:**
- Modify: `automute-extension/background.js` (lines 265–283)

No automated tests for this (content script / message handler). Manual verification below.

**Step 1: Update `YOUTUBE_AD_START` handler**

In `handleMessage()`, find the `YOUTUBE_AD_START` case (line 265). Replace:

```javascript
        case 'YOUTUBE_AD_START':
          this.log('info', 'YouTube ad detected via DOM — muting');
          if (this.currentTabId) {
            await audioController.muteTab(this.currentTabId, { smooth: false });
          } else if (sender?.tab?.id) {
            await audioController.muteTab(sender.tab.id, { smooth: false });
          }
          sendResponse({ success: true });
          break;
```

With:

```javascript
        case 'YOUTUBE_AD_START':
          this.log('info', 'YouTube ad detected via DOM — muting');
          if (this.currentTabId) {
            await audioController.muteTab(this.currentTabId, { smooth: false });
          } else if (sender?.tab?.id) {
            await audioController.muteTab(sender.tab.id, { smooth: false });
          }
          this.lastClassification = {
            classification: 'ad',
            confidence: 100,
            shouldMute: true,
            source: 'youtube_dom',
            timestamp: new Date().toISOString(),
            hostname: this.extractHostname(this.currentTabUrl),
            siteCategory: 'youtube'
          };
          sendResponse({ success: true });
          break;
```

**Step 2: Update `YOUTUBE_AD_END` handler**

Find the `YOUTUBE_AD_END` case (line 275). Replace:

```javascript
        case 'YOUTUBE_AD_END': {
          this.log('info', 'YouTube ad ended via DOM — unmuting');
          const tabIdToUnmute = this.currentTabId || sender?.tab?.id;
          if (tabIdToUnmute) {
            await audioController.unmuteTab(tabIdToUnmute, { smooth: false });
          }
          sendResponse({ success: true });
          break;
        }
```

With:

```javascript
        case 'YOUTUBE_AD_END': {
          this.log('info', 'YouTube ad ended via DOM — unmuting');
          const tabIdToUnmute = this.currentTabId || sender?.tab?.id;
          if (tabIdToUnmute) {
            await audioController.unmuteTab(tabIdToUnmute, { smooth: false });
          }
          this.lastClassification = {
            classification: 'other',
            confidence: 100,
            shouldMute: false,
            source: 'youtube_dom',
            timestamp: new Date().toISOString(),
            hostname: this.extractHostname(this.currentTabUrl),
            siteCategory: 'youtube'
          };
          sendResponse({ success: true });
          break;
        }
```

**Step 3: Commit**

```bash
cd /Users/kushagrbhatia/Desktop/automute_step_by_step
git add automute-extension/background.js
git commit -m "feat: update popup classification display for YouTube DOM ad detection"
```

---

### Task 2: Manual Verification

**Step 1: Load the extension**

1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click the refresh icon on the AutoMute extension (or "Load unpacked" if not loaded)

**Step 2: Test YouTube ad detection → popup updates**

1. Open `youtube.com` and start any video
2. Open the AutoMute popup → click **▶ Monitor** on the YouTube tab
3. Wait for a YouTube ad to play (or skip to a video known to have pre-roll ads)
4. While the ad is playing, open the popup again
5. Expected: classification box shows **🔇** with red background (muted state)
6. When the ad ends: classification box reverts to **👁️ OTHER** with green background

**Step 3: Verify no regressions on non-YouTube sites**

1. Open ESPN.com with a video playing
2. Monitor it
3. Confirm the classification box still updates normally from screenshot analysis
4. Confirm logs show `[cropped to video WxH]` as before

**Step 4: Commit verification note**

```bash
git add -A
git commit -m "feat: YouTube popup UI feedback complete"
```
