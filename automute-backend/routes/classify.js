const express = require('express');
const router = express.Router();
const { classificationLimiter } = require('../middleware/rateLimiter');
const { validateClassificationRequest } = require('../middleware/validator');
const { validateApiKey } = require('../middleware/auth');
const openaiService = require('../services/openai');
const imageProcessor = require('../services/imageProcessor');

// Classification endpoint
router.post('/classify', 
  classificationLimiter,
  validateApiKey,
  validateClassificationRequest,
  async (req, res) => {
    try {
      const { image, timestamp } = req.body;
      const startTime = Date.now();
      
      // Log request (without image data for privacy)
      console.log(`Classification request received at ${new Date().toISOString()}`);
      
      // Optimize image if needed
      let processedImage = image;
      try {
        processedImage = await imageProcessor.optimizeImage(image);
      } catch (optimizationError) {
        console.warn('Image optimization failed, using original:', optimizationError.message);
      }
      
      // Classify with OpenAI
      const result = await openaiService.classifyImage(processedImage);
      
      // Calculate total processing time
      const totalProcessingTime = (Date.now() - startTime) / 1000;
      
      // Log successful classification
      console.log(`Classification completed: ${result.classification} (${result.confidence}% confidence) in ${totalProcessingTime}s`);
      
      // Return result
      res.json({
        classification: result.classification,
        confidence: result.confidence,
        reasoning: result.reasoning,
        processing_time: totalProcessingTime,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Classification endpoint error:', error.message);
      
      const errorResponses = {
        'rate_limit': {
          status: 429,
          error: 'openai_rate_limit',
          message: 'OpenAI rate limit exceeded, please try again later',
          retry_after: 60
        },
        'openai_server_error': {
          status: 502,
          error: 'openai_server_error',
          message: 'OpenAI service temporarily unavailable',
          retry_after: 30
        },
        'invalid_response_format': {
          status: 502,
          error: 'invalid_ai_response',
          message: 'AI service returned invalid response',
          retry_after: 5
        },
        'invalid_classification': {
          status: 502,
          error: 'invalid_classification',
          message: 'AI service returned invalid classification',
          retry_after: 5
        }
      };
      
      const errorResponse = errorResponses[error.message] || {
        status: 500,
        error: 'classification_failed',
        message: 'Failed to classify image',
        retry_after: 10
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

// Health check endpoint for classification service
router.get('/health', async (req, res) => {
  try {
    const openaiHealth = await openaiService.healthCheck();
    res.json({
      status: 'healthy',
      services: {
        openai: openaiHealth
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;