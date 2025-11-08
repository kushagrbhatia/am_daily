import { CONFIG } from './config/constants.js';
import screenshotManager from './utils/screenshot.js';
import apiClient from './utils/api.js';
import audioController from './utils/audio.js';
import memoryManager from './utils/memory.js';
import spotifyAuth from './utils/spotify-auth.js';
import spotifyApi from './utils/spotify-api.js';
import musicController from './utils/music-controller.js';

class AutoMuteDetector {
  constructor() {
    this.isMonitoring = false;
    this.currentTabId = null;
    this.currentTabUrl = null;
    this.screenshotInterval = null;
    this.lastClassification = null;
    this.screenshotCount = 0;
    this.classificationHistory = [];
    this.maxHistorySize = 50;
    
    // Rate limiting state
    this.rateLimitState = {
      consecutiveFailures: 0,
      lastFailureTime: 0,
      currentInterval: CONFIG.SCREENSHOT_INTERVAL,
      backoffMultiplier: 1
    };
    
    // Music integration state variables
    this.musicEnabled = false;
    this.musicStartedByExtension = false;
    this.originalSpotifyState = null;
    this.lastMusicAction = null;
    
    // Bind ALL methods
    this.startMonitoring = this.startMonitoring.bind(this);
    this.stopMonitoring = this.stopMonitoring.bind(this);
    this.captureAndAnalyze = this.captureAndAnalyze.bind(this);
    this.handleClassificationResult = this.handleClassificationResult.bind(this);
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdated = this.handleTabUpdated.bind(this);
    this.adjustRateLimit = this.adjustRateLimit.bind(this);
    this.scheduleNextCapture = this.scheduleNextCapture.bind(this);
    this.loadMusicSettings = this.loadMusicSettings.bind(this);
    this.handleSpotifyLogin = this.handleSpotifyLogin.bind(this);
    this.handleSpotifyLogout = this.handleSpotifyLogout.bind(this);
    this.getSpotifyStatus = this.getSpotifyStatus.bind(this);
    this.getSpotifyPlaylists = this.getSpotifyPlaylists.bind(this);
    this.handleSpotifyControl = this.handleSpotifyControl.bind(this);
    this.updateMusicSettings = this.updateMusicSettings.bind(this);
    this.toggleMusicEnabled = this.toggleMusicEnabled.bind(this);
    
    // Initialize event listeners
    this.initializeEventListeners();
    
    console.log('AutoMute detector service worker initialized with Spotify support');
  }
  
  /**
   * Initialize Chrome extension event listeners
   */
  initializeEventListeners() {
    // Listen for tab removal
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    
    // Listen for tab updates
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
    
    // Listen for extension startup
    chrome.runtime.onStartup.addListener(() => {
      console.log('Extension started');
    });
    
    // Listen for extension install
    chrome.runtime.onInstalled.addListener((details) => {
      console.log('Extension installed/updated:', details.reason);
      if (details.reason === 'install') {
        this.handleFirstInstall();
      }
    });
    
    // Clean up on extension suspend
    chrome.runtime.onSuspend.addListener(() => {
      console.log('Extension suspending, cleaning up');
      this.cleanup();
    });
  }
  
