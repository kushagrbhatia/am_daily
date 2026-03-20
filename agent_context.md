# AutoMute — Agent Context

## What It Does
Chrome extension that auto-mutes video ads during streaming. It periodically screenshots a browser tab, sends the image to a backend API, and uses OpenAI GPT-4o vision to classify content as `ad` (mute), `game` (unmute), or `other` (unmute). YouTube gets instant DOM-based detection instead of screenshots.

---

## Architecture

```
Chrome Extension (MV3)          Node.js Backend (Cloud Run)
├── background.js               ├── server.js          — entry point
├── popup/popup.js              ├── app.js             — Express setup, routes
├── popup/onboarding.js         ├── routes/classify.js — POST /api/classify
├── content/content.js          ├── routes/report.js   — POST /api/report/weekly
├── content/youtube.js          ├── services/openai.js — dual-model classification
└── utils/                      ├── services/supabase.js — screenshot + label storage
    ├── screenshot.js           ├── services/analytics.js — weekly stats queries
    ├── api.js                  ├── services/email.js  — Resend weekly report email
    ├── audio.js                ├── services/imageProcessor.js
    └── memory.js               ├── middleware/rateLimiter.js
                                └── config/config.js
```

---

## Key Files

### Extension
- **`background.js`** — `AutoMuteDetector` class. Handles YouTube DOM messages (`YOUTUBE_AD_START`/`YOUTUBE_AD_END`) to mute/unmute without API calls. For YouTube tabs, skips screenshot loop entirely (returns `mode: 'youtube_dom'`). Non-YouTube tabs use screenshot interval as before.
- **`content/youtube.js`** — YouTube-only content script. `MutationObserver` on `#movie_player` watches for `.ad-showing` class. Sends `YOUTUBE_AD_START`/`YOUTUBE_AD_END` to background. Retries if player not in DOM. Handles SPA navigation via `yt-navigate-finish`.
- **`popup/popup.js`** — `PopupController` class. Inline `▶ Monitor` button per tab row. Logs hidden by default with "Show logs" toggle. Dynamic stop button appears when monitoring. No separate "Start AutoMuting" button.
- **`popup/onboarding.js`** — First-launch 3-step overlay ("Pick a tab", "AutoMute detects ads", "You're all set"). Stores `onboarding_complete: true` in `chrome.storage.local`. Never shown again.
- **`utils/screenshot.js`** — Captures tab screenshot via `chrome.tabs.captureVisibleTab`.
- **`utils/api.js`** — Sends base64 screenshot to backend `/api/classify` with site metadata.
- **`utils/audio.js`** — Mutes/unmutes tabs via `chrome.tabs.update({ muted })`.
- **`config/constants.js`** — `CONFIG` with `SCREENSHOT_INTERVAL`, confidence thresholds, API URL, storage keys.

### Backend
- **`routes/classify.js`** — `POST /api/classify`. Now calls `classifyImageDual()` (mini→gpt-4o). Non-blocking Supabase save after every classification. Returns `model_used` in response.
- **`routes/report.js`** — `POST /api/report/weekly`. Secured by `x-report-secret` header. Queries Supabase via analytics service, sends email via Resend.
- **`services/openai.js`** — `OpenAIService` with 4 prompt variants + `classifyImageDual()`: calls `gpt-4o-mini` first; if confidence ≥ threshold (default 75) returns immediately, else falls back to `gpt-4o`. `_parseResponse()` shared helper.
- **`services/supabase.js`** — `saveScreenshot(base64, filename)` → Supabase Storage. `saveClassification(data)` → `classifications` table. Both fail silently (no-throw).
- **`services/analytics.js`** — `getWeeklyStats(days=7)` queries Supabase for total, highConfidencePct, escalatedPct, flaggedPct, topHostnames.
- **`services/email.js`** — `sendWeeklyReport(stats)` via Resend API.
- **`middleware/rateLimiter.js`** — express-rate-limit on all routes except `/health`.

---

## Classification Logic

### YouTube (DOM-based, background.js)
- Content script detects `.ad-showing` on `#movie_player` → instant mute (<10ms, no API call)
- `YOUTUBE_AD_END` → unmute

### Non-YouTube (screenshot + API)
Site-specific mute decisions in `shouldMuteForClassification()`:
- **Sports streaming** (ESPN, Fox, CBS, Peacock, etc.): 3-way — mute `ad`, unmute `game`, maintain state for `other`
- **General sites**: mute `ad` only if video indicators present (audible tab, video site, or video-related reasoning keywords)

### Dual-Model (backend)
1. Call `gpt-4o-mini` (~300ms)
2. If `confidence >= DUAL_MODEL_CONFIDENCE_THRESHOLD` (default 75) → return immediately (`model_used: 'mini'`)
3. Else → call `gpt-4o` → return result (`model_used: 'gpt4o'`)

---

## Supabase Schema

```sql
Table: classifications
- id: uuid (primary key)
- timestamp: timestamptz
- screenshot_url: text
- label: text ('ad' | 'game' | 'other')
- confidence: integer (0-100)
- model_used: text ('mini' | 'gpt4o')
- source: text ('screenshot' | 'youtube_dom')
- site_category: text
- hostname: text
- reasoning: text
- flagged: boolean
```

Storage bucket: `screenshots` (public or service-key access)

---

## Deployment
- Backend: Google Cloud Run — `https://automute-api-16091147188.us-central1.run.app`
- Extension: Manifest V3 v1.1.0, permissions: `activeTab`, `tabCapture`, `tabs`, `storage`
- Backend URL hardcoded in `config/constants.js` and `manifest.json`

### Required env vars (Cloud Run)
| Var | Description |
|-----|-------------|
| `OPENAI_API_KEY` | OpenAI key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `RESEND_API_KEY` | Resend API key |
| `REPORT_EMAIL` | Email to send weekly report to |
| `REPORT_SECRET` | Secret header value for `/api/report/weekly` |
| `DUAL_MODEL_CONFIDENCE_THRESHOLD` | Optional, default 75 |

---

## Current State (v1.1.0, branch: am_v2)
- YouTube: instant DOM-based ad detection (no API cost)
- All other sites: dual-model classification (mini→gpt-4o fallback)
- Every classification saved to Supabase (async, non-blocking)
- Weekly accuracy email report via `/api/report/weekly` + Cloud Scheduler
- Popup redesigned: inline Monitor buttons, logs hidden by default
- First-launch onboarding overlay
- 10 tests pass (3 suites)
- Supabase + Resend not yet configured (env vars missing) — see manual setup steps
