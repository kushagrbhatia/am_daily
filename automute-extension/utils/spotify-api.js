/**
 * Spotify Web API Client
 * Handles all interactions with Spotify Web API for music control
 */

import spotifyAuth from './spotify-auth.js';

class SpotifyApiClient {
  constructor() {
    this.baseUrl = 'https://api.spotify.com/v1';
    this.rateLimitDelay = 1000; // 1 second base delay
    this.maxRetries = 3;
    
    // Bind methods
    this.makeRequest = this.makeRequest.bind(this);
    this.getPlaybackState = this.getPlaybackState.bind(this);
    this.startPlayback = this.startPlayback.bind(this);
    this.pausePlayback = this.pausePlayback.bind(this);
    this.skipToNext = this.skipToNext.bind(this);
    this.skipToPrevious = this.skipToPrevious.bind(this);
    this.setVolume = this.setVolume.bind(this);
    this.getUserPlaylists = this.getUserPlaylists.bind(this);
    this.searchTracks = this.searchTracks.bind(this);
    this.getDevices = this.getDevices.bind(this);
  }
  
  /**
   * Make authenticated request to Spotify API
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const token = await spotifyAuth.getAccessToken();
        
        const response = await fetch(url, {
          ...options,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...options.headers
          }
        });
        
        // Handle rate limiting
        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After')) || 1;
          console.log(`Rate limited, waiting ${retryAfter} seconds...`);
          await this.delay(retryAfter * 1000);
          continue;
        }
        
        // Handle authentication errors
        if (response.status === 401) {
          console.log('Token expired, attempting refresh...');
          await spotifyAuth.refreshAccessToken();
          continue;
        }
        
        // Handle no content responses (common for playback control)
        if (response.status === 204) {
          return null;
        }
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          throw new Error(`Spotify API error: ${errorData.error?.message || response.statusText}`);
        }
        
        const data = await response.json().catch(() => null);
        return data;
        
      } catch (error) {
        lastError = error;
        console.error(`API request attempt ${attempt} failed:`, error);
        
        if (attempt < this.maxRetries) {
          await this.delay(this.rateLimitDelay * attempt);
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * Get current playback state
   */
  async getPlaybackState() {
    try {
      const data = await this.makeRequest('/me/player');
      
      if (!data) {
        return {
          isPlaying: false,
          device: null,
          track: null,
          timestamp: Date.now()
        };
      }
      
      return {
        isPlaying: data.is_playing,
        device: data.device,
        track: data.item,
        progress: data.progress_ms,
        volume: data.device?.volume_percent,
        shuffleState: data.shuffle_state,
        repeatState: data.repeat_state,
        timestamp: Date.now()
      };
      
    } catch (error) {
      console.error('Failed to get playback state:', error);
      throw error;
    }
  }
  
  /**
   * Start or resume playback
   */
  async startPlayback(options = {}) {
    try {
      const {
        deviceId,
        contextUri, // playlist, album, or artist URI
        uris, // array of track URIs
        offset = 0
      } = options;
      
      const body = {};
      
      if (contextUri) {
        body.context_uri = contextUri;
        body.offset = { position: offset };
      } else if (uris && uris.length > 0) {
        body.uris = uris;
        body.offset = { position: offset };
      }
      
      const endpoint = deviceId ? `/me/player/play?device_id=${deviceId}` : '/me/player/play';
      
      await this.makeRequest(endpoint, {
        method: 'PUT',
        body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined
      });
      
      console.log('Playback started');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to start playback:', error);
      throw error;
    }
  }
  
  /**
   * Pause playback
   */
  async pausePlayback(deviceId = null) {
    try {
      const endpoint = deviceId ? `/me/player/pause?device_id=${deviceId}` : '/me/player/pause';
      
      await this.makeRequest(endpoint, {
        method: 'PUT'
      });
      
      console.log('Playback paused');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to pause playback:', error);
      throw error;
    }
  }
  
  /**
   * Skip to next track
   */
  async skipToNext(deviceId = null) {
    try {
      const endpoint = deviceId ? `/me/player/next?device_id=${deviceId}` : '/me/player/next';
      
      await this.makeRequest(endpoint, {
        method: 'POST'
      });
      
      console.log('Skipped to next track');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to skip to next track:', error);
      throw error;
    }
  }
  
  /**
   * Skip to previous track
   */
  async skipToPrevious(deviceId = null) {
    try {
      const endpoint = deviceId ? `/me/player/previous?device_id=${deviceId}` : '/me/player/previous';
      
      await this.makeRequest(endpoint, {
        method: 'POST'
      });
      
      console.log('Skipped to previous track');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to skip to previous track:', error);
      throw error;
    }
  }
  
