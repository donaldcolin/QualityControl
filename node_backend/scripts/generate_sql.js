const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const configDir = path.join(__dirname, '..', 'config');
const outputFile = path.join(__dirname, '..', 'scripts', 'full_migration.sql');

async function generateSql() {
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

  let sql = `
CREATE TABLE IF NOT EXISTS public.qc_parameters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  category text NOT NULL,
  parameter text NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_qc_parameters_source ON public.qc_parameters(source);

-- Clear existing data to avoid duplicates if run multiple times
DELETE FROM public.qc_parameters;

INSERT INTO public.qc_parameters (source, category, parameter, description) VALUES
`;

  const values = allParams.map(p => {
    // Escape single quotes by doubling them for SQL
    const source = p.source.replace(/'/g, "''");
    const category = p.category.replace(/'/g, "''");
    const parameter = p.parameter.replace(/'/g, "''");
    const description = p.description.replace(/'/g, "''");
    return `('${source}', '${category}', '${parameter}', '${description}')`;
  });

  sql += values.join(',\n') + ';\n';

  fs.writeFileSync(outputFile, sql);
  console.log(`Generated SQL with ${allParams.length} rows at ${outputFile}`);
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
            description: data.Description
          });
        }
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

generateSql().catch(console.error);
