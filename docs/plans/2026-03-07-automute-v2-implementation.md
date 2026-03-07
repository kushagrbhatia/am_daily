# AutoMute v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dual-model classification, YouTube DOM detection, Supabase screenshot storage, weekly email reports, and a cleaner popup UI with first-launch onboarding.

**Architecture:** The backend gains a dual-model path (gpt-4o-mini primary, gpt-4o fallback on low confidence) and two new services (Supabase for storage, Resend for email). The extension gains a YouTube-specific content script that bypasses the screenshot loop entirely, and the popup is redesigned with inline controls and a first-launch onboarding overlay.

**Tech Stack:** Node.js/Express (backend), Jest + supertest (backend tests), Supabase JS client v2, Resend Node SDK, Chrome Extension MV3, Vanilla JS (extension/popup)

---

## Task 1: Update backend config for new services

**Files:**
- Modify: `automute-backend/config/config.js`
- Modify: `automute-backend/.env` (add new keys — never commit this file)

**Step 1: Add new config keys**

Replace the contents of `automute-backend/config/config.js` with:

```js
require('dotenv').config();

module.exports = {
  port: process.env.PORT || 8080,
  nodeEnv: process.env.NODE_ENV || 'development',
  openaiApiKey: process.env.OPENAI_API_KEY || 'placeholder',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  rateLimitWindowMs: 15 * 60 * 1000,
  rateLimitMax: 100,

  // Dual-model classification
  dualModelConfidenceThreshold: parseInt(process.env.DUAL_MODEL_CONFIDENCE_THRESHOLD || '75', 10),

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY || '',

  // Email reporting
  resendApiKey: process.env.RESEND_API_KEY || '',
  reportEmail: process.env.REPORT_EMAIL || '',
};
```

**Step 2: Add placeholder keys to `.env`**

Add to `automute-backend/.env` (this file is gitignored — confirm with `cat .gitignore`):

```
DUAL_MODEL_CONFIDENCE_THRESHOLD=75
SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_KEY=your_supabase_service_key_here
RESEND_API_KEY=your_resend_api_key_here
REPORT_EMAIL=your_email@example.com
```

**Step 3: Commit**

```bash
git add automute-backend/config/config.js
git commit -m "feat: add config for dual-model, Supabase, and email"
```

---

## Task 2: Add dual-model classification to OpenAI service

**Files:**
- Modify: `automute-backend/services/openai.js`
- Test: `automute-backend/tests/openai.test.js` (new file)

**Step 1: Write the failing tests**

Create `automute-backend/tests/openai.test.js`:

```js
const openaiService = require('../services/openai');

// Mock the OpenAI client so tests don't make real API calls
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn()
      }
    }
  }));
});

describe('OpenAI Service - classifyImageDual', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns mini result when confidence >= threshold', async () => {
    // Arrange: mini returns high confidence
    const OpenAI = require('openai');
    const mockCreate = OpenAI.mock.instances[0].chat.completions.create;
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"ad","confidence":85,"reasoning":"clear ad"}' } }]
    });

    // Act
    const result = await openaiService.classifyImageDual('fakebase64', 75);

    // Assert: only one API call made (mini)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result.classification).toBe('ad');
    expect(result.confidence).toBe(85);
    expect(result.model_used).toBe('mini');
  });

  test('falls back to gpt-4o when mini confidence < threshold', async () => {
    const OpenAI = require('openai');
    const mockCreate = OpenAI.mock.instances[0].chat.completions.create;

    // mini returns low confidence
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"ad","confidence":60,"reasoning":"uncertain"}' } }]
    });
    // gpt-4o returns high confidence
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"game","confidence":90,"reasoning":"definitely game"}' } }]
    });

    const result = await openaiService.classifyImageDual('fakebase64', 75);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result.classification).toBe('game');
    expect(result.confidence).toBe(90);
    expect(result.model_used).toBe('gpt4o');
    expect(result.mini_result).toBeDefined();
    expect(result.mini_result.confidence).toBe(60);
  });

  test('returns mini result if gpt-4o call fails', async () => {
    const OpenAI = require('openai');
    const mockCreate = OpenAI.mock.instances[0].chat.completions.create;

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"classification":"ad","confidence":60,"reasoning":"uncertain"}' } }]
    });
    mockCreate.mockRejectedValueOnce(new Error('OpenAI error'));

    const result = await openaiService.classifyImageDual('fakebase64', 75);

    expect(result.model_used).toBe('mini');
    expect(result.confidence).toBe(60);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
cd automute-backend && npx jest tests/openai.test.js --no-coverage
```

Expected: FAIL — `classifyImageDual is not a function`

**Step 3: Implement `classifyImageDual` in `services/openai.js`**

Add this method to the `OpenAIService` class, just before the closing `}` of the class (around line 360):

