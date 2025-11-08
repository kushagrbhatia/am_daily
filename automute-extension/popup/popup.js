import { CONFIG } from '../config/constants.js';

class PopupController {
  constructor() {
    this.currentStatus = null;
    this.selectedTabId = null;
    this.isInitialized = false;
    this.spotifyStatus = null;
    
    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.loadTabs = this.loadTabs.bind(this);
    this.updateStatus = this.updateStatus.bind(this);
    this.handleTabSelection = this.handleTabSelection.bind(this);
    this.handleStartStop = this.handleStartStop.bind(this);
    this.handleSpotifyLogin = this.handleSpotifyLogin.bind(this);
    this.handleSpotifyLogout = this.handleSpotifyLogout.bind(this);
    this.updateSpotifyStatus = this.updateSpotifyStatus.bind(this);
    
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
      console.log('Initializing AutoMute popup with Spotify support...');
      
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
      
      // Create Spotify section first (in the circled area)
      this.createSpotifySection();
      
      // Add start/stop button to the popup
      this.createStartStopButton();
      
      // Create debugging interface
      this.createDebugInterface();
      
      // Test connections
      await this.testBackgroundConnection();
      await this.testBackendConnection();
      
      // Load current status
      await this.updateStatus();
      
      // Load Spotify status
      await this.updateSpotifyStatus();
      
      // Load tabs
      await this.loadTabs();
      
      // Set up auto-refresh for debugging
      this.startDebugRefresh();
      
      // Start periodic updates for Spotify
      this.startPeriodicUpdates();
      
      this.isInitialized = true;
      console.log('AutoMute popup initialized successfully with Spotify and debugging');
      
    } catch (error) {
      console.error('Failed to initialize popup:', error);
      this.showError('Failed to initialize extension popup');
    }
  }

  // ===================================================================
  // ===== CORRECTED AND INTEGRATED SPOTIFY LOGIC ======================
  // ===================================================================

  async handleSpotifyLogin() {
    try {
      console.log('🎵 Starting Spotify OAuth login...');
      this.showSpotifyLoading(true);

      const redirectUri = chrome.identity.getRedirectURL();
      const authParams = new URLSearchParams({
        client_id: CONFIG.SPOTIFY.CLIENT_ID,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: CONFIG.SPOTIFY.SCOPES,
        show_dialog: 'true',
        state: this.generateRandomString(16)
      });
      const authUrl = `${CONFIG.SPOTIFY.AUTH_URL}?${authParams.toString()}`;

      const redirectUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message || 'OAuth flow failed.'));
          }
          if (!responseUrl) {
            return reject(new Error('User cancelled login.'));
          }
          resolve(responseUrl);
        });
      });

      const authCode = this.extractAuthCodeFromUrl(redirectUrl);
      if (!authCode) throw new Error('Authorization code not found in response.');
      
      const response = await this.sendMessage({ type: 'SPOTIFY_LOGIN', code: authCode });
      if (!response.success) throw new Error(response.error || 'Background script failed to log in.');
      
      console.log('✅ Login successful. Updating UI.');
      await this.updateSpotifyStatus();

    } catch (error) {
      if (error.message.includes('User cancelled')) {
         console.log('User cancelled Spotify login.');
      } else {
          console.error('❌ Spotify login failed:', error);
          this.showSpotifyError(error.message);
      }
    } finally {
      this.showSpotifyLoading(false);
    }
  }
  
  async handleSpotifyLogout() {
    try {
      console.log('Logging out of Spotify...');
      await this.sendMessage({ type: 'SPOTIFY_LOGOUT' });
      this.showSpotifyDisconnected();
      console.log('Spotify logout successful');
    } catch (error) {
      console.error('Error during Spotify logout:', error);
    }
  }

  async updateSpotifyStatus() {
    try {
      const response = await this.sendMessage({ type: 'SPOTIFY_GET_STATUS' });
      if (response.success && response.data?.auth?.isAuthenticated) {
        this.spotifyStatus = response.data;
        this.showSpotifyConnected();
      } else {
        this.showSpotifyDisconnected();
      }
    } catch (error) {
      console.error('Error updating Spotify status:', error);
      this.showSpotifyDisconnected();
    }
  }
  
  showSpotifyLoading(show) {
    if (this.elements.spotifyLoading) this.elements.spotifyLoading.style.display = show ? 'block' : 'none';
    if (this.elements.spotifyDisconnected) this.elements.spotifyDisconnected.style.display = show ? 'none' : 'block';
    if (this.elements.spotifyConnected) this.elements.spotifyConnected.style.display = 'none';
    if (this.elements.spotifyError) this.elements.spotifyError.style.display = 'none';
  }

  showSpotifyConnected() {
    if (!this.elements.spotifyConnected) return;
    this.elements.spotifyDisconnected.style.display = 'none';
    this.elements.spotifyConnected.style.display = 'block';
    this.elements.spotifyError.style.display = 'none';
    this.elements.spotifyLoading.style.display = 'none';
    
    const user = this.spotifyStatus?.auth?.user;
    if (user) {
      this.elements.spotifyUserName.textContent = `Connected as ${user.display_name}`;
    }

    const track = this.spotifyStatus?.currentPlayback?.track;
    if (track) {
      this.elements.currentTrack.textContent = `${track.name} - ${track.artists[0].name}`;
    } else {
      this.elements.currentTrack.textContent = 'No track playing';
    }
  }

  showSpotifyDisconnected() {
    if (!this.elements.spotifyDisconnected) return;
    this.elements.spotifyDisconnected.style.display = 'block';
    this.elements.spotifyConnected.style.display = 'none';
    this.elements.spotifyError.style.display = 'none';
    this.elements.spotifyLoading.style.display = 'none';
  }

  showSpotifyError(errorMessage) {
    if (this.elements.spotifyError) {
      this.elements.spotifyError.style.display = 'block';
      const errorMessageEl = document.getElementById('spotifyErrorMessage');
      if (errorMessageEl) {
        errorMessageEl.textContent = errorMessage || 'Failed to connect to Spotify';
      }
    }
    this.showSpotifyLoading(false);
  }

  extractAuthCodeFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');
      const error = urlObj.searchParams.get('error');
      if (error) throw new Error(`OAuth error: ${error}`);
      return code;
    } catch (error) {
      console.error('❌ Error extracting auth code from URL:', error);
      return null;
    }
  }

  // ===================================================================
  // ===== ALL YOUR ORIGINAL FUNCTIONS (UNCHANGED AND INTACT) ==========
  // ===================================================================
  
  generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  handleAutoPlayToggle(event) {
    const enabled = event.target.checked;
    console.log('Auto-play toggle changed to:', enabled);
    
    // Send message to background to update music enabled state
    this.sendMessage({ 
      type: 'TOGGLE_MUSIC_ENABLED', 
      enabled: enabled 
    }).then(response => {
      if (response.success) {
        console.log('✅ Music enabled state updated:', response.data);
      } else {
        console.error('❌ Failed to update music state:', response.error);
      }
    }).catch(error => {
      console.error('❌ Error sending toggle message:', error);
    });
  }

    // ============================================================================
  // STEP 1: Update your handleMusicPlayPause in popup.js
  // ============================================================================

  async handleMusicPlayPause() {
    try {
      console.log('🎵 Play/Pause clicked');
      
      // Get stored Spotify token
      const result = await chrome.storage.local.get(['spotify_access_token', 'spotify_token_type']);
      
      if (!result.spotify_access_token) {
        alert('Not connected to Spotify. Please connect first.');
        return;
      }
      
      // Get current playback state
      const playbackResponse = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          'Authorization': `${result.spotify_token_type || 'Bearer'} ${result.spotify_access_token}`
        }
      });
      
      if (playbackResponse.status === 204) {
        alert('No active Spotify device found. Please open Spotify and start playing something.');
        return;
      }
      
      if (!playbackResponse.ok) {
        throw new Error(`Spotify API error: ${playbackResponse.status}`);
      }
      
      const playback = await playbackResponse.json();
      const isPlaying = playback.is_playing;
      
      // Toggle play/pause
      const endpoint = isPlaying ? 
        'https://api.spotify.com/v1/me/player/pause' : 
        'https://api.spotify.com/v1/me/player/play';
      
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: {
          'Authorization': `${result.spotify_token_type || 'Bearer'} ${result.spotify_access_token}`
        }
      });
      
      if (response.ok || response.status === 204) {
        console.log(`✅ ${isPlaying ? 'Paused' : 'Playing'}`);
        
        // Update button text
        if (this.elements.musicPlayPause) {
          this.elements.musicPlayPause.textContent = isPlaying ? '▶ Play' : '⏸ Pause';
        }
        
        // Refresh current track display
        setTimeout(() => this.updateCurrentTrack(), 500);
      } else {
        throw new Error(`Failed to ${isPlaying ? 'pause' : 'play'}: ${response.status}`);
      }
      
    } catch (error) {
      console.error('❌ Play/Pause failed:', error);
      alert(`Failed to control playback: ${error.message}`);
    }
  }

  // ============================================================================
  // STEP 2: Update your handleMusicSkip in popup.js
  // ============================================================================

  async handleMusicSkip() {
    try {
      console.log('⏭ Skip clicked');
      
      // Get stored Spotify token
      const result = await chrome.storage.local.get(['spotify_access_token', 'spotify_token_type']);
      
      if (!result.spotify_access_token) {
        alert('Not connected to Spotify. Please connect first.');
        return;
      }
      
      // Skip to next track
      const response = await fetch('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: {
          'Authorization': `${result.spotify_token_type || 'Bearer'} ${result.spotify_access_token}`
        }
      });
      
      if (response.ok || response.status === 204) {
        console.log('✅ Skipped to next track');
        
        // Wait a moment for Spotify to update, then refresh display
        setTimeout(() => this.updateCurrentTrack(), 1000);
      } else if (response.status === 404) {
        alert('No active Spotify device found. Please open Spotify and start playing something.');
      } else {
        throw new Error(`Failed to skip: ${response.status}`);
      }
      
    } catch (error) {
      console.error('❌ Skip failed:', error);
      alert(`Failed to skip track: ${error.message}`);
    }
  }

  // ============================================================================
  // STEP 3: Update your handleVolumeChange in popup.js
  // ============================================================================

  async handleVolumeChange(event) {
    try {
      const volume = parseInt(event.target.value);
      console.log('🔊 Volume changed to:', volume);
      
      // Get stored Spotify token
      const result = await chrome.storage.local.get(['spotify_access_token', 'spotify_token_type']);
      
      if (!result.spotify_access_token) {
        console.warn('Not connected to Spotify');
        return;
      }
      
      // Set volume (0-100)
      const response = await fetch(`https://api.spotify.com/v1/me/player/volume?volume_percent=${volume}`, {
        method: 'PUT',
        headers: {
          'Authorization': `${result.spotify_token_type || 'Bearer'} ${result.spotify_access_token}`
        }
      });
      
      if (response.ok || response.status === 204) {
        console.log(`✅ Volume set to ${volume}%`);
      } else if (response.status === 404) {
        console.warn('No active Spotify device found');
      } else {
        console.error(`Failed to set volume: ${response.status}`);
      }
      
    } catch (error) {
      console.error('❌ Volume change failed:', error);
    }
  }

  // ============================================================================
  // STEP 4: Add a method to update the current track display
  // ============================================================================

  async updateCurrentTrack() {
    try {
      // Get stored Spotify token
      const result = await chrome.storage.local.get(['spotify_access_token', 'spotify_token_type']);
      
      if (!result.spotify_access_token) {
        return;
      }
      
      // Get current playback
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: {
          'Authorization': `${result.spotify_token_type || 'Bearer'} ${result.spotify_access_token}`
        }
      });
      
      if (response.status === 204 || !response.ok) {
        // No active playback
        if (this.elements.currentTrack) {
          this.elements.currentTrack.textContent = 'No track playing';
        }
        if (this.elements.musicPlayPause) {
          this.elements.musicPlayPause.textContent = '▶ Play';
        }
        return;
      }
      
      const playback = await response.json();
      
      // Update current track display
      if (this.elements.currentTrack && playback.item) {
        const trackName = playback.item.name;
        const artistName = playback.item.artists.map(a => a.name).join(', ');
        this.elements.currentTrack.textContent = `${trackName} - ${artistName}`;
        this.elements.currentTrack.title = `${trackName} - ${artistName}`; // Full text in tooltip
      }
      
      // Update play/pause button
      if (this.elements.musicPlayPause) {
        this.elements.musicPlayPause.textContent = playback.is_playing ? '⏸ Pause' : '▶ Play';
      }
      
      // Update volume slider
      if (this.elements.musicVolume && playback.device) {
        this.elements.musicVolume.value = playback.device.volume_percent || 70;
      }
      
    } catch (error) {
      console.error('Failed to update current track:', error);
    }
  }

  // ============================================================================
  // STEP 5: Update startPeriodicUpdates to refresh current track
  // ============================================================================

  startPeriodicUpdates() {
    console.log('Starting periodic updates for Spotify');
    
    // Update status every 5 seconds
    setInterval(() => {
      this.updateStatus();
    }, 5000);
    
    // Update current track every 3 seconds
    setInterval(() => {
      if (this.elements.spotifyConnected && 
          this.elements.spotifyConnected.style.display !== 'none') {
        this.updateCurrentTrack();
      }
    }, 3000);
  }

  // ============================================================================
  // STEP 6: Call updateCurrentTrack when showing connected state
  // ============================================================================

  showSpotifyConnected() {
    if (this.elements.spotifyDisconnected) {
      this.elements.spotifyDisconnected.style.display = 'none';
    }
    if (this.elements.spotifyConnected) {
      this.elements.spotifyConnected.style.display = 'block';
    }
    if (this.elements.spotifyLoading) {
      this.elements.spotifyLoading.style.display = 'none';
    }
    if (this.elements.spotifyError) {
      this.elements.spotifyError.style.display = 'none';
    }
    
    // Show the Spotify section (in case it was hidden)
    if (this.elements.spotifySection) {
      this.elements.spotifySection.style.display = 'block';
    }
    
    // Update current track immediately
    this.updateCurrentTrack();
  }

  // ============================================================================
  // STEP 7: Handle token expiration gracefully
  // ============================================================================

  async makeSpotifyRequest(url, options = {}) {
    try {
      // Get stored Spotify token
      const result = await chrome.storage.local.get([
        'spotify_access_token', 
        'spotify_token_type',
        'spotify_expires_at'
      ]);
      
      if (!result.spotify_access_token) {
        throw new Error('Not connected to Spotify');
      }
      
      // Check if token is expired
      if (result.spotify_expires_at && Date.now() >= result.spotify_expires_at) {
        console.log('Token expired, please reconnect');
        this.showSpotifyError('Session expired. Please reconnect to Spotify.');
        await this.handleSpotifyLogout();
        throw new Error('Token expired');
      }
      
      // Make request with token
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `${result.spotify_token_type || 'Bearer'} ${result.spotify_access_token}`,
          'Content-Type': 'application/json',
          ...options.headers
        }
      });
      
      // Handle token expiration (401)
      if (response.status === 401) {
        console.log('Token invalid, please reconnect');
        this.showSpotifyError('Session expired. Please reconnect to Spotify.');
        await this.handleSpotifyLogout();
        throw new Error('Token invalid');
      }
      
      return response;
      
    } catch (error) {
      console.error('Spotify API request failed:', error);
      throw error;
    }
  }

  // ============================================================================
  // STEP 8: Simplified versions using the helper method
  // ============================================================================

  // Replace your handleMusicPlayPause with this simpler version:
  async handleMusicPlayPauseSimple() {
    try {
      // Get current state
      const response = await this.makeSpotifyRequest('https://api.spotify.com/v1/me/player');
      
      if (response.status === 204) {
        alert('No active Spotify device. Please open Spotify and play something.');
        return;
      }
      
      const playback = await response.json();
      const endpoint = playback.is_playing ? 
        'https://api.spotify.com/v1/me/player/pause' : 
        'https://api.spotify.com/v1/me/player/play';
      
      await this.makeSpotifyRequest(endpoint, { method: 'PUT' });
      
      setTimeout(() => this.updateCurrentTrack(), 500);
      
    } catch (error) {
      console.error('Play/Pause failed:', error);
      alert(`Playback control failed: ${error.message}`);
    }
  }

