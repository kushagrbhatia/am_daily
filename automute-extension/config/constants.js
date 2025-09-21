export const CONFIG = {
  // =============================================================================
  // API CONFIGURATION
  // =============================================================================
  API_BASE_URL: 'https://automute-api-16091147188.us-central1.run.app/api',
  API_TIMEOUT: 30000,
  
  // =============================================================================
  // SCREENSHOT CONFIGURATION
  // =============================================================================
  SCREENSHOT_INTERVAL: 2500, // 2.5 seconds (balanced for rate limits)
  SCREENSHOT_MAX_WIDTH: 1920,
  SCREENSHOT_MAX_HEIGHT: 1080,
  SCREENSHOT_QUALITY: 0.8,
  
  // =============================================================================
  // CLASSIFICATION CONFIGURATION
  // =============================================================================
  CONFIDENCE_THRESHOLD_AD: 75,
  CONFIDENCE_THRESHOLD_GAME: 70,
  
  // =============================================================================
  // MEMORY MANAGEMENT
  // =============================================================================
  MAX_RESOURCES_IN_MEMORY: 3,
  CLEANUP_INTERVAL: 15000,
  EMERGENCY_CLEANUP_THRESHOLD: 100 * 1024 * 1024, // 100MB
  
  // =============================================================================
  // AUDIO CONFIGURATION
  // =============================================================================
  AUDIO_FADE_DURATION: 250,
  
  // =============================================================================
  // RATE LIMITING
  // =============================================================================
  MAX_API_CALLS_PER_MINUTE: 15,
  RATE_LIMIT_BACKOFF_TIME: 5000, // 5 seconds wait on rate limit
  
  // =============================================================================
  // UI CONFIGURATION
  // =============================================================================
  POPUP_WIDTH: 400,
  POPUP_HEIGHT: 600,
  
  // =============================================================================
  // SPOTIFY CONFIGURATION
  // =============================================================================
  SPOTIFY: {
    CLIENT_ID: '216406c9336d4619851e1fa8c7b3ca84',
    // Remove the hardcoded redirect URI function and use chrome.identity.getRedirectURL() directly
    SCOPES: [
      'user-read-playback-state',
      'user-modify-playback-state', 
      'user-read-currently-playing',
      'streaming'
    ].join(' '),
    AUTH_URL: 'https://accounts.spotify.com/authorize'
  },
  
  // =============================================================================
  // MUSIC CONTROLLER CONFIGURATION
  // =============================================================================
  MUSIC_CONTROLLER: {
    // Default settings for music playback
    DEFAULT_VOLUME: 70, // 70% volume for background music
    FADE_IN_DURATION: 2000, // 2 seconds fade in
    FADE_OUT_DURATION: 1000, // 1 second fade out
    
    // Music selection preferences
    PREFERRED_GENRES: ['chill', 'ambient', 'instrumental', 'lofi', 'background'],
    
    // Timing controls
    MIN_AD_DURATION_FOR_MUSIC: 5000, // Only start music for ads longer than 5 seconds
    MUSIC_START_DELAY: 1000, // Wait 1 second after ad detection before starting music
    MUSIC_STOP_DELAY: 500, // Wait 0.5 seconds after ad ends before stopping music
    
    // Auto-play settings
    AUTO_PLAY_ENABLED_DEFAULT: true,
    RESPECT_USER_PAUSE: true, // Don't override if user manually paused
    
    // Playlist search keywords
    PLAYLIST_KEYWORDS: [
      'chill', 'background', 'instrumental', 'ambient', 'lofi', 
      'study', 'focus', 'calm', 'relaxing', 'peaceful'
    ]
  },
  
  // =============================================================================
  // SITE CATEGORIES
  // =============================================================================
  SITE_CATEGORIES: {
    YOUTUBE: 'youtube',
    SPORTS_STREAMING: 'sportsStreaming',
    GENERAL: 'general'
  },
  
  // =============================================================================
  // MUSIC INTEGRATION STATES
  // =============================================================================
  MUSIC_STATES: {
    DISABLED: 'disabled',
    ENABLED: 'enabled',
    PLAYING: 'playing',
    PAUSED: 'paused',
    STOPPING: 'stopping',
    ERROR: 'error'
  },
  
  // =============================================================================
  // STORAGE KEYS
  // =============================================================================
  STORAGE_KEYS: {
    MONITORING_STATE: 'monitoring_state',
    CURRENT_TAB_ID: 'current_tab_id',
    CLASSIFICATION_HISTORY: 'classification_history',
    USER_SETTINGS: 'user_settings',
    
    // Spotify and Music Storage Keys
    SPOTIFY_ACCESS_TOKEN: 'spotify_access_token',
    SPOTIFY_REFRESH_TOKEN: 'spotify_refresh_token',
    SPOTIFY_TOKEN_EXPIRY: 'spotify_token_expiry',
    SPOTIFY_USER: 'spotify_user',
    MUSIC_SETTINGS: 'music_settings',
    MUSIC_ENABLED: 'music_enabled',
    DEFAULT_PLAYLIST: 'default_playlist'
  },
  
  // =============================================================================
  // CLASSIFICATION TYPES
  // =============================================================================
  CLASSIFICATION_TYPES: {
    AD: 'ad',
    GAME: 'game',
    OTHER: 'other'
  },
  
  // =============================================================================
  // ERROR TYPES
  // =============================================================================
  ERROR_TYPES: {
    SCREENSHOT_FAILED: 'screenshot_failed',
    API_FAILED: 'api_failed',
    PERMISSION_DENIED: 'permission_denied',
    TAB_NOT_FOUND: 'tab_not_found',
    MEMORY_ERROR: 'memory_error',
    RATE_LIMITED: 'rate_limited',
    
    // Spotify and Music Error Types
    SPOTIFY_AUTH_FAILED: 'spotify_auth_failed',
    SPOTIFY_API_ERROR: 'spotify_api_error',
    SPOTIFY_TOKEN_EXPIRED: 'spotify_token_expired',
    SPOTIFY_RATE_LIMITED: 'spotify_rate_limited',
    MUSIC_PLAYBACK_FAILED: 'music_playback_failed',
    NO_SPOTIFY_DEVICE: 'no_spotify_device',
    MUSIC_PERMISSION_DENIED: 'music_permission_denied'
  },
  
  // =============================================================================
  // SPOTIFY DEVICE TYPES
  // =============================================================================
  SPOTIFY_DEVICE_TYPES: {
    COMPUTER: 'Computer',
    SMARTPHONE: 'Smartphone',
    SPEAKER: 'Speaker',
    TV: 'TV',
    AUTOMOBILE: 'Automobile',
    GAME_CONSOLE: 'GameConsole',
    CAST_VIDEO: 'CastVideo',
    CAST_AUDIO: 'CastAudio',
    TABLET: 'Tablet',
    UNKNOWN: 'Unknown'
  },
  
  // =============================================================================
  // MUSIC ACTION TYPES FOR LOGGING
  // =============================================================================
  MUSIC_ACTIONS: {
    MUSIC_STARTED: 'music_started',
    MUSIC_STOPPED: 'music_stopped',
    MUSIC_PAUSED: 'music_paused',
    MUSIC_RESUMED: 'music_resumed',
    MUSIC_SKIPPED: 'music_skipped',
    VOLUME_CHANGED: 'volume_changed',
    PLAYLIST_CHANGED: 'playlist_changed',
    DEVICE_CHANGED: 'device_changed'
  },
  
  // =============================================================================
  // DEFAULT MUSIC SETTINGS TEMPLATE
  // =============================================================================
  DEFAULT_MUSIC_SETTINGS: {
    autoPlayEnabled: true,
    defaultPlaylist: null,
    musicVolume: 70,
    fadeInDuration: 2000,
    fadeOutDuration: 1000,
    preferredGenres: ['chill', 'ambient', 'instrumental'],
    respectUserPause: true,
    minAdDurationForMusic: 5000,
    useSmartPlaylistSelection: true,
    enableVolumeNormalization: true
  },
  
  // =============================================================================
  // SPOTIFY SEARCH CONFIGURATION
  // =============================================================================
  SPOTIFY_SEARCH: {
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 50,
    SEARCH_TYPES: ['track', 'playlist', 'album', 'artist'],
    PLAYLIST_SEARCH_LIMIT: 10,
    TRACK_SEARCH_LIMIT: 20
  },
  
  // =============================================================================
  // TIMING CONFIGURATION
  // =============================================================================
  TIMING: {
    SPOTIFY_STATE_CHECK_INTERVAL: 5000, // Check Spotify state every 5 seconds
    MUSIC_SYNC_INTERVAL: 2000, // Sync music state every 2 seconds
    TOKEN_REFRESH_CHECK_INTERVAL: 60000, // Check token expiry every minute
    DEVICE_DISCOVERY_TIMEOUT: 10000, // Wait up to 10 seconds for device discovery
    PLAYBACK_STATE_TIMEOUT: 5000, // Timeout for playback state requests
    MUSIC_STOP_GRACE_PERIOD: 1000 // Grace period before force-stopping music
  },
  
  // =============================================================================
  // AUDIO COORDINATION SETTINGS
  // =============================================================================
  AUDIO_COORDINATION: {
    TAB_MUTE_PRIORITY: 1, // Tab muting takes priority
    MUSIC_VOLUME_PRIORITY: 2, // Music volume is secondary
    CROSS_FADE_DURATION: 500, // Cross-fade between tab audio and music
    VOLUME_STEP_SIZE: 5, // Volume change step size (percentage)
    MIN_MUSIC_VOLUME: 10, // Minimum music volume (percentage)
    MAX_MUSIC_VOLUME: 100 // Maximum music volume (percentage)
  }
};