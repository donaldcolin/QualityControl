require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const qcEngine = require('./services/qc_engine');

async function testE2EEvaluation() {
  console.log('====================================================');
  console.log('🧪 RUNNING END-TO-END QC EVALUATION WITH CONTEXT CACHING');
  console.log('====================================================\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });
  const model = qcEngine.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  // 1. Get Active Cache
  const activeCacheName = await qcEngine.getActiveCache(ai, model);
  console.log(`✓ Active Cache Pointer: ${activeCacheName}`);

  // 2. Fetch parameters for phone_call
  const { params } = await qcEngine.getParametersForSource('phone_call');
  console.log(`✓ Retrieved ${params.length} active parameters for phone_call`);

  // 3. Build synthetic transcript
  const mockTranscript = `
Speaker 0 (00:02): Hello, am I speaking with Rahul?
Speaker 1 (00:04): Yes, speaking. Who is this?
Speaker 0 (00:06): Hi Rahul, this is Anand from Kalvium. I saw you showed interest in our B.Tech Computer Science program. Is this a good time to speak for 2 minutes?
Speaker 1 (00:13): Yes, tell me.
Speaker 0 (00:15): Great! Which class are you studying right now Rahul, and what is your stream?
Speaker 1 (00:20): I am in 12th standard, studying PCM in Bangalore.
Speaker 0 (00:24): Wonderful! Are you preparing for JEE or attending any coaching classes?
Speaker 1 (00:28): Yes, I go to Allen coaching, preparing for JEE Main. But I am also looking at Scaler and Newton School.
Speaker 0 (00:36): Understood. Kalvium is very different from standard colleges because from year 2 onwards you do paid work internships. In fact, our 2026 batch has 81.8% students placed with top companies like Google and Flipkart, and the highest salary was an outlier 36 LPA, while average is around 10-12 LPA.
Speaker 1 (00:55): Okay, what are the fees?
Speaker 0 (00:58): The academic fees depend on the partner campus, around 3.5 to 4 Lakhs per year. Who usually makes decisions regarding college selection in your family?
Speaker 1 (01:08): My father and I discuss and decide.
Speaker 0 (01:11): Excellent. Can I get your email ID so I can share the syllabus booklet?
Speaker 1 (01:16): rahul.test@gmail.com.
Speaker 0 (01:19): Also do you have laptop access at home to take the KNET entrance exam?
Speaker 1 (01:23): Yes, I have an Asus gaming laptop.
Speaker 0 (01:26): Super. Let us book a 1:1 counselling session with your father tomorrow at 5 PM or 7 PM. Which slot works best?
Speaker 1 (01:34): 7 PM works.
Speaker 0 (01:36): Locked! I will send the Google Meet link on WhatsApp. Thank you Rahul!
`;

  // 4. Build Dynamic Omni Prompt (referencing cached rubric & cached 10 data capture questions)
  const mockChecks = params.slice(0, 10); // test on first 10 checks for validation
  const omniPrompt = qcEngine.buildDynamicOmniPrompt(
    mockTranscript,
    'phone_call',
    null, // dataCaptureQuestions is handled by cached knowledge
    [],
    { intent_score: 75 },
    mockChecks,
    params,
    null
  );

  const omniSchema = qcEngine.getOmniSchema([], mockChecks, params);

  console.log(`✓ Omni Prompt Length: ${omniPrompt.length} chars (lean dynamic prompt)`);

  // 5. Execute with cachedContent
  console.log('⚡ Sending request to Gemini with cachedContent pointer...');
  const startTime = Date.now();
  const response = await qcEngine.generateContentWithRetry({
    model,
    contents: omniPrompt,
    config: {
      cachedContent: activeCacheName,
      responseMimeType: 'application/json',
      responseSchema: omniSchema,
      temperature: 0.15
    }
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  const usage = response.usageMetadata;
  console.log(`\n====================================================`);
  console.log(`⚡ EVALUATION COMPLETED IN ${duration}s`);
  console.log(`====================================================`);
  console.log(`• Total Tokens:      ${usage.totalTokenCount}`);
  console.log(`• Prompt Tokens:     ${usage.promptTokenCount}`);
  console.log(`• Cached Tokens Hit: ${usage.cachedContentTokenCount || 0} (${Math.round(((usage.cachedContentTokenCount || 0) / usage.promptTokenCount) * 100)}% cache hit rate!)`);
  console.log(`• Fresh Paid Tokens: ${usage.promptTokenCount - (usage.cachedContentTokenCount || 0)} tokens`);
  console.log(`• Output Tokens:     ${usage.candidatesTokenCount}`);
  console.log(`====================================================\n`);

  const parsed = qcEngine.safeParseGeminiJSON(response.text);
  console.log('✓ Extracted Data Capture Fields:');
  console.log(JSON.stringify(parsed?.insights?.data_capture?.extracted_fields || [], null, 2));

  console.log('\n✓ Sample Quality Parameter Evaluation:');
  const sampleParamKey = Object.keys(parsed?.quality || {})[0];
  console.log(sampleParamKey, ':', parsed?.quality?.[sampleParamKey]);

  console.log('\n✅ END-TO-END VERIFICATION SUCCEEDED!');
}

testE2EEvaluation().catch(err => {
  console.error('\n❌ E2E EVALUATION FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