// ============================================================================
// DEBUGGING: Add console commands to test
// ============================================================================

// You can test these in the browser console:
/*
// Test getting current playback
chrome.storage.local.get(['spotify_access_token', 'spotify_token_type'], async (result) => {
  const response = await fetch('https://api.spotify.com/v1/me/player', {
    headers: { 'Authorization': `${result.spotify_token_type} ${result.spotify_access_token}` }
  });
  console.log('Status:', response.status);
  if (response.ok) {
    const data = await response.json();
    console.log('Playback:', data);
  }
});

// Test pause
chrome.storage.local.get(['spotify_access_token', 'spotify_token_type'], async (result) => {
  const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: { 'Authorization': `${result.spotify_token_type} ${result.spotify_access_token}` }
  });
  console.log('Pause status:', response.status);
});
*/

// ============================================================================
// COMMON ISSUES AND SOLUTIONS
// ============================================================================

/*
ISSUE 1: "No active device" error
SOLUTION: Make sure Spotify desktop app or web player is open and has played 
         something at least once

ISSUE 2: Controls work but with delay
SOLUTION: This is normal - Spotify API can have 1-2 second latency

ISSUE 3: Volume control doesn't work
SOLUTION: Some Spotify devices (like phones) don't allow remote volume control
         Try using the desktop app

ISSUE 4: Token expires quickly
SOLUTION: Implicit flow tokens expire in 1 hour. You'll need to reconnect.
         Consider implementing token refresh in the background script.

ISSUE 5: 403 Forbidden error
SOLUTION: Make sure your Spotify app has the correct scopes enabled:
         - user-read-playback-state
         - user-modify-playback-state
         - user-read-currently-playing
*/

  handleVolumeChange(event) {
    console.log('Volume changed to:', event.target.value);
  }

  startPeriodicUpdates() {
    setInterval(() => {
      this.updateStatus();
    }, 5000);
  }

  startDebugRefresh() {
    setInterval(() => {
      if (this.currentStatus && this.currentStatus.isMonitoring) {
        this.updateStatus();
      }
    }, 2000);
  }

  exportDebugData() {
    const debugData = {
      currentStatus: this.currentStatus,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent
    };
    
    const blob = new Blob([JSON.stringify(debugData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `automute-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  hideDebugInfo() {
    if (this.elements.debugSection) {
      this.elements.debugSection.style.display = 'none';
    }
  }

  determineAudioAction(classification, siteCategory) {
    if (classification.classification === 'ad') {
      return { mute: true, reason: 'Advertisement detected' };
    } else {
      return { mute: false, reason: 'Content is not an ad' };
    }
  }

  async sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        resolve(response || { success: false, error: 'No response' });
      });
    });
  }

  showError(message) {
    console.error('Popup error:', message);
    alert(`Error: ${message}`);
  }
  
  createSpotifySection() {
    const headerArea = document.querySelector('.header') || document.querySelector('h1')?.parentElement;
    
    if (!headerArea) {
      console.warn('Could not find header area, adding Spotify section after title');
      const title = document.querySelector('h1') || document.querySelector('.title');
      if (title) this.insertSpotifySection(title);
      return;
    }
    
    this.insertSpotifySection(headerArea);
  }
  
  insertSpotifySection(insertAfter) {
    const spotifyHtml = `
      <div id="spotifySection" style="margin: 16px 0; padding: 16px; background: #f8f9fa; border-radius: 8px; border: 1px solid #e8eaed;">
        <div id="spotifyConnectionArea">
          <div id="spotifyDisconnected" style="display: block;">
            <button id="spotifyLoginBtn" style="width: 100%; height: 48px; background: #1db954; color: white; border: none; border-radius: 24px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: background-color 0.2s ease;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.84-.179-.84-.6 0-.359.24-.66.54-.78 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.78.242 1.021zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.481.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              CONNECT WITH SPOTIFY
            </button>
          </div>
          <div id="spotifyConnected" style="display: none;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <div style="width: 8px; height: 8px; background: #1db954; border-radius: 50%;"></div>
                <span id="spotifyUserName" style="font-size: 13px; font-weight: 500; color: #202124;">Connected to Spotify</span>
              </div>
              <button id="spotifyLogoutBtn" style="background: none; border: 1px solid #dadce0; padding: 4px 8px; border-radius: 4px; font-size: 11px; color: #5f6368; cursor: pointer;">Disconnect</button>
            </div>
            <div id="musicControls" style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #e8eaed;">
              <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span style="font-size: 12px; font-weight: 500; color: #202124;">Music Control</span>
                <div style="display: flex; align-items: center; gap: 4px;">
                  <label style="font-size: 11px; color: #5f6368;">Auto-play during ads</label>
                  <input type="checkbox" id="autoPlayToggle" checked style="margin-left: 4px;">
                </div>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                <button id="musicPlayPause" style="background: #1a73e8; border: none; color: white; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">⏸ Pause</button>
                <button id="musicSkip" style="background: #f8f9fa; border: 1px solid #dadce0; color: #202124; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 11px;">⏭ Skip</button>
                <div style="flex: 1; text-align: right;">
                  <span style="font-size: 10px; color: #5f6368;">Vol:</span>
                  <input type="range" id="musicVolume" min="0" max="100" value="70" style="width: 60px; margin-left: 4px;">
                </div>
              </div>
              <div id="currentTrack" style="font-size: 11px; color: #5f6368; text-align: center; padding: 4px; background: #f8f9fa; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">No track playing</div>
            </div>
          </div>
        </div>
        <div id="spotifyLoading" style="display: none; text-align: center; padding: 20px;">
          <div style="font-size: 13px; color: #5f6368;">Connecting to Spotify...</div>
        </div>
        <div id="spotifyError" style="display: none; padding: 12px; background: #fce8e6; border-radius: 4px;">
          <div style="font-size: 12px; color: #d93025;" id="spotifyErrorMessage">Failed to connect to Spotify</div>
          <button id="spotifyRetry" style="margin-top: 8px; background: #d93025; color: white; border: none; padding: 6px 12px; border-radius: 4px; font-size: 11px; cursor: pointer;">Retry</button>
        </div>
      </div>
    `;
    const spotifyDiv = document.createElement('div');
    spotifyDiv.innerHTML = spotifyHtml;
    insertAfter.parentNode.insertBefore(spotifyDiv, insertAfter.nextSibling);
    
    this.elements = { ...this.elements,
      spotifySection: document.getElementById('spotifySection'),
      spotifyLoginBtn: document.getElementById('spotifyLoginBtn'),
      spotifyLogoutBtn: document.getElementById('spotifyLogoutBtn'),
      spotifyDisconnected: document.getElementById('spotifyDisconnected'),
      spotifyConnected: document.getElementById('spotifyConnected'),
      spotifyLoading: document.getElementById('spotifyLoading'),
      spotifyError: document.getElementById('spotifyError'),
      spotifyUserName: document.getElementById('spotifyUserName'),
      autoPlayToggle: document.getElementById('autoPlayToggle'),
      musicPlayPause: document.getElementById('musicPlayPause'),
      musicSkip: document.getElementById('musicSkip'),
      musicVolume: document.getElementById('musicVolume'),
      currentTrack: document.getElementById('currentTrack'),
      spotifyRetry: document.getElementById('spotifyRetry')
    };
    
    this.elements.spotifyLoginBtn.addEventListener('click', this.handleSpotifyLogin);
    this.elements.spotifyLogoutBtn.addEventListener('click', this.handleSpotifyLogout);
    this.elements.spotifyRetry.addEventListener('click', this.handleSpotifyLogin);
    this.elements.autoPlayToggle.addEventListener('change', this.handleAutoPlayToggle.bind(this));
    this.elements.musicPlayPause.addEventListener('click', this.handleMusicPlayPause.bind(this));
    this.elements.musicSkip.addEventListener('click', this.handleMusicSkip.bind(this));
    this.elements.musicVolume.addEventListener('input', this.handleVolumeChange.bind(this));
  }
  
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

  createDebugInterface() {
    const debugHtml = `
      <div id="debugSection" style="padding: 12px 16px; background: #f8f9fa; border-bottom: 1px solid #e8eaed; font-family: 'Courier New', monospace; font-size: 11px; display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <h3 style="font-size: 12px; font-weight: 600; color: #202124; margin: 0;">🛠 Debug Info</h3>
          <button id="toggleDebug" style="background: none; border: 1px solid #dadce0; border-radius: 4px; padding: 2px 6px; font-size: 10px; cursor: pointer;">Hide</button>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Site Info:</div>
          <div id="debugSiteUrl" style="color: #5f6368; word-break: break-all;">-</div>
          <div id="debugSiteCategory" style="color: #34a853; font-weight: bold;">-</div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Last Classification:</div>
          <div id="debugClassification" style="color: #ea4335; font-weight: bold; font-size: 13px;">-</div>
          <div id="debugConfidence" style="color: #fbbc04; font-weight: bold;">-</div>
          <div id="debugReasoning" style="color: #5f6368; margin-top: 2px;">-</div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Performance:</div>
          <div id="debugProcessingTime" style="color: #5f6368;">-</div>
          <div id="debugTokensUsed" style="color: #5f6368;">-</div>
          <div id="debugScreenshotCount" style="color: #5f6368;">-</div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Audio Decision:</div>
          <div id="debugAudioAction" style="color: #34a853; font-weight: bold;">-</div>
          <div id="debugAudioReason" style="color: #5f6368; font-size: 10px;">-</div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Rate Limiting:</div>
          <div id="debugRateLimit" style="color: #5f6368;">-</div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Music Status:</div>
          <div id="debugMusicStatus" style="color: #5f6368;">-</div>
        </div>
        
        <div style="margin-bottom: 8px;">
          <div style="color: #1967d2; font-weight: bold;">Last Update:</div>
          <div id="debugTimestamp" style="color: #5f6368;">-</div>
        </div>
        
        <button id="exportDebug" style="background: #1967d2; color: white; border: none; border-radius: 4px; padding: 4px 8px; font-size: 10px; cursor: pointer; margin-top: 8px;">Export Debug Data</button>
      </div>
    `;
    const header = document.querySelector('.header');
    if (header?.parentNode) {
      const debugDiv = document.createElement('div');
      debugDiv.innerHTML = debugHtml;
      header.parentNode.insertBefore(debugDiv, header.nextSibling);
      this.elements = { ...this.elements,
        debugSection: document.getElementById('debugSection'),
        toggleDebug: document.getElementById('toggleDebug'),
        debugSiteUrl: document.getElementById('debugSiteUrl'),
        debugSiteCategory: document.getElementById('debugSiteCategory'),
        debugClassification: document.getElementById('debugClassification'),
        debugConfidence: document.getElementById('debugConfidence'),
        debugReasoning: document.getElementById('debugReasoning'),
        debugProcessingTime: document.getElementById('debugProcessingTime'),
        debugTokensUsed: document.getElementById('debugTokensUsed'),
        debugScreenshotCount: document.getElementById('debugScreenshotCount'),
        debugAudioAction: document.getElementById('debugAudioAction'),
        debugAudioReason: document.getElementById('debugAudioReason'),
        debugRateLimit: document.getElementById('debugRateLimit'),
        debugMusicStatus: document.getElementById('debugMusicStatus'),
        debugTimestamp: document.getElementById('debugTimestamp'),
        exportDebug: document.getElementById('exportDebug')
      };
      this.elements.toggleDebug.addEventListener('click', () => {
        const isVisible = this.elements.debugSection.style.display !== 'none';
        this.elements.debugSection.style.display = isVisible ? 'none' : 'block';
        this.elements.toggleDebug.textContent = isVisible ? 'Show Debug' : 'Hide';
      });
      this.elements.exportDebug.addEventListener('click', () => this.exportDebugData());
    }
  }
  
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
  
  updateUI() {
    if (!this.currentStatus) return;
    const { isMonitoring, currentTabId, currentTabUrl, currentSiteCategory, screenshotCount, lastClassification, audioState, rateLimitState, musicEnabled, musicState, lastMusicAction } = this.currentStatus;
    
    this.elements.statusDot.className = isMonitoring ? 'status-dot monitoring' : 'status-dot idle';
    this.elements.statusText.textContent = isMonitoring ? 'AutoMuting' : 'Idle';
    
    if (this.elements.startStopBtn) {
      this.elements.startStopBtn.textContent = isMonitoring ? 'Stop AutoMuting' : 'Start AutoMuting';
      this.elements.startStopBtn.style.background = isMonitoring ? '#ea4335' : '#1a73e8';
      this.elements.startStopBtn.style.borderColor = isMonitoring ? '#ea4335' : '#1a73e8';
    }
    
    if (this.elements.currentTabInfo) {
      this.elements.currentTabInfo.style.display = isMonitoring ? 'block' : 'none';
      if(isMonitoring) this.updateCurrentTabDisplay(currentTabId);
    }
    
    this.updateAudioStatusIndicator(audioState, isMonitoring);

    if (isMonitoring) {
        this.updateDebugInfo(currentTabUrl, currentSiteCategory, screenshotCount, lastClassification, rateLimitState, musicEnabled, musicState, lastMusicAction);
    } else {
        this.hideDebugInfo();
    }
  }
  
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
  
  async handleTabSelection(tab) {
    this.selectedTabId = tab.id;
    document.querySelectorAll('.tab-item').forEach(item => {
      item.style.background = parseInt(item.dataset.tabId) === tab.id ? '#e8f0fe' : '#ffffff';
    });
    if (this.elements.controlsSection) this.elements.controlsSection.style.display = 'block';
    if (this.elements.currentTabTitle) this.elements.currentTabTitle.textContent = tab.title || 'Untitled';
    if (this.elements.currentTabFavicon) this.elements.currentTabFavicon.src = tab.favIconUrl || '../icons/icon16.png';
  }
  
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

  updateDebugInfo(currentTabUrl, currentSiteCategory, screenshotCount, lastClassification, rateLimitState, musicEnabled, musicState, lastMusicAction) {
    if(!this.elements.debugSection) return;
    this.elements.debugSection.style.display = 'block';
    
    if(document.getElementById('debugSiteUrl')) {
        document.getElementById('debugSiteUrl').textContent = `URL: ${currentTabUrl || '-'}`;
        document.getElementById('debugSiteCategory').textContent = `Category: ${currentSiteCategory || '-'}`;
        document.getElementById('debugClassification').textContent = `Classification: ${lastClassification?.classification || '-'}`;
    }
  }
}

const popupController = new PopupController();