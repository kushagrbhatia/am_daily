export const CONFIG = {
  // API Configuration - UPDATED FOR PRODUCTION
  API_BASE_URL: 'https://automute-api-16091147188.us-central1.run.app/api',
  API_TIMEOUT: 30000,
  
  // Screenshot Configuration - BALANCED FOR RATE LIMITS
  SCREENSHOT_INTERVAL: 2500, // 2.5 seconds (was 1.5 - too fast)
  SCREENSHOT_MAX_WIDTH: 1920,
  SCREENSHOT_MAX_HEIGHT: 1080,
  SCREENSHOT_QUALITY: 0.8,
  
  // Classification Configuration
  CONFIDENCE_THRESHOLD_AD: 75,
  CONFIDENCE_THRESHOLD_GAME: 70,
  
  // Memory Management
  MAX_RESOURCES_IN_MEMORY: 3,
  CLEANUP_INTERVAL: 15000,
  EMERGENCY_CLEANUP_THRESHOLD: 100 * 1024 * 1024,
  
  // Audio Configuration
  AUDIO_FADE_DURATION: 250,
  
  // Rate Limiting - NEW
  MAX_API_CALLS_PER_MINUTE: 15, // Reduced from 20
  RATE_LIMIT_BACKOFF_TIME: 5000, // 5 seconds wait on rate limit
  
  // UI Configuration
  POPUP_WIDTH: 400,
  POPUP_HEIGHT: 600,
  
  // Storage Keys
  STORAGE_KEYS: {
    MONITORING_STATE: 'monitoring_state',
    CURRENT_TAB_ID: 'current_tab_id',
    CLASSIFICATION_HISTORY: 'classification_history',
    USER_SETTINGS: 'user_settings'
  },
  
  // Classification Types
  CLASSIFICATION_TYPES: {
    AD: 'ad',
    GAME: 'game',
    OTHER: 'other'
  },
  
  // Error Types
  ERROR_TYPES: {
    SCREENSHOT_FAILED: 'screenshot_failed',
    API_FAILED: 'api_failed',
    PERMISSION_DENIED: 'permission_denied',
    TAB_NOT_FOUND: 'tab_not_found',
    MEMORY_ERROR: 'memory_error',
    RATE_LIMITED: 'rate_limited'
  }
};