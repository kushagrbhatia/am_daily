import { CONFIG } from '../config/constants.js';

class PopupController {
  constructor() {
    this.currentStatus = null;
    this.selectedTabId = null;
    this.isInitialized = false;
    
    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.loadTabs = this.loadTabs.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.handleTabSelection = this.handleTabSelection.bind(this);
    this.handleStartStop = this.handleStartStop.bind(this);
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', this.initialize);
    } else {
      this.initialize();
    }
  }
  
  /**
   * Initialize popup interface
   */
  async initialize() {
    try {
      console.log('Initializing AutoMute popup...');
      
      // Get DOM elements
      this.elements = {
        statusDot: document.getElementById('statusDot'),
        statusText: document.getElementById('statusText'),
        tabList: document.getElementById('tabList'),
        tabLoading: document.getElementById('tabLoading'),
        extensionStatus: document.getElementById('extensionStatus'),
        backendStatus: document.getElementById('backendStatus'),
        audioStatus: document.getElementById('audioStatus'),
        audioStatusText: document.getElementById('audioStatusText')
      };
      
      // Add start/stop button to the popup
      this.createStartStopButton();
      
      // NEW: Create debugging interface
      this.createDebugInterface();
      
      // Test connections
      await this.testBackgroundConnection();
      await this.testBackendConnection();
      
      // Load current status
      await this.updateStatus();
      
      // Load tabs
      await this.loadTabs();
      
      // NEW: Set up auto-refresh for debugging (every 2 seconds when monitoring)
      this.startDebugRefresh();
      
      this.isInitialized = true;
      console.log('AutoMute popup initialized successfully with debugging');
      
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.showError('Failed to initialize extension popup');
    }
  }
  
  /**
   * Create start/stop button
   */
  createStartStopButton() {
    // Add button after tab list
    const controlsHtml = `
      <div id="controlsSection" style="padding: 16px; border-bottom: 1px solid #e8eaed; display: none;">
        <h2 style="font-size: 14px; font-weight: 500; margin-bottom: 12px; color: #202124;">Controls</h2>
        <button id="startStopBtn" style="
          width: 100%;
          padding: 8px 16px;
          border: 1px solid #1a73e8;
          border-radius: 4px;
          background: #1a73e8;
          color: white;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
        ">Start AutoMuting</button>
        <div id="currentTabInfo" style="
          margin-top: 12px;
          padding: 8px 12px;
          background: #f8f9fa;
          border-radius: 4px;
          border: 1px solid #e8eaed;
          display: none;
        ">
          <div style="display: flex; align-items: center;">
            <img id="currentTabFavicon" style="width: 16px; height: 16px; margin-right: 8px;" src="" alt="">
            <span id="currentTabTitle" style="font-size: 12px; color: #202124;">No tab selected</span>
          </div>
        </div>
      </div>
    `;
    
    // Insert controls after tab list
    const tabList = document.getElementById('tabList');
    if (tabList && tabList.parentNode) {
      const controlsDiv = document.createElement('div');
      controlsDiv.innerHTML = controlsHtml;
      tabList.parentNode.insertBefore(controlsDiv, tabList.nextSibling);
      
      // Store references to new elements
      this.elements.controlsSection = document.getElementById('controlsSection');
      this.elements.startStopBtn = document.getElementById('startStopBtn');
      this.elements.currentTabInfo = document.getElementById('currentTabInfo');
      this.elements.currentTabFavicon = document.getElementById('currentTabFavicon');
      this.elements.currentTabTitle = document.getElementById('currentTabTitle');
      
      // Add event listener
      this.elements.startStopBtn.addEventListener('click', this.handleStartStop);
    }
  }
  
  /**
   * Test connection to background script
   */
  async testBackgroundConnection() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATUS' });
      
      if (response.success) {
        this.elements.extensionStatus.textContent = 'Connected';
        this.elements.extensionStatus.className = 'info-value connected';
        console.log('Background script connection: OK');
      } else {
        throw new Error('Background script returned error');
      }
    } catch (error) {
      console.error('Background script connection failed:', error);
      this.elements.extensionStatus.textContent = 'Error';
      this.elements.extensionStatus.className = 'info-value error';
    }
  }
  
  /**
   * Test connection to backend API
   */
  async testBackendConnection() {
    try {
      // Use the CONFIG URL instead of hardcoded localhost
      const healthUrl = CONFIG.API_BASE_URL.replace('/api', '') + '/health';
      const response = await fetch(healthUrl);
      
      if (response.ok) {
        const data = await response.json();
        this.elements.backendStatus.textContent = 'Connected';
        this.elements.backendStatus.className = 'info-value connected';
        console.log('Backend API connection: OK', data);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Backend API connection failed:', error);
      this.elements.backendStatus.textContent = 'Not available';
      this.elements.backendStatus.className = 'info-value error';
    }
  }
  
  /**
   * Update status from background script
   */
  async updateStatus() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATUS' });
      
      if (response.success) {
        this.currentStatus = response.data;
        this.updateUI();
      }
    } catch (error) {
      console.error('Failed to get status:', error);
    }
  }
  
  /**
   * ENHANCED updateUI method with debugging information
   */
  updateUI() {
    if (!this.currentStatus) return;
    
    const { 
      isMonitoring, 
      currentTabId, 
      currentTabUrl,
      currentSiteCategory,
      screenshotCount, 
      lastClassification, 
      audioState,
      rateLimitState 
    } = this.currentStatus;
    
    // Update status indicator
    if (isMonitoring) {
      this.elements.statusDot.className = 'status-dot monitoring';
      this.elements.statusText.textContent = 'AutoMuting';
      
      if (this.elements.startStopBtn) {
        this.elements.startStopBtn.textContent = 'Stop AutoMuting';
        this.elements.startStopBtn.style.background = '#ea4335';
        this.elements.startStopBtn.style.borderColor = '#ea4335';
      }
      
      // Show current tab info
      if (currentTabId && this.elements.currentTabInfo) {
        this.elements.currentTabInfo.style.display = 'block';
        this.updateCurrentTabDisplay(currentTabId);
      }
      
      // NEW: Show debugging information
      this.updateDebugInfo(currentTabUrl, currentSiteCategory, screenshotCount, lastClassification, rateLimitState);
      
    } else {
      this.elements.statusDot.className = 'status-dot idle';
      this.elements.statusText.textContent = 'Idle';
      
      if (this.elements.startStopBtn) {
        this.elements.startStopBtn.textContent = 'Start AutoMuting';
        this.elements.startStopBtn.style.background = '#1a73e8';
        this.elements.startStopBtn.style.borderColor = '#1a73e8';
      }
      
      if (this.elements.currentTabInfo) {
        this.elements.currentTabInfo.style.display = 'none';
      }
      
      // Hide debug info when not monitoring
      this.hideDebugInfo();
    }
    
    // Update audio status indicator
    this.updateAudioStatusIndicator(audioState, isMonitoring);
    
    // Update button state
    if (this.elements.startStopBtn) {
      this.elements.startStopBtn.disabled = false;
    }
    
    console.log('UI updated with debugging info:', { isMonitoring, screenshotCount, lastClassification });
  }
  
  /**
   * Update audio status indicator
   */
  updateAudioStatusIndicator(audioState, isMonitoring) {
    const audioStatus = document.getElementById('audioStatus');
    const audioStatusText = document.getElementById('audioStatusText');
    
    if (!audioStatus || !audioStatusText) return;
    
    if (!isMonitoring || !audioState) {
      audioStatus.className = 'audio-status unknown';
      audioStatusText.textContent = 'Unknown';
      return;
    }
    
    if (audioState.muted) {
      audioStatus.className = 'audio-status muted';
      audioStatusText.textContent = 'Muted';
    } else {
      audioStatus.className = 'audio-status unmuted';  
      audioStatusText.textContent = 'Unmuted';
    }
  }
  
  /**
   * Update current tab display
   */
  async updateCurrentTabDisplay(tabId) {
    try {
      const tabs = await this.sendMessage({ type: 'GET_TABS' });
      if (tabs.success) {
        const tab = tabs.data.find(t => t.id === tabId);
        if (tab) {
          this.elements.currentTabFavicon.src = tab.favIconUrl || '../icons/icon16.png';
          this.elements.currentTabTitle.textContent = tab.title || 'Untitled';
        }
      }
    } catch (error) {
      console.error('Failed to update tab display:', error);
    }
  }
  
  /**
   * Load and display available tabs
   */
  async loadTabs() {
    try {
      console.log('Loading tabs from all windows...');
      
      // Show loading state
      this.elements.tabLoading.style.display = 'block';
      
      // Get tabs from background script
      const response = await this.sendMessage({ type: 'GET_TABS' });
      
      if (!response.success) {
        throw new Error(response.error);
      }
      
      const tabs = response.data;
      console.log(`Loaded ${tabs.length} tabs from all windows`);
      
      // Hide loading
      this.elements.tabLoading.style.display = 'none';
      
      // Clear existing tabs
      const existingTabs = this.elements.tabList.querySelectorAll('.tab-item, .window-separator');
      existingTabs.forEach(tab => tab.remove());
      
      // Add tabs to list
      if (tabs.length === 0) {
        const noTabsDiv = document.createElement('div');
        noTabsDiv.className = 'no-tabs';
        noTabsDiv.style.cssText = 'text-align: center; color: #5f6368; font-style: italic; padding: 20px; font-size: 12px;';
        noTabsDiv.textContent = 'No monitorable tabs found';
        this.elements.tabList.appendChild(noTabsDiv);
        return;
      }
      
      // Group tabs by window and display
      let currentWindowId = null;
      const maxTabs = Math.min(tabs.length, 15); // Show max 15 tabs
      
      for (let i = 0; i < maxTabs; i++) {
        const tab = tabs[i];
        const isFirstInWindow = tab.windowId !== currentWindowId;
        
        const tabElement = this.createTabElement(tab, isFirstInWindow);
        this.elements.tabList.appendChild(tabElement);
        
        currentWindowId = tab.windowId;
      }
      
      if (tabs.length > maxTabs) {
        const moreDiv = document.createElement('div');
        moreDiv.style.cssText = 'text-align: center; color: #5f6368; font-size: 11px; padding: 8px;';
        moreDiv.textContent = `... and ${tabs.length - maxTabs} more tabs`;
        this.elements.tabList.appendChild(moreDiv);
      }
      
    } catch (error) {
      console.error('Failed to load tabs:', error);
      this.elements.tabLoading.textContent = 'Failed to load tabs';
    }
  }

  /**
   * Create tab element for the list
   */
  createTabElement(tab, isFirstInWindow = false) {
    const container = document.createElement('div');
    
    // Add window separator if this is the first tab in a new window
    if (isFirstInWindow && tab.windowId) {
      const windowSeparator = document.createElement('div');
      windowSeparator.style.cssText = `
        font-size: 11px;
        color: #5f6368;
        padding: 4px 8px;
        background: #f8f9fa;
        border-bottom: 1px solid #e8eaed;
        font-weight: 500;
      `;
      windowSeparator.textContent = `Window ${tab.windowId}${tab.active ? ' (Current)' : ''}`;
      container.appendChild(windowSeparator);
    }
    
    const tabDiv = document.createElement('div');
    tabDiv.className = 'tab-item';
    tabDiv.dataset.tabId = tab.id;
    tabDiv.style.cssText = `
      display: flex;
      align-items: center;
      padding: 8px 12px;
      margin-bottom: 4px;
      border: 1px solid #dadce0;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s ease;
      background: #ffffff;
    `;
    
    // Highlight active tab
    if (tab.active) {
      tabDiv.style.background = '#e8f0fe';
      tabDiv.style.borderColor = '#1a73e8';
    }
    
    // Add selected state if this is current monitoring tab
    if (this.currentStatus && tab.id === this.currentStatus.currentTabId) {
      tabDiv.style.background = '#fce8e6';
      tabDiv.style.borderColor = '#ea4335';
      this.selectedTabId = tab.id;
    }
    
    // Favicon
    const favicon = document.createElement('img');
    favicon.style.cssText = 'width: 16px; height: 16px; margin-right: 8px; flex-shrink: 0;';
    favicon.src = tab.favIconUrl || '../icons/icon16.png';
    favicon.alt = '';
    favicon.onerror = () => {
      favicon.src = '../icons/icon16.png';
    };
    
    // Title with better truncation
    const title = document.createElement('span');
    title.style.cssText = 'flex: 1; font-size: 13px; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    
    // Better title handling
    let displayTitle = tab.title || 'Loading...';
    if (displayTitle === 'Loading...' && tab.url) {
      try {
        const url = new URL(tab.url);
        displayTitle = url.hostname;
      } catch (e) {
        displayTitle = 'Loading...';
      }
    }
    
    title.textContent = displayTitle;
    title.title = `${displayTitle}\n${tab.url}`; // Full info in tooltip
    
    // Status indicators
    const indicators = document.createElement('div');
    indicators.style.cssText = 'display: flex; align-items: center; gap: 4px; margin-left: 8px;';
    
    // Audio indicator
    if (tab.audible) {
      const audioIcon = document.createElement('span');
      audioIcon.style.cssText = 'font-size: 12px;';
      audioIcon.textContent = '🔊';
      audioIcon.title = 'Tab has audio';
      indicators.appendChild(audioIcon);
    }
    
    // Active tab indicator
    if (tab.active) {
      const activeIcon = document.createElement('span');
      activeIcon.style.cssText = 'font-size: 10px; color: #1a73e8;';
      activeIcon.textContent = '●';
      activeIcon.title = 'Active tab';
      indicators.appendChild(activeIcon);
    }
    
    tabDiv.appendChild(favicon);
    tabDiv.appendChild(title);
    tabDiv.appendChild(indicators);
    
    // Click handler - attach to the tabDiv, not container
    tabDiv.addEventListener('click', () => this.handleTabSelection(tab));
    
    container.appendChild(tabDiv);
    return container;
  }
  
  /**
   * Handle tab selection
   */
  async handleTabSelection(tab) {
    try {
      console.log('Tab selected:', tab.id, tab.title);
      
      // Update selected tab
      this.selectedTabId = tab.id;
      
      // Update visual selection
      const tabItems = this.elements.tabList.querySelectorAll('.tab-item');
      tabItems.forEach(item => {
        const tabElement = item.querySelector ? item : item.querySelector('.tab-item') || item;
        const itemTabId = parseInt(tabElement.dataset?.tabId);
        
        if (itemTabId === tab.id) {
          tabElement.style.background = '#e8f0fe';
          tabElement.style.borderColor = '#1a73e8';
        } else {
          tabElement.style.background = '#ffffff';
          tabElement.style.borderColor = '#dadce0';
        }
      });
      
      // Create controls section if it doesn't exist
      if (!this.elements.controlsSection) {
        this.createStartStopButton();
      }
      
      // Show controls
      if (this.elements.controlsSection) {
        this.elements.controlsSection.style.display = 'block';
      }
      
      // Update current tab info
      if (this.elements.currentTabFavicon && this.elements.currentTabTitle) {
        this.elements.currentTabFavicon.src = tab.favIconUrl || '../icons/icon16.png';
        this.elements.currentTabTitle.textContent = tab.title || 'Untitled';
      }
      
      console.log('Tab selection updated, controls should now be visible');
      
    } catch (error) {
      console.error('Error selecting tab:', error);
    }
  }
  
  /**
   * Handle start/stop monitoring button
   */
  async handleStartStop() {
    try {
      this.elements.startStopBtn.disabled = true;
      this.elements.startStopBtn.textContent = 'Processing...';
      
      if (this.currentStatus && this.currentStatus.isMonitoring) {
        // Stop monitoring
        console.log('Stopping AutoMuting...');
        const response = await this.sendMessage({ type: 'STOP_MONITORING' });
        
        if (response.success) {
          console.log('AutoMuting stopped:', response.data);
        } else {
          throw new Error(response.error);
        }
      } else {
        // Start monitoring
        if (!this.selectedTabId) {
          alert('Please select a tab to AutoMute first');
          return;
        }
        
        console.log('Starting AutoMuting for tab:', this.selectedTabId);
        const response = await this.sendMessage({ 
          type: 'START_MONITORING', 
          tabId: this.selectedTabId 
        });
        
        if (response.success) {
          console.log('AutoMuting started:', response.data);
        } else {
          throw new Error(response.error);
        }
      }
      
      // Update status
      await this.updateStatus();
      
    } catch (error) {
      console.error('Failed to toggle AutoMuting:', error);
      alert(`Error: ${error.message}`);
    } finally {
      this.elements.startStopBtn.disabled = false;
    }
  }
  
  /**
   * Send message to background script
   */
  async sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { success: false, error: 'No response' });
      });
    });
  }
  
  /**
   * NEW: Create debugging interface section
   */
  createDebugInterface() {
    // Create debug section HTML
    const debugHtml = `
      <div id="debugSection" style="
        padding: 12px 16px;
        background: #f8f9fa;
        border-bottom: 1px solid #e8eaed;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        display: none;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="font-size: 12px; font-weight: 600; color: #202124; margin: 0;">🐛 Debug Info</h3>
          <button id="toggleDebug" style="
            background: none;
            border: 1px solid #dadce0;
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            cursor: pointer;
            color: #5f6368;
          ">Hide</button>
        </div>
        
        <!-- Site Information -->
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Site Info:</div>
          <div id="debugSiteUrl" style="color: #5f6368; word-break: break-all;">-</div>
          <div id="debugSiteCategory" style="color: #34a853; font-weight: bold;">-</div>
        </div>
        
        <!-- Current Classification -->
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Last Classification:</div>
          <div id="debugClassification" style="color: #ea4335; font-weight: bold; font-size: 13px;">-</div>
          <div id="debugConfidence" style="color: #fbbc04; font-weight: bold;">-</div>
          <div id="debugReasoning" style="color: #5f6368; margin-top: 2px;">-</div>
        </div>
        
        <!-- Performance Info -->
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Performance:</div>
          <div id="debugProcessingTime" style="color: #5f6368;">-</div>
          <div id="debugTokensUsed" style="color: #5f6368;">-</div>
          <div id="debugScreenshotCount" style="color: #5f6368;">-</div>
        </div>
        
        <!-- Audio State -->
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Audio Decision:</div>
          <div id="debugAudioAction" style="color: #34a853; font-weight: bold;">-</div>
          <div id="debugAudioReason" style="color: #5f6368; font-size: 10px;">-</div>
        </div>
        
        <!-- Rate Limiting -->
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Rate Limiting:</div>
          <div id="debugRateLimit" style="color: #5f6368;">-</div>
        </div>
        
        <!-- Timestamp -->
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Last Update:</div>
          <div id="debugTimestamp" style="color: #5f6368;">-</div>
        </div>
        
        <!-- Export Debug Data -->
        <button id="exportDebug" style="
          background: #1967d2;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 4px 8px;
          font-size: 10px;
          cursor: pointer;
          margin-top: 8px;
        ">Export Debug Data</button>
      </div>
    `;
    
    // Insert debug section after the header
    const header = document.querySelector('.header');
    if (header && header.parentNode) {
      const debugDiv = document.createElement('div');
      debugDiv.innerHTML = debugHtml;
      header.parentNode.insertBefore(debugDiv, header.nextSibling);
      
      // Store references
      this.elements.debugSection = document.getElementById('debugSection');
      this.elements.toggleDebug = document.getElementById('toggleDebug');
      this.elements.debugSiteUrl = document.getElementById('debugSiteUrl');
      this.elements.debugSiteCategory = document.getElementById('debugSiteCategory');
      this.elements.debugClassification = document.getElementById('debugClassification');
      this.elements.debugConfidence = document.getElementById('debugConfidence');
      this.elements.debugReasoning = document.getElementById('debugReasoning');
      this.elements.debugProcessingTime = document.getElementById('debugProcessingTime');
      this.elements.debugTokensUsed = document.getElementById('debugTokensUsed');
      this.elements.debugScreenshotCount = document.getElementById('debugScreenshotCount');
      this.elements.debugAudioAction = document.getElementById('debugAudioAction');
      this.elements.debugAudioReason = document.getElementById('debugAudioReason');
      this.elements.debugRateLimit = document.getElementById('debugRateLimit');
      this.elements.debugTimestamp = document.getElementById('debugTimestamp');
      this.elements.exportDebug = document.getElementById('exportDebug');
      
      // Add toggle functionality
      this.elements.toggleDebug.addEventListener('click', () => {
        const isVisible = this.elements.debugSection.style.display !== 'none';
        if (isVisible) {
          this.elements.debugSection.style.display = 'none';
          this.elements.toggleDebug.textContent = 'Show Debug';
        } else {
          this.elements.debugSection.style.display = 'block';
          this.elements.toggleDebug.textContent = 'Hide Debug';
        }
      });
      
      // Add export functionality
      this.elements.exportDebug.addEventListener('click', () => {
        this.exportDebugData();
      });
    }
  }

  /**
   * NEW: Update debugging information display
   */
  updateDebugInfo(currentTabUrl, currentSiteCategory, screenshotCount, lastClassification, rateLimitState) {
    if (!this.elements.debugSection) {
      this.createDebugInterface();
    }
    
    // Show debug section when monitoring
    this.elements.debugSection.style.display = 'block';
    
    // Update site information
    if (this.elements.debugSiteUrl) {
      this.elements.debugSiteUrl.textContent = currentTabUrl || 'Unknown URL';
    }
    
    if (this.elements.debugSiteCategory) {
      const categoryText = currentSiteCategory || 'general';
      const categoryColor = {
        'youtube': '#ff0000',
        'sportsStreaming': '#34a853', 
        'general': '#5f6368'
      }[categoryText] || '#5f6368';
      
      this.elements.debugSiteCategory.textContent = `Category: ${categoryText}`;
      this.elements.debugSiteCategory.style.color = categoryColor;
    }
    
    // Update classification information
    if (lastClassification) {
      if (this.elements.debugClassification) {
        const classText = lastClassification.classification.toUpperCase();
        const classColor = {
          'AD': '#ea4335',
          'GAME': '#34a853',
          'OTHER': '#1967d2'
        }[classText] || '#5f6368';
        
        this.elements.debugClassification.textContent = classText;
        this.elements.debugClassification.style.color = classColor;
      }
      
      if (this.elements.debugConfidence) {
        const confidence = lastClassification.confidence || 0;
        const confColor = confidence >= 75 ? '#34a853' : confidence >= 50 ? '#fbbc04' : '#ea4335';
        this.elements.debugConfidence.textContent = `Confidence: ${confidence}%`;
        this.elements.debugConfidence.style.color = confColor;
      }
      
      if (this.elements.debugReasoning) {
        this.elements.debugReasoning.textContent = lastClassification.reasoning || 'No reasoning provided';
      }
      
      if (this.elements.debugProcessingTime) {
        const procTime = lastClassification.processing_time || 0;
        this.elements.debugProcessingTime.textContent = `Processing: ${procTime.toFixed(2)}s`;
      }
      
      if (this.elements.debugTokensUsed) {
        const tokens = lastClassification.tokens_used || 'Unknown';
        this.elements.debugTokensUsed.textContent = `Tokens: ${tokens}`;
      }
      
      // Audio decision information
      if (this.elements.debugAudioAction) {
        const shouldMute = this.determineAudioAction(lastClassification, currentSiteCategory);
        this.elements.debugAudioAction.textContent = shouldMute.mute ? '🔇 MUTED' : '🔊 UNMUTED';
        this.elements.debugAudioAction.style.color = shouldMute.mute ? '#ea4335' : '#34a853';
      }
      
      if (this.elements.debugAudioReason) {
        const shouldMute = this.determineAudioAction(lastClassification, currentSiteCategory);
        this.elements.debugAudioReason.textContent = shouldMute.reason;
      }
      
      if (this.elements.debugTimestamp) {
        const timestamp = new Date(lastClassification.timestamp).toLocaleTimeString();
        this.elements.debugTimestamp.textContent = timestamp;
      }
    } else {
      // No classification yet
      if (this.elements.debugClassification) {
        this.elements.debugClassification.textContent = 'WAITING...';
        this.elements.debugClassification.style.color = '#5f6368';
      }
    }
    
    // Update screenshot count
    if (this.elements.debugScreenshotCount) {
      this.elements.debugScreenshotCount.textContent = `Screenshots: ${screenshotCount}`;
    }
    
    // Update rate limiting info
    if (this.elements.debugRateLimit && rateLimitState) {
      const backoff = rateLimitState.backoffMultiplier || 1;
      const failures = rateLimitState.consecutiveFailures || 0;
      this.elements.debugRateLimit.textContent = `Backoff: ${backoff}x (${failures} failures)`;
      this.elements.debugRateLimit.style.color = backoff > 1 ? '#ea4335' : '#34a853';
    }
  }

  /**
   * NEW: Determine what audio action should be taken (for debugging display)
   */
  determineAudioAction(classification, siteCategory) {
    const { classification: type, confidence } = classification;
    
    // YouTube: Binary logic
    if (siteCategory === 'youtube') {
      if (type === 'ad' && confidence >= 75) {
        return {
          mute: true,
          reason: `YouTube ad detected (${confidence}%)`
        };
      } else {
        return {
          mute: false,
          reason: `YouTube content: ${type} (${confidence}%)`
        };
      }
    }
    
    // Sports streaming: 3-way logic
    if (siteCategory === 'sportsStreaming') {
      switch (type) {
        case 'ad':
          return confidence >= 75 ? 
            { mute: true, reason: `Streaming ad (${confidence}%)` } :
            { mute: false, reason: `Low confidence ad (${confidence}%)` };
        case 'game':
          return confidence >= 70 ?
            { mute: false, reason: `Sports content (${confidence}%)` } :
            { mute: false, reason: `Low confidence game (${confidence}%)` };
        case 'other':
          return { mute: false, reason: `Other content (${confidence}%)` };
      }
    }
    
    // General sites: Video ad detection
    if (type === 'ad' && confidence >= 75) {
      return { mute: true, reason: `General site ad (${confidence}%)` };
    }
    
    return { mute: false, reason: `No mute action (${type}, ${confidence}%)` };
  }

  /**
   * NEW: Hide debugging information
   */
  hideDebugInfo() {
    if (this.elements.debugSection) {
      this.elements.debugSection.style.display = 'none';
    }
  }

  /**
   * NEW: Auto-refresh debugging information
   */
  startDebugRefresh() {
    setInterval(async () => {
      if (this.currentStatus && this.currentStatus.isMonitoring) {
        try {
          await this.updateStatus();
        } catch (error) {
          console.error('Failed to refresh debug info:', error);
        }
      }
    }, 2000); // Refresh every 2 seconds when monitoring
  }

  /**
   * NEW: Export debug data for troubleshooting
   */
  async exportDebugData() {
    try {
      const status = await this.sendMessage({ type: 'GET_STATUS' });
      const history = await this.sendMessage({ type: 'GET_HISTORY' });
      
      const debugData = {
        timestamp: new Date().toISOString(),
        status: status.data,
        classificationHistory: history.data,
        browserInfo: {
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          language: navigator.language
        }
      };
      
      // Copy to clipboard
      const dataString = JSON.stringify(debugData, null, 2);
      await navigator.clipboard.writeText(dataString);
      
      console.log('Debug data copied to clipboard:', debugData);
      alert('Debug data copied to clipboard!');
      
    } catch (error) {
      console.error('Failed to export debug data:', error);
    }
  }

  /**
   * NEW: Enhanced error display for debugging
   */
  showError(message, details = null) {
    console.error('Popup error:', message, details);
    
    // Create error display
    const errorHtml = `
      <div style="
        padding: 12px 16px;
        background: #fce8e6;
        border: 1px solid #ea4335;
        border-radius: 4px;
        margin: 16px;
        color: #d93025;
        font-size: 12px;
      ">
        <div style="font-weight: bold; margin-bottom: 4px;">⚠️ Error</div>
        <div>${message}</div>
        ${details ? `<div style="margin-top: 4px; font-family: monospace; font-size: 10px; color: #5f6368;">${details}</div>` : ''}
      </div>
    `;
    
    // Show error in main content
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
      mainContent.innerHTML = errorHtml;
    }
  }
}

// Initialize popup controller
const popupController = new PopupController();