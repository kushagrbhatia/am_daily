# Video Region Crop — Design Document
**Date:** 2026-03-08
**Status:** Approved

---

## Problem

Screenshots include the entire browser viewport — sidebars, promotional banners, and other page content. This causes misclassifications when promotions appear alongside the main video (e.g. ESPN sidebar ads get classified as "ad" even when a game is playing).

## Solution

Detect the main `<video>` element's position via DOM, crop the screenshot to that region before sending to GPT, and save only the cropped image to Supabase.

---

## Data Flow

```
content.js detects <video> bounds
       ↓
background.js stores bounds per tab (Map: tabId → bounds)
       ↓
captureAndAnalyze(): capture full viewport → crop to bounds
       ↓
api.js sends cropped base64 to /api/classify
       ↓
Backend classifies + saves cropped image to Supabase (no backend changes)
```

---

## Component Changes (Extension Only)

### `content/content.js`
- On load: find largest visible `<video>` element via `querySelectorAll('video')`
- Extract `getBoundingClientRect()` → send `VIDEO_BOUNDS_UPDATED` to background
- Watch for DOM changes via `MutationObserver` (videos added/removed)
- Re-run on SPA navigation (`popstate`, `yt-navigate-finish`)
- Send `VIDEO_BOUNDS_CLEARED` if no video found

### `background.js`
- Add `videoBoundsMap = new Map()` (tabId → bounds)
- Handle `VIDEO_BOUNDS_UPDATED` → store bounds for sender tab
- Handle `VIDEO_BOUNDS_CLEARED` → delete bounds for sender tab
- In `captureAndAnalyze()`: pass bounds to screenshot manager if available
- On tab closed/navigate: clear stored bounds

### `utils/screenshot.js`
- New method `cropImage(base64, bounds)`:
  - Creates offscreen Canvas, draws full image, extracts crop region
  - Returns cropped base64 JPEG
  - Note: Canvas API available in service worker via `OffscreenCanvas`
- In capture flow: if bounds available → crop → return cropped image
- Fallback: if no bounds or crop fails → return full image (existing behavior)

---

## Fallback Behavior

| Situation | Behavior |
|-----------|----------|
| `<video>` found | Crop to video bounds → classify crop |
| No `<video>` on page | Full screenshot (existing) |
| Video bounds change | Content script sends update → next capture uses new bounds |
| Crop throws error | Log warning → fall back to full screenshot |
| YouTube tab | YouTube DOM path unchanged (mute on `.ad-showing`, no screenshot) |

---

## No Backend Changes

Backend receives smaller base64 — works identically. Supabase will store the cropped image. No schema changes needed.

---

## Files Changed

| File | Change |
|------|--------|
| `automute-extension/content/content.js` | Add video detection + bounds messaging |
| `automute-extension/background.js` | Store bounds map, pass to screenshot manager |
| `automute-extension/utils/screenshot.js` | Add `cropImage()`, integrate into capture flow |
