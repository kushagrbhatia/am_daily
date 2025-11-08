const OpenAI = require('openai');
const config = require('../config/config');

const openai = new OpenAI({
  apiKey: config.openaiApiKey
});

// ENHANCED YouTube-specific prompt with spatial awareness and step-by-step guidance
const YOUTUBE_VIDEO_PLAYER_FOCUSED_PROMPT = `You are an expert at identifying advertisements in YouTube video screenshots.

STEP 1: LOCATE THE VIDEO PLAYER
The video player is the LARGE CENTRAL RECTANGLE (typically 16:9 aspect ratio) where video content plays.
- Usually occupies 60-80% of screen width in the upper-center portion of the page
- Has playback controls (play/pause, timeline, volume) at the bottom
- IGNORE everything outside this rectangle

STEP 2: IDENTIFY AD INDICATORS (in priority order)

🔴 DEFINITIVE AD SIGNS (95-100% confidence):
1. Yellow "Ad" icon/badge in bottom-left corner of video player
2. "Skip Ad" button (typically bottom-right, appears after 5 seconds)
3. Ad countdown timer: "Ad will end in X seconds" or "Video will play after ad"
4. "Video will play after ad" message
5. "Ad X of Y" indicator showing multiple ads
6. "Visit advertiser" or "Why this ad?" links on video player

⚠️ STRONG AD INDICATORS (80-95% confidence):
7. "Sponsored" text overlay on the video player itself
8. "Learn More" or "Shop Now" CTA buttons overlaying the video content
9. Commercial product/service advertisement playing in the video frame (car ads, product commercials)
10. Black bars/letterboxing with promotional content and company logos
11. Muted speaker icon with "Tap to unmute ad"

✅ NOT ADS - These are NON-AD content:
- Video thumbnails or preview screens (even if showing products)
- Paused video at any frame showing actual content
- YouTube's video suggestions sidebar (right side of screen)
- Video title/description containing words like "ad", "sponsor", "commercial" (text BELOW player)
- Channel promotional content within the creator's own video (in-video sponsorships)
- Product reviews, unboxing videos, or tutorials (creator content)
- Video buffering/loading screens
- End-screen video recommendations
- Actual video content playing (even if it contains sponsor mentions)

CRITICAL RULES:
❌ DO NOT classify as "ad" based on:
   - Video TITLES or DESCRIPTIONS mentioning sponsors
   - Sidebar recommended videos
   - Comments section content
   - Channel names or subscriber information
   - Static banner ads on the webpage outside video player
   - The actual video content itself (only pre-roll/mid-roll/post-roll ads should be classified as "ad")

STEP 3: CONFIDENCE SCORING
- 95-100%: Multiple definitive signs (ad badge + skip button + countdown)
- 85-94%: One definitive sign present
- 70-84%: Multiple strong indicators
- 60-69%: One strong indicator
- Below 60%: Uncertain, default to "non-ad"

EXAMPLES:

Example 1 (AD - 100% confidence):
"Yellow 'Ad' badge in bottom-left, 'Skip Ad' button in bottom-right, countdown shows '5 seconds remaining'"

Example 2 (AD - 95% confidence):
"Car commercial playing in video player, 'Learn More' button overlaying the video, no skip button visible yet"

Example 3 (NON-AD - 95% confidence):
"Video title says 'Sponsored by NordVPN' but video player shows actual gaming content with no ad indicators"

Example 4 (NON-AD - 90% confidence):
"Paused video showing product review, creator is holding product on screen, playback controls visible, no ad overlays"

Response format: {"classification": "ad|non-ad", "confidence": 0-100, "reasoning": "specific visual elements IN video player only"}`;