  /**
   * Set playback volume
   */
  async setVolume(volumePercent, deviceId = null) {
    try {
      // Clamp volume between 0-100
      const volume = Math.max(0, Math.min(100, volumePercent));
      
      const endpoint = deviceId 
        ? `/me/player/volume?volume_percent=${volume}&device_id=${deviceId}`
        : `/me/player/volume?volume_percent=${volume}`;
      
      await this.makeRequest(endpoint, {
        method: 'PUT'
      });
      
      console.log(`Volume set to ${volume}%`);
      return { success: true, volume };
      
    } catch (error) {
      console.error('Failed to set volume:', error);
      throw error;
    }
  }
  
  /**
   * Get user's playlists
   */
  async getUserPlaylists(limit = 50, offset = 0) {
    try {
      const data = await this.makeRequest(`/me/playlists?limit=${limit}&offset=${offset}`);
      
      return {
        playlists: data.items.map(playlist => ({
          id: playlist.id,
          name: playlist.name,
          description: playlist.description,
          uri: playlist.uri,
          images: playlist.images,
          trackCount: playlist.tracks.total,
          owner: playlist.owner.display_name,
          public: playlist.public
        })),
        total: data.total,
        hasMore: data.next !== null
      };
      
    } catch (error) {
      console.error('Failed to get user playlists:', error);
      throw error;
    }
  }
  
  /**
   * Search for tracks, albums, artists, or playlists
   */
  async searchTracks(query, type = 'track', limit = 20) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const data = await this.makeRequest(`/search?q=${encodedQuery}&type=${type}&limit=${limit}`);
      
      const results = {};
      
      if (data.tracks) {
        results.tracks = data.tracks.items.map(track => ({
          id: track.id,
          name: track.name,
          uri: track.uri,
          artists: track.artists.map(artist => artist.name),
          album: track.album.name,
          duration: track.duration_ms,
          preview: track.preview_url,
          images: track.album.images
        }));
      }
      
      if (data.playlists) {
        results.playlists = data.playlists.items.map(playlist => ({
          id: playlist.id,
          name: playlist.name,
          uri: playlist.uri,
          description: playlist.description,
          images: playlist.images,
          trackCount: playlist.tracks.total
        }));
      }
      
      return results;
      
    } catch (error) {
      console.error('Failed to search:', error);
      throw error;
    }
  }
  
  /**
   * Get user's available devices
   */
  async getDevices() {
    try {
      const data = await this.makeRequest('/me/player/devices');
      
      return data.devices.map(device => ({
        id: device.id,
        name: device.name,
        type: device.type,
        isActive: device.is_active,
        isPrivateSession: device.is_private_session,
        isRestricted: device.is_restricted,
        volume: device.volume_percent
      }));
      
    } catch (error) {
      console.error('Failed to get devices:', error);
      throw error;
    }
  }
  
  /**
   * Transfer playback to specific device
   */
  async transferPlayback(deviceId, play = false) {
    try {
      await this.makeRequest('/me/player', {
        method: 'PUT',
        body: JSON.stringify({
          device_ids: [deviceId],
          play: play
        })
      });
      
      console.log(`Playback transferred to device: ${deviceId}`);
      return { success: true };
      
    } catch (error) {
      console.error('Failed to transfer playback:', error);
      throw error;
    }
  }
  
  /**
   * Get recently played tracks
   */
  async getRecentlyPlayed(limit = 20) {
    try {
      const data = await this.makeRequest(`/me/player/recently-played?limit=${limit}`);
      
      return data.items.map(item => ({
        track: {
          id: item.track.id,
          name: item.track.name,
          uri: item.track.uri,
          artists: item.track.artists.map(artist => artist.name),
          album: item.track.album.name
        },
        playedAt: item.played_at
      }));
      
    } catch (error) {
      console.error('Failed to get recently played:', error);
      throw error;
    }
  }
  
  /**
   * Add track to queue
   */
  async addToQueue(uri, deviceId = null) {
    try {
      const endpoint = deviceId 
        ? `/me/player/queue?uri=${encodeURIComponent(uri)}&device_id=${deviceId}`
        : `/me/player/queue?uri=${encodeURIComponent(uri)}`;
      
      await this.makeRequest(endpoint, {
        method: 'POST'
      });
      
      console.log('Track added to queue');
      return { success: true };
      
    } catch (error) {
      console.error('Failed to add to queue:', error);
      throw error;
    }
  }
  
  /**
   * Utility method for delays
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Get API client statistics
   */
  getStats() {
    return {
      baseUrl: this.baseUrl,
      isAuthenticated: spotifyAuth.isAuthenticated(),
      user: spotifyAuth.getUser()
    };
  }
}

// Create singleton instance
const spotifyApi = new SpotifyApiClient();

export default spotifyApi;
export { SpotifyApiClient };