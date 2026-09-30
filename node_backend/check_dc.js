const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  const { data, error } = await supabase.from('data_capture_questions').select('label, source, question');
  console.log(JSON.stringify(data, null, 2));
}
check();
