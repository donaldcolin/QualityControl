require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function findCall() {
    const { data, error } = await supabase.from('calls').select('id, filename').ilike('filename', '%Ronmcklein%');
    console.log(data);
}
findCall();
