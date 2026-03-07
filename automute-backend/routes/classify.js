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
