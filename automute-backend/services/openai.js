const OpenAI = require('openai');
const config = require('../config/config');
const openai = new OpenAI({
  apiKey: config.openaiApiKey
});

// ✅ IMPROVED PROMPT #1 (Recommended - Balanced)
// This version is less conservative and better at catching ads
const VIDEO_AD_DETECTION_PROMPT_V1 = `You are an expert at identifying video content in web screenshots for auto-muting purposes.

Your job: Classify the screenshot as "ad", "game", or "other" to determine if audio should be muted.

**CLASSIFICATION RULES:**

**"ad" - MUTE THIS (Video Advertisements):**
- Pre-roll/mid-roll/post-roll video ads on YouTube, streaming sites
- Commercial breaks during sports streams or shows
- "Skip Ad in 5 seconds" or countdown timers
- Video ad players with play/pause controls
- Auto-playing video ads anywhere on the web
- Video ads overlaid on content
- Sponsored video content that auto-plays
- Advertisement videos with audio playback
- Any video designed to sell products/services
- Video commercials on streaming platforms
- Static ads on streaming sites (mute to be safe)
- Promotional video content

**"game" - UNMUTE THIS (Sports/Entertainment Video):**
- Live sports broadcasts (NFL, NBA, MLB, NHL, soccer, etc.)
- Sports video highlights and game recaps
- Any live sports streaming with active play
- Sports analysis shows with video
- Sports news with game footage
- Recorded sports games/matches
- Live event streaming (Olympics, tennis, golf, boxing, etc.)
- Sports content with visible field/court/athletes
- League broadcasts and competitions

**"other" - UNMUTE THIS (Everything Else):**
- Regular YouTube videos (music, tutorials, entertainment)
- Netflix/Hulu/Disney+ content (non-sports)
- TV shows and movies (non-sports)
- Gaming videos and gaming livestreams
- Educational content and documentaries
- News videos
- Static web pages with no video
- Social media feeds and articles
- Regular web browsing

**DETECTION HINTS:**
- "Skip Ad" buttons, timers, or countdown = definitely "ad"
- Score overlays, player names, sports graphics = definitely "game"
- Looks like a commercial or advertisement = "ad"
- Playing field/court visible with action = "game"
- Promotional/marketing content = "ad"
- Uncertainty: when in doubt on streaming sites, prefer "ad" for safety

**IMPORTANT:** Be more aggressive with "ad" classification. Static promotional content on streaming sites should be classified as "ad" to prevent unwanted audio.

Return JSON only: {"classification": "ad"|"game"|"other", "confidence": 0-100, "reasoning": "one sentence explanation"}`;

// ✅ IMPROVED PROMPT #2 (Aggressive - Catches More Ads)
// Use this if V1 still misses ads
const VIDEO_AD_DETECTION_PROMPT_V2 = `Classify web screenshot for auto-muting: "ad" (MUTE), "game" (UNMUTE), "other" (UNMUTE).

**AD = Anything promotional/commercial/non-content:**
✓ Video ads, commercials, "Skip Ad" buttons
✓ Ad breaks, promotional overlays
✓ Sponsored content, product promotions
✓ Static ads on streaming platforms
✓ Anything that interrupts main content
✓ Uncertainty on streaming sites = classify as "ad"

**GAME = Sports/entertainment video playback:**
✓ Sports broadcasts, live games, highlights
✓ Movies, TV shows, entertainment videos
✓ Any active video content you want to watch
✓ Visible athletes, fields, action, playing content

**OTHER = Regular browsing:**
✓ Web pages, news articles, static content
✓ Non-video websites, social media feeds
✓ Navigation/menus, UI elements only

**KEY:** When unsure on a streaming site (Fox, ESPN, etc.), classify as "ad" - better to mute ads than unmute them.

Return JSON: {"classification": "ad"|"game"|"other", "confidence": 0-100, "reasoning": "brief explanation"}`;

