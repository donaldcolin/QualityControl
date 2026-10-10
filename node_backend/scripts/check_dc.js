const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = 'https://uczjwxqquvzvsibakomp.supabase.co';
const supabaseKey = 'sb_publishable_fiKfwPomLCNgKh0Rb8QGJw_etH2J5f7';
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data: questions } = await supabase.from('data_capture_questions').select('*');
  console.log(questions);
}
test();
