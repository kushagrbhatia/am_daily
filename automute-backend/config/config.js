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
