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
      // Extract both image and metadata from request body
      const { image, metadata = {}, timestamp } = req.body;
      const startTime = Date.now();
      
      // Log request with site context (without image data for privacy)
      const hostname = metadata.hostname || 'unknown';
      console.log(`Classification request for ${hostname} received at ${new Date().toISOString()}`);
      
      // Optimize image if needed
      let processedImage = image;
      try {
        processedImage = await imageProcessor.optimizeImage(image);
      } catch (optimizationError) {
        console.warn('Image optimization failed, using original:', optimizationError.message);
      }
      
      // Classify with OpenAI using site metadata
      const result = await openaiService.classifyImage(processedImage, metadata);
      
      // Calculate total processing time
      const totalProcessingTime = (Date.now() - startTime) / 1000;
      
      // Enhanced logging with site context
      console.log(`Classification completed for ${hostname}: ${result.classification} (${result.confidence}% confidence) in ${totalProcessingTime}s`);
      
      // Return enhanced result with site context
      res.json({
        classification: result.classification,
        confidence: result.confidence,
        reasoning: result.reasoning,
        processing_time: totalProcessingTime,
        site_category: result.site_category, // Include site category in response
        tokens_used: result.tokens_used,     // Include token usage for monitoring
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Classification endpoint error:', error.message);
      
      // Enhanced error responses with more specific handling
      const errorResponses = {
        'rate_limit': {
          status: 429,
          error: 'openai_rate_limit',
          message: 'OpenAI rate limit exceeded, please try again later',
          retry_after: 60,
          suggestion: 'Reduce screenshot frequency or upgrade OpenAI plan'
        },
        'quota_exceeded': {
          status: 402,
          error: 'quota_exceeded',
          message: 'OpenAI API quota exceeded',
          retry_after: 300,
          suggestion: 'Check your OpenAI billing and usage limits'
        },
        'openai_server_error': {
          status: 502,
          error: 'openai_server_error',
          message: 'OpenAI service temporarily unavailable',
          retry_after: 30,
          suggestion: 'OpenAI service is experiencing issues'
        },
        'invalid_response_format': {
          status: 502,
          error: 'invalid_ai_response',
          message: 'AI service returned invalid response format',
          retry_after: 5,
          suggestion: 'Temporary AI parsing issue'
        },
        'invalid_classification': {
          status: 502,
          error: 'invalid_classification',
          message: 'AI service returned invalid classification',
          retry_after: 5,
          suggestion: 'Temporary AI classification issue'
        },
        'classification_failed': {
          status: 500,
          error: 'classification_failed',
          message: 'Failed to classify image due to internal error',
          retry_after: 10,
          suggestion: 'Check server logs for details'
        }
      };
      
      const errorResponse = errorResponses[error.message] || {
        status: 500,
        error: 'internal_server_error',
        message: 'Internal server error during classification',
        retry_after: 10,
        suggestion: 'Unexpected error occurred'
      };
      
      // Log error details for debugging
      console.error(`Error details: ${error.stack || error.message}`);
      
      res.status(errorResponse.status).json({
        error: errorResponse.error,
        message: errorResponse.message,
        retry_after: errorResponse.retry_after,
        suggestion: errorResponse.suggestion,
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
      supported_sites: openaiService.getStats(), // Include supported sites info
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Debug endpoint to test prompts (optional - for development)
router.get('/debug/prompt/:hostname', (req, res) => {
  try {
    const { hostname } = req.params;
    const promptInfo = openaiService.getPromptForSite(hostname);
    
    res.json({
      hostname,
      category: promptInfo.category,
      prompt_preview: promptInfo.prompt.substring(0, 200) + '...', // First 200 chars
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get prompt info',
      message: error.message
    });
  }
});

module.exports = router;