```js
/**
 * Dual-model classification: fast with gpt-4o-mini, accurate fallback to gpt-4o
 */
async classifyImageDual(base64Image, confidenceThreshold = 75) {
  // Step 1: try gpt-4o-mini (fast)
  let miniResult;
  try {
    const startTime = Date.now();
    const response = await new OpenAI({ apiKey: require('../config/config').openaiApiKey })
      .chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.getPrompt() },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' } }
          ]
        }],
        max_tokens: 250,
        temperature: 0.2
      });

    miniResult = this._parseResponse(response.choices[0].message.content);
    miniResult.processing_time = (Date.now() - startTime) / 1000;
    miniResult.model_used = 'mini';
  } catch (error) {
    console.error('gpt-4o-mini call failed:', error.message);
    // Fall through to gpt-4o
  }

  // Step 2: if mini succeeded and confidence is high enough, return it
  if (miniResult && miniResult.confidence >= confidenceThreshold) {
    return miniResult;
  }

  // Step 3: fallback to gpt-4o
  try {
    const startTime = Date.now();
    const response = await new OpenAI({ apiKey: require('../config/config').openaiApiKey })
      .chat.completions.create({
        model: 'gpt-4o',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: this.getPrompt() },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' } }
          ]
        }],
        max_tokens: 250,
        temperature: 0.2
      });

    const fullResult = this._parseResponse(response.choices[0].message.content);
    fullResult.processing_time = (Date.now() - startTime) / 1000;
    fullResult.model_used = 'gpt4o';
    if (miniResult) fullResult.mini_result = miniResult;
    return fullResult;
  } catch (error) {
    console.error('gpt-4o fallback failed:', error.message);
    // If gpt-4o also fails, return mini result if we have it
    if (miniResult) return miniResult;
    throw error;
  }
}

/**
 * Parse OpenAI response content into a classification result object.
 * Extracted from classifyImage to avoid duplication.
 */
_parseResponse(content) {
  let cleanContent = content.trim();
  if (cleanContent.startsWith('```json')) {
    cleanContent = cleanContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
  } else if (cleanContent.startsWith('```')) {
    cleanContent = cleanContent.replace(/```\s*/, '').replace(/\s*```$/, '');
  }
  cleanContent = cleanContent.replace(/,\s*}/, '}').replace(/,\s*]/, ']');

  let result;
  try {
    result = JSON.parse(cleanContent);
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('ad') || lower.includes('skip')) {
      result = { classification: 'ad', confidence: 65, reasoning: 'Fallback: ad keywords' };
    } else if (lower.includes('game') || lower.includes('sport')) {
      result = { classification: 'game', confidence: 65, reasoning: 'Fallback: game keywords' };
    } else {
      result = { classification: 'other', confidence: 50, reasoning: 'Fallback: parse failed' };
    }
  }

  if (!['ad', 'game', 'other'].includes(result.classification)) result.classification = 'other';
  if (typeof result.confidence !== 'number') result.confidence = 50;
  if (!result.reasoning) result.reasoning = 'Classification completed';

  return result;
}
```

**Step 4: Run tests to confirm they pass**

```bash
cd automute-backend && npx jest tests/openai.test.js --no-coverage
```

Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add automute-backend/services/openai.js automute-backend/tests/openai.test.js
git commit -m "feat: add dual-model classification (gpt-4o-mini + gpt-4o fallback)"
```

---

## Task 3: Install Supabase client and create Supabase service

**Files:**
- Create: `automute-backend/services/supabase.js`
- Test: `automute-backend/tests/supabase.test.js`

**Step 1: Install Supabase JS client**

```bash
cd automute-backend && npm install @supabase/supabase-js
```

**Step 2: Set up Supabase project (one-time manual step)**

