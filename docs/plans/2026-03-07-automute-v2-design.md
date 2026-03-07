# AutoMute v2 — Design Document
**Date:** 2026-03-07
**Status:** Approved

---

## Goals

1. Faster + more accurate ad classification (no accuracy sacrifice)
2. YouTube first-class support via DOM detection
3. Screenshot + label dataset stored in cloud for future model training
4. Weekly accuracy report emailed to developer
5. Cleaner popup UI with first-launch onboarding

---

## Feature 1: Dual-Model Classification (Speed + Accuracy)

**Problem:** GPT-4o is accurate but slow (~1-3s). Switching entirely to gpt-4o-mini risks accuracy.

**Solution:** Use gpt-4o-mini as the fast primary path. Automatically escalate to gpt-4o when confidence is low.

**Flow:**
1. Screenshot → backend `/api/classify`
2. Backend calls `gpt-4o-mini` (~300ms)
3. If `confidence >= 75%` → return result immediately
4. If `confidence < 75%` → call `gpt-4o` with same image, return that result
5. Log `model_used` (`mini` | `gpt4o`) alongside classification to Supabase

**Backend changes:**
- `services/openai.js`: Add `classifyImageDual()` method — calls mini first, falls back to gpt-4o
- `routes/classify.js`: Use `classifyImageDual()` instead of `classifyImage()`
- Confidence threshold (75%) stored in `config/config.js` as `DUAL_MODEL_CONFIDENCE_THRESHOLD`

**No extension changes needed for this feature.**

---

## Feature 2: YouTube DOM-Based Detection

**Problem:** Screenshot-based detection on YouTube is slow and costs API credits. YouTube reliably exposes ad state via DOM.

**Solution:** A dedicated YouTube content script using `MutationObserver` on YouTube's video player.

**How it works:**
- YouTube adds `.ad-showing` class to `#movie_player` when an ad plays
- Content script watches for this class change → sends message to background instantly
- Background mutes/unmutes tab directly — no screenshot, no API call, <10ms response

**New file:** `automute-extension/content/youtube.js`
- Injected only on `youtube.com` and `youtu.be` (scoped in `manifest.json`)
- Sends `YOUTUBE_AD_START` / `YOUTUBE_AD_END` messages to background
- Falls back to screenshot classification if DOM signals are unavailable

**Background changes (`background.js`):**
- Handle `YOUTUBE_AD_START` → `audioController.muteTab()`
- Handle `YOUTUBE_AD_END` → `audioController.unmuteTab()`
- When tab is YouTube, skip the screenshot interval loop entirely

**Manifest changes:**
- Add `content/youtube.js` as a content script scoped to `*://*.youtube.com/*` and `*://*.youtu.be/*`
- Add `"storage"` to permissions (missing from current manifest, code already uses it)

---

## Feature 3: Screenshot + Label Storage (Supabase)

**Problem:** No dataset exists for evaluating model accuracy or training a future local model.

**Solution:** After every classification, store the screenshot and metadata in Supabase.

**Supabase schema:**

```sql
Table: classifications
- id: uuid (primary key)
- timestamp: timestamptz
- screenshot_url: text (Supabase Storage path)
- label: text ('ad' | 'game' | 'other')
- confidence: integer (0-100)
- model_used: text ('mini' | 'gpt4o')
- source: text ('screenshot' | 'youtube_dom')
- site_category: text ('youtube' | 'sportsStreaming' | 'general')
- hostname: text
- reasoning: text
- flagged: boolean (true if mini and gpt-4o disagreed)
```

**Backend changes:**
- `services/supabase.js`: New service — Supabase client, `saveClassification()`, `saveScreenshot()`
- `routes/classify.js`: Call `supabase.saveClassification()` after every classification (async, non-blocking — does not slow down response)

**Infrastructure:**
- Supabase project (free tier covers this volume)
- `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` added as Cloud Run environment variables

---

## Feature 4: Weekly Accuracy Report (Email)

