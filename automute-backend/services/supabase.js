const { createClient } = require('@supabase/supabase-js');
const config = require('../config/config');

// No module-level singleton — create a fresh client each call so mocks work
// in tests and config changes are always reflected at runtime.
function getClient() {
  if (!config.supabaseUrl || !config.supabaseServiceKey) {
    return null;
  }
  return createClient(config.supabaseUrl, config.supabaseServiceKey);
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