  /**
   * Handle messages from popup and content scripts
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      console.log('Received message:', message.type);
      
      switch (message.type) {
        case 'START_MONITORING':
          const startResult = await this.startMonitoring(message.tabId);
          sendResponse({ success: true, data: startResult });
          break;
          
        case 'STOP_MONITORING':
          const stopResult = await this.stopMonitoring();
          sendResponse({ success: true, data: stopResult });
          break;
          
        case 'GET_STATUS':
          const status = await this.getStatus();
          sendResponse({ success: true, data: status });
          break;
          
        case 'GET_TABS':
          const tabs = await this.getAllTabs();
          sendResponse({ success: true, data: tabs });
          break;
          
        case 'TOGGLE_AUDIO':
          const audioResult = await this.toggleAudio(message.tabId);
          sendResponse({ success: true, data: audioResult });
          break;
          
        case 'GET_HISTORY':
          sendResponse({ success: true, data: this.classificationHistory });
          break;

          
        // ADD ALL OF THESE NEW CASES:
        case 'SPOTIFY_LOGIN':
          const loginResult = await this.handleSpotifyLogin();
          sendResponse({ success: true, data: loginResult });
          break;
          
        case 'SPOTIFY_LOGOUT':
          const logoutResult = await this.handleSpotifyLogout();
          sendResponse({ success: true, data: logoutResult });
          break;
          
        case 'SPOTIFY_GET_STATUS':
          const spotifyStatus = await this.getSpotifyStatus();
          sendResponse({ success: true, data: spotifyStatus });
          break;
          
        case 'SPOTIFY_GET_PLAYLISTS':
          const playlists = await this.getSpotifyPlaylists();
          sendResponse({ success: true, data: playlists });
          break;
          
        case 'SPOTIFY_CONTROL':
          const controlResult = await this.handleSpotifyControl(message.action, message.params);
          sendResponse({ success: true, data: controlResult });
          break;
          
        case 'UPDATE_MUSIC_SETTINGS':
          const settingsResult = await this.updateMusicSettings(message.settings);
          sendResponse({ success: true, data: settingsResult });
          break;
          
        case 'TOGGLE_MUSIC_ENABLED':
          const toggleResult = await this.toggleMusicEnabled(message.enabled);
          sendResponse({ success: true, data: toggleResult });
          break;
        

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  /**
   * Start monitoring with adaptive rate limiting
   */
  async startMonitoring(tabId) {
  try {
    if (this.isMonitoring) {
      await this.stopMonitoring();
    }
    
    console.log(`Starting monitoring for tab ${tabId}`);
    
    // Validate tab
    const tab = await this.getEnhancedTabInfo(tabId);
    if (!tab) {
      throw new Error('Tab not found or not accessible');
    }
    
    if (!this.isTabMonitorable(tab)) {
      throw new Error('Tab cannot be monitored (internal page)');
    }
    
    // Set monitoring state
    this.isMonitoring = true;
    this.currentTabId = tabId;
    this.currentTabUrl = tab.url;
    this.screenshotCount = 0;
    this.lastClassification = null;
    
    // Reset rate limiting
    this.rateLimitState.consecutiveFailures = 0;
    this.rateLimitState.backoffMultiplier = 1;
    this.rateLimitState.currentInterval = CONFIG.SCREENSHOT_INTERVAL;
    // ===== STEP 2: LOAD MUSIC SETTINGS AND ENABLE =====
    await this.loadMusicSettings();
    
    // Check if Spotify is authenticated
    const spotifyStatus = spotifyAuth.getAuthStatus();
    if (spotifyStatus.isAuthenticated) {
      console.log('✅ Spotify is authenticated and ready');
      musicController.setEnabled(this.musicEnabled);
    } else {
      console.warn('⚠️ Spotify not authenticated - music features disabled');
      this.musicEnabled = false;
    }
    // ================================================
    
    // Start capture loop
    this.scheduleNextCapture();
    
    console.log(`✅ Monitoring started for tab ${tabId}: ${tab.title}`);
    console.log(`   Music enabled: ${this.musicEnabled}`);
    console.log(`   Spotify auth: ${spotifyStatus.isAuthenticated}`);
    
    return {
      success: true,
      tabId: this.currentTabId,
      tabTitle: tab.title,
      tabUrl: tab.url,
      interval: this.rateLimitState.currentInterval,
      musicEnabled: this.musicEnabled,
      spotifyAuthenticated: spotifyStatus.isAuthenticated
    };
    
  } catch (error) {
    this.isMonitoring = false;
    this.currentTabId = null;
    this.currentTabUrl = null;
    console.error('Failed to start monitoring:', error);
    throw error;
  }
}
  

