const sharp = require('sharp');

class ImageProcessor {
  async optimizeImage(base64Image) {
    try {
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(base64Image, 'base64');
      
      // Process with sharp to optimize
      const optimizedBuffer = await sharp(imageBuffer)
        .resize(1920, 1080, { 
          fit: 'inside',
          withoutEnlargement: true 
        })
        .jpeg({ 
          quality: 80,
          progressive: true 
        })
        .toBuffer();
      
      // Convert back to base64
      return optimizedBuffer.toString('base64');
    } catch (error) {
      console.error('Image processing error:', error);
      // Return original if processing fails
      return base64Image;
    }
  }
  
  getImageInfo(base64Image) {
    try {
      const imageBuffer = Buffer.from(base64Image, 'base64');
      return sharp(imageBuffer).metadata();
    } catch (error) {
      throw new Error('invalid_image_format');
    }
  }
}

module.exports = new ImageProcessor();