// Sports streaming sites prompt
const SPORTS_STREAMING_PROMPT = `You're an expert at identifying ads in sports streaming screenshots.

Classify this sports streaming screenshot as "ad" or "non-ad".

PRIORITY 1 - STREAMING AD DETECTION:
Look for these ad patterns FIRST:
- Commercial breaks with "We'll be right back" messages
- Video advertisements interrupting live sports
- Betting/gambling ads (DraftKings, FanDuel, BetMGM, etc.)
- Car commercials, beer ads, insurance ads during breaks
- "Advertisement" overlays on streaming players
- Sponsored content banners covering the game feed
- Product placement commercials during breaks
- Auto/beer/food brand commercials (not just logos on field/jerseys)
- Subscription prompts for premium tiers
- "Skip Ad" or countdown timers on streaming platforms
- Full-screen promotional content blocking the game

PRIORITY 2 - LIVE SPORTS/NON-AD DETECTION:
Only if NO ads found:
- Live NFL, NBA, MLB, NHL, Soccer games in progress
- Active gameplay with players, referees, scoreboards
- Sports broadcasts with real-time action
- Professional athletes competing
- Game statistics, score overlays, time clocks
- Playing fields: football field, basketball court, soccer pitch, hockey rink
- Team uniforms, equipment, stadium views
- Sports commentary and analysis during games
- Pre-game/post-game analysis
- Halftime shows
- Replays and highlights
- Menus, loading screens, navigation interfaces

IMPORTANT DISTINCTIONS:
- In-stadium advertising (banners, field logos, jersey sponsors) = NON-AD (part of live game)
- Commercial breaks interrupting the game = AD
- Broadcaster logos (ESPN, FOX, etc.) = NON-AD (part of broadcast)
- Full-screen product commercials = AD

Platform-specific patterns:
- ESPN/FOX/CBS: Commercial fade-outs with "We'll be right back"
- Peacock/Hulu/Prime: Streaming service ad overlays covering content
- Free streams (StreamEast, Buffstreams): Pop-up ads, redirect overlays, suspicious "Download" buttons

Response: {"classification": "ad|non-ad", "confidence": 0-100, "reasoning": "specific visual elements seen"}

REMEMBER: Only classify as "ad" if there's an actual advertisement interrupting or covering the sports content. Live game footage with in-stadium advertising is "non-ad".`;

// Generic fallback prompt
const GENERIC_PROMPT = `You are an expert at identifying advertisements in website screenshots.

Classify as "ad" or "non-ad".

AD: Advertisements, sponsored content interruptions, promotional overlays, commercial breaks, pop-up ads, video ads, interstitial ads

NON-AD: All regular content including articles, videos, entertainment, sports, menus, navigation, actual website content, user-generated content

Response: {"classification": "ad|non-ad", "confidence": 0-100, "reasoning": "brief"}`;

// Site categorization
const SITE_CATEGORIES = {
  youtube: ['youtube.com', 'youtu.be', 'm.youtube.com'],
  
  sportsStreaming: [
    // Official Sports Networks
    'espn.com', 'espn.go.com', 'watchespn.com',
    'fox.com', 'foxsports.com', 'fs1.com', 'fs2.com',
    'cbs.com', 'cbssports.com', 'cbssportsnetwork.com',
    'peacocktv.com', 'peacock.com',
    'hulu.com', 'hulu.tv',
    'amazon.com', 'primevideo.com', 'amazon.ca', 'amazon.co.uk',
    'nfl.com', 'nflnetwork.com', 'nflredzone.com',
    'nba.com', 'nba.tv',
    'mlb.com', 'mlb.tv',
    'nhl.com', 'nhl.tv',
    'paramount.com', 'paramountplus.com',
    'fubo.tv', 'fubotv.com',
    'sling.com', 'slingtv.com',
    'directv.com', 'stream.directv.com',
    'youtube.tv', 'tv.youtube.com',
    
    // Free Streaming Sites
    'streameast.io', 'streameast.live', 'streameast.app',
    'buffstreams.tv', 'buffstreams.io', 'buff.ly',
    'crackstreams.com', 'crackstreams.io', 'crack.stream',
    'sportsurge.net', 'sportsurge.io', 'sportsurge.club',
    'reddit.nflbite.com', 'nflbite.com',
    'nbastreams.tv', 'nbastream.tv',
    'mlbstreams.tv', 'mlbstream.tv',
    'nhlstreams.tv', 'nhlstream.tv',
    'footybite.com', 'soccer-streams.net',
    'methstreams.com', 'meth.co',
    'givemenflstreams.com', 'givemeredditstreams.com',
    'topstreams.info', 'topstreams.tv',
    'vipleague.lc', 'vipleague.st', 'viprow.me',
    'firstrowsports.tv', 'firstrow.eu',
    'livesoccertv.com', 'livetvsx.eu',
    'strikeout.me', 'strikeout.club',
    'bosscast.net', 'bosscast.eu',
    'liveonlinetv247.info', 'livetvsx.tv'
  ]
};

