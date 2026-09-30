const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  const { data, error } = await supabase.from('evaluation_runs').select('call_id, results').in('call_id', ['6ff640b8-cfb3-4cf8-ac23-ecbbc3d86bb1', '853bfe8a-e9c0-4d13-855d-20fd538a749a']).order('created_at', { ascending: false }).limit(2);
  console.log(JSON.stringify(data, null, 2));
}
check();