// ✅ IMPROVED PROMPT #3 (Context-Aware - Best for Streaming)
// Use this if you want to be context-aware about the streaming platform
const VIDEO_AD_DETECTION_PROMPT_V3 = `You are an auto-mute assistant for video streaming. Classify: "ad" (mute), "game" (unmute), "other" (unmute).

**CONTEXT:** This screenshot is from a streaming website (sports, entertainment, video platform).

**CLASSIFICATION:**

**"ad" - MUTE AUDIO:**
1. Video advertisements
   - Pre-roll ads (before main content)
   - Mid-roll ads (during content)
   - Post-roll ads (after content)
   - Commercial breaks
   - "Skip Ad in X seconds" visible
   - Play button on ad, countdown timer

2. Promotional content on streaming sites
   - "Subscribe Now" overlays
   - "Start Your Free Trial" promotions
   - Product advertisements
   - Promotional videos/clips
   - Sponsored content clearly marked

3. Non-content interruptions
   - Loading screens with ads
   - Intermission/break screens
   - Advertisement panels
   - Sponsorship overlays

**"game" - UNMUTE AUDIO:**
1. Live sports content
   - Football, basketball, baseball, hockey, soccer
   - Game in progress with score/stats visible
   - Live commentary/broadcast happening
   - Professional sports being streamed

2. Sports-related video content
   - Highlights, recaps, analysis
   - Sports news with footage
   - Player interviews, press conferences
   - Game replays

3. Entertainment content
   - Movies and TV shows
   - Entertainment videos
   - Streaming platform content you subscribed for
   - Main content being watched

**"other" - UNMUTE AUDIO:**
- Non-video pages (static content, menus, guides)
- Text-based articles or information
- Error messages or system messages
- Navigation or UI elements only

**DECISION LOGIC:**
- If it looks like it interrupts content = "ad"
- If it's actual sports/movie content = "game"  
- If it's just information/navigation = "other"
- On streaming sites with ambiguity: prefer "ad" classification

Return JSON only: {"classification": "ad"|"game"|"other", "confidence": 0-100, "reasoning": "brief explanation"}`;

// ✅ IMPROVED PROMPT #4 (Concise & Direct)
// Simple, no-nonsense version
const VIDEO_AD_DETECTION_PROMPT_V4 = `Classify screenshot for auto-mute: "ad" (mute), "game" (unmute), or "other" (unmute).

AD = Commercial, advertisement, ad break, promotional content, "Skip Ad" button
GAME = Sports game, movie, show, entertainment video being played
OTHER = Web page, navigation, text, non-video content

When on a streaming site (Fox, ESPN, etc.) and unsure: guess "ad".

Return JSON: {"classification": "ad"|"game"|"other", "confidence": 0-100, "reasoning": "brief"}`;

class OpenAIService {
  // ✅ Allow choosing which prompt to use
  constructor(promptVersion = 'v1') {
    this.promptVersion = promptVersion;
    this.prompts = {
      'v1': VIDEO_AD_DETECTION_PROMPT_V1,
      'v2': VIDEO_AD_DETECTION_PROMPT_V2,
      'v3': VIDEO_AD_DETECTION_PROMPT_V3,
      'v4': VIDEO_AD_DETECTION_PROMPT_V4
    };
  }

  getPrompt() {
    return this.prompts[this.promptVersion] || this.prompts['v1'];
  }

