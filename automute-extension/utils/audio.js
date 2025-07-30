import { CONFIG } from '../config/constants.js';

class AudioController {
  constructor() {
    this.mutedTabs = new Set();
    this.audioTransitions = new Map();
    this.originalVolumes = new Map();
    
    // Bind methods
    this.muteTab = this.muteTab.bind(this);
    this.unmuteTab = this.unmuteTab.bind(this);
    this.getTabAudioState = this.getTabAudioState.bind(this);
    this.handleAudioTransition = this.handleAudioTransition.bind(this);
  }
  
  /**
   * Mute audio for specified tab
   * @param {number} tabId - Chrome tab ID
   * @param {Object} options - Muting options
   * @returns {Promise<boolean>} Success status
   */
/**
 * Mute audio for specified tab
 * @param {number} tabId - Chrome tab ID
 * @param {Object} options - Muting options
 * @returns {Promise<boolean>} Success status
 */
async muteTab(tabId, options = {}) {
    try {
      console.log(`Muting audio for tab ${tabId}`);
      
      // Validate tabId
      if (!tabId || typeof tabId !== 'number') {
        console.warn(`Invalid tab ID for muting: ${tabId}`);
        return false;
      }
      
      // Validate tab exists
      const tab = await this.getTabInfo(tabId);
      if (!tab) {
        throw new Error('Tab not found');
      }
      
      // Rest of the existing muteTab code...
      // Check if already muted
      if (this.mutedTabs.has(tabId)) {
        console.log(`Tab ${tabId} is already muted`);
        return true;
      }
      
      // Store original audio state
      this.originalVolumes.set(tabId, {
        wasMuted: tab.mutedInfo?.muted || false,
        reason: tab.mutedInfo?.reason || 'user'
      });
      
      // Apply mute with smooth transition if requested
      if (options.smooth && CONFIG.AUDIO_FADE_DURATION > 0) {
        await this.handleAudioTransition(tabId, true);
      } else {
        await this.setTabMuted(tabId, true);
      }
      
      // Track muted state
      this.mutedTabs.add(tabId);
      
      console.log(`Successfully muted tab ${tabId}`);
      return true;
      
    } catch (error) {
      console.error(`Failed to mute tab ${tabId}:`, error);
      return false;
    }
  }
  
  /**
   * Unmute audio for specified tab
   * @param {number} tabId - Chrome tab ID
   * @param {Object} options - Unmuting options
   * @returns {Promise<boolean>} Success status
   */
  async unmuteTab(tabId, options = {}) {
    try {
      console.log(`Unmuting audio for tab ${tabId}`);
      
      // Validate tabId
      if (!tabId || typeof tabId !== 'number') {
        console.warn(`Invalid tab ID for unmuting: ${tabId}`);
        return false;
      }
      
      // Validate tab exists
      const tab = await this.getTabInfo(tabId);
      if (!tab) {
        throw new Error('Tab not found');
      }
      
      // Rest of the existing unmuteTab code...
      // Check if already unmuted
      if (!this.mutedTabs.has(tabId)) {
        console.log(`Tab ${tabId} is already unmuted`);
        return true;
      }
      
      // Get original audio state
      const originalState = this.originalVolumes.get(tabId);
      
      // Only unmute if we originally muted it (don't override user muting)
      if (originalState && originalState.wasMuted) {
        console.log(`Not unmuting tab ${tabId} - was originally muted by user`);
        this.mutedTabs.delete(tabId);
        return true;
      }
      
      // Apply unmute with smooth transition if requested
      if (options.smooth && CONFIG.AUDIO_FADE_DURATION > 0) {
        await this.handleAudioTransition(tabId, false);
      } else {
        await this.setTabMuted(tabId, false);
      }
      
      // Update tracking
      this.mutedTabs.delete(tabId);
      this.originalVolumes.delete(tabId);
      
      console.log(`Successfully unmuted tab ${tabId}`);
      return true;
      
    } catch (error) {
      console.error(`Failed to unmute tab ${tabId}:`, error);
      return false;
    }
  }
  
  /**
   * Get audio state for specified tab
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<Object>} Audio state information
   */
  async getTabAudioState(tabId) {
    try {
      const tab = await this.getTabInfo(tabId);
      if (!tab) {
        return {
          exists: false,
          muted: false,
          audible: false,
          managedByExtension: false
        };
      }
      
      return {
        exists: true,
        muted: tab.mutedInfo?.muted || false,
        audible: tab.audible || false,
        mutedReason: tab.mutedInfo?.reason || null,
        managedByExtension: this.mutedTabs.has(tabId),
        hasAudioTransition: this.audioTransitions.has(tabId)
      };
      
    } catch (error) {
      console.error(`Failed to get audio state for tab ${tabId}:`, error);
      return {
        exists: false,
        muted: false,
        audible: false,
        managedByExtension: false,
        error: error.message
      };
    }
  }
  
