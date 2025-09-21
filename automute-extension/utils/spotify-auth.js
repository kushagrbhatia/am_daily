/**
 * Spotify Authentication Service
 * Handles OAuth 2.0 flow, token management, and user authentication
 */

import { CONFIG } from '../config/constants.js';

class SpotifyAuthService {
  constructor() {
    this.clientId = null; // Will be loaded from manifest
    this.redirectUri = chrome.identity.getRedirectURL();
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    this.user = null;
    
    // OAuth configuration
    this.scopes = [
      'user-read-playback-state',
      'user-modify-playback-state', 
      'user-read-currently-playing',
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-library-read',
      'streaming'
    ];
    
    // Bind methods
    this.login = this.login.bind(this);
    this.logout = this.logout.bind(this);
    this.getAccessToken = this.getAccessToken.bind(this);
    this.refreshAccessToken = this.refreshAccessToken.bind(this);
    this.isAuthenticated = this.isAuthenticated.bind(this);
    
    // Initialize
    this.initialize();
  }
  
  /**
   * Initialize the auth service
   */
  async initialize() {
    try {
      // Load client ID from manifest
      const manifest = chrome.runtime.getManifest();
      this.clientId = manifest.oauth2?.client_id;
      
      if (!this.clientId) {
        console.error('Spotify client ID not found in manifest');
        return;
      }
      
      // Load stored tokens
      await this.loadStoredTokens();
      
      // Check if tokens need refresh
      if (this.accessToken && this.isTokenExpired()) {
        await this.refreshAccessToken();
      }
      
      console.log('Spotify auth service initialized');
      
    } catch (error) {
      console.error('Failed to initialize Spotify auth service:', error);
    }
  }
  
  /**
   * Start OAuth login flow
   */
  async login() {
    try {
      console.log('Starting Spotify login flow...');
      
      if (!this.clientId) {
        throw new Error('Spotify client ID not configured');
      }
      
      // Generate state parameter for security
      const state = this.generateRandomString(16);
      
      // Build authorization URL
      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.append('client_id', this.clientId);
      authUrl.searchParams.append('response_type', 'code');
      authUrl.searchParams.append('redirect_uri', this.redirectUri);
      authUrl.searchParams.append('scope', this.scopes.join(' '));
      authUrl.searchParams.append('state', state);
      authUrl.searchParams.append('show_dialog', 'true'); // Force login dialog
      
      console.log('Authorization URL:', authUrl.toString());
      console.log('Redirect URI:', this.redirectUri);
      
      // Launch OAuth flow
      const responseUrl = await new Promise((resolve, reject) => {
        chrome.identity.launchWebAuthFlow({
          url: authUrl.toString(),
          interactive: true
        }, (responseUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!responseUrl) {
            reject(new Error('Authorization cancelled by user'));
          } else {
            resolve(responseUrl);
          }
        });
      });
      
      console.log('OAuth response URL:', responseUrl);
      
      // Parse authorization code from response
      const urlParams = new URL(responseUrl).searchParams;
      const code = urlParams.get('code');
      const returnedState = urlParams.get('state');
      const error = urlParams.get('error');
      
      if (error) {
        throw new Error(`Authorization failed: ${error}`);
      }
      
      if (returnedState !== state) {
        throw new Error('State parameter mismatch - possible CSRF attack');
      }
      
      if (!code) {
        throw new Error('No authorization code received');
      }
      
      // Exchange code for tokens
      await this.exchangeCodeForTokens(code);
      
      // Get user profile
      await this.loadUserProfile();
      
      console.log('Spotify login successful:', this.user);
      
      return {
        success: true,
        user: this.user
      };
      
    } catch (error) {
      console.error('Spotify login failed:', error);
      throw error;
    }
  }
  
  /**
   * Exchange authorization code for access tokens
   */
  async exchangeCodeForTokens(code) {
    try {
      const tokenUrl = 'https://accounts.spotify.com/api/token';
      
      // The 'client_secret' is required for this step.
      // NOTE: Storing a client_secret in an extension is not secure for production apps.
      const clientSecret = 'e5682db791e94b8189e9437b21d23626'; // 🤫 Get this from your Spotify Dashboard

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: this.redirectUri,
        client_id: this.clientId,
        client_secret: clientSecret
      });
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Token exchange failed: ${errorData.error_description || response.statusText}`);
      }
      
      const data = await response.json();
      
      // Store tokens and set expiry time
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      // Save to storage
      await this.saveTokens();
      
      console.log('✅ Tokens obtained and saved successfully');
      
    } catch (error) {
      console.error('❌ Token exchange failed:', error);
      throw error;
    }
  }
  
  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    try {
      if (!this.refreshToken) {
        throw new Error('No refresh token available');
      }
      
      console.log('Refreshing Spotify access token...');
      
      const tokenUrl = 'https://accounts.spotify.com/api/token';
      
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.clientId
      });
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        // If refresh token is invalid, clear stored tokens
        if (response.status === 400) {
          console.log('Refresh token invalid, clearing stored tokens');
          await this.clearStoredTokens();
        }
        
        throw new Error(`Token refresh failed: ${errorData.error || response.statusText}`);
      }
      
      const data = await response.json();
      
      // Update tokens
      this.accessToken = data.access_token;
      if (data.refresh_token) {
        this.refreshToken = data.refresh_token;
      }
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      // Save updated tokens
      await this.saveTokens();
      
      console.log('Access token refreshed successfully');
      
      return this.accessToken;
      
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw error;
    }
  }
  
  /**
   * Get valid access token (refresh if needed)
   */
  async getAccessToken() {
    try {
      if (!this.accessToken) {
        throw new Error('No access token available - please login');
      }
      
      // Check if token needs refresh
      if (this.isTokenExpired()) {
        await this.refreshAccessToken();
      }
      
      return this.accessToken;
      
    } catch (error) {
      console.error('Failed to get access token:', error);
      throw error;
    }
  }
  
  /**
   * Load user profile from Spotify API
   */
  async loadUserProfile() {
    try {
      const token = await this.getAccessToken();
      
      const response = await fetch('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to load user profile: ${response.statusText}`);
      }
      
      this.user = await response.json();
      
      // Save user profile
      await chrome.storage.local.set({ 
        spotify_user: this.user 
      });
      
      return this.user;
      
    } catch (error) {
      console.error('Failed to load user profile:', error);
      throw error;
    }
  }
  
  /**
   * Logout and clear all stored data
   */
  async logout() {
    try {
      console.log('Logging out of Spotify...');
      
      // Clear tokens and user data
      this.accessToken = null;
      this.refreshToken = null;
      this.tokenExpiry = null;
      this.user = null;
      
      // Clear stored data
      await this.clearStoredTokens();
      
      console.log('Spotify logout completed');
      
      return { success: true };
      
    } catch (error) {
      console.error('Logout failed:', error);
      throw error;
    }
  }
  
  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!(this.accessToken && !this.isTokenExpired());
  }
  
  /**
   * Check if access token is expired
   */
  isTokenExpired() {
    if (!this.tokenExpiry) return true;
    
    // Consider token expired if it expires within next 5 minutes
    const buffer = 5 * 60 * 1000; // 5 minutes in milliseconds
    return Date.now() >= (this.tokenExpiry - buffer);
  }
  
  /**
   * Get current user info
   */
  getUser() {
    return this.user;
  }
  
  /**
   * Get authentication status and user info
   */
