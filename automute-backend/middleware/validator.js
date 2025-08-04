const validateClassificationRequest = (req, res, next) => {
  const { image, metadata } = req.body;  // Extract both image and metadata
  
  // Check if image is provided
  if (!image) {
    return res.status(400).json({
      error: 'missing_image',
      message: 'Image data is required'
    });
  }
  
  // Check if image is valid base64
  if (typeof image !== 'string') {
    return res.status(400).json({
      error: 'invalid_image_format',
      message: 'Image must be a base64 string'
    });
  }
  
  // Check image size (base64 encoded, so roughly 4/3 of actual size)
  const imageSizeBytes = (image.length * 3) / 4;
  const maxSizeBytes = 10 * 1024 * 1024; // 10MB
  
  if (imageSizeBytes > maxSizeBytes) {
    return res.status(400).json({
      error: 'image_too_large',
      message: 'Image size exceeds 10MB limit'
    });
  }
  
  // Basic base64 validation
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(image)) {
    return res.status(400).json({
      error: 'invalid_base64',
      message: 'Image data is not valid base64'
    });
  }
  
  // Validate metadata (optional field)
  if (metadata !== undefined) {
    if (typeof metadata !== 'object' || metadata === null) {
      return res.status(400).json({
        error: 'invalid_metadata',
        message: 'Metadata must be an object if provided'
      });
    }
    
    // Sanitize hostname if present
    if (metadata.hostname) {
      if (typeof metadata.hostname !== 'string') {
        return res.status(400).json({
          error: 'invalid_hostname',
          message: 'Hostname must be a string'
        });
      }
      
      // Clean and normalize hostname
      metadata.hostname = metadata.hostname
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, '') // Remove any non-alphanumeric chars except dots and hyphens
        .replace(/^www\./, '');      // Remove www prefix for consistency
      
      // Validate hostname format
      const hostnameRegex = /^[a-z0-9.-]+\.[a-z]{2,}$/;
      if (metadata.hostname && !hostnameRegex.test(metadata.hostname)) {
        // Don't reject, just clear invalid hostname
        metadata.hostname = '';
      }
    }
    
    // Validate referer if present
    if (metadata.referer) {
      if (typeof metadata.referer !== 'string') {
        delete metadata.referer; // Remove invalid referer
      } else if (!metadata.referer.startsWith('http://') && !metadata.referer.startsWith('https://')) {
        delete metadata.referer; // Remove invalid referer
      }
    }
    
    // Validate title if present
    if (metadata.title && typeof metadata.title !== 'string') {
      delete metadata.title;
    }
    
    // Validate timestamp if present
    if (metadata.timestamp && typeof metadata.timestamp !== 'number') {
      delete metadata.timestamp;
    }
    
    // Log metadata for debugging (remove in production)
    if (metadata.hostname) {
      console.log(`Request for site: ${metadata.hostname}`);
    }
  }
  
  next();
};

module.exports = {
  validateClassificationRequest
};