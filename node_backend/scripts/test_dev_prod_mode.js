const axios = require('axios');
const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');

const BASE_URL = 'http://localhost:3000/api';
const AUTH_HEADER = {
  headers: {
    'Authorization': 'Bearer internal_qc_worker_secret_2026',
    'Content-Type': 'application/json'
  }
};

async function runTests() {
  console.log('🧪 Starting DEV/PROD Switcher Automated Test Suite...\n');

  try {
    // 1. Test GET /qc/mode
    console.log('Test 1: Verify GET /qc/mode endpoint');
    const modeRes = await axios.get(`${BASE_URL}/qc/mode`, AUTH_HEADER);
    console.log('✓ Mode response:', modeRes.data.mode, '| Model:', modeRes.data.model, '| Counts:', modeRes.data.counts);

    // 2. Set mode to PROD
    console.log('\nTest 2: Switch mode to PROD via POST /qc/mode');
    const setProdRes = await axios.post(`${BASE_URL}/qc/mode`, { mode: 'prod' }, AUTH_HEADER);
    console.log('✓ Set PROD response:', setProdRes.data);

    // 3. Create a test call in Supabase
    const testCallId1 = uuidv4();
    await supabase.from('calls').insert({
      id: testCallId1,
      qc_status: 'pending',
      duration_sec: 120,
      source: 'phone_call'
    });
    console.log(`✓ Inserted dummy call for PROD queue test: ${testCallId1}`);

    // 4. In PROD mode, calling evaluate_call without immediate should queue it as 'ready_for_qc'
    console.log('\nTest 3: Calling evaluate_call in PROD mode (should queue, not run Gemini)');
    const prodEvalRes = await axios.post(`${BASE_URL}/qc/evaluate_call`, {
      call_id: testCallId1
    }, AUTH_HEADER);
    console.log('✓ PROD evaluate response:', prodEvalRes.data);

    const { data: queuedCall } = await supabase.from('calls').select('qc_status').eq('id', testCallId1).single();
    if (queuedCall?.qc_status !== 'ready_for_qc') {
      throw new Error(`Expected qc_status to be 'ready_for_qc', got: ${queuedCall?.qc_status}`);
    }
    console.log(`✓ Confirmed in Supabase: call ${testCallId1} qc_status is '${queuedCall.qc_status}'`);

    // 5. In PROD mode with immediate: true, calling evaluate_call should trigger immediate execution
    console.log('\nTest 4: Calling evaluate_call in PROD mode with immediate: true');
    const prodImmediateRes = await axios.post(`${BASE_URL}/qc/evaluate_call`, {
      call_id: testCallId1,
      immediate: true
    }, AUTH_HEADER);
    console.log('✓ PROD immediate response:', prodImmediateRes.data);
    if (prodImmediateRes.data.status !== 'Evaluation started in background') {
      throw new Error(`Expected 'Evaluation started in background', got: ${prodImmediateRes.data.status}`);
    }

    // 6. Switch mode back to DEV
    console.log('\nTest 5: Switch mode to DEV via POST /qc/mode');
    const setDevRes = await axios.post(`${BASE_URL}/qc/mode`, { mode: 'dev' }, AUTH_HEADER);
    console.log('✓ Set DEV response:', setDevRes.data);

    // 7. Create a second test call
    const testCallId2 = uuidv4();
    await supabase.from('calls').insert({
      id: testCallId2,
      qc_status: 'pending',
      duration_sec: 120,
      source: 'phone_call'
    });

    // 8. In DEV mode, evaluate_call should immediately start evaluation
    console.log('\nTest 6: Calling evaluate_call in DEV mode (should immediately start evaluation)');
    const devEvalRes = await axios.post(`${BASE_URL}/qc/evaluate_call`, {
      call_id: testCallId2
    }, AUTH_HEADER);
    console.log('✓ DEV evaluate response:', devEvalRes.data);
    if (devEvalRes.data.status !== 'Evaluation started in background' || devEvalRes.data.mode !== 'dev') {
      throw new Error(`Expected immediate dev start, got: ${JSON.stringify(devEvalRes.data)}`);
    }

    // Clean up dummy test calls
    await supabase.from('calls').delete().in('id', [testCallId1, testCallId2]);
    console.log('\n✓ Cleaned up dummy test calls from database');

    console.log('\n🎉 ALL DEV/PROD SWITCHER TESTS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('❌ Test failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

runTests();
