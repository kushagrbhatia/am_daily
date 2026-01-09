import { CONFIG } from './config/constants.js';
import screenshotManager from './utils/screenshot.js';
import apiClient from './utils/api.js';
import audioController from './utils/audio.js';
import memoryManager from './utils/memory.js';

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
    
    // LOCAL LOGGING SYSTEM
    this.logs = [];
    this.maxLogs = 500; // Keep last 500 log entries
    
    // Rate limiting state
    this.rateLimitState = {
      consecutiveFailures: 0,
      lastFailureTime: 0,
      currentInterval: CONFIG.SCREENSHOT_INTERVAL,
      backoffMultiplier: 1
    };
    
    // Bind methods
    this.startMonitoring = this.startMonitoring.bind(this);
    this.stopMonitoring = this.stopMonitoring.bind(this);
    this.captureAndAnalyze = this.captureAndAnalyze.bind(this);
    this.handleClassificationResult = this.handleClassificationResult.bind(this);
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdated = this.handleTabUpdated.bind(this);
    this.adjustRateLimit = this.adjustRateLimit.bind(this);
    this.scheduleNextCapture = this.scheduleNextCapture.bind(this);
    
    // LOCAL LOGGING METHODS
    this.log = this.log.bind(this);
    this.saveLogs = this.saveLogs.bind(this);
    this.getLogs = this.getLogs.bind(this);
    this.clearLogs = this.clearLogs.bind(this);
    
    // Initialize event listeners
    this.initializeEventListeners();
    
    this.log('info', 'AutoMute detector initialized (Core Edition)');
  }
  
  /**
   * LOCAL LOGGING SYSTEM
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level, // 'info', 'warn', 'error', 'debug', 'success'
      message,
      data,
      tabId: this.currentTabId
    };
    
    this.logs.unshift(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    // Also log to console
    const emoji = {
      'info': 'ℹ️',
      'warn': '⚠️',
      'error': '❌',
      'debug': '🐛',
      'success': '✅'
    }[level] || '📝';
    
    console.log(`${emoji} [${level.toUpperCase()}] ${message}`, data || '');
    
    // Save to storage periodically
    if (this.logs.length % 10 === 0) {
      this.saveLogs();
    }
  }
  
  /**
   * Save logs to chrome storage
   */
  async saveLogs() {
    try {
      await chrome.storage.local.set({
        automute_logs: this.logs,
        automute_logs_updated: new Date().toISOString()
      });
    } catch (error) {
      console.error('Failed to save logs:', error);
    }
  }
  
  /**
   * Get all logs
   */
  async getLogs() {
    try {
      const result = await chrome.storage.local.get(['automute_logs', 'automute_logs_updated']);
      return {
        logs: result.automute_logs || [],
        updated: result.automute_logs_updated || null
      };
    } catch (error) {
      console.error('Failed to get logs:', error);
      return { logs: [], updated: null };
    }
  }
  
  /**
   * Clear all logs
   */
  async clearLogs() {
    try {
      this.logs = [];
      await chrome.storage.local.remove(['automute_logs', 'automute_logs_updated']);
      this.log('info', 'Logs cleared');
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
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
      return true;
    });
    
    // Listen for extension startup
    chrome.runtime.onStartup.addListener(() => {
      this.log('info', 'Extension started');
      this.loadClassificationHistory();
    });
    
    // Listen for extension install
    chrome.runtime.onInstalled.addListener((details) => {
      this.log('info', 'Extension installed/updated', { reason: details.reason });
      this.loadClassificationHistory();
      if (details.reason === 'install') {
        this.handleFirstInstall();
      }
    });
    
    // Clean up on extension suspend
    chrome.runtime.onSuspend.addListener(() => {
      this.log('info', 'Extension suspending, cleaning up');
      this.cleanup();
    });
  }

  /**
   * Load classification history from storage
   */
  async loadClassificationHistory() {
    try {
      const key = CONFIG.STORAGE_KEYS.CLASSIFICATION_HISTORY;
      const result = await chrome.storage.local.get([key]);
      
      if (result[key]) {
        this.classificationHistory = result[key];
        this.log('info', `Loaded classification history`, { count: this.classificationHistory.length });
      } else {
        this.classificationHistory = [];
        this.log('debug', 'No classification history found in storage');
      }
    } catch (error) {
      this.log('error', 'Failed to load classification history', error.message);
      this.classificationHistory = [];
    }
  }

  /**
   * Save classification history to storage
   */
  async saveClassificationHistory() {
    try {
      await chrome.storage.local.set({ 
        [CONFIG.STORAGE_KEYS.CLASSIFICATION_HISTORY]: this.classificationHistory 
      });
    } catch (error) {
      this.log('error', 'Failed to save classification history', error.message);
    }
  }

  /**
   * Handle messages from popup and content scripts
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      this.log('debug', 'Message received', { type: message.type });
      
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
          
        case 'GET_LOGS':
          const logsData = await this.getLogs();
          sendResponse({ success: true, data: logsData.logs });
          break;
          
        case 'CLEAR_LOGS':
          await this.clearLogs();
          sendResponse({ success: true, data: { cleared: true } });
          break;
          
        case 'EXPORT_LOGS':
          const allLogs = await this.getLogs();
          sendResponse({ success: true, data: allLogs.logs });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      this.log('error', 'Error handling message', error.message);
      sendResponse({ success: false, error: error.message });
    }
  }
  
  /**
   * Start monitoring a tab with adaptive rate limiting
   */
  async startMonitoring(tabId) {
    try {
      if (this.isMonitoring) {
        await this.stopMonitoring();
      }
      
      this.log('info', `Starting monitoring for tab ${tabId}`);
      
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
      
      // Start capture loop
      this.scheduleNextCapture();
      
      this.log('success', `Monitoring started for tab ${tabId}: ${tab.title}`);
      
      return {
        success: true,
        tabId: this.currentTabId,
        tabTitle: tab.title,
        tabUrl: tab.url,
        interval: this.rateLimitState.currentInterval
      };
      
    } catch (error) {
      this.isMonitoring = false;
      this.currentTabId = null;
      this.currentTabUrl = null;
      this.log('error', 'Failed to start monitoring', error.message);
      throw error;
    }
  }
  
  /**
   * Stop monitoring the current tab
   */
  async stopMonitoring() {
    try {
      this.log('info', 'Stopping monitoring...');
      
      // Clear interval
      if (this.screenshotInterval) {
        clearTimeout(this.screenshotInterval);
        this.screenshotInterval = null;
      }
      
      // Restore audio if we were managing it
      if (this.currentTabId) {
        try {
          await audioController.unmuteTab(this.currentTabId);
          this.log('info', 'Tab unmuted on stop');
        } catch (error) {
          this.log('warn', 'Failed to restore audio on stop', error.message);
        }
      }
      
      // Reset state
      const stoppedTabId = this.currentTabId;
      this.isMonitoring = false;
      this.currentTabId = null;
      this.currentTabUrl = null;
      this.lastClassification = null;
      
      // Clean up memory
      await memoryManager.cleanup();
      
      // Save logs before stopping
      await this.saveLogs();
      
      this.log('success', `Monitoring stopped for tab ${stoppedTabId}`);
      
      return {
        success: true,
        stoppedTabId
      };
      
    } catch (error) {
      this.log('error', 'Error stopping monitoring', error.message);
      throw error;
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
   * Capture screenshot and analyze with AI
   */
  async captureAndAnalyze() {
    try {
      if (!this.isMonitoring || !this.currentTabId) {
        return;
      }
      
      this.screenshotCount++;
      this.log('debug', `Capture #${this.screenshotCount} starting`);
      
      // Get tab information
      const tab = await this.getEnhancedTabInfo(this.currentTabId);
      
      const siteMetadata = {
        hostname: this.extractHostname(tab.url),
        referer: tab.url,
        title: tab.title,
        timestamp: Date.now()
      };
      
      this.log('debug', `Tab info: ${tab.title}`, { audible: tab.audible, muted: tab.mutedInfo?.muted });
      
      // Capture screenshot
      const screenshotStart = Date.now();
      const base64Image = await screenshotManager.captureTab(this.currentTabId);
      const screenshotTime = Date.now() - screenshotStart;
      
      if (!base64Image) {
        throw new Error('Screenshot capture returned empty data');
      }
      
      this.log('debug', `Screenshot captured in ${screenshotTime}ms (${Math.round(base64Image.length / 1024)}KB)`);
      
      // Classify with AI
      const classificationStart = Date.now();
      const classification = await apiClient.classifyImage(base64Image, siteMetadata);
      const classificationTime = Date.now() - classificationStart;
      
      this.log('debug', `Classification completed in ${classificationTime}ms`, classification);
      
      // Handle classification result
      await this.handleClassificationResult(classification);
      
      // Reset rate limiting on success
      this.adjustRateLimit(false);
      
      // Schedule next capture
      this.scheduleNextCapture();
      
      const totalTime = Date.now() - screenshotStart;
      this.log('success', `Capture #${this.screenshotCount} completed in ${totalTime}ms`);
      
    } catch (error) {
      this.log('error', 'Capture and analyze failed', error.message);
      
      // Handle rate limiting
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        this.log('warn', 'API rate limit hit, backing off...');
        this.adjustRateLimit(true);
        
        // Use safe fallback classification
        const hostname = this.extractHostname(this.currentTabUrl);
        const isYoutube = hostname && hostname.includes('youtube.com');
        
        await this.handleClassificationResult({
          classification: 'other',
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
   * Handle classification result - determine audio action
   */
  async handleClassificationResult(classification) {
    try {
      this.log('debug', 'Processing classification', classification);
      
      const { classification: type, confidence, site_category } = classification;
      
      // Get site context
      const hostname = this.extractHostname(this.currentTabUrl);
      const siteCategory = this.getSiteCategory(hostname);
      
      this.log('debug', `Site category: ${siteCategory}`);
      
      // Store classification with metadata
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
      await this.saveClassificationHistory();
      
      // Determine audio action
      const shouldMute = await this.shouldMuteForClassification(classification);
      
      this.log('info', `Audio Decision: ${shouldMute.mute ? 'MUTE' : 'UNMUTE'}`, { reason: shouldMute.reason });
      
      // Execute audio action
      if (shouldMute.mute) {
        this.log('debug', 'Executing mute...');
        const result = await audioController.muteTab(this.currentTabId, { smooth: true });
        this.log('success', 'Tab muted', { result });
      } else {
        this.log('debug', 'Executing unmute...');
        const result = await audioController.unmuteTab(this.currentTabId, { smooth: true });
        this.log('success', 'Tab unmuted', { result });
      }
      
      // Verify audio state
      const finalAudioState = await audioController.getTabAudioState(this.currentTabId);
      this.log('debug', 'Final audio state', finalAudioState);
      
    } catch (error) {
      this.log('error', 'Error handling classification result', error.message);
    }
  }
  
  /**
   * Determine if audio should be muted for classification
   */
  async shouldMuteForClassification(classification) {
    const { classification: type, confidence, site_category } = classification;
    
    // Get site category
    const siteCategory = this.getSiteCategory(this.extractHostname(this.currentTabUrl));
    
    // YOUTUBE: Binary classification (ad vs content)
    if (siteCategory === 'youtube') {
      if (type === 'ad' && confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
        return {
          mute: true,
          reason: `YouTube ad detected with ${confidence}% confidence (threshold: ${CONFIG.CONFIDENCE_THRESHOLD_AD}%)`
        };
      } else {
        return {
          mute: false,
          reason: `YouTube content (${type}) - unmuting`
        };
      }
    }
    
    // SPORTS STREAMING SITES: 3-way classification
    if (siteCategory === 'sportsStreaming') {
      switch (type) {
        case 'ad':
          if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
            return {
              mute: true,
              reason: `Streaming ad detected with ${confidence}% confidence`
            };
          }
          break;
          
        case 'game':
          if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_GAME) {
            return {
              mute: false,
              reason: `Sports content detected with ${confidence}% confidence`
            };
          }
          break;
          
        case 'other':
          const currentAudioState = await audioController.getTabAudioState(this.currentTabId);
          return {
            mute: currentAudioState.muted,
            reason: 'Maintaining current audio state for other content'
          };
      }
    }
    
    // GENERAL SITES: Enhanced video ad detection
    if (type === 'ad' && confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
      const tabInfo = await this.getEnhancedTabInfo(this.currentTabId);
      const { audioInfo } = tabInfo;
      
      const isVideoAd = (
        audioInfo.hasAudio || 
        audioInfo.isVideoSite || 
        this.hasVideoIndicators(classification.reasoning)
      );
      
      if (isVideoAd) {
        return {
          mute: true,
          reason: `Video ad detected with ${confidence}% confidence`
        };
      } else {
        return {
          mute: false,
          reason: `Static ad detected - not muting`
        };
      }
    }
    
    // Default: don't mute
    return {
      mute: false,
      reason: `No mute condition met: ${type} (${confidence}%)`
    };
  }
  
  /**
   * Extract hostname from URL
   */
  extractHostname(url) {
    if (!url) return '';
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch (error) {
      return '';
    }
  }
  
  /**
   * Get site category for classification logic
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
      'youtube.tv', 'tv.youtube.com'
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
      'video controls', 'play button', 'pause button', 'progress bar'
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
      this.log('error', 'Failed to get enhanced tab info', error.message);
      throw error;
    }
  }
  
  /**
   * Check if URL is a known video streaming site
   */
  isVideoStreamingSite(url) {
    if (!url) return false;
    
    const videoSites = [
      'youtube.com', 'youtu.be', 'twitch.tv',
      'netflix.com', 'hulu.com', 'disneyplus.com',
      'hbo.com', 'espn.com', 'nfl.com', 'nba.com',
      'mlb.com', 'nhl.com', 'fox.com', 'cbs.com',
      'nbc.com', 'abc.com', 'paramount.com',
      'peacocktv.com', 'sling.com', 'fubo.tv'
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
      
      this.log('warn', `Rate limit backoff increased to ${this.rateLimitState.backoffMultiplier}x`);
      
    } else {
      // Success - gradually reduce backoff
      if (this.rateLimitState.consecutiveFailures > 0) {
        this.rateLimitState.consecutiveFailures = Math.max(0, this.rateLimitState.consecutiveFailures - 1);
        this.rateLimitState.backoffMultiplier = Math.max(
          1, 
          Math.pow(2, this.rateLimitState.consecutiveFailures)
        );
        
        if (this.rateLimitState.backoffMultiplier === 1) {
          this.log('info', 'Rate limit backoff reset to normal');
        }
      }
    }
  }
  
  /**
   * Handle tab removed event
   */
  async handleTabRemoved(tabId) {
    if (tabId === this.currentTabId) {
      this.log('warn', `Monitored tab ${tabId} was closed, stopping monitoring`);
      await this.stopMonitoring();
    }
    
    audioController.handleTabRemoved(tabId);
  }
  
  /**
   * Handle tab updated event
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    if (tabId === this.currentTabId && changeInfo.url) {
      this.log('info', `Monitored tab navigated to: ${changeInfo.url}`);
      this.currentTabUrl = changeInfo.url;
      
      if (this.isTabMonitorable(tab)) {
        this.log('debug', 'New URL is monitorable, continuing monitoring');
      } else {
        this.log('warn', 'New URL is not monitorable, stopping monitoring');
        await this.stopMonitoring();
      }
    }
  }
  
  /**
   * Check if tab can be monitored
   */
  isTabMonitorable(tab) {
    const url = tab.url || '';
    
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
            siteCategory: this.getSiteCategory(this.extractHostname(tab.url))
          }))
          .sort((a, b) => {
            if (a.windowId !== b.windowId) {
              return a.windowId - b.windowId;
            }
            return a.index - b.index;
          });
        
        resolve(monitorableTabs);
      });
    });
  }
  
  /**
   * Get current status
   */
  async getStatus() {
    const audioState = this.currentTabId ? 
      await audioController.getTabAudioState(this.currentTabId) : null;
    
    return {
      isMonitoring: this.isMonitoring,
      currentTabId: this.currentTabId,
      currentTabUrl: this.currentTabUrl,
      currentSiteCategory: this.getSiteCategory(this.extractHostname(this.currentTabUrl)),
      screenshotCount: this.screenshotCount,
      lastClassification: this.lastClassification,
      rateLimitState: this.rateLimitState,
      audioState: audioState,
      memoryStats: memoryManager.getMemoryStats(),
      logsCount: this.logs.length
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
      this.log('error', 'Failed to toggle audio', error.message);
      throw error;
    }
  }
  
  /**
   * Handle first install
   */
  async handleFirstInstall() {
    this.log('success', 'AutoMute extension installed for the first time');
  }
  
  /**
   * Clean up all resources
   */
  async cleanup() {
    this.log('info', 'Cleaning up AutoMute detector...');
    
    try {
      await this.stopMonitoring();
      await audioController.cleanup();
      await memoryManager.cleanup();
      await this.saveLogs();
    } catch (error) {
      this.log('error', 'Error during cleanup', error.message);
    }
  }
}

// Create and initialize the detector
const autoMuteDetector = new AutoMuteDetector();

// Export for testing
export default autoMuteDetector;