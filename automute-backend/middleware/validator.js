const validateClassificationRequest = (req, res, next) => {
    const { image } = req.body;
    
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
    
    next();
  };
  
  module.exports = {
    validateClassificationRequest
  };