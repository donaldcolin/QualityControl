const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://uczjwxqquvzvsibakomp.supabase.co';
const supabaseKey = 'sb_publishable_fiKfwPomLCNgKh0Rb8QGJw_etH2J5f7';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: rubrics, error } = await supabase.from('rubric_versions').select('*').eq('is_active', true);
  if (error) console.error("Error:", error);
  if (rubrics) {
    for (const r of rubrics) {
      console.log(`Source: ${r.source}`);
      console.log(JSON.stringify(r.parameters?.data_capture_questions, null, 2));
    }
  }
}
test();