1. Go to [supabase.com](https://supabase.com) → New project
2. In the SQL editor, run:

```sql
create table classifications (
  id uuid primary key default gen_random_uuid(),
  timestamp timestamptz default now(),
  screenshot_url text,
  label text check (label in ('ad', 'game', 'other')),
  confidence integer check (confidence >= 0 and confidence <= 100),
  model_used text check (model_used in ('mini', 'gpt4o', 'youtube_dom')),
  source text check (source in ('screenshot', 'youtube_dom')),
  site_category text,
  hostname text,
  reasoning text,
  flagged boolean default false
);
```

3. In Storage → New bucket → name it `screenshots`, set to private
4. Copy Project URL and service role key → paste into `.env`

**Step 3: Write failing tests**

Create `automute-backend/tests/supabase.test.js`:

```js
// Mock Supabase before requiring the service
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn().mockResolvedValue({ data: { path: 'screenshots/test.jpg' }, error: null })
      }))
    },
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ error: null })
    }))
  }))
}));

const supabaseService = require('../services/supabase');

describe('Supabase Service', () => {
  test('saveClassification resolves without throwing', async () => {
    const payload = {
      label: 'ad',
      confidence: 85,
      model_used: 'mini',
      source: 'screenshot',
      site_category: 'youtube',
      hostname: 'youtube.com',
      reasoning: 'Skip ad button visible',
      flagged: false,
      screenshot_url: 'screenshots/abc.jpg'
    };

    await expect(supabaseService.saveClassification(payload)).resolves.not.toThrow();
  });

  test('saveScreenshot returns a storage path', async () => {
    const path = await supabaseService.saveScreenshot('fakebase64data', 'jpg');
    expect(typeof path).toBe('string');
    expect(path).toContain('screenshots/');
  });

  test('saveClassification does not throw if Supabase is unconfigured', async () => {
    // Should fail silently — never crash the classification flow
    const { createClient } = require('@supabase/supabase-js');
    createClient.mockImplementationOnce(() => ({
      storage: { from: () => ({ upload: jest.fn().mockResolvedValue({ data: null, error: new Error('no config') }) }) },
      from: () => ({ insert: jest.fn().mockResolvedValue({ error: new Error('no config') }) })
    }));

    await expect(supabaseService.saveClassification({ label: 'ad' })).resolves.not.toThrow();
  });
});
```

**Step 4: Run tests to confirm they fail**

```bash
cd automute-backend && npx jest tests/supabase.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../services/supabase'`

**Step 5: Implement `services/supabase.js`**

Create `automute-backend/services/supabase.js`:

```js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

// Client is created lazily so the app starts even if Supabase is unconfigured
let client = null;
function getClient() {
  if (!client && config.supabaseUrl && config.supabaseServiceKey) {
    client = createClient(config.supabaseUrl, config.supabaseServiceKey);
  }
  return client;
}

/**
 * Upload a base64 screenshot to Supabase Storage.
 * Returns the storage path, or null if upload fails.
 */
async function saveScreenshot(base64Image, extension = 'jpg') {
  const db = getClient();
  if (!db) return null;

  try {
    const filename = `screenshots/${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const buffer = Buffer.from(base64Image, 'base64');

    const { data, error } = await db.storage
      .from('screenshots')
      .upload(filename, buffer, { contentType: `image/${extension}` });

    if (error) {
      console.warn('Supabase screenshot upload failed:', error.message);
      return null;
    }

    return data.path;
  } catch (err) {
    console.warn('saveScreenshot error:', err.message);
    return null;
  }
}

/**
 * Insert a classification record into the `classifications` table.
 * Fails silently — never blocks the main classification response.
 */
async function saveClassification(payload) {
  const db = getClient();
  if (!db) return;

  try {
    const { error } = await db.from('classifications').insert({
      label: payload.label,
      confidence: payload.confidence,
      model_used: payload.model_used,
      source: payload.source || 'screenshot',
      site_category: payload.site_category,
      hostname: payload.hostname,
      reasoning: payload.reasoning,
      flagged: payload.flagged || false,
      screenshot_url: payload.screenshot_url || null,
      timestamp: new Date().toISOString()
    });

    if (error) {
      console.warn('Supabase insert failed:', error.message);
    }
  } catch (err) {
    console.warn('saveClassification error:', err.message);
  }
}

module.exports = { saveScreenshot, saveClassification };
```

**Step 6: Run tests**

```bash
cd automute-backend && npx jest tests/supabase.test.js --no-coverage
```

Expected: PASS (3 tests)

**Step 7: Commit**

```bash
git add automute-backend/services/supabase.js automute-backend/tests/supabase.test.js automute-backend/package.json automute-backend/package-lock.json
git commit -m "feat: add Supabase service for screenshot and classification storage"
```

---

## Task 4: Update classify route to use dual-model + save to Supabase

**Files:**
- Modify: `automute-backend/routes/classify.js`
- Modify: `automute-backend/tests/api.test.js`

**Step 1: Update `routes/classify.js`**

Replace the classification block inside the route handler. The full updated handler:

```js
const express = require('express');
const router = express.Router();
const { classificationLimiter } = require('../middleware/rateLimiter');
const { validateClassificationRequest } = require('../middleware/validator');
const { validateApiKey } = require('../middleware/auth');
const openaiService = require('../services/openai');
const imageProcessor = require('../services/imageProcessor');
const supabaseService = require('../services/supabase');
const config = require('../config/config');