// In utils/spotify-auth.js

getAuthStatus() {
  console.log('--- Auth Status Check ---');
  console.log('Has access token?', !!this.accessToken);
  console.log('Token expiry time:', new Date(this.tokenExpiry).toLocaleString());
  console.log('Is token expired?', this.isTokenExpired());
  console.log('User object:', this.user);
  const isAuthenticated = this.isAuthenticated();
  console.log('Result: Is Authenticated?', isAuthenticated);
  console.log('-------------------------');

  return {
    isAuthenticated: isAuthenticated,
    user: this.user,
    hasValidToken: !!this.accessToken,
    tokenExpiry: this.tokenExpiry
  };
}
  
  /**
   * Save tokens to Chrome storage
   */
  async saveTokens() {
    try {
      await chrome.storage.local.set({
        spotify_access_token: this.accessToken,
        spotify_refresh_token: this.refreshToken,
        spotify_token_expiry: this.tokenExpiry
      });
    } catch (error) {
      console.error('Failed to save tokens:', error);
    }
  }
  
  /**
   * Load tokens from Chrome storage
   */
  async loadStoredTokens() {
    try {
      const result = await chrome.storage.local.get([
        'spotify_access_token',
        'spotify_refresh_token', 
        'spotify_token_expiry',
        'spotify_user'
      ]);
      
      this.accessToken = result.spotify_access_token || null;
      this.refreshToken = result.spotify_refresh_token || null;
      this.tokenExpiry = result.spotify_token_expiry || null;
      this.user = result.spotify_user || null;
      
      console.log('Loaded stored tokens:', {
        hasAccessToken: !!this.accessToken,
        hasRefreshToken: !!this.refreshToken,
        hasUser: !!this.user,
        isExpired: this.isTokenExpired()
      });
      
    } catch (error) {
      console.error('Failed to load stored tokens:', error);
    }
  }
  
  /**
   * Clear all stored tokens and user data
   */
  async clearStoredTokens() {
    try {
      await chrome.storage.local.remove([
        'spotify_access_token',
        'spotify_refresh_token',
        'spotify_token_expiry',
        'spotify_user'
      ]);
    } catch (error) {
      console.error('Failed to clear stored tokens:', error);
    }
  }
  
  /**
   * Generate random string for OAuth state parameter
   */
  generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}

// Create singleton instance
const spotifyAuth = new SpotifyAuthService();
const authReady = spotifyAuth.initialize(); // The initialize() method is async

export default spotifyAuth;
export { SpotifyAuthService, authReady };