const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

// Mock data loading
const configDir = path.join(__dirname, 'config');
const csvData = fs.readFileSync(path.join(configDir, 'qc_parameters_demo.csv'), 'utf8');
const records = parse(csvData, { columns: true, skip_empty_lines: true });

let coachingTemplates = [];
try {
  const templateData = fs.readFileSync(path.join(configDir, 'coaching_templates.json'), 'utf8');
  coachingTemplates = JSON.parse(templateData);
} catch (e) {}

const parameters = records;
const qualityChecks = parameters;
const source = 'phone_call';
const context = 'a university admissions sales counselling call';

let block = `You are an AI Quality Assurance Manager evaluating ${context}.\n`;
block += `You must complete TWO tasks in one response.\n\n`;

block += `=== PART 1: QUALITY SCORING ===\n`;
block += `For each parameter: assign a score (0 to max_score), a status, and a reason citing the transcript.\n`;
block += `Statuses: Done (full marks), Partially Done (partial), Needs Improvement (low), Not Applicable.\n\n`;

const qualityGroups = {};
qualityChecks.forEach(check => {
  const group = check.category || 'Other';
  if (!qualityGroups[group]) qualityGroups[group] = [];
  qualityGroups[group].push(check);
});
for (const [group, checks] of Object.entries(qualityGroups)) {
  block += `== ${group} ==\n`;
  checks.forEach(check => {
    block += `- ${check.parameter} (Max: ${check.max_score || 10})\n`;
    if (check.check_question) block += `  Q: ${check.check_question}\n`;
    block += `  Guide: ${check.description}\n`;
    if (check.na_condition) block += `  N/A when: ${check.na_condition}\n`;
  });
  block += '\n';
}

block += `=== PART 2: PRESCRIPTIVE COACHING REPORT ===\n`;
block += `You are a strict but helpful Sales Coach. We use standard proven pitches/templates to close sales.\n`;
block += `You must evaluate the associate against the following PREDEFINED COMPANY TEMPLATES:\n`;

if (coachingTemplates.length > 0) {
  coachingTemplates.forEach((t, i) => {
    block += `\n[TEMPLATE ${i+1}]\n- FLAG TO DETECT: ${t.flag}\n- GOLDEN PITCH TO RECOMMEND: ${t.template}\n`;
  });
}

block += `\nWhen the associate triggers any of the FLAGS above, you must correct them using the PRESCRIPTIVE COACHING format:\n`;
block += `1. Identify the situation based on the FLAG detected.\n`;
block += `2. Quote exactly what the associate said (the failure/deviation).\n`;
block += `3. Provide the EXACT 'Golden Pitch' provided in the template above.\n`;
block += `4. Explain briefly why this Golden Pitch works better.\n\n`;
block += `Overall grade scale — A (90-100), B (75-89), C (60-74), D (40-59), F (0-39)\n\n`;

block += `=== TRANSCRIPT ===\n`;
block += `[Speaker 1]: Hello, am I speaking to Farhaan's mother?\n[Speaker 2]: Yes, speaking.\n[Speaker 1]: Hi, this is Hemalatha from Kalvium...\n\nBe specific. Cite evidence from the transcript for every score and coaching point.`;

const fsOut = require('fs');
fsOut.writeFileSync('exact_prompt.txt', block);
console.log("Prompt generated to exact_prompt.txt");