router.post('/classify',
  classificationLimiter,
  validateApiKey,
  validateClassificationRequest,
  async (req, res) => {
    try {
      const { image, siteMetadata = {}, timestamp } = req.body;
      const startTime = Date.now();

      console.log(`Classification request at ${new Date().toISOString()}`);

      let processedImage = image;
      try {
        processedImage = await imageProcessor.optimizeImage(image);
      } catch (e) {
        console.warn('Image optimization failed, using original:', e.message);
      }

      // Dual-model classification
      const result = await openaiService.classifyImageDual(
        processedImage,
        config.dualModelConfidenceThreshold
      );

      const totalTime = (Date.now() - startTime) / 1000;
      const flagged = !!(result.mini_result); // flagged = escalated to gpt-4o

      console.log(`Classification: ${result.classification} (${result.confidence}%) via ${result.model_used} in ${totalTime}s`);

      // Save to Supabase asynchronously — do NOT await, never blocks response
      (async () => {
        try {
          const screenshotUrl = await supabaseService.saveScreenshot(processedImage);
          await supabaseService.saveClassification({
            label: result.classification,
            confidence: result.confidence,
            model_used: result.model_used,
            source: 'screenshot',
            site_category: siteMetadata.site_category || 'general',
            hostname: siteMetadata.hostname || '',
            reasoning: result.reasoning,
            flagged,
            screenshot_url: screenshotUrl
          });
        } catch (e) {
          console.warn('Background Supabase save failed:', e.message);
        }
      })();

      res.json({
        classification: result.classification,
        confidence: result.confidence,
        reasoning: result.reasoning,
        processing_time: totalTime,
        model_used: result.model_used,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('Classification endpoint error:', error.message);

      const errorResponses = {
        'rate_limit': { status: 429, error: 'openai_rate_limit', message: 'OpenAI rate limit exceeded', retry_after: 60 },
        'openai_server_error': { status: 502, error: 'openai_server_error', message: 'OpenAI temporarily unavailable', retry_after: 30 }
      };

      const errorResponse = errorResponses[error.message] || {
        status: 500, error: 'classification_failed', message: 'Failed to classify image', retry_after: 10
      };

      res.status(errorResponse.status).json({
        error: errorResponse.error,
        message: errorResponse.message,
        retry_after: errorResponse.retry_after,
        timestamp: new Date().toISOString()
      });
    }
  }
);

router.get('/health', async (req, res) => {
  try {
    const openaiHealth = await openaiService.healthCheck();
    res.json({ status: 'healthy', services: { openai: openaiHealth }, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', error: error.message, timestamp: new Date().toISOString() });
  }
});

module.exports = router;
```

**Step 2: Add test for `model_used` field in classify response**

Add to `automute-backend/tests/api.test.js`:

```js
test('POST /api/classify response includes model_used field', async () => {
  // This test mocks the openaiService to return a fast result
  jest.mock('../services/openai', () => ({
    classifyImageDual: jest.fn().mockResolvedValue({
      classification: 'game',
      confidence: 90,
      reasoning: 'Sports content',
      model_used: 'mini',
      processing_time: 0.3
    }),
    healthCheck: jest.fn().mockResolvedValue({ status: 'healthy' })
  }));

  const validBase64 = Buffer.from('fake image data').toString('base64');
  const response = await request(app)
    .post('/api/classify')
    .send({ image: validBase64 })
    .expect(200);

  expect(response.body.model_used).toBeDefined();
});
```

**Step 3: Run all backend tests**

```bash
cd automute-backend && npx jest --no-coverage
```

Expected: PASS (all existing + new tests)

**Step 4: Commit**

```bash
git add automute-backend/routes/classify.js automute-backend/tests/api.test.js
git commit -m "feat: use dual-model classification in classify route, save results to Supabase"
```

---

## Task 5: Create email service and weekly report route

**Files:**
- Create: `automute-backend/services/email.js`
- Create: `automute-backend/services/analytics.js`
- Create: `automute-backend/routes/report.js`
- Modify: `automute-backend/app.js`

**Step 1: Install Resend**

```bash
cd automute-backend && npm install resend
```

**Step 2: Create `services/analytics.js`**

```js
const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

function getClient() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) return null;
  return createClient(config.supabaseUrl, config.supabaseServiceKey);
}

/**
 * Aggregate classification stats for the past N days.
 */
async function getWeeklyStats(days = 7) {
  const db = getClient();
  if (!db) return null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from('classifications')
    .select('label, confidence, model_used, flagged, hostname, site_category')
    .gte('timestamp', since);

  if (error) throw new Error(`Supabase query failed: ${error.message}`);
  if (!data || data.length === 0) return { total: 0 };

  const total = data.length;
  const highConfidence = data.filter(r => r.confidence >= 75).length;
  const escalated = data.filter(r => r.model_used === 'gpt4o').length;
  const flagged = data.filter(r => r.flagged).length;

  // Top 5 hostnames by volume
  const hostnameCounts = {};
  data.forEach(r => {
    if (r.hostname) hostnameCounts[r.hostname] = (hostnameCounts[r.hostname] || 0) + 1;
  });
  const topHostnames = Object.entries(hostnameCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([host, count]) => ({ host, count }));

  return {
    total,
    highConfidencePct: Math.round((highConfidence / total) * 100),
    escalatedPct: Math.round((escalated / total) * 100),
    flaggedPct: Math.round((flagged / total) * 100),
    topHostnames,
    since
  };
}

module.exports = { getWeeklyStats };
```

**Step 3: Create `services/email.js`**

```js
const { Resend } = require('resend');
const config = require('../config/config');

const resend = new Resend(config.resendApiKey);

async function sendWeeklyReport(stats) {
  if (!config.reportEmail || !config.resendApiKey) {
    console.warn('Email not configured — skipping report send');
    return;
  }

  const subject = `AutoMute Weekly Report — ${stats.total} classifications`;

  const topHostsHtml = stats.topHostnames
    .map(({ host, count }) => `<li>${host}: ${count}</li>`)
    .join('');

  const html = `
    <h2>AutoMute Weekly Accuracy Report</h2>
    <p><strong>Period:</strong> Last 7 days (since ${new Date(stats.since).toDateString()})</p>
    <hr>
    <h3>Summary</h3>
    <ul>
      <li><strong>Total classifications:</strong> ${stats.total}</li>
      <li><strong>High confidence (≥75%):</strong> ${stats.highConfidencePct}%</li>
      <li><strong>Escalated to gpt-4o:</strong> ${stats.escalatedPct}%</li>
      <li><strong>Flagged (mini/gpt-4o disagreed):</strong> ${stats.flaggedPct}%</li>
    </ul>
    <h3>Top Sites</h3>
    <ol>${topHostsHtml}</ol>
    <p><a href="${config.supabaseUrl ? config.supabaseUrl.replace('/rest/v1', '') + '/project/default/editor' : '#'}">Browse flagged screenshots in Supabase →</a></p>
  `;

  const { error } = await resend.emails.send({
    from: 'AutoMute <reports@yourdomain.com>',
    to: config.reportEmail,
    subject,
    html
  });

  if (error) throw new Error(`Email send failed: ${error.message}`);
  console.log('Weekly report sent to', config.reportEmail);
}

module.exports = { sendWeeklyReport };
```

**Step 4: Create `routes/report.js`**

```js
const express = require('express');
const router = express.Router();
const { getWeeklyStats } = require('../services/analytics');
const { sendWeeklyReport } = require('../services/email');

// Called by Cloud Scheduler weekly. Secured by a simple shared secret.
router.post('/weekly', async (req, res) => {
  const secret = req.headers['x-report-secret'];
  if (secret !== process.env.REPORT_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const stats = await getWeeklyStats(7);

    if (!stats || stats.total === 0) {
      return res.json({ message: 'No data for this period, report skipped' });
    }

    await sendWeeklyReport(stats);
    res.json({ message: 'Report sent', stats });
  } catch (error) {
    console.error('Report generation failed:', error.message);
    res.status(500).json({ error: 'report_failed', message: error.message });
  }
});

module.exports = router;
```

**Step 5: Register the report route in `app.js`**

Add after the existing `app.use('/api', require('./routes/classify'))` line:

```js
app.use('/api/report', require('./routes/report'));
```

Also add `REPORT_SECRET` to `.env`:

```
REPORT_SECRET=pick_a_random_string_here
```

**Step 6: Run all tests**

```bash
cd automute-backend && npx jest --no-coverage
```

Expected: PASS

**Step 7: Commit**

```bash
git add automute-backend/services/analytics.js automute-backend/services/email.js automute-backend/routes/report.js automute-backend/app.js automute-backend/package.json automute-backend/package-lock.json
git commit -m "feat: add weekly accuracy report (Supabase analytics + Resend email)"
```

---

## Task 6: Update extension manifest

**Files:**
- Modify: `automute-extension/manifest.json`

**Step 1: Apply all manifest changes**

Replace `manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "AutoMute",
  "version": "1.1.0",
  "description": "Automatically mute ads during sports streams while preserving game audio",
  "permissions": [
    "activeTab",
    "tabCapture",
    "tabs",
    "storage"
  ],
  "host_permissions": [
    "https://automute-api-16091147188.us-central1.run.app/*",
    "<all_urls>"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "AutoMute",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://automute-api-16091147188.us-central1.run.app"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/content.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["*://*.youtube.com/*", "*://*.youtu.be/*"],
      "js": ["content/youtube.js"],
      "run_at": "document_idle"
    }
  ]
}
```

**Step 2: Reload extension and verify no errors in `chrome://extensions`**