  async stopMonitoring() {
  try {
    console.log('Stopping monitoring...');
    
    // Clear interval
    if (this.screenshotInterval) {
      clearTimeout(this.screenshotInterval);
      this.screenshotInterval = null;
    }
    
    // Restore audio if we were managing it
    if (this.currentTabId) {
      try {
        await audioController.unmuteTab(this.currentTabId);
      } catch (error) {
        console.warn('Failed to restore audio on stop:', error);
      }
    }
    
    // ===== STEP 3: EMERGENCY STOP MUSIC IF PLAYING =====
    if (this.musicStartedByExtension) {
      try {
        console.log('🎵 Stopping music due to monitoring stop...');
        await musicController.emergencyStop();
        this.musicStartedByExtension = false;
        console.log('✅ Music stopped successfully');
      } catch (error) {
        console.warn('⚠️ Failed to stop music during monitoring stop:', error);
      }
    }
    // ================================================
    
    // Reset state
    const stoppedTabId = this.currentTabId;
    this.isMonitoring = false;
    this.currentTabId = null;
    this.currentTabUrl = null;
    this.lastClassification = null;
    this.lastMusicAction = null;
    this.musicStartedByExtension = false;
    this.originalSpotifyState = null;
    
    // Clean up memory
    await memoryManager.cleanup();
    
    console.log(`✅ Monitoring stopped for tab ${stoppedTabId}`);
    
    return {
      success: true,
      stoppedTabId
    };
    
  } catch (error) {
    console.error('Error stopping monitoring:', error);
    throw error;
  }
  
}
  /**
 * Load music settings from storage
 */
  async loadMusicSettings() {
    try {
      const result = await chrome.storage.local.get(['music_enabled']);
      this.musicEnabled = result.music_enabled ?? false;
      console.log(`Music integration ${this.musicEnabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      console.error('Failed to load music settings:', error);
      this.musicEnabled = false;
    }
  }
    
  
  /**
   * Schedule next screenshot capture with adaptive timing
   */
  scheduleNextCapture() {
    if (!this.isMonitoring) return;
    
    // Calculate current interval with backoff
    this.rateLimitState.currentInterval = CONFIG.SCREENSHOT_INTERVAL * this.rateLimitState.backoffMultiplier;
    
    this.screenshotInterval = setTimeout(() => {
      if (this.isMonitoring) {
        this.captureAndAnalyze();
      }
    }, this.rateLimitState.currentInterval);
  }
  
  /**
   * ENHANCED captureAndAnalyze with step-by-step logging
   */
  async captureAndAnalyze() {
    try {
      if (!this.isMonitoring || !this.currentTabId) {
        return;
      }
      
      this.screenshotCount++;
      console.log('');
      console.log('='.repeat(80));
      console.log(`🚀 STARTING CAPTURE #${this.screenshotCount} FOR TAB ${this.currentTabId}`);
      console.log('='.repeat(80));
      
      // Get tab information
      console.log('📋 STEP 1: Getting tab information...');
      const tab = await this.getEnhancedTabInfo(this.currentTabId);
      
      const siteMetadata = {
        hostname: this.extractHostname(tab.url),
        referer: tab.url,
        title: tab.title,
        timestamp: Date.now()
      };
      
      console.log('📋 Tab info:', {
        id: tab.id,
        title: tab.title,
        url: tab.url,
        audible: tab.audible,
        muted: tab.mutedInfo?.muted
      });
      
      console.log('🎯 Site metadata:', siteMetadata);
      console.log(`🎯 Site category: ${this.getSiteCategory(siteMetadata.hostname)}`);
      
      // Capture screenshot
      console.log('📸 STEP 2: Capturing screenshot...');
      const screenshotStart = Date.now();
      const base64Image = await screenshotManager.captureTab(this.currentTabId);
      const screenshotTime = Date.now() - screenshotStart;
      
      if (!base64Image) {
        throw new Error('Screenshot capture returned empty data');
      }
      
      console.log(`📸 Screenshot captured in ${screenshotTime}ms`);
      console.log(`📸 Image size: ${Math.round(base64Image.length / 1024)}KB`);
      
      // Classify with AI
      console.log('🤖 STEP 3: Sending for AI classification...');
      const classificationStart = Date.now();
      const classification = await apiClient.classifyImage(base64Image, siteMetadata);
      const classificationTime = Date.now() - classificationStart;
      
      console.log(`🤖 Classification completed in ${classificationTime}ms`);
      console.log('🤖 Raw classification result:', classification);
      
      // Handle classification result
      console.log('🎵 STEP 4: Processing classification and audio decision...');
      await this.handleClassificationResult(classification);
      
      // Reset rate limiting on success
      console.log('📈 STEP 5: Updating rate limiting (success)...');
      this.adjustRateLimit(false);
      
      // Schedule next capture
      console.log('⏰ STEP 6: Scheduling next capture...');
      this.scheduleNextCapture();
      
      const totalTime = Date.now() - screenshotStart;
      console.log(`✅ CAPTURE #${this.screenshotCount} COMPLETED in ${totalTime}ms`);
      console.log('='.repeat(80));
      console.log('');
      
    } catch (error) {
      console.error('❌ CAPTURE AND ANALYZE FAILED:', error);
      
      // Handle rate limiting
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        console.warn('⚠️ API rate limit hit, backing off...');
        this.adjustRateLimit(true);
        
        // Return fallback classification for rate limits with site context
        const hostname = this.extractHostname(this.currentTabUrl);
        const isYoutube = hostname && hostname.includes('youtube.com');
        
        console.log('🔄 Using fallback classification due to rate limit...');
        await this.handleClassificationResult({
          classification: 'other',  // Safe default (unmute)
          confidence: 0,
          reasoning: 'Skipped due to API rate limit',
          processing_time: 0,
          site_category: isYoutube ? 'youtube' : 'general'
        });
      } else {
        this.adjustRateLimit(true);
      }
      
      // Continue monitoring even on errors
      this.scheduleNextCapture();
    }
  }
  
