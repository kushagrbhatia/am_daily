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

    // Video bounds detected by content script, keyed by tabId
    this.videoBoundsMap = new Map();

    // LOCAL LOGGING SYSTEM
    this.logs = [];
    this.maxLogs = 500;
    
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
    
    this.log = this.log.bind(this);
    this.saveLogs = this.saveLogs.bind(this);
    this.getLogs = this.getLogs.bind(this);
    this.clearLogs = this.clearLogs.bind(this);
    
    this.initializeEventListeners();
    this.log('info', 'AutoMute detector initialized');
  }
  
  /**
   * LOCAL LOGGING SYSTEM
   * ✅ FIX: Save logs immediately and safely
   */
  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      tabId: this.currentTabId
    };
    
    this.logs.unshift(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
    
    const emoji = {
      'info': 'ℹ️',
      'warn': '⚠️',
      'error': '❌',
      'debug': '🐛',
      'success': '✅'
    }[level] || '📝';
    
    console.log(`${emoji} [${level.toUpperCase()}] ${message}`, data || '');
    
    // ✅ Save logs asynchronously (don't block)
    this.saveLogs().catch(err => console.error('Log save failed:', err));
  }
  
  /**
   * Save logs to chrome storage
   * ✅ FIX: Check if chrome.storage exists before using
   */
  async saveLogs() {
    try {
      if (!chrome?.storage?.local) {
        console.warn('chrome.storage.local not available');
        return;
      }
      
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
      if (!chrome?.storage?.local) {
        return { logs: this.logs || [], updated: null };
      }
      
      const result = await chrome.storage.local.get(['automute_logs', 'automute_logs_updated']);
      return {
        logs: result.automute_logs || this.logs || [],
        updated: result.automute_logs_updated || null
      };
    } catch (error) {
      console.error('Failed to get logs:', error);
      return { logs: this.logs || [], updated: null };
    }
  }
  
  /**
   * Clear all logs
   */
  async clearLogs() {
    try {
      this.logs = [];
      
      if (!chrome?.storage?.local) {
        return;
      }
      
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
    chrome.tabs.onRemoved.addListener(this.handleTabRemoved);
    chrome.tabs.onUpdated.addListener(this.handleTabUpdated);
    
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });
    
    chrome.runtime.onStartup.addListener(() => {
      this.log('info', 'Extension started');
      this.loadClassificationHistory();
    });
    
    chrome.runtime.onInstalled.addListener((details) => {
      this.log('info', 'Extension installed/updated', { reason: details.reason });
      this.loadClassificationHistory();
      if (details.reason === 'install') {
        this.handleFirstInstall();
      }
    });
    
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
      if (!chrome?.storage?.local) {
        return;
      }
      
      await chrome.storage.local.set({ 
        [CONFIG.STORAGE_KEYS.CLASSIFICATION_HISTORY]: this.classificationHistory 
      });
    } catch (error) {
      console.error('Failed to save classification history:', error);
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
          const allLogs = [...logsData.logs, ...this.logs];
          sendResponse({ success: true, data: allLogs });
          break;
          
        case 'CLEAR_LOGS':
          await this.clearLogs();
          sendResponse({ success: true, data: { cleared: true } });
          break;
          
        case 'EXPORT_LOGS':
          const allLogsExport = await this.getLogs();
          sendResponse({ success: true, data: allLogsExport.logs });
          break;

        case 'YOUTUBE_AD_START':
          this.log('info', 'YouTube ad detected via DOM — muting');
          if (this.currentTabId) {
            await audioController.muteTab(this.currentTabId, { smooth: false });
          } else if (sender?.tab?.id) {
            await audioController.muteTab(sender.tab.id, { smooth: false });
          }
          this.lastClassification = {
            classification: 'ad',
            confidence: 100,
            shouldMute: true,
            source: 'youtube_dom',
            timestamp: new Date().toISOString(),
            hostname: this.extractHostname(this.currentTabUrl),
            siteCategory: 'youtube'
          };
          sendResponse({ success: true });
          break;

        case 'YOUTUBE_AD_END': {
          this.log('info', 'YouTube ad ended via DOM — unmuting');
          const tabIdToUnmute = this.currentTabId || sender?.tab?.id;
          if (tabIdToUnmute) {
            await audioController.unmuteTab(tabIdToUnmute, { smooth: false });
          }
          this.lastClassification = {
            classification: 'other',
            confidence: 100,
            shouldMute: false,
            source: 'youtube_dom',
            timestamp: new Date().toISOString(),
            hostname: this.extractHostname(this.currentTabUrl),
            siteCategory: 'youtube'
          };
          sendResponse({ success: true });
          break;
        }

        case 'VIDEO_BOUNDS_UPDATED':
          if (sender?.tab?.id) {
            this.videoBoundsMap.set(sender.tab.id, message.bounds);
            this.log('debug', `Video bounds updated for tab ${sender.tab.id}`, message.bounds);
          }
          sendResponse({ success: true });
          break;

        case 'VIDEO_BOUNDS_CLEARED':
          if (sender?.tab?.id) {
            this.videoBoundsMap.delete(sender.tab.id);
            this.log('debug', `Video bounds cleared for tab ${sender.tab.id}`);
          }
          sendResponse({ success: true });
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
   * ✅ FIXED: Immediate capture on user gesture
   */
  async startMonitoring(tabId) {
    try {
      if (this.isMonitoring) {
        await this.stopMonitoring();
      }
      
      this.log('info', `🚀 Starting monitoring for tab ${tabId}`);
      
      const tab = await this.getEnhancedTabInfo(tabId);
      if (!tab) {
        throw new Error('Tab not found or not accessible');
      }
      
      if (!this.isTabMonitorable(tab)) {
        throw new Error('Tab cannot be monitored (internal page)');
      }
      
      this.isMonitoring = true;
      this.currentTabId = tabId;
      this.currentTabUrl = tab.url;
      this.screenshotCount = 0;
      this.lastClassification = null;
      
      // Reset rate limiting
      this.rateLimitState.consecutiveFailures = 0;
      this.rateLimitState.backoffMultiplier = 1;
      this.rateLimitState.currentInterval = CONFIG.SCREENSHOT_INTERVAL;
      
      // Skip screenshot loop for YouTube — DOM detection handles it
      const hostname = this.extractHostname(tab.url);
      if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
        this.log('info', 'YouTube tab detected — using DOM detection, skipping screenshot loop');
        return {
          success: true,
          tabId: this.currentTabId,
          tabTitle: tab.title,
          tabUrl: tab.url,
          mode: 'youtube_dom'
        };
      }

      // ✅ FIXED: Capture immediately within user gesture
      console.log('✅ IMMEDIATE CAPTURE: User gesture active, capturing first screenshot NOW');
      this.screenshotInterval = setTimeout(() => {
        if (this.isMonitoring) {
          console.log('✅ First capture triggered (within user gesture)');
          this.captureAndAnalyze();
        }
      }, 50);
      
      setTimeout(() => {
        this.scheduleNextCapture();
      }, 100);
      
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
      
      if (this.screenshotInterval) {
        clearTimeout(this.screenshotInterval);
        this.screenshotInterval = null;
      }
      
      if (this.currentTabId) {
        try {
          await audioController.unmuteTab(this.currentTabId);
          this.log('info', 'Tab unmuted on stop');
        } catch (error) {
          this.log('warn', 'Failed to restore audio on stop', error.message);
        }
      }
      
      const stoppedTabId = this.currentTabId;
      this.isMonitoring = false;
      if (this.currentTabId) {
        this.videoBoundsMap.delete(this.currentTabId);
      }
      this.currentTabId = null;
      this.currentTabUrl = null;
      this.lastClassification = null;
      
      await memoryManager.cleanup();
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
   * ✅ FIXED: Cap at 4x backoff for faster recovery
   */
  scheduleNextCapture() {
    if (!this.isMonitoring) return;
    
    // ✅ FIX: Cap at 4x instead of 8x (max 10 seconds instead of 20)
    const cappedMultiplier = Math.min(this.rateLimitState.backoffMultiplier, 4);
    this.rateLimitState.currentInterval = CONFIG.SCREENSHOT_INTERVAL * cappedMultiplier;
    
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
      
      const tab = await this.getEnhancedTabInfo(this.currentTabId);
      
      const siteMetadata = {
        hostname: this.extractHostname(tab.url),
        referer: tab.url,
        title: tab.title,
        timestamp: Date.now()
      };
      
      this.log('debug', `Tab info: ${tab.title}`, { audible: tab.audible, muted: tab.mutedInfo?.muted });
      
      const screenshotStart = Date.now();
      const videoBounds = this.videoBoundsMap.get(this.currentTabId);
      const captureOptions = videoBounds ? { cropBounds: videoBounds } : {};
      const base64Image = await screenshotManager.captureTab(this.currentTabId, captureOptions);
      const screenshotTime = Date.now() - screenshotStart;

      if (!base64Image) {
        throw new Error('Screenshot capture returned empty data');
      }

      const cropInfo = videoBounds ? ` [cropped to video ${videoBounds.width}x${videoBounds.height}]` : ' [full screenshot]';
      this.log('debug', `Screenshot captured in ${screenshotTime}ms (${Math.round(base64Image.length / 1024)}KB)${cropInfo}`);
      
      const classificationStart = Date.now();
      const classification = await apiClient.classifyImage(base64Image, siteMetadata);
      const classificationTime = Date.now() - classificationStart;
      
      this.log('debug', `Classification completed in ${classificationTime}ms`, classification);
      
      // ✅ FIXED: ALWAYS handle result - this is critical!
      await this.handleClassificationResult(classification);
      
      this.adjustRateLimit(false);
      this.scheduleNextCapture();
      
      const totalTime = Date.now() - screenshotStart;
      this.log('success', `Capture #${this.screenshotCount} completed in ${totalTime}ms`);
      
    } catch (error) {
      this.log('error', 'Capture and analyze failed', error.message);
      
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        this.log('warn', 'API rate limit hit, backing off...');
        this.adjustRateLimit(true);
        
        // Use safe fallback classification
        const hostname = this.extractHostname(this.currentTabUrl);
        const isYoutube = hostname && hostname.includes('youtube.com');
        
        await this.handleClassificationResult({
          classification: 'game',
          confidence: 0,
          reasoning: 'Skipped due to API rate limit',
          processing_time: 0,
          site_category: isYoutube ? 'youtube' : 'general'
        });
      } else {
        this.adjustRateLimit(true);
      }
      
      this.scheduleNextCapture();
    }
  }
  
  /**
   * Handle classification result - determine audio action
   * ✅ FIXED: ALWAYS update classification and make decision
   */
  async handleClassificationResult(classification) {
    try {
      this.log('debug', 'Processing classification', classification);
      
      // ✅ FIXED: Convert 'other' to 'game' for binary classification
      let type = classification.classification;
      if (type === 'other' || !type) {
        type = 'game'; // Default to game, not ad
      }
      
      const confidence = classification.confidence || 0;
      const site_category = classification.site_category;
      
      const hostname = this.extractHostname(this.currentTabUrl);
      const siteCategory = this.getSiteCategory(hostname);
      
      this.log('debug', `Site category: ${siteCategory}`);
      
      // ✅ FIXED: ALWAYS update lastClassification (this is what popup displays)
      this.lastClassification = {
        ...classification,
        classification: type,
        timestamp: new Date().toISOString(),
        screenshotNumber: this.screenshotCount,
        hostname: hostname,
        siteCategory: siteCategory,
        tabUrl: this.currentTabUrl
      };
      
      this.log('info', `Classification updated: ${type} (${confidence}%)`);
      
      this.classificationHistory.unshift(this.lastClassification);
      if (this.classificationHistory.length > this.maxHistorySize) {
        this.classificationHistory = this.classificationHistory.slice(0, this.maxHistorySize);
      }
      await this.saveClassificationHistory();
      
      // ✅ FIXED: ALWAYS determine and execute audio action
      const shouldMute = await this.shouldMuteForClassification({ classification: type, confidence, site_category });
      
      this.log('info', `Audio Decision: ${shouldMute.mute ? 'MUTE' : 'UNMUTE'}`, { reason: shouldMute.reason });
      
      if (shouldMute.mute) {
        this.log('debug', 'Executing mute...');
        const result = await audioController.muteTab(this.currentTabId, { smooth: true });
        this.log('success', 'Tab muted', { result });
      } else {
        this.log('debug', 'Executing unmute...');
        const result = await audioController.unmuteTab(this.currentTabId, { smooth: true });
        this.log('success', 'Tab unmuted', { result });
      }
      
      const finalAudioState = await audioController.getTabAudioState(this.currentTabId);
      this.log('debug', 'Final audio state', finalAudioState);
      
    } catch (error) {
      this.log('error', 'Error handling classification result', error.message);
    }
  }
  
  /**
   * Determine if audio should be muted for classification
   * ✅ KEEPS: Full site-specific logic from original
   */
  async shouldMuteForClassification(classification) {
    const { classification: type, confidence, site_category } = classification;
    
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
   * ✅ KEEPS: Full list of sports streaming sites
   */
  getSiteCategory(hostname) {
    if (!hostname) return 'general';
    
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) {
      return 'youtube';
    }
    
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
   * ✅ KEEPS: Full video indicator logic
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
   * ✅ FIXED: Cap at 4x instead of 8x for faster unmuting
   */
  adjustRateLimit(isFailure) {
    if (isFailure) {
      this.rateLimitState.consecutiveFailures++;
      this.rateLimitState.lastFailureTime = Date.now();
      
      // ✅ FIX: Cap at 4x instead of 8x (max 10 seconds instead of 20)
      this.rateLimitState.backoffMultiplier = Math.min(
        Math.pow(2, this.rateLimitState.consecutiveFailures),
        4
      );
      
      this.log('warn', `Rate limit backoff increased to ${this.rateLimitState.backoffMultiplier}x`);
      
    } else {
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
    this.videoBoundsMap.delete(tabId);
  }
  
  /**
   * Handle tab updated event
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    // Clear cached video bounds for any tab that navigates — new page may have different layout
    if (changeInfo.url) {
      this.videoBoundsMap.delete(tabId);
    }

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