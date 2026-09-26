require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
  try {
    // GoogleGenAI automatically picks up GEMINI_API_KEY from environment variables
    const ai = new GoogleGenAI({});
    console.log('Testing Gemini API key...');
    
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: 'Respond with a simple "Hello, world! Your key is working."',
    });
    console.log('\n✅ SUCCESS! Gemini responded with:\n', response.text);
  } catch (error) {
    console.error('\n❌ FAILED! Error testing Gemini API:', error.message || error);
  }
}

test();