Open Chrome → `chrome://extensions` → Developer mode ON → Load unpacked → select `automute-extension/` → confirm no errors shown.

**Step 3: Commit**

```bash
git add automute-extension/manifest.json
git commit -m "feat: add storage permission, YouTube content script, bump version to 1.1.0"
```

---

## Task 7: Create YouTube DOM detection content script

**Files:**
- Create: `automute-extension/content/youtube.js`

**Step 1: Create `content/youtube.js`**

```js
/**
 * YouTube DOM-based ad detection.
 * Watches #movie_player for the .ad-showing class using MutationObserver.
 * Sends YOUTUBE_AD_START / YOUTUBE_AD_END messages to background.js.
 * No screenshot or API call needed — instant detection.
 */

const PLAYER_SELECTOR = '#movie_player';
const AD_CLASS = 'ad-showing';

let isAdPlaying = false;

function checkAdState(player) {
  const adNow = player.classList.contains(AD_CLASS);

  if (adNow && !isAdPlaying) {
    isAdPlaying = true;
    chrome.runtime.sendMessage({ type: 'YOUTUBE_AD_START' });
  } else if (!adNow && isAdPlaying) {
    isAdPlaying = false;
    chrome.runtime.sendMessage({ type: 'YOUTUBE_AD_END' });
  }
}

function init() {
  const player = document.querySelector(PLAYER_SELECTOR);
  if (!player) {
    // Player not in DOM yet — wait and retry
    setTimeout(init, 1000);
    return;
  }

  // Initial check
  checkAdState(player);

  // Watch for class changes on the player element
  const observer = new MutationObserver(() => checkAdState(player));
  observer.observe(player, { attributes: true, attributeFilter: ['class'] });
}

// YouTube is a SPA — re-init on navigation
document.addEventListener('yt-navigate-finish', init);
init();
```