  /**
   * ENHANCED handleClassificationResult with detailed logging
   */
  /**
 * ENHANCED handleClassificationResult with detailed logging AND music integration
 */
async handleClassificationResult(classification) {
  try {
    console.log('🔍 DETAILED CLASSIFICATION ANALYSIS:');
    console.log('Raw classification:', classification);
    
    // Get site context
    const hostname = this.extractHostname(this.currentTabUrl);
    const siteCategory = this.getSiteCategory(hostname);
    
    console.log(`🌐 Site context: ${hostname} (category: ${siteCategory})`);
    
    // Store classification with enhanced metadata
    this.lastClassification = {
      ...classification,
      timestamp: new Date().toISOString(),
      screenshotNumber: this.screenshotCount,
      hostname: hostname,
      siteCategory: siteCategory,
      tabUrl: this.currentTabUrl
    };
    
    // Add to history
    this.classificationHistory.unshift(this.lastClassification);
    if (this.classificationHistory.length > this.maxHistorySize) {
      this.classificationHistory = this.classificationHistory.slice(0, this.maxHistorySize);
    }
    
    // Determine audio action
    const shouldMute = await this.shouldMuteForClassificationWithLogging(classification);
    
    console.log(`🎵 AUDIO DECISION: ${shouldMute.mute ? 'MUTE' : 'UNMUTE'}`);
    console.log(`🎵 REASONING: ${shouldMute.reason}`);
    
    // ===== HANDLE AD DETECTED (MUTE + MUSIC) =====
    if (shouldMute.mute) {
      console.log('🔇 EXECUTING MUTE...');
      await audioController.muteTab(this.currentTabId, { smooth: true });
      console.log('🔇 MUTE COMPLETED');
      
      // ADD THIS ENTIRE SECTION - START MUSIC WHEN AD IS DETECTED
      console.log('🎵 CHECKING IF SHOULD START MUSIC...');
      console.log('   musicEnabled:', this.musicEnabled);
      console.log('   classification type:', classification.classification);
      console.log('   CONFIG.CLASSIFICATION_TYPES.AD:', CONFIG.CLASSIFICATION_TYPES.AD);
      console.log('   is AD match?:', classification.classification === CONFIG.CLASSIFICATION_TYPES.AD);
      
      if (this.musicEnabled && classification.classification === CONFIG.CLASSIFICATION_TYPES.AD) {
        // Check if Spotify is authenticated
        const isAuthenticated = spotifyAuth.isAuthenticated();
        console.log('   Spotify authenticated?:', isAuthenticated);
        
        if (!isAuthenticated) {
          console.warn('⚠️ Spotify not authenticated, cannot start music');
        } else {
          try {
            console.log('🎵 AD DETECTED - STARTING BACKGROUND MUSIC...');
            const musicResult = await musicController.handleAdDetected(classification);
            console.log('🎵 Music controller returned:', musicResult);
            
            if (musicResult && musicResult.success) {
              this.musicStartedByExtension = true;
              this.lastMusicAction = musicResult;
              console.log('✅ Music started successfully:', musicResult);
            } else {
              console.error('❌ Failed to start music:', musicResult?.error || 'Unknown error');
            }
          } catch (error) {
            console.error('❌ Exception while starting music:', error);
            console.error('❌ Error stack:', error.stack);
            this.lastMusicAction = { 
              success: false, 
              error: error.message,
              action: 'music_start_failed'
            };
          }
        }
      } else {
        console.log('⏭️ Skipping music start:');
        console.log('   musicEnabled:', this.musicEnabled);
        console.log('   is ad?:', classification.classification === CONFIG.CLASSIFICATION_TYPES.AD);
      }
      
    // ===== HANDLE AD ENDED (UNMUTE + STOP MUSIC) =====
    } else {
      console.log('🔊 EXECUTING UNMUTE...');
      await audioController.unmuteTab(this.currentTabId, { smooth: true });
      console.log('🔊 UNMUTE COMPLETED');
      
      // STOP MUSIC WHEN RETURNING TO NON-AD CONTENT
      console.log('🎵 CHECKING IF SHOULD STOP MUSIC...');
      console.log('   musicEnabled:', this.musicEnabled);
      console.log('   musicStartedByExtension:', this.musicStartedByExtension);
      
      if (this.musicEnabled && this.musicStartedByExtension) {
        try {
          console.log('🎵 AD ENDED - STOPPING BACKGROUND MUSIC...');
          const musicResult = await musicController.handleAdEnded(classification);
          console.log('🎵 Music controller returned:', musicResult);
          
          if (musicResult && musicResult.success) {
            this.musicStartedByExtension = false;
            this.lastMusicAction = musicResult;
            console.log('✅ Music stopped successfully:', musicResult);
          } else {
            console.error('❌ Failed to stop music:', musicResult?.error || 'Unknown error');
          }
        } catch (error) {
          console.error('❌ Exception while stopping music:', error);
          console.error('❌ Error stack:', error.stack);
          this.lastMusicAction = { 
            success: false, 
            error: error.message,
            action: 'music_stop_failed'
          };
        }
      } else {
        console.log('⏭️ Skipping music stop - music not started by extension');
      }
    }
    
    // Verify audio state after action
    const finalAudioState = await audioController.getTabAudioState(this.currentTabId);
    console.log('🎵 FINAL AUDIO STATE:', finalAudioState);
    
  } catch (error) {
    console.error('❌ Error handling classification result:', error);
    console.error('❌ Error stack:', error.stack);
  }
}

