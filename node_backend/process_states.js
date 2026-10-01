const fs = require('fs');

function parseCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim() !== '');
  
  if (lines.length < 2) return [];
  
  const headers = lines[0].split(',');
  const results = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    if (values.length < 30) continue; // Skip malformed lines
    
    // Extract basic info
    const id = values[0];
    const name = `${values[1]} ${values[2]}`.trim();
    const state = values[19];
    
    // Audio links are at the end (from index 30 onwards)
    const audioUrls = [];
    for (let j = 30; j < values.length; j++) {
      if (values[j] && (values[j].includes('http') || values[j].includes('.mp3'))) {
        audioUrls.push(values[j]);
      }
    }
    
    results.push({
      lead_number: id,
      name: name,
      state: state,
      calls_to_transcribe: audioUrls,
      total_calls: audioUrls.length
    });
  }
  
  return results;
}

const leads = parseCSV('golden_leads.csv');

// 1. Calculate stats per state
const stateStats = {};
let totalLeads = 0;
let totalAudioFiles = 0;

leads.forEach(lead => {
  if (lead.state) {
    totalLeads++;
    totalAudioFiles += lead.total_calls;
    
    if (!stateStats[lead.state]) {
      stateStats[lead.state] = { leads: 0, calls: 0 };
    }
    stateStats[lead.state].leads += 1;
    stateStats[lead.state].calls += lead.total_calls;
  }
});

console.log("=== CALLS PER STATE ===");
console.table(stateStats);
console.log(`\nTotal Valid Leads: ${totalLeads}`);
console.log(`Total Audio Calls: ${totalAudioFiles}`);

// 2. Generate the requested JSON format (printing first 3 for preview)
console.log("\n=== REQUESTED FORMAT (Preview of first 3) ===");
const formattedOutput = leads.map(lead => ({
  lead_number: lead.lead_number,
  name: lead.name,
  state: lead.state,
  // This is where you would place the array of transcribed texts after calling the ASR
  transcribed_calls: lead.calls_to_transcribe 
}));

console.log(JSON.stringify(formattedOutput.slice(0, 3), null, 2));

// Save full JSON to file
fs.writeFileSync('leads_to_transcribe.json', JSON.stringify(formattedOutput, null, 2));
console.log("\n✅ Saved full structure to 'leads_to_transcribe.json'");