**Step 2: Manual test**

1. Load the extension in Chrome (reload it in `chrome://extensions`)
2. Open any YouTube video
3. Open DevTools Console on the YouTube tab
4. Check for any script errors from `youtube.js`
5. Open a YouTube video with an ad — verify the tab mutes within 1 second (background.js handles it in Task 8)

**Step 3: Commit**

```bash
git add automute-extension/content/youtube.js
git commit -m "feat: add YouTube DOM ad detection content script"
```

---

## Task 8: Handle YouTube messages in background.js

**Files:**
- Modify: `automute-extension/background.js`

**Step 1: Add YouTube message handlers to `handleMessage()`**

In `background.js`, find the `switch (message.type)` block inside `handleMessage()` and add before `default:`:

```js
case 'YOUTUBE_AD_START':
  this.log('info', 'YouTube ad detected via DOM — muting');
  if (this.currentTabId) {
    await audioController.muteTab(this.currentTabId, { smooth: false });
  } else if (sender?.tab?.id) {
    // YouTube tab might not be the "monitored" tab — mute it directly
    await audioController.muteTab(sender.tab.id, { smooth: false });
  }
  sendResponse({ success: true });
  break;

case 'YOUTUBE_AD_END':
  this.log('info', 'YouTube ad ended via DOM — unmuting');
  const tabIdToUnmute = this.currentTabId || sender?.tab?.id;
  if (tabIdToUnmute) {
    await audioController.unmuteTab(tabIdToUnmute, { smooth: false });
  }
  sendResponse({ success: true });
  break;
```

**Step 2: Skip screenshot loop for YouTube tabs**

In `startMonitoring()`, after the `this.isMonitoring = true` block, add:

```js
// Skip screenshot loop for YouTube — DOM detection handles it
const hostname = this.extractHostname(tab.url);
if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
  this.log('info', 'YouTube tab detected — using DOM detection, skipping screenshot loop');
  return {
    success: true,
    tabId: this.currentTabId,
    tabTitle: tab.title,
    tabUrl: tab.url,
    mode: 'youtube_dom'
  };
}
```

Place this block right before the `// ✅ FIXED: Capture immediately within user gesture` comment.

**Step 3: Manual test**

1. Reload the extension
2. Open YouTube, select the tab in the popup, click Monitor
3. Play a video with ads — tab should mute immediately when ad starts, unmute when ad ends
4. Confirm no screenshot requests appear in the backend logs

**Step 4: Commit**

```bash
git add automute-extension/background.js
git commit -m "feat: handle YouTube DOM messages in background, skip screenshot loop for YouTube"
```

---

## Task 9: Redesign popup — inline Monitor buttons + hide logs

**Files:**
- Modify: `automute-extension/popup/popup.js`
- Modify: `automute-extension/popup/popup.html`
- Modify: `automute-extension/popup/popup.css`

**Step 1: Update `createTabElement()` in `popup.js`**

Replace the existing `createTabElement()` method with:

```js
createTabElement(tab, isFirstInWindow = false) {
  const container = document.createElement('div');

  if (isFirstInWindow && tab.windowId) {
    const sep = document.createElement('div');
    sep.className = 'window-separator';
    sep.textContent = `Window ${tab.windowId}`;
    container.appendChild(sep);
  }

  const tabDiv = document.createElement('div');
  tabDiv.className = 'tab-item';
  tabDiv.dataset.tabId = tab.id;

  const favicon = document.createElement('img');
  favicon.src = tab.favIconUrl || '../icons/icon16.png';
  favicon.style.cssText = 'width:16px;height:16px;margin-right:8px;flex-shrink:0;';

  const title = document.createElement('div');
  title.textContent = tab.title || 'Loading...';
  title.style.cssText = 'flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;';

  const monitorBtn = document.createElement('button');
  monitorBtn.textContent = '▶ Monitor';
  monitorBtn.className = 'monitor-btn';
  monitorBtn.style.cssText = `
    margin-left:8px;padding:4px 10px;border:1px solid #1a73e8;
    border-radius:4px;background:#1a73e8;color:white;
    font-size:11px;font-weight:500;cursor:pointer;flex-shrink:0;
  `;
  monitorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    this.startMonitoringTab(tab);
  });

  tabDiv.style.cssText = 'display:flex;align-items:center;padding:8px 12px;';
  tabDiv.appendChild(favicon);
  tabDiv.appendChild(title);
  tabDiv.appendChild(monitorBtn);
  container.appendChild(tabDiv);
  return container;
}
```

