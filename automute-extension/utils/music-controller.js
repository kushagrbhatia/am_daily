/**
 * Music Controller
 * Coordinates between Spotify playback and ad detection
 * Manages automatic music start/stop based on ad states
 */

import spotifyAuth from './spotify-auth.js';
import spotifyApi from './spotify-api.js';

class MusicController {
  constructor() {
    this.isEnabled = false;
    this.musicSettings = {
      autoPlayEnabled: true,
      defaultPlaylist: null,
      musicVolume: 70,
      fadeInDuration: 2000,
      fadeOutDuration: 1000,
      preferredGenres: ['chill', 'ambient', 'instrumental']
    };
    
    this.state = {
      isPlayingMusic: false,
      currentTrack: null,
      playbackDevice: null,
      lastAdStartTime: null,
      musicStartedByExtension: false,
      originalSpotifyState: null
    };
    
    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.handleAdDetected = this.handleAdDetected.bind(this);
    this.handleAdEnded = this.handleAdEnded.bind(this);
    this.startMusic = this.startMusic.bind(this);
    this.stopMusic = this.stopMusic.bind(this);
    this.updateSettings = this.updateSettings.bind(this);
    
    // Initialize
    this.initialize();
  }
  
  /**
   * Initialize music controller
   */
  async initialize() {
    try {
      // Load settings from storage
      await this.loadSettings();
      
      console.log('Music controller initialized', this.musicSettings);
      
    } catch (error) {
      console.error('Failed to initialize music controller:', error);
    }
  }
  
