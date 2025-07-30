const OpenAI = require('openai');
const config = require('../config/config');

const openai = new OpenAI({
  apiKey: config.openaiApiKey
});

const VIDEO_FOCUSED_DETECTION_PROMPT = `You are an expert at identifying video content in web screenshots. Your primary focus is distinguishing between VIDEO ADS, SPORTS VIDEO CONTENT, and OTHER CONTENT. Only classify content as "ad" if it's a VIDEO ADVERTISEMENT that would have audio.

Classification Rules:

**"ad" - VIDEO ADVERTISEMENTS ONLY (that have audio):**
- YouTube pre-roll, mid-roll, and post-roll video ads
- Video ads playing on streaming platforms (Twitch, etc.)
- Video commercials with "Skip Ad" buttons or countdown timers
- Auto-playing video advertisements on websites
- Video ads with play/pause controls and audio indicators
- Commercial breaks during live streams
- Video advertising overlays with audio content
- Sponsored video content that plays automatically

**DO NOT classify as "ad":**
- Static banner ads on webpages (no audio)
- Display advertisements without video
- Sidebar ads or header/footer promotional content
- Image-based sponsored content
- Text advertisements or promotional links
- Shopping product listings or recommendations
- Static promotional overlays without video

**"game" - SPORTS VIDEO CONTENT:**

Live Sports Video/Streams:
- NFL, NBA, MLB, NHL, Soccer games being streamed/broadcast
- Olympic events and competitions
- Tennis matches, golf tournaments, boxing/MMA events
- Racing events (NASCAR, F1, etc.)
- Any live or recorded sports with active video playback

Sports Video Content:
- YouTube sports highlights and game recaps
- Sports news video segments with game footage
- Player interviews and press conferences (video)
- Sports analysis shows with video components
- Live sports streaming on YouTube, Twitch, or other platforms
- Sports documentary video content
- Fantasy sports video analysis and draft content

Video Player Indicators for Sports:
- Video progress bars showing sports content
- Live streaming indicators with sports action
- Sports video thumbnails actively playing
- Sports broadcast graphics and score overlays
- Video players showing field/court action

**"other" - NON-SPORTS VIDEO or NON-VIDEO CONTENT:**
- Regular YouTube videos (music, tutorials, vlogs, entertainment)
- Netflix, Hulu, Disney+ and other streaming content (non-sports)
- Gaming videos and livestreams (video games, not sports)
- Educational videos, documentaries, how-to content
- Music videos, movie trailers, TV shows
- News videos (non-sports), talk shows, podcasts
- Static websites with no video content
- Social media feeds, articles, productivity apps
- E-commerce sites, search results, forums
- Any webpage content that doesn't involve video playback

**Key Detection Criteria:**

For "ad" classification:
1. Must be VIDEO content (not static images)
2. Must have audio/sound capabilities
3. Look for: video player controls, "Skip Ad" buttons, countdown timers
4. Usually interrupts or precedes main content

For "game" classification:
1. Must show sports-related video content
2. Look for: playing fields/courts, athletes in action, sports equipment
3. Video players showing live or recorded sports
4. Sports broadcast elements and graphics

For "other" classification:
1. Static webpage content (regardless of ads present)
2. Non-sports video content
3. Any content without active video playback
4. Regular browsing activities

**Audio Muting Logic:**
- "ad" = MUTE (video ads with audio)
- "game" = UNMUTE (sports video content)
- "other" = NO CHANGE (maintain current audio state)

Return only a JSON object: {"classification": "ad|game|other", "confidence": 0-100, "reasoning": "brief explanation"}

Be very conservative with "ad" classification - only classify as "ad" if you can clearly see a VIDEO advertisement playing with audio controls or indicators. Static webpage ads should always be "other".`;
class OpenAIService {
  async classifyImage(base64Image) {
    try {
      const startTime = Date.now();
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            { 
              type: "text", 
              text: VIDEO_FOCUSED_DETECTION_PROMPT 
            },
            { 
              type: "image_url", 
              image_url: { 
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: "low" // Use low detail for faster processing
              }
            }
          ]
        }],
        max_tokens: 200,
        temperature: 0.1 // Low temperature for consistent results
      });
      
      const processingTime = (Date.now() - startTime) / 1000;
      const content = response.choices[0].message.content;
      
      // Parse JSON response (handle markdown code blocks)
      let result;
      try {
        // Remove markdown code blocks if present
        let cleanContent = content.trim();
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/```\s*/, '').replace(/\s*```$/, '');
        }
        
        result = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error('Failed to parse OpenAI response:', content);
        throw new Error('invalid_response_format');
      }
      
      // Validate response structure
      if (!result.classification || !['ad', 'game', 'other'].includes(result.classification)) {
        throw new Error('invalid_classification');
      }
      
      if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 100) {
        result.confidence = 50; // Default confidence
      }
      
      return {
        ...result,
        processing_time: processingTime
      };
      
    } catch (error) {
      console.error('OpenAI classification error:', error);
      
      if (error.status === 429) {
        throw new Error('rate_limit');
      }
      if (error.status >= 500) {
        throw new Error('openai_server_error');
      }
      if (error.message === 'invalid_response_format' || error.message === 'invalid_classification') {
        throw error;
      }
      
      throw new Error('classification_failed');
    }
  }
  
  async healthCheck() {
    try {
      // Use the test screenshot for health check
      const fs = require('fs');
      const path = require('path');
      
      // Path to test image (adjust if needed)
      const imagePath = path.join(__dirname, '../test_screenshot.png');
      
      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        throw new Error('Test image not found');
      }
      
      // Read and convert to base64
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      
      // Test classification
      const result = await this.classifyImage(base64Image);
      return { status: 'healthy', test_result: result };
      
    } catch (error) {
      throw new Error(`OpenAI service unhealthy: ${error.message}`);
    }
  }
}

module.exports = new OpenAIService();