  /**
   * ENHANCED shouldMuteForClassification with detailed logging
   */
  async shouldMuteForClassificationWithLogging(classification) {
    const { classification: type, confidence, site_category } = classification;
    
    console.log('🤔 AUDIO DECISION ANALYSIS:');
    console.log(`   Classification: ${type}`);
    console.log(`   Confidence: ${confidence}%`);
    console.log(`   Site Category: ${site_category}`);
    
    // Get site category
    const siteCategory = site_category || this.getSiteCategory(this.extractHostname(this.currentTabUrl));
    console.log(`   Determined Category: ${siteCategory}`);
    
    // YOUTUBE: Binary classification
    if (siteCategory === 'youtube') {
      console.log('📺 YOUTUBE LOGIC:');
      console.log(`   Ad threshold: ${CONFIG.CONFIDENCE_THRESHOLD_AD}%`);
      
      if (type === 'ad') {
        console.log(`   ✓ Ad detected with ${confidence}% confidence`);
        
        if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
          console.log(`   ✓ Confidence above threshold (${CONFIG.CONFIDENCE_THRESHOLD_AD}%) - WILL MUTE`);
          return {
            mute: true,
            reason: `YouTube ad detected with ${confidence}% confidence (threshold: ${CONFIG.CONFIDENCE_THRESHOLD_AD}%)`
          };
        } else {
          console.log(`   ✗ Confidence below threshold (${CONFIG.CONFIDENCE_THRESHOLD_AD}%) - WILL NOT MUTE`);
          return {
            mute: false,
            reason: `YouTube ad confidence too low: ${confidence}% < ${CONFIG.CONFIDENCE_THRESHOLD_AD}%`
          };
        }
      } else {
        console.log(`   ✓ Non-ad content (${type}) - WILL UNMUTE`);
        return {
          mute: false,
          reason: `YouTube content (${type}) detected with ${confidence}% confidence - unmuting all non-ad content`
        };
      }
    }
    
    // SPORTS STREAMING SITES: 3-way classification
    if (siteCategory === 'sportsStreaming') {
      console.log('🏈 SPORTS STREAMING LOGIC:');
      
      switch (type) {
        case 'ad':
          console.log(`   Ad detected with ${confidence}% confidence (threshold: ${CONFIG.CONFIDENCE_THRESHOLD_AD}%)`);
          if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
            console.log('   ✓ Will mute streaming ad');
            return {
              mute: true,
              reason: `Streaming ad detected with ${confidence}% confidence`
            };
          } else {
            console.log('   ✗ Confidence too low for ad muting');
            return {
              mute: false,
              reason: `Streaming ad confidence too low: ${confidence}% < ${CONFIG.CONFIDENCE_THRESHOLD_AD}%`
            };
          }
          
        case 'game':
          console.log(`   Sports content detected with ${confidence}% confidence (threshold: ${CONFIG.CONFIDENCE_THRESHOLD_GAME}%)`);
          if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_GAME) {
            console.log('   ✓ Will unmute sports content');
            return {
              mute: false,
              reason: `Sports content detected with ${confidence}% confidence`
            };
          }
          break;
          
