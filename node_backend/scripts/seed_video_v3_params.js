const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

async function seedVideoV3Parameters() {
  const videoCsvPath = path.join(configDir, 'qc_parameters_video_v3.csv');
  if (!fs.existsSync(videoCsvPath)) {
    console.error("qc_parameters_video_v3.csv not found.");
    process.exit(1);
  }

  const rawRows = await parseCsv(videoCsvPath);
  console.log(`\n📋 Parsed ${rawRows.length} parameters from qc_parameters_video_v3.csv`);

  // Validation: Check category weights and counts
  const categoryStats = {};
  rawRows.forEach(p => {
    if (!categoryStats[p.category]) {
      categoryStats[p.category] = { count: 0, weight: p.category_weight_pct };
    }
    categoryStats[p.category].count += 1;
  });

  console.log("\n📊 Category Breakdown:");
  let totalWeight = 0;
  for (const [cat, stat] of Object.entries(categoryStats)) {
    console.log(`  • ${cat}: ${stat.count} parameters | Weight: ${stat.weight}%`);
    totalWeight += stat.weight;
  }
  console.log(`Total Weight: ${totalWeight}% (Expected: 100%)\n`);

  if (totalWeight !== 100) {
    console.warn(`⚠️ Warning: Total weight sum is ${totalWeight}%, expected 100%.`);
  }

  // 1. Prepare rows for qc_parameters table (Legacy & UI compatibility)
  const qcParamRows = rawRows.map((r, idx) => ({
    source: 'google_meet',
    param_id: r.param_id,
    category: r.category,
    category_weight_pct: r.category_weight_pct,
    parameter: r.parameter_name,
    description: r.scoring_prompt,
    scale: r.scale,
    polarity: r.polarity,
    embedded_breach_flag: r.embedded_breach_flag === 'yes',
    evidence_required: r.evidence_required,
    max_score: 2,
    sort_order: idx + 1
  }));

  // Clear existing google_meet parameters in qc_parameters
  console.log("🔄 Clearing old 'google_meet' parameters in qc_parameters...");
  const { error: delError } = await supabase
    .from('qc_parameters')
    .delete()
    .eq('source', 'google_meet');

  if (delError) {
    console.error("❌ Failed to clear old google_meet parameters:", delError.message);
  } else {
    console.log("✅ Cleared old google_meet parameters.");
  }

  // Insert 72 new parameters into qc_parameters
  console.log(`📥 Inserting ${qcParamRows.length} parameters into qc_parameters table...`);
  const { data: insertedParams, error: insertError } = await supabase
    .from('qc_parameters')
    .insert(qcParamRows)
    .select();

  if (insertError) {
    console.error("❌ Error inserting into qc_parameters:", insertError.message);
  } else {
    console.log(`✅ Successfully seeded ${insertedParams.length} parameters into qc_parameters table!`);
  }

  // 2. Prepare rubric version entry for rubric_versions table
  const rubricPayload = {
    qc_parameters: rawRows.map((r, idx) => ({
      param_id: r.param_id,
      category: r.category,
      category_weight_pct: r.category_weight_pct,
      parameter: r.parameter_name,
      description: r.scoring_prompt,
      scale: r.scale,
      polarity: r.polarity,
      embedded_breach_flag: r.embedded_breach_flag === 'yes',
      visual_dependency: r.visual_dependency,
      requires_speaker_inference: r.requires_speaker_inference === 'yes',
      evidence_required: r.evidence_required,
      max_score: 2,
      sort_order: idx + 1
    })),
    category_weights: categoryStats,
    total_parameters: rawRows.length
  };

  const payloadString = JSON.stringify(rubricPayload);
  const contentHash = crypto.createHash('sha256').update(payloadString).digest('hex');

  console.log("\n📦 Ingesting into rubric_versions table (source: 'google_meet', version_number: 3)...");

  // Check if version 3 already exists
  const { data: existingRubrics } = await supabase
    .from('rubric_versions')
    .select('id, version_number')
    .eq('source', 'google_meet')
    .eq('version_number', 3);

  if (existingRubrics && existingRubrics.length > 0) {
    console.log("Updating existing version 3 entry in rubric_versions...");
    const { error: updateError } = await supabase
      .from('rubric_versions')
      .update({
        content_hash: contentHash,
        parameters: rubricPayload,
        notes: 'Official 72-Parameter Multi-Modal Video QC Rubric V3',
        created_at: new Date().toISOString()
      })
      .eq('id', existingRubrics[0].id);

    if (updateError) {
      console.error("❌ Error updating rubric_versions:", updateError.message);
    } else {
      console.log("✅ Successfully updated version 3 in rubric_versions!");
    }
  } else {
    const { data: newRubric, error: rubError } = await supabase
      .from('rubric_versions')
      .insert({
        source: 'google_meet',
        version_number: 3,
        content_hash: contentHash,
        parameters: rubricPayload,
        created_by: 'system_video_v3_migration',
        notes: 'Official 72-Parameter Multi-Modal Video QC Rubric V3'
      })
      .select();

    if (rubError) {
      console.error("❌ Error inserting into rubric_versions:", rubError.message);
    } else {
      console.log(`✅ Successfully created version 3 in rubric_versions! (ID: ${newRubric[0].id})`);
    }
  }

  console.log("\n🎉 Phase 1 Complete: All 72 Video QC V3 parameters ingested and active.");
}

function parseCsv(filePath) {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (data) => {
        if (data.param_id && data.parameter_name && data.category && data.scoring_prompt) {
          results.push({
            param_id: data.param_id.trim(),
            category: data.category.trim(),
            category_weight_pct: parseFloat(data.category_weight_pct) || 0,
            parameter_name: data.parameter_name.trim(),
            scoring_prompt: data.scoring_prompt.trim(),
            scale: data.scale ? data.scale.trim() : '2=done well / 1=partial / 0=absent / not_applicable / not_assessable',
            polarity: data.polarity ? data.polarity.trim() : 'positive',
            embedded_breach_flag: data.embedded_breach_flag ? data.embedded_breach_flag.trim().toLowerCase() : 'no',
            visual_dependency: data.visual_dependency ? data.visual_dependency.trim() : 'none',
            requires_speaker_inference: data.requires_speaker_inference ? data.requires_speaker_inference.trim().toLowerCase() : 'no',
            evidence_required: data.evidence_required ? data.evidence_required.trim() : 'timestamp + verbatim quote + English translation'
          });
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

seedVideoV3Parameters().catch(console.error);
