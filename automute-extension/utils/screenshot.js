import { CONFIG } from '../config/constants.js';
import memoryManager from './memory.js';

class ScreenshotManager {
  constructor() {
    this.isCapturing = false;
    this.captureQueue = [];
    
    // Bind methods
    this.captureTab = this.captureTab.bind(this);
    this.optimizeImage = this.optimizeImage.bind(this);
    this.cleanup = this.cleanup.bind(this);
  }
  
  /**
   * Capture screenshot of specified tab
   * @param {number} tabId - Chrome tab ID
   * @param {Object} options - Capture options
   * @returns {Promise<string>} Base64 encoded image
   */
  async captureTab(tabId, options = {}) {
    const captureId = `capture_${Date.now()}_${Math.random()}`;
    
    try {
      // Prevent concurrent captures
      if (this.isCapturing) {
        console.warn('Screenshot capture already in progress, queuing request');
        return new Promise((resolve, reject) => {
          this.captureQueue.push({ resolve, reject, tabId, options });
        });
      }
      
      this.isCapturing = true;
      console.log(`Starting screenshot capture for tab ${tabId}`);
      
      // Validate tab exists and is accessible
      await this.validateTab(tabId);
      
      // Set capture options (cropBounds is not a Chrome ImageDetails key, so exclude it)
      const { cropBounds, ...captureApiOptions } = options;
      const captureOptions = {
        format: 'jpeg',
        quality: Math.floor(CONFIG.SCREENSHOT_QUALITY * 100),
        ...captureApiOptions
      };
      
      // Capture the visible tab
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(null, captureOptions, (dataUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(dataUrl);
          }
        });
      });
      
      if (!dataUrl) {
        throw new Error('Screenshot capture returned empty data');
      }
      
      // Convert data URL to base64
      const base64Data = dataUrl.split(',')[1];
      if (!base64Data) {
        throw new Error('Invalid data URL format');
      }
      
      // Crop to video region if bounds were provided
      let imageToProcess = base64Data;
      if (cropBounds) {
        const cropped = await this.cropImage(base64Data, cropBounds);
        if (cropped) {
          imageToProcess = cropped;
          console.log(`Screenshot cropped to video region: ${cropBounds.width}x${cropBounds.height}px`);
        } else {
          console.warn('Crop failed, using full screenshot');
        }
      }

      // Optimize image
      const optimizedBase64 = await this.optimizeImage(imageToProcess, captureId);
      
      // Track for memory management
      const estimatedSize = (optimizedBase64.length * 3) / 4; // Rough base64 to byte conversion
      memoryManager.trackResource(captureId, {
        data: optimizedBase64,
        type: 'screenshot',
        cleanup: () => {
          // Screenshot data cleanup handled by memory manager
        }
      }, estimatedSize);
      
      console.log(`Screenshot captured successfully: ${estimatedSize} bytes`);
      
      // Process any queued captures
      this.processQueue();
      
      return optimizedBase64;
      
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      
      // Handle specific error types
      if (error.message.includes('permission')) {
        throw new Error(CONFIG.ERROR_TYPES.PERMISSION_DENIED);
      } else if (error.message.includes('tab')) {
        throw new Error(CONFIG.ERROR_TYPES.TAB_NOT_FOUND);
      } else {
        throw new Error(CONFIG.ERROR_TYPES.SCREENSHOT_FAILED);
      }
    } finally {
      this.isCapturing = false;
    }
  }
  
  /**
   * Validate that tab exists and is accessible
   * @param {number} tabId - Tab ID to validate
   */
  async validateTab(tabId) {
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
      
      if (!tab) {
        throw new Error('Tab not found');
      }
      
      if (tab.status !== 'complete') {
        console.warn('Tab is still loading, capture may fail');
      }
      
      // Check if tab URL is capturable
      const url = tab.url || '';
      if (url.startsWith('chrome://') || 
          url.startsWith('chrome-extension://') || 
          url.startsWith('moz-extension://') ||
          url === 'about:blank') {
        throw new Error('Cannot capture browser internal pages');
      }
      
      return tab;
    } catch (error) {
      throw new Error(`Tab validation failed: ${error.message}`);
    }
  }
  
  /**
   * Optimize image for API transmission
   * @param {string} base64Data - Original base64 image data
   * @param {string} resourceId - Resource ID for tracking
   * @returns {Promise<string>} Optimized base64 image data
   */
/**
 * Optimize image for API transmission
 * @param {string} base64Data - Original base64 image data
 * @param {string} resourceId - Resource ID for tracking
 * @returns {Promise<string>} Optimized base64 image data
 */