        case 'other':
          console.log('   Other content on sports site - maintaining state');
          const currentAudioState = await audioController.getTabAudioState(this.currentTabId);
          return {
            mute: currentAudioState.managedByExtension ? currentAudioState.muted : false,
            reason: `Non-sports content on streaming site, maintaining current state`
          };
      }
    }
    
    // GENERAL SITES: Enhanced video ad detection
    console.log('🌐 GENERAL SITE LOGIC:');
    
    if (type === 'ad' && confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
      console.log('   Potential ad detected - checking if video ad...');
      
      // Get enhanced tab info
      const tabInfo = await this.getEnhancedTabInfo(this.currentTabId);
      const { audioInfo } = tabInfo;
      
      console.log('   Tab audio info:', audioInfo);
      
      // Check if this is a video ad
      const isVideoAd = (
        audioInfo.hasAudio || 
        audioInfo.isVideoSite || 
        this.hasVideoIndicators(classification.reasoning)
      );
      
      console.log(`   Is video ad: ${isVideoAd}`);
      console.log(`   Has audio: ${audioInfo.hasAudio}`);
      console.log(`   Is video site: ${audioInfo.isVideoSite}`);
      console.log(`   Has video indicators: ${this.hasVideoIndicators(classification.reasoning)}`);
      
      if (isVideoAd) {
        console.log('   ✓ Video ad confirmed - WILL MUTE');
        return {
          mute: true,
          reason: `Video ad detected with ${confidence}% confidence`
        };
      } else {
        console.log('   ✗ Static ad detected - WILL NOT MUTE');
        return {
          mute: false,
          reason: `Static webpage ad detected (${confidence}% confidence) - not muting`
        };
      }
    }
    
    // Default: don't mute
    console.log(`   ✗ No mute action: ${type} with ${confidence}% confidence`);
    return {
      mute: false,
      reason: `No mute condition met: ${type} (${confidence}%)`
    };
  }
  
  /**
   * ADD: Extract hostname from URL
   */
  extractHostname(url) {
    if (!url) return '';
    
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch (error) {
      console.warn('Failed to extract hostname from URL:', url);
      return '';
    }
  }
  
  /**
   * ADD: Get site category for classification logic
   */
  getSiteCategory(hostname) {
    if (!hostname) return 'general';
    
    // YouTube sites
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    
    // Sports streaming sites
    const sportsStreamingSites = [
      'espn.com', 'espn.go.com', 'watchespn.com',
      'fox.com', 'foxsports.com', 'fs1.com', 'fs2.com',
      'cbs.com', 'cbssports.com', 'cbssportsnetwork.com',
      'peacocktv.com', 'peacock.com',
      'hulu.com', 'hulu.tv',
      'amazon.com', 'primevideo.com',
      'nfl.com', 'nflnetwork.com', 'nflredzone.com',
      'nba.com', 'nba.tv',
      'mlb.com', 'mlb.tv',
      'nhl.com', 'nhl.tv',
      'paramount.com', 'paramountplus.com',
      'fubo.tv', 'fubotv.com',
      'sling.com', 'slingtv.com',
      'directv.com', 'stream.directv.com',
      'youtube.tv', 'tv.youtube.com',
      'streameast', 'buffstreams', 'crackstreams', 'sportsurge',
      'nflbite.com', 'nbastreams', 'mlbstreams', 'nhlstreams',
      'footybite.com', 'soccer-streams.net', 'methstreams',
      'givemenflstreams.com', 'topstreams', 'vipleague',
      'firstrowsports', 'livetvsx', 'strikeout', 'bosscast'
    ];
    
    if (sportsStreamingSites.some(site => hostname.includes(site))) {
      return 'sportsStreaming';
    }
    
    return 'general';
  }
  
  /**
   * Check if reasoning indicates video content
   */
  hasVideoIndicators(reasoning) {
    if (!reasoning) return false;
    
    const videoIndicators = [
      'video', 'playing', 'player', 'stream', 'youtube', 'skip ad', 
      'countdown', 'pre-roll', 'mid-roll', 'commercial', 'auto-play',
      'video controls', 'play button', 'pause button', 'progress bar',
      'video player', 'media player', 'streaming'
    ];
    
    const lowerReasoning = reasoning.toLowerCase();
    return videoIndicators.some(indicator => lowerReasoning.includes(indicator));
  }
  
  /**
   * Get enhanced tab information with audio/video detection
   */
  async getEnhancedTabInfo(tabId) {
    try {
      const tab = await new Promise((resolve, reject) => {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(tab);
          }
        });
      });
      
      // Enhanced audio detection
      const audioInfo = {
        hasAudio: tab.audible || false,
        isMuted: tab.mutedInfo?.muted || false,
        isVideoSite: this.isVideoStreamingSite(tab.url),
        isLikelyVideo: tab.audible || this.isVideoStreamingSite(tab.url)
      };
      
      return {
        ...tab,
        audioInfo
      };
    } catch (error) {
      console.error('Failed to get enhanced tab info:', error);
      throw error;
    }
  }
  
  /**
   * Check if URL is a known video streaming site
   */
  isVideoStreamingSite(url) {
    if (!url) return false;
    
    const videoSites = [
      'youtube.com',
      'youtu.be', 
      'twitch.tv',
      'netflix.com',
      'hulu.com',
      'amazon.com/prime',
      'disneyplus.com',
      'hbo.com',
      'espn.com',
      'nfl.com',
      'nba.com',
      'mlb.com',
      'nhl.com',
      'fox.com',
      'cbs.com',
      'nbc.com',
      'abc.com',
      'paramount.com',
      'peacocktv.com',
      'sling.com',
      'fubo.tv'
    ];
    
    return videoSites.some(site => url.includes(site));
  }
  
  /**
   * Adjust rate limiting based on success/failure
   */
  adjustRateLimit(isFailure) {
    if (isFailure) {
      this.rateLimitState.consecutiveFailures++;
      this.rateLimitState.lastFailureTime = Date.now();
      
      // Exponential backoff: 1x -> 2x -> 4x -> 8x (max)
      this.rateLimitState.backoffMultiplier = Math.min(
        Math.pow(2, this.rateLimitState.consecutiveFailures), 
        8
      );
      
      console.log(`📈 Rate limit backoff increased to ${this.rateLimitState.backoffMultiplier}x (${this.rateLimitState.consecutiveFailures} failures)`);
      
    } else {
      // Success - gradually reduce backoff
      if (this.rateLimitState.consecutiveFailures > 0) {
        this.rateLimitState.consecutiveFailures = Math.max(0, this.rateLimitState.consecutiveFailures - 1);
        this.rateLimitState.backoffMultiplier = Math.max(
          1, 
          Math.pow(2, this.rateLimitState.consecutiveFailures)
        );
        
        if (this.rateLimitState.backoffMultiplier === 1) {
          console.log(`📉 Rate limit backoff reset to normal`);
        } else {
          console.log(`📉 Rate limit backoff reduced to ${this.rateLimitState.backoffMultiplier}x`);
        }
      }
    }
  }
  
  /**
   * Handle tab removed event
   */
  async handleTabRemoved(tabId) {
    if (tabId === this.currentTabId) {
      console.log(`Monitored tab ${tabId} was closed, stopping monitoring`);
      await this.stopMonitoring();
    }
    
    // Clean up audio controller state
    audioController.handleTabRemoved(tabId);
  }
  
  /**
   * Handle tab updated event
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    if (tabId === this.currentTabId && changeInfo.url) {
      console.log(`Monitored tab navigated to: ${changeInfo.url}`);
      
      // UPDATE: Update stored URL for site detection
      this.currentTabUrl = changeInfo.url;
      
      // Check if new URL is monitorable
      if (this.isTabMonitorable(tab)) {
        console.log('New URL is monitorable, continuing monitoring');
      } else {
        console.log('New URL is not monitorable, stopping monitoring');
        await this.stopMonitoring();
      }
    }
  }
  
  /**
   * Check if tab can be monitored
   */
  isTabMonitorable(tab) {
    const url = tab.url || '';
    
    // Cannot monitor browser internal pages
    if (url.startsWith('chrome://') || 
        url.startsWith('chrome-extension://') || 
        url.startsWith('moz-extension://') ||
        url === 'about:blank') {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get all monitorable tabs from all windows
   */
  async getAllTabs() {
    return new Promise((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        console.log(`Found ${tabs.length} total tabs across all windows`);
        
        const monitorableTabs = tabs
          .filter(tab => this.isTabMonitorable(tab))
          .map(tab => ({
            id: tab.id,
            title: tab.title || 'Loading...',
            url: tab.url,
            favIconUrl: tab.favIconUrl,
            active: tab.active,
            audible: tab.audible || false,
            status: tab.status,
            windowId: tab.windowId,
            index: tab.index,
            siteCategory: this.getSiteCategory(this.extractHostname(tab.url))  // ADD: Include site category
          }))
          .sort((a, b) => {
            if (a.windowId !== b.windowId) {
              return a.windowId - b.windowId;
            }
            return a.index - b.index;
          });
        
        console.log(`Returning ${monitorableTabs.length} monitorable tabs`);
        resolve(monitorableTabs);
      });
    });
  }
  
  /**
   * Get current status
   */
