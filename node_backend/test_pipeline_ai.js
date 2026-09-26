require('dotenv').config();
const qcEngine = require('./services/qc_engine');

async function testPipeline() {
  console.log(`Starting Pipeline Test with model: ${qcEngine.GEMINI_MODEL}`);
  
  const mockTranscript = "Agent: Hello, welcome to the university admissions center. Are you interested in the KNET exam?\nCustomer: Yes, I am very interested and have the budget ready to enroll.";
  
  console.log("\nMock Transcript:");
  console.log(mockTranscript);
  
  // Mock data capture questions (as if fetched from DB)
  const mockQuestions = [
    { label: "Exam Interest", question: "Is the student interested in KNET?" },
    { label: "Budget", question: "Does the student have budget?" }
  ];
  
  try {
    const insightsSchema = qcEngine.getInsightsSchema(mockQuestions);
    const insightsPrompt = qcEngine.buildInsightsPrompt(mockTranscript, 'phone_call', mockQuestions, [], null);
    
    console.log("\nSending prompt to Gemini via qc_engine...");
    const response = await qcEngine.ai.models.generateContent({
      model: qcEngine.GEMINI_MODEL,
      contents: insightsPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: insightsSchema,
        temperature: 0.15
      }
    });
    
    console.log("\n✅ SUCCESS! Pipeline AI Integration works. Parsed Output:");
    console.log(JSON.stringify(JSON.parse(response.text), null, 2));
  } catch (err) {
    console.error("\n❌ PIPELINE ERROR:", err.message || err);
  }
}

testPipeline();