**Step 2: Add `startMonitoringTab()` method to `PopupController`**

Add as a new method after `handleTabSelection()`:

```js
async startMonitoringTab(tab) {
  try {
    if (this.currentStatus?.isMonitoring) {
      await this.sendMessage({ type: 'STOP_MONITORING' });
    }
    await this.sendMessage({ type: 'START_MONITORING', tabId: tab.id });
    await this.updateStatus();
  } catch (error) {
    console.error('Failed to start monitoring:', error);
    alert(`Error: ${error.message}`);
  }
}
```

**Step 3: Hide logs by default — update `createLogsViewer()`**

The logs section already has `display: none` by default. Make the toggle link minimal. Replace the header button `toggleLogs` style in `createLogsViewer()`:

Change the `<button id="toggleLogs"` element to:

```html
<button id="toggleLogs" style="background:none;border:none;color:#1967d2;font-size:11px;cursor:pointer;text-decoration:underline;padding:0;">Show logs</button>
```

Update the toggle listener to also update button text:

```js
this.elements.toggleLogs.addEventListener('click', () => {
  const container = this.elements.logsContainer;
  const isHidden = container.style.display === 'none' || !container.style.display;
  container.style.display = isHidden ? 'block' : 'none';
  this.elements.toggleLogs.textContent = isHidden ? 'Hide logs' : 'Show logs';
});
```

Also update `createLogsViewer()` so `logsContainer` starts hidden:

```js
// In the logsHtml string, add display:none to logsContainer div:
// <div id="logsContainer" style="display:none; max-height:300px; ...">
```

**Step 4: Remove the old `createStartStopButton()` call**

In `initialize()`, remove (or comment out) the line:

```js
this.createStartStopButton();
```

The inline ▶ Monitor buttons replace it.

**Step 5: Add a "Stop" button that appears when monitoring is active**

In `updateUI()`, after updating `statusText`, add:

```js
// Show/hide stop button
let stopBtn = document.getElementById('globalStopBtn');
if (isMonitoring) {
  if (!stopBtn) {
    stopBtn = document.createElement('button');
    stopBtn.id = 'globalStopBtn';
    stopBtn.textContent = '⏹ Stop AutoMuting';
    stopBtn.style.cssText = `
      display:block;width:calc(100% - 32px);margin:0 16px 12px;
      padding:8px;background:#ea4335;color:white;border:none;
      border-radius:4px;font-size:13px;font-weight:500;cursor:pointer;
    `;
    stopBtn.addEventListener('click', () => this.sendMessage({ type: 'STOP_MONITORING' }).then(() => this.updateStatus()));
    document.body.insertBefore(stopBtn, document.body.firstChild);
  }
} else if (stopBtn) {
  stopBtn.remove();
}
```

**Step 6: Reload extension and verify**

1. Open the popup — should see tab list with inline ▶ Monitor buttons
2. Click ▶ Monitor on a tab — monitoring starts, ⏹ Stop button appears at top
3. Logs section should be collapsed; "Show logs" link at bottom expands it
4. Click ⏹ Stop — returns to idle state

**Step 7: Commit**

```bash
git add automute-extension/popup/popup.js automute-extension/popup/popup.html automute-extension/popup/popup.css
git commit -m "feat: redesign popup with inline Monitor buttons, hide logs by default, add stop button"
```

---

## Task 10: Add first-launch onboarding overlay

**Files:**
- Create: `automute-extension/popup/onboarding.js`
- Modify: `automute-extension/popup/popup.html`

**Step 1: Create `popup/onboarding.js`**

