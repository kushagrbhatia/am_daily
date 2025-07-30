import { CONFIG } from '../config/constants.js';

class MemoryManager {
  constructor() {
    this.resources = new Map();
    this.cleanupTimer = null;
    this.memoryUsage = 0;
    this.isCleanupRunning = false;
    
    // Start automatic cleanup timer
    this.startPeriodicCleanup();
    
    // Bind methods to preserve context
    this.trackResource = this.trackResource.bind(this);
    this.cleanup = this.cleanup.bind(this);
    this.forceCleanup = this.forceCleanup.bind(this);
  }
  
  /**
   * Track a resource for cleanup
   * @param {string} id - Unique identifier for the resource
   * @param {Object} resource - Resource object with cleanup method
   * @param {number} estimatedSize - Estimated size in bytes
   */
  trackResource(id, resource, estimatedSize = 0) {
    try {
      // Remove existing resource with same ID
      if (this.resources.has(id)) {
        this.cleanupResource(id);
      }
      
      // Add new resource
      this.resources.set(id, {
        resource,
        estimatedSize,
        createdAt: Date.now(),
        lastAccessed: Date.now()
      });
      
      this.memoryUsage += estimatedSize;
      
      // Check if we need emergency cleanup
      if (this.memoryUsage > CONFIG.EMERGENCY_CLEANUP_THRESHOLD || 
          this.resources.size > CONFIG.MAX_RESOURCES_IN_MEMORY) {
        this.forceCleanup();
      }
      
      console.log(`Resource tracked: ${id}, Total memory: ${this.memoryUsage} bytes`);
    } catch (error) {
      console.error('Error tracking resource:', error);
    }
  }
  
  /**
   * Clean up a specific resource
   * @param {string} id - Resource ID to cleanup
   */
/**
 * Clean up a specific resource
 * @param {string} id - Resource ID to cleanup
 */
cleanupResource(id) {
    try {
      const item = this.resources.get(id);
      if (!item) return false;
      
      const { resource, estimatedSize } = item;
      
      // Call cleanup method if available
      if (resource && typeof resource.cleanup === 'function') {
        resource.cleanup();
      }
      
      // Handle different resource types - with service worker checks
      if (resource instanceof Blob) {
        // Blob cleanup is automatic, just remove reference
      } else if (typeof resource === 'string' && resource.startsWith('blob:')) {
        // Revoke blob URL
        try {
          URL.revokeObjectURL(resource);
        } catch (e) {
          // Ignore errors in service worker context
        }
      } else if (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) {
        // Only try canvas cleanup if HTMLCanvasElement is available (not in service worker)
        try {
          const ctx = resource.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, resource.width, resource.height);
          }
        } catch (e) {
          // Ignore canvas errors
        }
      } else if (typeof ImageData !== 'undefined' && resource instanceof ImageData) {
        // ImageData cleanup is automatic
      }
      
      // Remove from tracking
      this.resources.delete(id);
      this.memoryUsage = Math.max(0, this.memoryUsage - estimatedSize);
      
      console.log(`Resource cleaned: ${id}, Remaining memory: ${this.memoryUsage} bytes`);
      return true;
    } catch (error) {
      console.error(`Error cleaning resource ${id}:`, error);
      return false;
    }
  }
  
  /**
   * Clean up all resources
   */
  cleanup() {
    if (this.isCleanupRunning) return;
    this.isCleanupRunning = true;
    
    try {
      console.log(`Starting cleanup of ${this.resources.size} resources`);
      
      const resourceIds = Array.from(this.resources.keys());
      let cleanedCount = 0;
      
      for (const id of resourceIds) {
        if (this.cleanupResource(id)) {
          cleanedCount++;
        }
      }
      
      // Force garbage collection if available
      if (typeof window !== 'undefined' && window.gc) {
        window.gc();
      }
      
      console.log(`Cleanup completed: ${cleanedCount} resources cleaned`);
    } catch (error) {
      console.error('Error during cleanup:', error);
    } finally {
      this.isCleanupRunning = false;
    }
  }
  
  /**
   * Force cleanup of oldest resources to free memory
   */
  forceCleanup() {
    try {
      console.warn('Force cleanup triggered');
      
      // Sort resources by creation time (oldest first)
      const sortedResources = Array.from(this.resources.entries())
        .sort(([, a], [, b]) => a.createdAt - b.createdAt);
      
      // Clean up oldest resources until we're under the limit
      const targetSize = Math.floor(CONFIG.MAX_RESOURCES_IN_MEMORY / 2);
      
      while (this.resources.size > targetSize && sortedResources.length > 0) {
        const [id] = sortedResources.shift();
        this.cleanupResource(id);
      }
      
      console.log(`Force cleanup completed, ${this.resources.size} resources remaining`);
    } catch (error) {
      console.error('Error during force cleanup:', error);
    }
  }
  
  /**
   * Start periodic cleanup timer
   */
  startPeriodicCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(() => {
      // Clean up resources older than 60 seconds
      const cutoffTime = Date.now() - 60000;
      const expiredIds = [];
      
      for (const [id, item] of this.resources.entries()) {
        if (item.createdAt < cutoffTime) {
          expiredIds.push(id);
        }
      }
      
      for (const id of expiredIds) {
        this.cleanupResource(id);
      }
      
      if (expiredIds.length > 0) {
        console.log(`Periodic cleanup: ${expiredIds.length} expired resources cleaned`);
      }
    }, CONFIG.CLEANUP_INTERVAL);
  }
  
  /**
   * Stop periodic cleanup
   */
  stopPeriodicCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
  
  /**
   * Get memory usage statistics
   */
  getMemoryStats() {
    return {
      resourceCount: this.resources.size,
      estimatedMemoryUsage: this.memoryUsage,
      resources: Array.from(this.resources.entries()).map(([id, item]) => ({
        id,
        estimatedSize: item.estimatedSize,
        age: Date.now() - item.createdAt
      }))
    };
  }
  
  /**
   * Clean up when extension is unloaded
   */
  destroy() {
    this.stopPeriodicCleanup();
    this.cleanup();
  }
}

// Create singleton instance
const memoryManager = new MemoryManager();

// Export for use in other modules
export default memoryManager;

// Also export the class for testing
export { MemoryManager };