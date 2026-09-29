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

async function seedParameters() {
  const allParams = [];

  // Parse phone parameters
  const phoneCsvPath = path.join(configDir, 'qc_parameters.csv');
  if (fs.existsSync(phoneCsvPath)) {
    const phoneData = await parseCsv(phoneCsvPath, 'phone_call');
    allParams.push(...phoneData);
  }

  // Parse google meet parameters
  const meetCsvPath = path.join(configDir, 'qc_parameters_demo.csv');
  if (fs.existsSync(meetCsvPath)) {
    const meetData = await parseCsv(meetCsvPath, 'google_meet');
    allParams.push(...meetData);
  }

  if (allParams.length === 0) {
    console.log("No parameters found in CSV files.");
    return;
  }

  console.log(`Found ${allParams.length} total parameters. Seeding to Supabase...`);

  // Clear existing parameters to prevent duplicates on re-run
  await supabase.from('qc_parameters').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // delete all

  const { data, error } = await supabase.from('qc_parameters').insert(allParams).select();

  if (error) {
    console.error("Error seeding parameters:", error);
  } else {
    console.log(`Successfully seeded ${data.length} parameters into Supabase.`);
  }
}

function parseCsv(filePath, source) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        if (data.Parameter && data.Category && data.Description) {
          results.push({
            source: source,
            category: data.Category,
            parameter: data.Parameter,
            description: data.Description,
            max_score: data.max_score ? parseInt(data.max_score) : 10
          });
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

seedParameters().catch(console.error);