  /**
   * Handle smooth audio transitions (fade in/out)
   * @param {number} tabId - Chrome tab ID
   * @param {boolean} fadeOut - True to fade out (mute), false to fade in (unmute)
   */
  async handleAudioTransition(tabId, fadeOut) {
    // Note: Chrome extension APIs don't support volume control
    // This is a placeholder for smooth transitions
    // In practice, we can only toggle mute on/off
    
    const transitionId = `${tabId}_${Date.now()}`;
    this.audioTransitions.set(tabId, transitionId);
    
    try {
      // Simulate fade with a brief delay
      await new Promise(resolve => setTimeout(resolve, CONFIG.AUDIO_FADE_DURATION / 2));
      
      // Apply mute/unmute
      await this.setTabMuted(tabId, fadeOut);
      
      // Complete transition
      await new Promise(resolve => setTimeout(resolve, CONFIG.AUDIO_FADE_DURATION / 2));
      
    } finally {
      // Clean up transition tracking
      if (this.audioTransitions.get(tabId) === transitionId) {
        this.audioTransitions.delete(tabId);
      }
    }
  }
  
  /**
   * Set tab muted state using Chrome API
   * @param {number} tabId - Chrome tab ID
   * @param {boolean} muted - Muted state
   */
  async setTabMuted(tabId, muted) {
    return new Promise((resolve, reject) => {
      chrome.tabs.update(tabId, { muted }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }
  
  /**
   * Get tab information
   * @param {number} tabId - Chrome tab ID
   * @returns {Promise<Object>} Tab information
   */
/**
 * Get tab information
 * @param {number} tabId - Chrome tab ID
 * @returns {Promise<Object>} Tab information
 */
async getTabInfo(tabId) {
    return new Promise((resolve, reject) => {
      // Check if tabId is valid
      if (!tabId || typeof tabId !== 'number') {
        reject(new Error(`Invalid tab ID: ${tabId}`));
        return;
      }
      
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(tab);
        }
      });
    });
  }
  
  /**
   * Handle tab removal - clean up tracking
   * @param {number} tabId - Removed tab ID
   */
  handleTabRemoved(tabId) {
    this.mutedTabs.delete(tabId);
    this.originalVolumes.delete(tabId);
    this.audioTransitions.delete(tabId);
    console.log(`Cleaned up audio tracking for removed tab ${tabId}`);
  }
  
  /**
   * Toggle tab audio state
   * @param {number} tabId - Chrome tab ID
   * @param {Object} options - Toggle options
   * @returns {Promise<boolean>} New muted state
   */
  async toggleTabAudio(tabId, options = {}) {
    try {
      const audioState = await this.getTabAudioState(tabId);
      
      if (audioState.managedByExtension) {
        // If we're managing it, toggle our state
        if (this.mutedTabs.has(tabId)) {
          await this.unmuteTab(tabId, options);
          return false; // unmuted
        } else {
          await this.muteTab(tabId, options);
          return true; // muted
        }
      } else {
        // If not managed by us, start managing it
        if (audioState.muted) {
          await this.unmuteTab(tabId, options);
          return false;
        } else {
          await this.muteTab(tabId, options);
          return true;
        }
      }
    } catch (error) {
      console.error(`Failed to toggle audio for tab ${tabId}:`, error);
      throw error;
    }
  }
  
  /**
   * Get audio controller statistics
   * @returns {Object} Audio controller stats
   */
  getStats() {
    return {
      mutedTabsCount: this.mutedTabs.size,
      mutedTabs: Array.from(this.mutedTabs),
      activeTransitions: this.audioTransitions.size,
      trackedOriginalStates: this.originalVolumes.size
    };
  }
  
  /**
   * Clean up all audio states
   */
  cleanup() {
    // Restore all tabs to their original state
    const promises = Array.from(this.mutedTabs).map(async (tabId) => {
      try {
        await this.unmuteTab(tabId);
      } catch (error) {
        console.warn(`Failed to restore audio for tab ${tabId}:`, error);
      }
    });
    
    return Promise.all(promises).then(() => {
      this.mutedTabs.clear();
      this.originalVolumes.clear();
      this.audioTransitions.clear();
      console.log('Audio controller cleanup completed');
    });
  }
}

// Create singleton instance
const audioController = new AudioController();

export default audioController;
export { AudioController };