  // ✅ FIXED: Better error handling and retry logic
  async classifyImage(base64Image, retryCount = 0) {
    const maxRetries = 2;
    
    try {
      const startTime = Date.now();
      
      // ✅ FIX: Use selected prompt version
      const prompt = this.getPrompt();
      
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
                detail: "low" // Low detail for faster processing
              }
            }
          ]
        }],
        max_tokens: 250, // ✅ Increased slightly for better responses
        temperature: 0.2 // ✅ Very low for consistency
      });

      const processingTime = (Date.now() - startTime) / 1000;
      const content = response.choices[0].message.content;

      // ✅ IMPROVED: Better JSON parsing
      let result;
      try {
        let cleanContent = content.trim();
        
        // Remove markdown code blocks
        if (cleanContent.startsWith('```json')) {
          cleanContent = cleanContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
        } else if (cleanContent.startsWith('```')) {
          cleanContent = cleanContent.replace(/```\s*/, '').replace(/\s*```$/, '');
        }
        
        // Remove any trailing commas or invalid JSON
        cleanContent = cleanContent.replace(/,\s*}/, '}').replace(/,\s*]/, ']');
        
        result = JSON.parse(cleanContent);
      } catch (parseError) {
        console.error('Failed to parse OpenAI response:', content);
        
        // ✅ IMPROVED: Fallback classification based on keywords
        console.log('Attempting keyword-based fallback classification...');
        const lowerContent = content.toLowerCase();
        
        if (lowerContent.includes('ad') || lowerContent.includes('commercial') || lowerContent.includes('skip')) {
          result = {
            classification: 'ad',
            confidence: 65,
            reasoning: 'Fallback: Contains ad-related keywords'
          };
        } else if (lowerContent.includes('game') || lowerContent.includes('sport') || lowerContent.includes('play')) {
          result = {
            classification: 'game',
            confidence: 65,
            reasoning: 'Fallback: Contains game/sports keywords'
          };
        } else {
          result = {
            classification: 'other',
            confidence: 50,
            reasoning: 'Fallback: Could not parse response'
          };
        }
      }

      // ✅ IMPROVED: Validate and enforce response format
      if (!result.classification || !['ad', 'game', 'other'].includes(result.classification)) {
        console.warn('Invalid classification in response, defaulting to "other"');
        result.classification = 'other';
        result.confidence = 50;
      }

      // Ensure confidence is valid
      if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 100) {
        result.confidence = 50;
      }

      // Ensure reasoning exists
      if (!result.reasoning) {
        result.reasoning = 'Classification completed';
      }

      return {
        ...result,
        processing_time: processingTime,
        prompt_version: this.promptVersion
      };

    } catch (error) {
      console.error('OpenAI classification error:', error.message);

      // ✅ IMPROVED: Better error handling and retry logic
      if (error.status === 429 && retryCount < maxRetries) {
        console.log(`Rate limited, retrying... (attempt ${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1))); // Exponential backoff
        return this.classifyImage(base64Image, retryCount + 1);
      }

      // Handle specific errors
      if (error.status === 429) {
        throw new Error('rate_limit');
      }
      if (error.status >= 500) {
        throw new Error('openai_server_error');
      }
      if (error.message === 'invalid_response_format' || error.message === 'invalid_classification') {
        throw error;
      }

      // ✅ IMPROVED: Graceful fallback on any error
      console.warn('Classification failed, returning safe default');
      return {
        classification: 'other', // Safe default - unmute
        confidence: 0,
        reasoning: 'Error in classification, defaulting to other',
        processing_time: 0,
        prompt_version: this.promptVersion,
        error: error.message
      };
    }
  }

  // ✅ NEW: Health check with configurable prompt
  async healthCheck(promptVersion = 'v1') {
    try {
      // Update prompt version for this test
      const oldVersion = this.promptVersion;
      this.promptVersion = promptVersion;

      const fs = require('fs');
      const path = require('path');
      
      // Path to test image
      const imagePath = path.join(__dirname, '../test_screenshot.png');
      
      if (!fs.existsSync(imagePath)) {
        throw new Error('Test image not found');
      }

      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');

      const result = await this.classifyImage(base64Image);

      // Restore original version
      this.promptVersion = oldVersion;

      return { 
        status: 'healthy', 
        test_result: result,
        prompt_version: promptVersion
      };
    } catch (error) {
      throw new Error(`OpenAI service unhealthy: ${error.message}`);
    }
  }

  // ✅ NEW: Switch prompt at runtime
  setPromptVersion(version) {
    if (!this.prompts[version]) {
      throw new Error(`Unknown prompt version: ${version}. Available: v1, v2, v3, v4`);
    }
    this.promptVersion = version;
    console.log(`Switched to prompt version ${version}`);
  }

  // ✅ NEW: Get current prompt info
  getPromptInfo() {
    return {
      current: this.promptVersion,
      available: Object.keys(this.prompts),
      description: {
        'v1': 'Balanced - Recommended for most use cases',
        'v2': 'Aggressive - Catches more ads, fewer false negatives',
        'v3': 'Context-aware - Best for streaming platforms',
        'v4': 'Concise - Simple and direct'
      }
    };
  }

  /**
   * Dual-model classification: fast with gpt-4o-mini, accurate fallback to gpt-4o
   */
  async classifyImageDual(base64Image, confidenceThreshold = 75) {
    // Step 1: try gpt-4o-mini (fast)
    let miniResult;
    try {
      const startTime = Date.now();
      const response = await new OpenAI({ apiKey: config.openaiApiKey })
        .chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: this.getPrompt() },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' } }
            ]
          }],
          max_tokens: 250,
          temperature: 0.2
        });

      miniResult = this._parseResponse(response.choices[0].message.content);
      miniResult.processing_time = (Date.now() - startTime) / 1000;
      miniResult.model_used = 'mini';
    } catch (error) {
      console.error('gpt-4o-mini call failed:', error.message);
      // Fall through to gpt-4o
    }

    // Step 2: if mini succeeded and confidence is high enough, return it
    if (miniResult && miniResult.confidence >= confidenceThreshold) {
      return miniResult;
    }

    // Step 3: fallback to gpt-4o
    try {
      const startTime = Date.now();
      const response = await new OpenAI({ apiKey: config.openaiApiKey })
        .chat.completions.create({
          model: 'gpt-4o',
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: this.getPrompt() },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}`, detail: 'low' } }
            ]
          }],
          max_tokens: 250,
          temperature: 0.2
        });

      const fullResult = this._parseResponse(response.choices[0].message.content);
      fullResult.processing_time = (Date.now() - startTime) / 1000;
      fullResult.model_used = 'gpt4o';
      if (miniResult) fullResult.mini_result = miniResult;
      return fullResult;
    } catch (error) {
      console.error('gpt-4o fallback failed:', error.message);
      // If gpt-4o also fails, return mini result if we have it
      if (miniResult) return miniResult;
      throw error;
    }
  }

  /**
   * Parse OpenAI response content into a classification result object.
   */
  _parseResponse(content) {
    let cleanContent = content.trim();
    if (cleanContent.startsWith('```json')) {
      cleanContent = cleanContent.replace(/```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanContent.startsWith('```')) {
      cleanContent = cleanContent.replace(/```\s*/, '').replace(/\s*```$/, '');
    }
    cleanContent = cleanContent.replace(/,\s*}/, '}').replace(/,\s*]/, ']');

    let result;
    try {
      result = JSON.parse(cleanContent);
    } catch {
      const lower = content.toLowerCase();
      if (lower.includes('ad') || lower.includes('skip')) {
        result = { classification: 'ad', confidence: 65, reasoning: 'Fallback: ad keywords' };
      } else if (lower.includes('game') || lower.includes('sport')) {
        result = { classification: 'game', confidence: 65, reasoning: 'Fallback: game keywords' };
      } else {
        result = { classification: 'other', confidence: 50, reasoning: 'Fallback: parse failed' };
      }
    }

    if (!['ad', 'game', 'other'].includes(result.classification)) result.classification = 'other';
    if (typeof result.confidence !== 'number') result.confidence = 50;
    if (result.confidence < 0 || result.confidence > 100) result.confidence = 50;
    if (!result.reasoning) result.reasoning = 'Classification completed';

    return result;
  }
}

// ✅ IMPROVED: Export with default V1, allow switching
module.exports = new OpenAIService('v1');

// Allow switching at runtime in your route handler:
// Example in your API route:
// openaiService.setPromptVersion('v2'); // Switch to aggressive mode
// const result = await openaiService.classifyImage(base64Image);