const supabase = require('./node_backend/config/supabase');

async function test() {
  const { data, error } = await supabase
    .from('calls')
    .select('id, qc_status, call_quality_score, updated_at')
    .order('created_at', { ascending: false })
    .limit(3);
  console.log("Error:", error);
  console.log("Data:", data);
}
test();
