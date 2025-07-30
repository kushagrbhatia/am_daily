// Simple API key validation (optional for MVP)
const validateApiKey = (req, res, next) => {
    // For MVP, we'll skip API key validation
    // In production, you'd validate API keys here
    next();
  };
  
  module.exports = {
    validateApiKey
  };