async optimizeImage(base64Data, resourceId) {
    try {
      // Skip optimization in service worker context (no DOM access)
      // Service workers can't create canvas elements
      if (typeof document === 'undefined') {
        console.log('Skipping image optimization in service worker context');
        return base64Data;
      }
      
      // Rest of the canvas optimization code stays the same...
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      
      // Track blob for cleanup
      const blobId = `${resourceId}_blob`;
      memoryManager.trackResource(blobId, blob, blob.size);
      
      // Create image element for resizing
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      // Track canvas for cleanup
      const canvasId = `${resourceId}_canvas`;
      memoryManager.trackResource(canvasId, canvas, 0);
      
      return new Promise((resolve, reject) => {
        img.onload = () => {
          try {
            // Calculate new dimensions
            let { width, height } = this.calculateOptimalDimensions(
              img.width, 
              img.height
            );
            
            // Set canvas size
            canvas.width = width;
            canvas.height = height;
            
            // Draw and compress
            ctx.drawImage(img, 0, 0, width, height);
            
            // Convert to base64 with compression
            const optimizedDataUrl = canvas.toDataURL('image/jpeg', CONFIG.SCREENSHOT_QUALITY);
            const optimizedBase64 = optimizedDataUrl.split(',')[1];
            
            // Clean up temporary resources
            memoryManager.cleanupResource(blobId);
            memoryManager.cleanupResource(canvasId);
            
            resolve(optimizedBase64);
          } catch (error) {
            reject(error);
          }
        };
        
        img.onerror = () => {
          reject(new Error('Failed to load image for optimization'));
        };
        
        // Load image from blob
        const blobUrl = URL.createObjectURL(blob);
        memoryManager.trackResource(`${resourceId}_url`, blobUrl, 0);
        img.src = blobUrl;
      });
      
    } catch (error) {
      console.warn('Image optimization failed, using original:', error);
      return base64Data;
    }
  }
  
  /**
   * Calculate optimal dimensions for screenshot
   * @param {number} originalWidth - Original image width
   * @param {number} originalHeight - Original image height
   * @returns {Object} Optimal width and height
   */
  calculateOptimalDimensions(originalWidth, originalHeight) {
    const maxWidth = CONFIG.SCREENSHOT_MAX_WIDTH;
    const maxHeight = CONFIG.SCREENSHOT_MAX_HEIGHT;
    
    // If image is already smaller, keep original size
    if (originalWidth <= maxWidth && originalHeight <= maxHeight) {
      return { width: originalWidth, height: originalHeight };
    }
    
    // Calculate scaling factor
    const widthRatio = maxWidth / originalWidth;
    const heightRatio = maxHeight / originalHeight;
    const scaleFactor = Math.min(widthRatio, heightRatio);
    
    return {
      width: Math.floor(originalWidth * scaleFactor),
      height: Math.floor(originalHeight * scaleFactor)
    };
  }
  
  /**
   * Crop base64 image to a specific region using OffscreenCanvas.
   * Safe to call in service worker context (no document needed).
   * Returns cropped base64, or null if crop fails (caller falls back to full image).
   * @param {string} base64 - Original base64 JPEG
   * @param {{ x: number, y: number, width: number, height: number }} bounds - Crop region
   * @returns {Promise<string|null>} Cropped base64, or null on failure
   */
  async cropImage(base64, bounds) {
    let bitmap;
    try {
      // Decode base64 → Blob
      const byteChars = atob(base64);
      const byteNums = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i);
      }
      const blob = new Blob([byteNums], { type: 'image/jpeg' });

      // createImageBitmap is available in service workers
      bitmap = await createImageBitmap(blob);

      // Clamp bounds to actual image dimensions
      const x = Math.max(0, Math.round(bounds.x));
      const y = Math.max(0, Math.round(bounds.y));
      const width = Math.min(Math.round(bounds.width), bitmap.width - x);
      const height = Math.min(Math.round(bounds.height), bitmap.height - y);

      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid crop dimensions: ${width}x${height}`);
      }

      // OffscreenCanvas is available in service workers
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(bitmap, x, y, width, height, 0, 0, width, height);

      // Export to blob → base64 (chunked apply avoids O(n²) string concat)
      const croppedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      const arrayBuffer = await croppedBlob.arrayBuffer();
      const croppedBytes = new Uint8Array(arrayBuffer);
      const CHUNK_SIZE = 8192;
      let binary = '';
      for (let i = 0; i < croppedBytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode.apply(null, croppedBytes.subarray(i, i + CHUNK_SIZE));
      }

      return btoa(binary);

    } catch (error) {
      console.warn('cropImage failed, will use full screenshot:', error.message);
      return null;
    } finally {
      if (bitmap) bitmap.close(); // Free GPU memory in all paths
    }
  }

  /**
   * Process queued capture requests
   */
  async processQueue() {
    if (this.captureQueue.length === 0) return;
    
    const { resolve, reject, tabId, options } = this.captureQueue.shift();
    
    try {
      const result = await this.captureTab(tabId, options);
      resolve(result);
    } catch (error) {
      reject(error);
    }
  }
  
  /**
   * Clean up all screenshot resources
   */
  cleanup() {
    this.captureQueue = [];
    this.isCapturing = false;
    // Memory manager will handle resource cleanup
  }
  
  /**
   * Get capture statistics
   */
  getStats() {
    return {
      isCapturing: this.isCapturing,
      queuedRequests: this.captureQueue.length,
      memoryStats: memoryManager.getMemoryStats()
    };
  }
}

// Create singleton instance
const screenshotManager = new ScreenshotManager();

export default screenshotManager;
export { ScreenshotManager };