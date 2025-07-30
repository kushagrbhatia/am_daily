const fs = require('fs');
const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function testRealImage() {
  try {
    console.log('Testing with real screenshot...');
    
    // Read your test screenshot and convert to base64
    const imageBuffer = fs.readFileSync('test_screenshot.png');
    const base64Image = imageBuffer.toString('base64');
    
    console.log(`Image size: ${base64Image.length} characters`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { 
            type: "text", 
            text: "Analyze this screenshot and classify it as: 'ad', 'game', or 'other'. Return JSON: {\"classification\": \"ad|game|other\", \"confidence\": 0-100, \"reasoning\": \"brief explanation\"}"
          },
          { 
            type: "image_url", 
            image_url: { 
              url: `data:image/png;base64,${base64Image}`,
              detail: "low"
            }
          }
        ]
      }],
      max_tokens: 200,
      temperature: 0.1
    });
    
    const result = response.choices[0].message.content;
    console.log('Classification result:', result);
    
    // Try to parse as JSON
    try {
      const parsed = JSON.parse(result);
      console.log('Parsed successfully:', parsed);
    } catch (e) {
      console.log('Could not parse as JSON, but got response');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

testRealImage();