function categorizeWebsite(hostname) {
  if (!hostname) return 'general';
  
  const lowerHost = hostname.toLowerCase();
  
  // Check YouTube
  if (SITE_CATEGORIES.youtube.some(site => lowerHost.includes(site))) {
    return 'youtube';
  }
  
  // Check Sports Streaming
  if (SITE_CATEGORIES.sportsStreaming.some(site => lowerHost.includes(site))) {
    return 'sportsStreaming';
  }
  
  return 'general';
}

function getOptimizedPrompt(hostname) {
  const category = categorizeWebsite(hostname);
  
  switch (category) {
    case 'youtube':
      return YOUTUBE_VIDEO_PLAYER_FOCUSED_PROMPT;  // UPDATED: Use video-player-focused prompt
    case 'sportsStreaming':
      return SPORTS_STREAMING_PROMPT;
    default:
      return GENERIC_PROMPT;
  }
}

class OpenAIService {
  async classifyImage(base64Image, siteMetadata = {}) {
    try {
      const startTime = Date.now();
      
      // Get hostname from metadata
      const hostname = siteMetadata.hostname || siteMetadata.referer || '';
      const prompt = getOptimizedPrompt(hostname);
      const siteCategory = categorizeWebsite(hostname);
      
      console.log(`🎯 Using ${siteCategory} prompt for ${hostname}`);
      
      // ENHANCED: Log prompt type for YouTube debugging
      if (siteCategory === 'youtube') {
        console.log('📺 Using VIDEO-PLAYER-FOCUSED YouTube prompt');
        console.log('🎯 Prompt will ignore titles and focus on video player area only');
      }
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            { 
              type: "text", 
              text: prompt 
            },
            { 
              type: "image_url", 
              image_url: { 
                url: `data:image/jpeg;base64,${base64Image}`,
                detail: "low" // Keep low for speed
              }
            }
          ]
        }],
        max_tokens: 120,      // Optimized for faster response
        temperature: 0,       // Zero for maximum consistency  
        top_p: 0.1,          // Focus responses
        stop: ["}"],         // Stop immediately after JSON completion
        frequency_penalty: 0.1 // Encourage concise reasoning
      });
      
      const processingTime = (Date.now() - startTime) / 1000;
      const content = response.choices[0].message.content;
      
      // Parse JSON response with enhanced error handling
      let result = this.parseResponse(content, siteCategory);
      result = this.validateAndNormalizeResult(result, hostname);
      
      // ENHANCED: Log YouTube-specific debugging
      if (siteCategory === 'youtube') {
        console.log(`📺 YouTube classification result:`);
        console.log(`   Classification: ${result.classification}`);
        console.log(`   Confidence: ${result.confidence}%`);
        console.log(`   Reasoning: ${result.reasoning}`);
        console.log(`   Should ${result.classification === 'ad' ? 'MUTE' : 'UNMUTE'} based on classification`);
      }
      
      console.log(`✅ ${siteCategory} classification: ${result.classification} (${result.confidence}%) in ${processingTime}s`);
      
      return {
        ...result,
        processing_time: processingTime,
        site_category: siteCategory,
        tokens_used: response.usage?.total_tokens || 0,
        prompt_type: siteCategory === 'youtube' ? 'video_player_focused' : 'standard'
      };
      
    } catch (error) {
      console.error('OpenAI classification error:', error);
      
      if (error.status === 429 || error.message.includes('rate_limit')) {
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
  
  parseResponse(content, siteCategory) {
    try {
      let cleanContent = content.trim();
      
      // Handle incomplete JSON from stop token
      if (!cleanContent.endsWith('}')) {
        cleanContent += '}';
      }
      
      // Remove markdown code blocks if present
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/```\s*/, '').replace(/\s*```$/, '');
      }
      
      return JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', content);
      console.error('Parse error:', parseError.message);
      
      // Fallback: extract classification from text
      return this.extractClassificationFromText(content, siteCategory);
    }
  }
  
  extractClassificationFromText(text, siteCategory) {
    const lowerText = text.toLowerCase();
    
    // Default to safe classification
    let classification = siteCategory === 'youtube' ? 'other' : 'other';
    let confidence = 50;
    
    // Look for ad indicators with enhanced YouTube detection
    if (lowerText.includes('"ad"') || 
        lowerText.includes('advertisement') || 
        lowerText.includes('skip ad') ||
        lowerText.includes('sponsored') ||
        lowerText.includes('learn more') ||
        lowerText.includes('visit advertiser')) {  // ADDED: More YouTube ad indicators
      classification = 'ad';
      confidence = 80;
    } else if (siteCategory === 'sportsStreaming' && 
               (lowerText.includes('"game"') || 
                lowerText.includes('sports') || 
                lowerText.includes('match') ||
                lowerText.includes('gameplay'))) {
      classification = 'game';
      confidence = 80;
    }
    
    // Try to extract confidence if present
    const confMatch = text.match(/\d{1,3}(?=%|\s*confidence)/i);
    if (confMatch) {
      confidence = Math.min(100, Math.max(0, parseInt(confMatch[0])));
    }
    
    return {
      classification,
      confidence,
      reasoning: "Extracted from malformed response"
    };
  }
  
  validateAndNormalizeResult(result, hostname) {
    const siteCategory = categorizeWebsite(hostname);
    
    // Ensure required fields exist
    if (!result.classification) {
      result.classification = siteCategory === 'youtube' ? 'other' : 'other';
    }
    
    if (typeof result.confidence !== 'number') {
      result.confidence = 50;
    }
    
    if (!result.reasoning) {
      result.reasoning = 'Classification completed';
    }
    
    // Normalize classification based on site type
    if (siteCategory === 'youtube') {
      // YouTube: only "ad" or "other" 
      const validClassifications = ['ad', 'other'];
      if (!validClassifications.includes(result.classification)) {
        result.classification = 'other';  // Default to unmute for YouTube
      }
      // Convert any "game" classifications to "other" for YouTube
      if (result.classification === 'game') {
        result.classification = 'other';
        result.reasoning = 'YouTube content (converted from game to other)';
        console.log('🔄 Converted YouTube "game" classification to "other"');
      }
    } else {
      // Sports streaming: "ad", "game", or "other"
      const validClassifications = ['ad', 'game', 'other'];
      if (!validClassifications.includes(result.classification)) {
        result.classification = 'other';
      }
    }
    
    // Normalize confidence (0-100)
    result.confidence = Math.min(100, Math.max(0, Math.round(result.confidence)));
    
    // UPDATED: Site-specific confidence adjustments with enhanced YouTube focus
    if (siteCategory === 'youtube') {
      // Boost confidence for YouTube ad detection, especially for sponsored content
      if (result.classification === 'ad') {
        result.confidence = Math.min(100, result.confidence + 15);  // Increased boost from 10 to 15
        console.log(`📺 YouTube ad confidence boosted to ${result.confidence}%`);
      }
      
      // Lower confidence requirements for sponsored content detection
      if (result.reasoning && result.reasoning.toLowerCase().includes('sponsored')) {
        result.confidence = Math.min(100, result.confidence + 20);
        console.log(`📺 "Sponsored" content detected - confidence boosted to ${result.confidence}%`);
      }
    } else if (siteCategory === 'sportsStreaming' && result.classification === 'game') {
      // Boost confidence for sports content on sports sites
      result.confidence = Math.min(100, result.confidence + 15);
    }
    
    return result;
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
      
      // Test classification with YouTube metadata
      const result = await this.classifyImage(base64Image, { hostname: 'youtube.com' });
      return { 
        status: 'healthy', 
        test_result: result,
        prompt_test: 'YouTube video-player-focused prompt tested successfully'
      };
      
    } catch (error) {
      throw new Error(`OpenAI service unhealthy: ${error.message}`);
    }
  }
  
  // Utility method to get prompt for debugging
  getPromptForSite(hostname) {
    return {
      hostname,
      category: categorizeWebsite(hostname),
      prompt: getOptimizedPrompt(hostname),
      prompt_type: categorizeWebsite(hostname) === 'youtube' ? 'video_player_focused' : 'standard'
    };
  }
  
  // Get classification statistics
  getStats() {
    return {
      youtube_sites: SITE_CATEGORIES.youtube,
      sports_streaming_sites: SITE_CATEGORIES.sportsStreaming,
      supported_categories: ['youtube', 'sportsStreaming', 'general'],
      youtube_prompt_type: 'video_player_focused'
    };
  }
}

module.exports = new OpenAIService();