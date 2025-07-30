import { CONFIG } from './config/constants.js';
import screenshotManager from './utils/screenshot.js';
import apiClient from './utils/api.js';
import audioController from './utils/audio.js';
import memoryManager from './utils/memory.js';

class AutoMuteDetector {
  constructor() {
    this.isMonitoring = false;
    this.currentTabId = null;
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
    
    // Bind methods
    this.startMonitoring = this.startMonitoring.bind(this);
    this.stopMonitoring = this.stopMonitoring.bind(this);
    this.captureAndAnalyze = this.captureAndAnalyze.bind(this);
    this.handleClassificationResult = this.handleClassificationResult.bind(this);
    this.handleTabRemoved = this.handleTabRemoved.bind(this);
    this.handleTabUpdated = this.handleTabUpdated.bind(this);
    this.adjustRateLimit = this.adjustRateLimit.bind(this);
    this.scheduleNextCapture = this.scheduleNextCapture.bind(this);
    
    // Initialize event listeners
    this.initializeEventListeners();
    
    console.log('AutoMute detector service worker initialized');
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
      this.screenshotCount = 0;
      this.lastClassification = null;
      
      // Reset rate limiting
      this.rateLimitState.consecutiveFailures = 0;
      this.rateLimitState.backoffMultiplier = 1;
      this.rateLimitState.currentInterval = CONFIG.SCREENSHOT_INTERVAL;
      
      // Start capture loop
      this.scheduleNextCapture();
      
      console.log(`✅ Monitoring started for tab ${tabId}: ${tab.title}`);
      
      return {
        success: true,
        tabId: this.currentTabId,
        tabTitle: tab.title,
        interval: this.rateLimitState.currentInterval
      };
      
    } catch (error) {
      this.isMonitoring = false;
      this.currentTabId = null;
      console.error('Failed to start monitoring:', error);
      throw error;
    }
  }
  
  /**
   * Stop monitoring and clean up
   */
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
      
      // Reset state
      const stoppedTabId = this.currentTabId;
      this.isMonitoring = false;
      this.currentTabId = null;
      this.lastClassification = null;
      
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
      console.log(`📸 Starting capture #${this.screenshotCount} for tab ${this.currentTabId}`);
      
      // Capture screenshot
      const base64Image = await screenshotManager.captureTab(this.currentTabId);
      
      if (!base64Image) {
        throw new Error('Screenshot capture returned empty data');
      }
      
      console.log(`📸 Screenshot captured, sending for classification...`);
      
      // Classify with AI
      const classification = await apiClient.classifyImage(base64Image);
      
      // Handle successful classification
      await this.handleClassificationResult(classification);
      
      // Reset rate limiting on success
      this.adjustRateLimit(false);
      
      // Schedule next capture
      this.scheduleNextCapture();
      
    } catch (error) {
      console.error('Capture and analyze failed:', error);
      
      // Handle rate limiting
      if (error.message.includes('rate_limit') || error.message.includes('429')) {
        console.warn('⚠️ API rate limit hit, backing off...');
        this.adjustRateLimit(true);
        
        // Return fallback classification for rate limits
        await this.handleClassificationResult({
          classification: 'other',
          confidence: 0,
          reasoning: 'Skipped due to API rate limit',
          processing_time: 0
        });
      } else {
        this.adjustRateLimit(true);
      }
      
      // Continue monitoring even on errors
      this.scheduleNextCapture();
    }
  }
  
  /**
   * Handle classification result and update audio
   */
  async handleClassificationResult(classification) {
    try {
      console.log('Processing classification result:', classification);
      
      // Store classification
      this.lastClassification = {
        ...classification,
        timestamp: new Date().toISOString(),
        screenshotNumber: this.screenshotCount
      };
      
      // Add to history
      this.classificationHistory.unshift(this.lastClassification);
      if (this.classificationHistory.length > this.maxHistorySize) {
        this.classificationHistory = this.classificationHistory.slice(0, this.maxHistorySize);
      }
      
      // Determine audio action based on classification
      const shouldMute = await this.shouldMuteForClassification(classification);
      
      if (shouldMute.mute) {
        await audioController.muteTab(this.currentTabId, { smooth: true });
        console.log(`🔇 Tab muted: ${shouldMute.reason}`);
      } else {
        await audioController.unmuteTab(this.currentTabId, { smooth: true });
        console.log(`🔊 Tab unmuted: ${shouldMute.reason}`);
      }
      
    } catch (error) {
      console.error('Error handling classification result:', error);
    }
  }
  
  /**
   * Enhanced logic to determine if tab should be muted based on classification
   * Only mutes VIDEO ads, not static webpage ads
   */
  async shouldMuteForClassification(classification) {
    const { classification: type, confidence, reasoning } = classification;
    
    // Get enhanced tab info
    const tabInfo = await this.getEnhancedTabInfo(this.currentTabId);
    const { audioInfo } = tabInfo;
    
    switch (type) {
      case CONFIG.CLASSIFICATION_TYPES.AD:
        if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_AD) {
          
          // Multiple checks to ensure this is a VIDEO ad:
          // 1. Tab currently has audible content
          // 2. Tab is on a video streaming site
          // 3. AI reasoning mentions video-related terms
          const isVideoAd = (
            audioInfo.hasAudio || 
            audioInfo.isVideoSite || 
            this.hasVideoIndicators(reasoning)
          );
          
          if (isVideoAd) {
            console.log(`🎥 Video ad detected - will mute (audio: ${audioInfo.hasAudio}, video site: ${audioInfo.isVideoSite})`);
            return {
              mute: true,
              reason: `Video ad detected with ${confidence}% confidence`
            };
          } else {
            console.log(`📄 Static ad detected - will NOT mute (audio: ${audioInfo.hasAudio}, video site: ${audioInfo.isVideoSite})`);
            return {
              mute: false,
              reason: `Static webpage ad detected (${confidence}% confidence) - not muting`
            };
          }
        }
        break;
        
      case CONFIG.CLASSIFICATION_TYPES.GAME:
        if (confidence >= CONFIG.CONFIDENCE_THRESHOLD_GAME) {
          return {
            mute: false,
            reason: `Sports content detected with ${confidence}% confidence`
          };
        }
        break;
        
      case CONFIG.CLASSIFICATION_TYPES.OTHER:
        const currentAudioState = await audioController.getTabAudioState(this.currentTabId);
        return {
          mute: currentAudioState.managedByExtension ? currentAudioState.muted : false,
          reason: `Other content detected, maintaining current state`
        };
    }
    
    // Default: maintain current state
    const currentAudioState = await audioController.getTabAudioState(this.currentTabId);
    return {
      mute: currentAudioState.managedByExtension ? currentAudioState.muted : false,
      reason: `Low confidence (${confidence}%), maintaining current state`
    };
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
            index: tab.index
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
  async getStatus() {
    const audioState = this.currentTabId ? 
      await audioController.getTabAudioState(this.currentTabId) : null;
    
    return {
      isMonitoring: this.isMonitoring,
      currentTabId: this.currentTabId,
      screenshotCount: this.screenshotCount,
      lastClassification: this.lastClassification,
      rateLimitState: this.rateLimitState,
      audioState,
      memoryStats: memoryManager.getMemoryStats()
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
}

// Create and initialize the detector
const autoMuteDetector = new AutoMuteDetector();

// Export for testing
export default autoMuteDetector;