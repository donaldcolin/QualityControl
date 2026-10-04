const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase URL or Key in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const configDir = path.join(__dirname, '..', 'config');

async function seedV3Parameters() {
  const allParams = [];

  // Parse phone parameters v3
  const phoneCsvPath = path.join(configDir, 'qc_parameters_v3.csv');
  if (fs.existsSync(phoneCsvPath)) {
    const phoneData = await parseCsv(phoneCsvPath, 'phone_call');
    allParams.push(...phoneData);
  } else {
    console.error("qc_parameters_v3.csv not found.");
    return;
  }

  if (allParams.length === 0) {
    console.log("No parameters found in CSV files.");
    return;
  }

  console.log(`Found ${allParams.length} total parameters. Seeding to Supabase...`);

  // Delete old phone_call parameters to avoid conflicts or stale data
  await supabase.from('qc_parameters').delete().eq('source', 'phone_call'); 

  const { data, error } = await supabase.from('qc_parameters').insert(allParams).select();

  if (error) {
    console.error("Error seeding parameters:", error);
  } else {
    console.log(`Successfully seeded ${data.length} v3 parameters into Supabase.`);
  }
}

function parseCsv(filePath, source) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        if (data.parameter_name && data.category && data.scoring_prompt) {
          results.push({
            source: source,
            param_id: data.param_id,
            category: data.category,
            category_weight_pct: data.category_weight_pct ? parseFloat(data.category_weight_pct) : 0,
            parameter: data.parameter_name, // Mapping parameter_name to parameter for legacy support
            description: data.scoring_prompt, // Mapping scoring_prompt to description for legacy support
            scale: data.scale,
            polarity: data.polarity,
            embedded_breach_flag: data.embedded_breach_flag === 'yes',
            evidence_required: data.evidence_required
          });
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

seedV3Parameters().catch(console.error);