**How it works:**
- A Cloud Scheduler job hits `POST /api/report/weekly` every Monday at 9am
- Backend queries Supabase for the past 7 days of classifications
- Computes: total count, % high-confidence, disagreement rate (mini vs gpt-4o), top flagged hostnames
- Sends email via **Resend** API (free tier: 3,000 emails/month)

**Email contents:**
- Total classifications last 7 days
- % classified by mini only (fast path) vs escalated to gpt-4o
- Disagreement rate (% where mini confidence < 75%)
- Top 5 hostnames by classification volume
- Top 5 most-flagged (uncertain) hostnames
- Link to Supabase dashboard to browse flagged screenshots

**Backend changes:**
- `routes/report.js`: New route `POST /api/report/weekly`
- `services/email.js`: New service — Resend client, `sendWeeklyReport()`
- `services/analytics.js`: New service — Supabase query logic for report aggregation

**Infrastructure:**
- Cloud Scheduler job (GCP) — calls `/api/report/weekly` weekly
- `RESEND_API_KEY` and `REPORT_EMAIL` added as Cloud Run environment variables

---

## Feature 5: UI Redesign + Onboarding

### Popup Redesign

**Current problems:** Live logs visible by default, tab selection is unclear (click tab → then click button).

**Changes:**
- **Tab list**: Each tab row gets an inline ▶ "Monitor" button. Clicking it immediately starts monitoring that tab. No separate "Start AutoMuting" button needed.
- **Logs**: Hidden by default. A small "Show logs" link at the bottom of the popup reveals them. The logs section does not render in the DOM until opened (performance).
- **Status indicator**: Enlarged, centered. Shows one of three states clearly: `Idle`, `Monitoring — [tab name]`, `Muted (Ad detected)`.

### First-Launch Onboarding

A 3-step overlay shown the first time the popup opens after install.

**Steps:**
1. "Pick a tab to watch" — arrow pointing at tab list
2. "Click Monitor" — arrow pointing at a Monitor button
3. "AutoMute handles the rest" — shows the status indicator

**Dismissed** with "Got it" button. State stored in `chrome.storage.local` as `onboarding_complete: true`. Never shown again.

**Implementation:** `popup/onboarding.js` — a simple overlay injected into `popup.html`. No external dependencies.

---

## Deployment

### Backend (GCP Cloud Run)
- Rebuild Docker image with new code
- Add environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `REPORT_EMAIL`
- Create Cloud Scheduler job targeting `POST /api/report/weekly`
- Redeploy — same URL, no extension update needed for backend-only changes

### Extension (Chrome Web Store)
- Bump `manifest.json` version to `1.1.0`
- Submit update for review (1-3 day turnaround)
- Changes requiring review: new content script for YouTube, `storage` permission added

---

## Files Changed

### Extension
| File | Change |
|------|--------|
| `manifest.json` | Add `storage` permission, add YouTube content script entry, bump version |
| `background.js` | Handle YouTube DOM messages, skip screenshot loop for YouTube tabs |
| `content/youtube.js` | **New** — YouTube DOM ad detection |
| `popup/popup.js` | Inline Monitor buttons, hide logs, add onboarding trigger |
| `popup/popup.html` | Updated structure |
| `popup/popup.css` | Updated styles |
| `popup/onboarding.js` | **New** — first-launch overlay |

### Backend
| File | Change |
|------|--------|
| `services/openai.js` | Add `classifyImageDual()` method |
| `services/supabase.js` | **New** — Supabase client + save helpers |
| `services/email.js` | **New** — Resend email service |
| `services/analytics.js` | **New** — report aggregation queries |
| `routes/classify.js` | Use dual-model, call Supabase save |
| `routes/report.js` | **New** — weekly report endpoint |
| `app.js` | Register `/api/report` route |
| `config/config.js` | Add `DUAL_MODEL_CONFIDENCE_THRESHOLD`, `SUPABASE_URL`, `RESEND_API_KEY` |
