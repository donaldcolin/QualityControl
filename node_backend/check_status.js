const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  const { data, error } = await supabase.from('calls').select('id, qc_status, evaluated_at, duration_sec, prospect_id').limit(10).order('created_at', { ascending: false });
  console.log(JSON.stringify(data, null, 2));
}
check();