/**
 * Get current status including music state
  */
  async getStatus() {
    const audioState = this.currentTabId ? 
      await audioController.getTabAudioState(this.currentTabId) : null;
    
    const musicState = musicController.getState();
    const spotifyAuthStatus = spotifyAuth.getAuthStatus();
    
    return {
      isMonitoring: this.isMonitoring,
      currentTabId: this.currentTabId,
      currentTabUrl: this.currentTabUrl,
      currentSiteCategory: this.getSiteCategory(this.extractHostname(this.currentTabUrl)),
      screenshotCount: this.screenshotCount,
      lastClassification: this.lastClassification,
      rateLimitState: this.rateLimitState,
      audioState,
      memoryStats: memoryManager.getMemoryStats(),
      // NEW: Music and Spotify status
      musicEnabled: this.musicEnabled,
      musicState: musicState,
      spotifyAuth: spotifyAuthStatus,
      lastMusicAction: this.lastMusicAction
    };
  }
  
  /**
   * Toggle audio for a tab
   */
  async toggleAudio(tabId) {
    try {
      const wasMuted = await audioController.toggleTabAudio(tabId);
      return {
        tabId,
        muted: wasMuted,
        action: wasMuted ? 'muted' : 'unmuted'
      };
    } catch (error) {
      console.error('Failed to toggle audio:', error);
      throw error;
    }
  }
  
  /**
   * Handle first install
   */
  async handleFirstInstall() {
    console.log('AutoMute extension installed for the first time');
    // Could show welcome page or setup instructions
  }
  
  /**
   * Clean up all resources
   */
  async cleanup() {
    console.log('Cleaning up AutoMute detector...');
    
    try {
      await this.stopMonitoring();
      await audioController.cleanup();
      await memoryManager.cleanup();
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }
  async handleSpotifyLogin() {
    try {
      const result = await spotifyAuth.login();
      console.log('Spotify login successful:', result);
      return result;
    } catch (error) {
      console.error('Spotify login failed:', error);
      throw error;
    }
  }
  
  /**
   * Spotify logout handler
   */
  async handleSpotifyLogout() {
    try {
      // Stop any ongoing music first
      if (musicController.getState().state.isPlayingMusic) {
        await musicController.emergencyStop();
      }
      
      const result = await spotifyAuth.logout();
      console.log('Spotify logout successful');
      return result;
    } catch (error) {
      console.error('Spotify logout failed:', error);
      throw error;
    }
  }
  
  /**
   * Get Spotify status
   */
  async getSpotifyStatus() {
    try {
      const authStatus = spotifyAuth.getAuthStatus();
      const musicState = musicController.getState();
      const currentPlayback = await musicController.getCurrentPlayback();
      
      return {
        auth: authStatus,
        music: musicState,
        currentPlayback: currentPlayback
      };
    } catch (error) {
      console.error('Failed to get Spotify status:', error);
      return {
        auth: { isAuthenticated: false },
        music: musicController.getState(),
        currentPlayback: null
      };
    }
  }
  
  /**
   * Get user's Spotify playlists
   */
  async getSpotifyPlaylists() {
    try {
      if (!spotifyAuth.isAuthenticated()) {
        throw new Error('Not authenticated with Spotify');
      }
      
      const playlists = await spotifyApi.getUserPlaylists(50);
      return playlists;
    } catch (error) {
      console.error('Failed to get playlists:', error);
      throw error;
    }
  }
  
  /**
   * Handle Spotify playback control
   */
  async handleSpotifyControl(action, params = {}) {
    try {
      if (!spotifyAuth.isAuthenticated()) {
        throw new Error('Not authenticated with Spotify');
      }
      
      let result;
      
      switch (action) {
        case 'play_pause':
          result = await musicController.playPause();
          break;
          
        case 'skip_next':
          result = await musicController.skipNext();
          break;
          
        case 'skip_previous':
          result = await musicController.skipPrevious();
          break;
          
        case 'set_volume':
          result = await musicController.setVolume(params.volume);
          break;
          
        default:
          throw new Error(`Unknown Spotify control action: ${action}`);
      }
      
      return result;
    } catch (error) {
      console.error(`Spotify control action '${action}' failed:`, error);
      throw error;
    }
  }
  
  /**
   * Update music settings
   */
  async updateMusicSettings(settings) {
    try {
      const result = await musicController.updateSettings(settings);
      console.log('Music settings updated:', settings);
      return result;
    } catch (error) {
      console.error('Failed to update music settings:', error);
      throw error;
    }
  }
  
  /**
   * Toggle music enabled/disabled
   */
  async toggleMusicEnabled(enabled) {
    try {
      this.musicEnabled = enabled;
      musicController.setEnabled(enabled);
      
      // Save to storage
      await chrome.storage.local.set({ music_enabled: enabled });
      
      console.log(`Music integration ${enabled ? 'enabled' : 'disabled'}`);
      
      return { enabled: this.musicEnabled };
    } catch (error) {
      console.error('Failed to toggle music enabled:', error);
      throw error;
    }
  }
}

// Create and initialize the detector
const autoMuteDetector = new AutoMuteDetector();

// Export for testing
export default autoMuteDetector;