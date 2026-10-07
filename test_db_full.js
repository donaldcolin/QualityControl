const supabase = require('./node_backend/config/supabase');

async function test() {
  const { data, error } = await supabase
    .from('calls')
    .select('coaching_report')
    .not('coaching_report', 'is', null)
    .limit(1);
  console.log("Error:", error);
  console.log("Data:", JSON.stringify(data, null, 2));
}
test();