```js
const STORAGE_KEY = 'onboarding_complete';

const STEPS = [
  {
    emoji: '👇',
    title: 'Pick a tab to watch',
    body: 'Find the tab playing video and click ▶ Monitor next to it.'
  },
  {
    emoji: '🔇',
    title: 'AutoMute detects ads',
    body: 'AutoMute takes periodic screenshots and uses AI to detect ads. It mutes automatically.'
  },
  {
    emoji: '✅',
    title: "You're all set",
    body: 'Click Stop AutoMuting anytime to turn it off. That\'s it!'
  }
];

async function shouldShow() {
  return new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      resolve(!result[STORAGE_KEY]);
    });
  });
}

async function markComplete() {
  return new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: true }, resolve);
  });
}

function buildOverlay() {
  let currentStep = 0;

  const overlay = document.createElement('div');
  overlay.id = 'onboardingOverlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    background:white;border-radius:12px;padding:24px;width:280px;
    text-align:center;box-shadow:0 4px 24px rgba(0,0,0,0.2);
  `;

  function render() {
    const step = STEPS[currentStep];
    card.innerHTML = `
      <div style="font-size:40px;margin-bottom:12px;">${step.emoji}</div>
      <div style="font-size:11px;color:#9aa0a6;margin-bottom:4px;">
        Step ${currentStep + 1} of ${STEPS.length}
      </div>
      <h2 style="font-size:16px;font-weight:600;margin:0 0 8px;color:#202124;">${step.title}</h2>
      <p style="font-size:13px;color:#5f6368;margin:0 0 20px;line-height:1.5;">${step.body}</p>
      <button id="onboardingNext" style="
        background:#1a73e8;color:white;border:none;border-radius:6px;
        padding:10px 24px;font-size:13px;font-weight:500;cursor:pointer;width:100%;
      ">
        ${currentStep < STEPS.length - 1 ? 'Next →' : 'Got it'}
      </button>
    `;

    card.querySelector('#onboardingNext').addEventListener('click', async () => {
      if (currentStep < STEPS.length - 1) {
        currentStep++;
        render();
      } else {
        await markComplete();
        overlay.remove();
      }
    });
  }

  render();
  overlay.appendChild(card);
  return overlay;
}

export async function initOnboarding() {
  if (await shouldShow()) {
    document.body.appendChild(buildOverlay());
  }
}
```

**Step 2: Add script tag to `popup.html`**

Add before the closing `</body>` tag, after the existing script tags:

```html
<script type="module" src="onboarding.js"></script>
```

**Step 3: Call `initOnboarding()` in `popup.js`**

At the top of `popup.js`, add:

```js
import { initOnboarding } from './onboarding.js';
```

In the `initialize()` method, add as the first line inside the `try` block:

```js
await initOnboarding();
```

**Step 4: Manual test — first launch**

1. In `chrome://extensions` → remove and re-add the extension (clears storage)
2. Open the popup — onboarding overlay should appear
3. Click through all 3 steps
4. Click "Got it" — overlay disappears
5. Close and reopen popup — overlay should NOT appear again

**Step 5: Commit**

```bash
git add automute-extension/popup/onboarding.js automute-extension/popup/popup.html automute-extension/popup/popup.js
git commit -m "feat: add first-launch onboarding overlay (3-step walkthrough)"
```

---

## Task 11: Deploy backend to Google Cloud Run

**Step 1: Rebuild and push the Docker image**

```bash
cd automute-backend

# Replace YOUR_PROJECT_ID with your GCP project ID
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/automute-api
```

**Step 2: Deploy to Cloud Run with new environment variables**

```bash
gcloud run deploy automute-api \
  --image gcr.io/YOUR_PROJECT_ID/automute-api \
  --region us-central1 \
  --set-env-vars "SUPABASE_URL=your_url,SUPABASE_SERVICE_KEY=your_key,RESEND_API_KEY=your_key,REPORT_EMAIL=your@email.com,REPORT_SECRET=your_secret" \
  --platform managed
```

**Step 3: Set up Cloud Scheduler for weekly reports**

```bash
gcloud scheduler jobs create http automute-weekly-report \
  --schedule="0 9 * * 1" \
  --uri="https://automute-api-16091147188.us-central1.run.app/api/report/weekly" \
  --http-method=POST \
  --headers="x-report-secret=your_secret" \
  --time-zone="America/New_York"
```

**Step 4: Verify deployment**

```bash
curl https://automute-api-16091147188.us-central1.run.app/health
```

Expected: `{"status":"healthy",...}`

---

## Task 12: Submit extension update to Chrome Web Store

**Step 1: Zip the extension**

```bash
cd automute-extension
zip -r ../automute-v1.1.0.zip . --exclude "*.DS_Store" --exclude "__MACOSX"
```

**Step 2: Submit via Chrome Web Store Developer Dashboard**

1. Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Select the AutoMute listing → Package → Upload new package
3. Upload `automute-v1.1.0.zip`
4. In the Store listing, note the new features: YouTube support, faster classification, improved UI
5. Submit for review — typically approved in 1-3 business days

---

## Full test run (before each deployment)

```bash
cd automute-backend && npx jest --no-coverage
```

Expected: All tests pass.

For the extension — manual testing checklist:
- [ ] Popup opens without errors
- [ ] Onboarding shows on fresh install, not on subsequent opens
- [ ] Tab list shows with inline ▶ Monitor buttons
- [ ] Clicking Monitor starts monitoring and shows Stop button
- [ ] Logs hidden by default, visible after clicking "Show logs"
- [ ] YouTube tab: DOM detection mutes/unmutes without API calls
- [ ] Non-YouTube tab: screenshot loop runs, classifications shown in status
- [ ] Stop button returns to idle state, tab unmuted
