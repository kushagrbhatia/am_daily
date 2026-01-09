import { CONFIG } from '../config/constants.js';

class PopupController {
  constructor() {
    this.currentStatus = null;
    this.selectedTabId = null;
    this.isInitialized = false;
    this.currentLogs = [];
    
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
      console.log('Initializing AutoMute popup with logging...');
      
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
      
      // Create classification display area (the green box!)
      this.createClassificationDisplay();
      
      // Create start/stop button
      this.createStartStopButton();
      
      // Create logs viewer
      this.createLogsViewer();
      
      // Test connections
      await this.testBackgroundConnection();
      await this.testBackendConnection();
      
      // Load current status
      await this.updateStatus();
      
      // Load tabs
      await this.loadTabs();
      
      // Set up auto-refresh
      this.startDebugRefresh();
      
      // Periodic status updates
      this.startPeriodicUpdates();
      
      this.isInitialized = true;
      console.log('AutoMute popup initialized successfully');
      
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.showError('Failed to initialize extension popup');
    }
  }

  /**
   * Create classification display (the green box!)
   */
  createClassificationDisplay() {
    const headerArea = document.querySelector('.header');
    
    if (!headerArea) {
      console.warn('Could not find header area for classification display');
      return;
    }
    
    const classificationHtml = `
      <div id="classificationDisplay" style="
        margin: 16px;
        padding: 16px;
        background: linear-gradient(135deg, #e8f5e9 0%, #f1f8e9 100%);
        border: 2px solid #4caf50;
        border-radius: 8px;
        min-height: 60px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        box-shadow: 0 2px 8px rgba(76, 175, 80, 0.2);
        font-weight: bold;
      ">
        <div style="display: flex; align-items: center; gap: 8px; width: 100%; justify-content: center;">
          <span id="classificationEmoji" style="font-size: 24px;">👁️</span>
          <div style="text-align: center;">
            <div id="classificationText" style="
              font-size: 16px;
              color: #2e7d32;
              font-weight: bold;
              min-height: 24px;
            ">Waiting for classification...</div>
            <div id="confidenceText" style="
              font-size: 12px;
              color: #558b2f;
              margin-top: 4px;
              min-height: 18px;
            ">---</div>
          </div>
        </div>
      </div>
    `;
    
    const classificationDiv = document.createElement('div');
    classificationDiv.innerHTML = classificationHtml;
    headerArea.parentNode.insertBefore(classificationDiv, headerArea.nextSibling);
    
    this.elements = { ...this.elements,
      classificationDisplay: document.getElementById('classificationDisplay'),
      classificationText: document.getElementById('classificationText'),
      classificationEmoji: document.getElementById('classificationEmoji'),
      confidenceText: document.getElementById('confidenceText')
    };
  }

  /**
   * Update classification display
   */
  updateClassificationDisplay(classification) {
    if (!this.elements.classificationText || !this.currentStatus?.isMonitoring) {
      return;
    }
    
    const { classification: type, confidence } = classification;
    
    // Set emoji based on classification
    const emojis = {
      'ad': '📢',
      'game': '🎮',
      'other': '👁️'
    };
    
    this.elements.classificationEmoji.textContent = emojis[type] || '👁️';
    
    // Set color based on confidence
    let color = '#2e7d32'; // Green for high confidence
    if (confidence < CONFIG.CONFIDENCE_THRESHOLD_AD) {
      color = '#f57c00'; // Orange for medium confidence
    }
    
    this.elements.classificationText.textContent = `${type.toUpperCase()}`;
    this.elements.classificationText.style.color = color;
    
    this.elements.confidenceText.textContent = `Confidence: ${confidence}% (Threshold: ${CONFIG.CONFIDENCE_THRESHOLD_AD}%)`;
    this.elements.confidenceText.style.color = color;
    
    // Also update the background color based on what action was taken
    if (this.currentStatus.lastClassification?.shouldMute) {
      this.elements.classificationDisplay.style.background = 'linear-gradient(135deg, #ffebee 0%, #ffcdd2 100%)';
      this.elements.classificationDisplay.style.borderColor = '#f44336';
      this.elements.classificationEmoji.textContent = '🔇';
      this.elements.classificationText.style.color = '#c62828';
      this.elements.confidenceText.style.color = '#c62828';
    }
  }

  /**
   * Create logs viewer
   */
  createLogsViewer() {
    const logsHtml = `
      <div id="logsSection" style="padding: 16px; border-bottom: 1px solid #e8eaed; display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h2 style="font-size: 14px; font-weight: 500; color: #202124; margin: 0;">📋 Logs</h2>
          <div style="display: flex; gap: 6px;">
            <button id="toggleLogs" style="background: none; border: 1px solid #dadce0; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;">Hide</button>
            <button id="clearLogsBtn" style="background: none; border: 1px solid #dadce0; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;">Clear</button>
            <button id="exportLogsBtn" style="background: #1967d2; color: white; border: 1px solid #1967d2; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer;">Export</button>
          </div>
        </div>
        
        <div id="logsContainer" style="
          max-height: 300px;
          overflow-y: auto;
          background: #f8f9fa;
          border-radius: 4px;
          padding: 8px;
          font-family: 'Courier New', monospace;
          font-size: 10px;
          line-height: 1.4;
          border: 1px solid #e8eaed;
        ">
          <div style="color: #5f6368; text-align: center; padding: 20px;">
            No logs yet. Start monitoring to see logs.
          </div>
        </div>
        
        <div style="margin-top: 8px; font-size: 10px; color: #5f6368;">
          <span id="logsCount">0 logs</span> | 
          <span id="logsUpdated">Not updated</span>
        </div>
      </div>
    `;
    
    const tabList = document.getElementById('tabList');
    if (tabList?.parentNode) {
      const logsDiv = document.createElement('div');
      logsDiv.innerHTML = logsHtml;
      tabList.parentNode.insertBefore(logsDiv, tabList.nextSibling);
      
      this.elements = { ...this.elements,
        logsSection: document.getElementById('logsSection'),
        logsContainer: document.getElementById('logsContainer'),
        toggleLogs: document.getElementById('toggleLogs'),
        clearLogsBtn: document.getElementById('clearLogsBtn'),
        exportLogsBtn: document.getElementById('exportLogsBtn'),
        logsCount: document.getElementById('logsCount'),
        logsUpdated: document.getElementById('logsUpdated')
      };
      
      this.elements.toggleLogs.addEventListener('click', () => {
        const isVisible = this.elements.logsSection.style.display !== 'none';
        this.elements.logsSection.style.display = isVisible ? 'none' : 'block';
        this.elements.toggleLogs.textContent = isVisible ? 'Show' : 'Hide';
      });
      
      this.elements.clearLogsBtn.addEventListener('click', () => this.clearLogs());
      this.elements.exportLogsBtn.addEventListener('click', () => this.exportLogs());
    }
  }

  /**
   * Update logs display
   */
  async updateLogsDisplay() {
    try {
      const response = await this.sendMessage({ type: 'GET_LOGS' });
      
      if (!response.success || !response.data) {
        return;
      }
      
      this.currentLogs = response.data;
      
      if (this.currentLogs.length === 0) {
        this.elements.logsContainer.innerHTML = '<div style="color: #5f6368; text-align: center; padding: 20px;">No logs yet.</div>';
        return;
      }
      
      // Show logs
      let html = '';
      for (let i = 0; i < Math.min(50, this.currentLogs.length); i++) {
        const log = this.currentLogs[i];
        const emoji = {
          'info': 'ℹ️',
          'warn': '⚠️',
          'error': '❌',
          'debug': '🐛',
          'success': '✅'
        }[log.level] || '📝';
        
        const dataStr = log.data ? ` ${JSON.stringify(log.data)}` : '';
        html += `<div style="color: #5f6368; margin-bottom: 2px;">${emoji} [${log.level.toUpperCase()}] ${log.message}${dataStr}</div>`;
      }
      
      this.elements.logsContainer.innerHTML = html;
      this.elements.logsCount.textContent = `${this.currentLogs.length} logs`;
      this.elements.logsUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
      
    } catch (error) {
      console.error('Failed to update logs:', error);
    }
  }

  /**
   * Clear logs
   */
  async clearLogs() {
    if (!confirm('Clear all logs?')) return;
    
    try {
      await this.sendMessage({ type: 'CLEAR_LOGS' });
      this.currentLogs = [];
      this.elements.logsContainer.innerHTML = '<div style="color: #5f6368; text-align: center; padding: 20px;">Logs cleared.</div>';
      this.elements.logsCount.textContent = '0 logs';
    } catch (error) {
      console.error('Failed to clear logs:', error);
    }
  }

  /**
   * Export logs to file
   */
  async exportLogs() {
    try {
      const response = await this.sendMessage({ type: 'EXPORT_LOGS' });
      
      if (!response.success || !response.data) {
        alert('No logs to export');
        return;
      }
      
      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `automute-logs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log('Logs exported successfully');
    } catch (error) {
      console.error('Failed to export logs:', error);
      alert('Failed to export logs');
    }
  }

  /**
   * Create start/stop monitoring button
   */
  createStartStopButton() {
    const controlsHtml = `
      <div id="controlsSection" style="padding: 16px; border-bottom: 1px solid #e8eaed; display: none;">
        <h2 style="font-size: 14px; font-weight: 500; margin-bottom: 12px; color: #202124;">Monitoring Controls</h2>
        <button id="startStopBtn" style="width: 100%; padding: 8px 16px; border: 1px solid #1a73e8; border-radius: 4px; background: #1a73e8; color: white; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s ease;">Start AutoMuting</button>
        <div id="currentTabInfo" style="margin-top: 12px; padding: 8px 12px; background: #f8f9fa; border-radius: 4px; border: 1px solid #e8eaed; display: none;">
          <div style="display: flex; align-items: center;">
            <img id="currentTabFavicon" style="width: 16px; height: 16px; margin-right: 8px;" src="" alt="">
            <span id="currentTabTitle" style="font-size: 12px; color: #202124;">No tab selected</span>
          </div>
        </div>
      </div>
    `;
    const tabList = document.getElementById('tabList');
    if (tabList?.parentNode) {
      const controlsDiv = document.createElement('div');
      controlsDiv.innerHTML = controlsHtml;
      tabList.parentNode.insertBefore(controlsDiv, tabList.nextSibling);
      this.elements = { ...this.elements,
        controlsSection: document.getElementById('controlsSection'),
        startStopBtn: document.getElementById('startStopBtn'),
        currentTabInfo: document.getElementById('currentTabInfo'),
        currentTabFavicon: document.getElementById('currentTabFavicon'),
        currentTabTitle: document.getElementById('currentTabTitle')
      };
      this.elements.startStopBtn.addEventListener('click', this.handleStartStop);
    }
  }
  
  /**
   * Test background script connection
   */
  async testBackgroundConnection() {
    try {
      const response = await this.sendMessage({ type: 'GET_STATUS' });
      if (response.success) {
        this.elements.extensionStatus.textContent = 'Connected';
        this.elements.extensionStatus.className = 'info-value connected';
      } else {
        throw new Error('Background script returned error');
      }
    } catch (error) {
      this.elements.extensionStatus.textContent = 'Error';
      this.elements.extensionStatus.className = 'info-value error';
    }
  }
  
  /**
   * Test backend API connection
   */
  async testBackendConnection() {
    try {
      const healthUrl = CONFIG.API_BASE_URL.replace('/api', '') + '/health';
      const response = await fetch(healthUrl);
      if (response.ok) {
        this.elements.backendStatus.textContent = 'Connected';
        this.elements.backendStatus.className = 'info-value connected';
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
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
   * Update UI based on current status
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
      logsCount
    } = this.currentStatus;
    
    // Update status indicator
    this.elements.statusDot.className = isMonitoring ? 'status-dot monitoring' : 'status-dot idle';
    this.elements.statusText.textContent = isMonitoring ? 'AutoMuting' : 'Idle';
    
    // Update button
    if (this.elements.startStopBtn) {
      this.elements.startStopBtn.textContent = isMonitoring ? 'Stop AutoMuting' : 'Start AutoMuting';
      this.elements.startStopBtn.style.background = isMonitoring ? '#ea4335' : '#1a73e8';
      this.elements.startStopBtn.style.borderColor = isMonitoring ? '#ea4335' : '#1a73e8';
    }
    
    // Update current tab info
    if (this.elements.currentTabInfo) {
      this.elements.currentTabInfo.style.display = isMonitoring ? 'block' : 'none';
      if(isMonitoring) this.updateCurrentTabDisplay(currentTabId);
    }
    
    // Update audio indicator
    this.updateAudioStatusIndicator(audioState, isMonitoring);

    // Update classification display if monitoring
    if (isMonitoring && lastClassification) {
      this.updateClassificationDisplay(lastClassification);
      this.elements.logsSection.style.display = 'block';
    } else {
      if (this.elements.classificationText) {
        this.elements.classificationText.textContent = 'Waiting for classification...';
        this.elements.classificationEmoji.textContent = '👁️';
        this.elements.confidenceText.textContent = '---';
      }
      if (this.elements.logsSection) {
        this.elements.logsSection.style.display = 'none';
      }
    }

    // Update logs display if monitoring
    if (isMonitoring) {
      this.updateLogsDisplay();
    }
  }
  
  /**
   * Update audio status indicator
   */
  updateAudioStatusIndicator(audioState, isMonitoring) {
    if (!this.elements.audioStatus || !this.elements.audioStatusText) return;
    if (!isMonitoring || !audioState) {
      this.elements.audioStatus.className = 'audio-status unknown';
      this.elements.audioStatusText.textContent = 'Unknown';
      return;
    }
    this.elements.audioStatus.className = audioState.muted ? 'audio-status muted' : 'audio-status unmuted';
    this.elements.audioStatusText.textContent = audioState.muted ? 'Muted' : 'Unmuted';
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
   * Load list of monitorable tabs
   */
  async loadTabs() {
    try {
      this.elements.tabLoading.style.display = 'block';
      const response = await this.sendMessage({ type: 'GET_TABS' });
      if (!response.success) throw new Error(response.error);
      const tabs = response.data;
      this.elements.tabLoading.style.display = 'none';
      this.elements.tabList.innerHTML = '';
      
      if (tabs.length === 0) {
        this.elements.tabList.innerHTML = '<div class="no-tabs">No monitorable tabs found</div>';
        return;
      }
      
      let currentWindowId = null;
      tabs.slice(0, 15).forEach(tab => {
        const isFirstInWindow = tab.windowId !== currentWindowId;
        const tabElement = this.createTabElement(tab, isFirstInWindow);
        this.elements.tabList.appendChild(tabElement);
        currentWindowId = tab.windowId;
      });
      
    } catch (error) {
      console.error('Failed to load tabs:', error);
      this.elements.tabLoading.textContent = 'Failed to load tabs';
    }
  }

  /**
   * Create tab element for display
   */
  createTabElement(tab, isFirstInWindow = false) {
    const container = document.createElement('div');
    if (isFirstInWindow && tab.windowId) {
        const windowSeparator = document.createElement('div');
        windowSeparator.className = 'window-separator';
        windowSeparator.textContent = `Window ${tab.windowId}`;
        container.appendChild(windowSeparator);
    }
    
    const tabDiv = document.createElement('div');
    tabDiv.className = 'tab-item';
    tabDiv.dataset.tabId = tab.id;
    
    const favicon = document.createElement('img');
    favicon.src = tab.favIconUrl || '../icons/icon16.png';
    favicon.style.width = '16px';
    favicon.style.height = '16px';
    favicon.style.marginRight = '8px';

    const title = document.createElement('div');
    title.textContent = tab.title || 'Loading...';
    title.style.whiteSpace = 'nowrap';
    title.style.overflow = 'hidden';
    title.style.textOverflow = 'ellipsis';
    
    tabDiv.appendChild(favicon);
    tabDiv.appendChild(title);
    tabDiv.addEventListener('click', () => this.handleTabSelection(tab));
    
    container.appendChild(tabDiv);
    return container;
  }
  
  /**
   * Handle tab selection
   */
  async handleTabSelection(tab) {
    this.selectedTabId = tab.id;
    document.querySelectorAll('.tab-item').forEach(item => {
      item.style.background = parseInt(item.dataset.tabId) === tab.id ? '#e8f0fe' : '#ffffff';
    });
    if (this.elements.controlsSection) this.elements.controlsSection.style.display = 'block';
    if (this.elements.currentTabTitle) this.elements.currentTabTitle.textContent = tab.title || 'Untitled';
    if (this.elements.currentTabFavicon) this.elements.currentTabFavicon.src = tab.favIconUrl || '../icons/icon16.png';
  }
  
  /**
   * Handle start/stop monitoring button
   */
  async handleStartStop() {
    try {
      if (this.currentStatus && this.currentStatus.isMonitoring) {
        await this.sendMessage({ type: 'STOP_MONITORING' });
      } else {
        if (!this.selectedTabId) {
          alert('Please select a tab to monitor.');
          return;
        }
        await this.sendMessage({ type: 'START_MONITORING', tabId: this.selectedTabId });
      }
      await this.updateStatus();
    } catch (error) {
      console.error('Failed to toggle monitoring:', error);
    }
  }

  /**
   * Start debug refresh interval
   */
  startDebugRefresh() {
    setInterval(() => {
      if (this.currentStatus && this.currentStatus.isMonitoring) {
        this.updateStatus();
      }
    }, 2000);
  }

  /**
   * Start periodic status updates
   */
  startPeriodicUpdates() {
    setInterval(() => {
      this.updateStatus();
    }, 3000);
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
   * Show error message
   */
  showError(message) {
    console.error('Popup error:', message);
    alert(`Error: ${message}`);
  }
}

const popupController = new PopupController();