  /**
   * Handle ad detection - start background music
   */
  async handleAdDetected(classification) {
    try {
      if (!this.isEnabled || !this.musicSettings.autoPlayEnabled) {
        console.log('Auto-play disabled, skipping music start');
        return;
      }
      
      if (!spotifyAuth.isAuthenticated()) {
        console.log('Spotify not authenticated, cannot start music');
        return;
      }
      
      console.log('Ad detected, starting background music...');
      
      // Store when ad started
      this.state.lastAdStartTime = Date.now();
      
      // Save original Spotify state before we interfere
      await this.saveOriginalSpotifyState();
      
      // Start music
      await this.startMusic();
      
      return { success: true, action: 'music_started' };
      
    } catch (error) {
      console.error('Failed to handle ad detection:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Handle ad ended - stop background music and restore original state
   */
  async handleAdEnded(classification) {
    try {
      if (!this.state.musicStartedByExtension) {
        console.log('Music not started by extension, skipping stop');
        return;
      }
      
      console.log('Ad ended, stopping background music...');
      
      // Stop music and restore original state
      await this.stopMusic();
      
      return { success: true, action: 'music_stopped' };
      
    } catch (error) {
      console.error('Failed to handle ad end:', error);
      return { success: false, error: error.message };
    }
  }
  
  /**
   * Start background music during ads
   */
  async startMusic() {
    try {
      if (this.state.isPlayingMusic) {
        console.log('Music already playing');
        return;
      }
      
      // Get available devices
      const devices = await spotifyApi.getDevices();
      const activeDevice = devices.find(d => d.isActive) || devices[0];
      
      if (!activeDevice) {
        throw new Error('No Spotify devices available. Please open Spotify app first.');
      }
      
      this.state.playbackDevice = activeDevice;
      console.log(`Using Spotify device: ${activeDevice.name}`);
      
      // Set volume for background music
      await spotifyApi.setVolume(this.musicSettings.musicVolume, activeDevice.id);
      
      // Choose what to play
      const playbackOptions = await this.selectMusicToPlay();
      
      // Start playback
      await spotifyApi.startPlayback({
        deviceId: activeDevice.id,
        ...playbackOptions
      });
      
      // Update state
      this.state.isPlayingMusic = true;
      this.state.musicStartedByExtension = true;
      
      // Get current track info
      setTimeout(async () => {
        try {
          const playbackState = await spotifyApi.getPlaybackState();
          this.state.currentTrack = playbackState.track;
        } catch (error) {
          console.warn('Failed to get current track info:', error);
        }
      }, 1000);
      
      console.log('🎵 Background music started');
      
    } catch (error) {
      console.error('Failed to start music:', error);
      throw error;
    }
  }
  
  /**
   * Stop background music and restore original Spotify state
   */
  async stopMusic() {
    try {
      if (!this.state.isPlayingMusic || !this.state.musicStartedByExtension) {
        console.log('No music to stop or not started by extension');
        return;
      }
      
      // Restore original Spotify state
      if (this.state.originalSpotifyState) {
        if (this.state.originalSpotifyState.wasPlaying) {
          // Resume original playback
          await spotifyApi.startPlayback({
            deviceId: this.state.playbackDevice?.id
          });
          
          // Restore original volume
          if (this.state.originalSpotifyState.volume !== null) {
            await spotifyApi.setVolume(
              this.state.originalSpotifyState.volume, 
              this.state.playbackDevice?.id
            );
          }
        } else {
          // Pause if it wasn't playing before
          await spotifyApi.pausePlayback(this.state.playbackDevice?.id);
        }
      } else {
        // No original state to restore, just pause
        await spotifyApi.pausePlayback(this.state.playbackDevice?.id);
      }
      
      // Reset state
      this.state.isPlayingMusic = false;
      this.state.musicStartedByExtension = false;
      this.state.currentTrack = null;
      this.state.originalSpotifyState = null;
      
      console.log('🔇 Background music stopped and original state restored');
      
    } catch (error) {
      console.error('Failed to stop music:', error);
      throw error;
    }
  }
  
  /**
   * Save current Spotify state before we start interfering
   */
  async saveOriginalSpotifyState() {
    try {
      const playbackState = await spotifyApi.getPlaybackState();
      
      this.state.originalSpotifyState = {
        wasPlaying: playbackState.isPlaying,
        track: playbackState.track,
        progress: playbackState.progress,
        volume: playbackState.volume,
        device: playbackState.device
      };
      
      console.log('Original Spotify state saved:', this.state.originalSpotifyState);
      
    } catch (error) {
      console.warn('Failed to save original Spotify state:', error);
      this.state.originalSpotifyState = null;
    }
  }
  
  /**
   * Select appropriate music to play during ads
   */
  async selectMusicToPlay() {
    try {
      // If user has selected a default playlist, use that
      if (this.musicSettings.defaultPlaylist) {
        return {
          contextUri: this.musicSettings.defaultPlaylist.uri,
          offset: Math.floor(Math.random() * (this.musicSettings.defaultPlaylist.trackCount || 20))
        };
      }
      
      // Otherwise, try to find a suitable playlist
      const playlists = await spotifyApi.getUserPlaylists(50);
      
      // Look for playlists with preferred genres/keywords
      const suitablePlaylists = playlists.playlists.filter(playlist => {
        const name = playlist.name.toLowerCase();
        const description = (playlist.description || '').toLowerCase();
        
        return this.musicSettings.preferredGenres.some(genre => 
          name.includes(genre) || description.includes(genre)
        ) || name.includes('chill') || name.includes('background') || 
           name.includes('instrumental') || name.includes('ambient');
      });
      
      if (suitablePlaylists.length > 0) {
        const selectedPlaylist = suitablePlaylists[Math.floor(Math.random() * suitablePlaylists.length)];
        return {
          contextUri: selectedPlaylist.uri,
          offset: Math.floor(Math.random() * Math.min(selectedPlaylist.trackCount, 20))
        };
      }
      
      // Fallback: use any playlist
      if (playlists.playlists.length > 0) {
        const randomPlaylist = playlists.playlists[Math.floor(Math.random() * playlists.playlists.length)];
        return {
          contextUri: randomPlaylist.uri,
          offset: Math.floor(Math.random() * Math.min(randomPlaylist.trackCount, 10))
        };
      }
      
      // Last resort: search for instrumental music
      const searchResults = await spotifyApi.searchTracks('instrumental chill', 'playlist', 10);
      if (searchResults.playlists && searchResults.playlists.length > 0) {
        const playlist = searchResults.playlists[0];
        return {
          contextUri: playlist.uri,
          offset: 0
        };
      }
      
      throw new Error('No suitable music found to play');
      
    } catch (error) {
      console.error('Failed to select music:', error);
      
      // Emergency fallback: try to resume whatever was playing
      return {};
    }
  }
  
  /**
   * Manual music control methods
   */
  async playPause() {
    try {
      const playbackState = await spotifyApi.getPlaybackState();
      
      if (playbackState.isPlaying) {
        await spotifyApi.pausePlayback();
        return { action: 'paused' };
      } else {
        await spotifyApi.startPlayback();
        return { action: 'playing' };
      }
    } catch (error) {
      console.error('Failed to toggle play/pause:', error);
      throw error;
    }
  }
  
  async skipNext() {
    try {
      await spotifyApi.skipToNext();
      
      // Update current track info
      setTimeout(async () => {
        try {
          const playbackState = await spotifyApi.getPlaybackState();
          this.state.currentTrack = playbackState.track;
        } catch (error) {
          console.warn('Failed to update track info after skip:', error);
        }
      }, 1000);
      
      return { action: 'skipped_next' };
    } catch (error) {
      console.error('Failed to skip to next track:', error);
      throw error;
    }
  }
  
  async skipPrevious() {
    try {
      await spotifyApi.skipToPrevious();
      
      // Update current track info
      setTimeout(async () => {
        try {
          const playbackState = await spotifyApi.getPlaybackState();
          this.state.currentTrack = playbackState.track;
        } catch (error) {
          console.warn('Failed to update track info after skip:', error);
        }
      }, 1000);
      
      return { action: 'skipped_previous' };
    } catch (error) {
      console.error('Failed to skip to previous track:', error);
      throw error;
    }
  }
  
  async setVolume(volume) {
    try {
      await spotifyApi.setVolume(volume);
      this.musicSettings.musicVolume = volume;
      await this.saveSettings();
      
      return { action: 'volume_changed', volume };
    } catch (error) {
      console.error('Failed to set volume:', error);
      throw error;
    }
  }
  
  /**
   * Settings management
   */
  async updateSettings(newSettings) {
    try {
      this.musicSettings = {
        ...this.musicSettings,
        ...newSettings
      };
      
      await this.saveSettings();
      
      console.log('Music settings updated:', this.musicSettings);
      return { success: true };
      
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }
  
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['music_settings']);
      
      if (result.music_settings) {
        this.musicSettings = {
          ...this.musicSettings,
          ...result.music_settings
        };
      }
      
    } catch (error) {
      console.error('Failed to load music settings:', error);
    }
  }
  
  async saveSettings() {
    try {
      await chrome.storage.local.set({
        music_settings: this.musicSettings
      });
    } catch (error) {
      console.error('Failed to save music settings:', error);
    }
  }
  
  /**
   * Enable/disable music controller
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    console.log(`Music controller ${enabled ? 'enabled' : 'disabled'}`);
  }
  
  /**
   * Get current music state and settings
   */
  getState() {
    return {
      isEnabled: this.isEnabled,
      settings: this.musicSettings,
      state: this.state,
      isAuthenticated: spotifyAuth.isAuthenticated(),
      user: spotifyAuth.getUser()
    };
  }
  
  /**
   * Get current playback info
   */
  async getCurrentPlayback() {
    try {
      const playbackState = await spotifyApi.getPlaybackState();
      return {
        ...playbackState,
        managedByExtension: this.state.musicStartedByExtension
      };
    } catch (error) {
      console.error('Failed to get current playback:', error);
      return null;
    }
  }
  
  /**
   * Emergency stop - force stop all music activity
   */
  async emergencyStop() {
    try {
      await spotifyApi.pausePlayback();
      
      this.state.isPlayingMusic = false;
      this.state.musicStartedByExtension = false;
      this.state.currentTrack = null;
      this.state.originalSpotifyState = null;
      
      console.log('Emergency stop executed');
      return { success: true };
      
    } catch (error) {
      console.error('Emergency stop failed:', error);
      throw error;
    }
  }
}

// Create singleton instance
const musicController = new MusicController();

export default musicController;
export { MusicController };