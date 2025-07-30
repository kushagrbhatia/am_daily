const rateLimit = require('express-rate-limit');
const config = require('../config/config');

// More lenient API rate limiter
const apiLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 200, // Increased from 100
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many requests, please try again later',
    retry_after: Math.ceil(config.rateLimitWindowMs / 1000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// More lenient limiter for classification endpoint
const classificationLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 40, // Increased from 20 to 40 requests per minute
  message: {
    error: 'classification_rate_limit',
    message: 'Too many classification requests, please slow down',
    retry_after: 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  apiLimiter,
  classificationLimiter
};