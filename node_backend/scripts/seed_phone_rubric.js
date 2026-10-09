const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const csv = require('csv-parser');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const configDir = path.join(__dirname, '..', 'config');

async function seed() {
  const phoneCsvPath = path.join(configDir, 'qc_parameters_v3.csv');
  const rawRows = await new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(phoneCsvPath)
      .pipe(csv())
      .on('data', (data) => {
        if (data.parameter_name && data.category && data.scoring_prompt) {
          results.push(data);
        }
      })
      .on('end', () => resolve(results));
  });

  const payload = {
    qc_parameters: rawRows.map((r, idx) => ({
      param_id: r.param_id || `P${idx}`,
      category: r.category,
      category_weight_pct: r.category_weight_pct ? parseFloat(r.category_weight_pct) : 0,
      parameter: r.parameter_name,
      description: r.scoring_prompt,
      scale: r.scale || '2=done well / 1=partial / 0=absent',
      polarity: r.polarity || 'positive',
      embedded_breach_flag: r.embedded_breach_flag === 'yes',
      evidence_required: r.evidence_required || 'timestamp + quote',
      max_score: r.max_score ? parseInt(r.max_score) : 2,
      sort_order: idx + 1
    })),
    category_weights: {},
    total_parameters: rawRows.length
  };

  const payloadString = JSON.stringify(payload);
  const contentHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  const { data, error } = await supabase.from('rubric_versions').insert({
    source: 'phone_call',
    version_number: 1,
    content_hash: contentHash,
    parameters: payload,
    created_by: 'system_phone_seed',
    notes: 'Phone Call Rubric'
  }).select();

  if (error) console.error("Error:", error.message);
  else console.log("Seeded phone rubric!", data[0].id);
}
seed();
