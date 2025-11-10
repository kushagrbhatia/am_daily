import { CONFIG } from '../config/constants.js';

class ApiClient {
  constructor() {
    this.baseUrl = CONFIG.API_BASE_URL;
    this.timeout = CONFIG.API_TIMEOUT;
    this.retryAttempts = 3;
    this.retryDelay = 1000; // Base delay in ms
    
    // Bind methods
    this.classifyImage = this.classifyImage.bind(this);
    this.makeRequest = this.makeRequest.bind(this);
    this.handleApiError = this.handleApiError.bind(this);
  }
  
  /**
   * Classify image using the backend API
   * @param {string} base64Image - Base64 encoded image data
   * @param {Object} siteMetadata - Site metadata for prompt optimization
   * @returns {Promise<Object>} Classification result
   */
  async classifyImage(base64Image, siteMetadata = {}) {  
    try {
      console.log('Starting image classification via API');
      
      // Validate input
      if (!base64Image || typeof base64Image !== 'string') {
        throw new Error('Invalid image data provided');
      }
      
      // Log site context for debugging
      if (siteMetadata.hostname) {
        console.log(`Classifying image for site: ${siteMetadata.hostname}`);
      }
      
      // --- THIS IS THE FIX ---
      // The backend expects 'image' and 'timestamp' at the top level,
      // not inside a 'metadata' object.
      const payload = {
        image: base64Image,
        timestamp: new Date().toISOString(),
        ...siteMetadata // Spread metadata properties into the top level
      };
      
      // Make API request with retries
      const result = await this.makeRequest('/classify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      // Validate response structure
      this.validateClassificationResponse(result);
      
      // Enhanced logging with site context
      const siteInfo = result.site_category ? ` (${result.site_category} site)` : '';
      console.log(`Classification completed: ${result.classification} (${result.confidence}%)${siteInfo}`);
      
      return result;
      
    } catch (error) {
      console.error('Image classification failed:', error);
      throw this.handleApiError(error);
    }
  }
  
  /**
   * Make HTTP request with retry logic
   * @param {string} endpoint - API endpoint path
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Response data
   */
  async makeRequest(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        console.log(`API request attempt ${attempt}/${this.retryAttempts}: ${url}`);
        
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        // Make request
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        // Handle HTTP errors
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
          error.status = response.status;
          error.data = errorData;
          throw error;
        }
        
        // Parse JSON response
        const data = await response.json();
        console.log(`API request successful on attempt ${attempt}`);
        
        return data;
        
      } catch (error) {
        lastError = error;
        
        // Don't retry on certain errors
        if (this.shouldNotRetry(error)) {
          throw error;
        }
        
        // Don't retry on last attempt
        if (attempt === this.retryAttempts) {
          throw lastError;
        }
        
        // Calculate delay with exponential backoff
        const delay = this.retryDelay * Math.pow(2, attempt - 1);
        console.warn(`API request failed, retrying in ${delay}ms:`, error.message);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError;
  }
  
  /**
   * Check if error should not be retried
   * @param {Error} error - Error to check
   * @returns {boolean} True if should not retry
   */
  shouldNotRetry(error) {
    // Don't retry client errors (4xx) except for 429 (rate limit)
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      return true;
    }
    
    // Don't retry validation errors
    if (error.message.includes('Invalid image data')) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Validate classification response structure
   * @param {Object} response - API response to validate
   */
  validateClassificationResponse(response) {
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format');
    }
    
    const { classification, confidence } = response;
    
    // Update validation for new binary YouTube classification
    const validClassifications = ['ad', 'game', 'other'];  
    
    // Validate classification
    if (!classification || !validClassifications.includes(classification)) {
      throw new Error(`Invalid classification: ${classification}`);
    }
    
    // Validate confidence
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 100) {
      throw new Error(`Invalid confidence: ${confidence}`);
    }
    
    return true;
  }
  
  /**
   * Handle and normalize API errors
   * @param {Error} error - Original error
   * @returns {Error} Normalized error
   */
  handleApiError(error) {
    // Network/timeout errors
    if (error.name === 'AbortError') {
      const timeoutError = new Error('API request timeout');
      timeoutError.type = CONFIG.ERROR_TYPES.API_FAILED;
      timeoutError.retryable = true;
      return timeoutError;
    }
    
    // HTTP status errors
    if (error.status) {
      switch (error.status) {
        case 400:
          const validationError = new Error(error.data?.message || 'Invalid request');
          validationError.type = CONFIG.ERROR_TYPES.API_FAILED;
          validationError.retryable = false;
          return validationError;
          
        case 429:
          const rateLimitError = new Error('Rate limit exceeded');
          rateLimitError.type = CONFIG.ERROR_TYPES.API_FAILED;
          rateLimitError.retryable = true;
          rateLimitError.retryAfter = error.data?.retry_after || 60;
          return rateLimitError;
          
        case 500:
        case 502:
        case 503:
          const serverError = new Error('Server temporarily unavailable');
          serverError.type = CONFIG.ERROR_TYPES.API_FAILED;
          serverError.retryable = true;
          return serverError;
          
        default:
          const httpError = new Error(`HTTP ${error.status}: ${error.message}`);
          httpError.type = CONFIG.ERROR_TYPES.API_FAILED;
          httpError.retryable = error.status >= 500;
          return httpError;
      }
    }
    
    // Network errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      const networkError = new Error('Network connection failed');
      networkError.type = CONFIG.ERROR_TYPES.API_FAILED;
      networkError.retryable = true;
      return networkError;
    }
    
    // Default error
    const defaultError = new Error(error.message || 'Unknown API error');
    defaultError.type = CONFIG.ERROR_TYPES.API_FAILED;
    defaultError.retryable = false;
    return defaultError;
  }
  
  /**
   * Test API health
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      const result = await this.makeRequest('/health', {
        method: 'GET'
      });
      
      return {
        status: 'healthy',
        data: result
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }
  
  /**
   * Get API client statistics
   * @returns {Object} Client statistics
   */
  getStats() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      retryAttempts: this.retryAttempts,
      retryDelay: this.retryDelay
    };
  }
  
  /**
   * Update API configuration
   * @param {Object} config - New configuration
   */
  updateConfig(config) {
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    if (config.timeout) this.timeout = config.timeout;
    if (config.retryAttempts) this.retryAttempts = config.retryAttempts;
    if (config.retryDelay) this.retryDelay = config.retryDelay;
  }
}

// Create singleton instance
const apiClient = new ApiClient();

export default apiClient;
export { ApiClient };