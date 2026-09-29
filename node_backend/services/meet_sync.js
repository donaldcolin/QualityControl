const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');

const GOOGLE_KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'config', 'credentials.json');
const TOP_LEVEL_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

const PROCESSED_FILES_PATH = path.join(__dirname, '..', 'config', 'processed_files.json');

let processedFiles = [];
if (fs.existsSync(PROCESSED_FILES_PATH)) {
    try {
        processedFiles = JSON.parse(fs.readFileSync(PROCESSED_FILES_PATH, 'utf-8'));
    } catch (e) {
        console.error("Error reading processed_files.json. Initializing as empty array.");
        processedFiles = [];
    }
}

function markAsProcessed(fileId) {
    processedFiles.push(fileId);
    fs.writeFileSync(PROCESSED_FILES_PATH, JSON.stringify(processedFiles, null, 2));
}

let auth = null;
let drive = null;

if (fs.existsSync(GOOGLE_KEY_FILE) && TOP_LEVEL_FOLDER_ID) {
  auth = new google.auth.GoogleAuth({
      keyFile: GOOGLE_KEY_FILE,
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  drive = google.drive({ version: 'v3', auth });
} else {
  console.warn("WARNING: Google Drive credentials or DRIVE_FOLDER_ID missing. Meet Sync will fail.");
}

async function scanFolderForTranscripts(folderId, folderPath = "") {
    console.log(`Scanning folder: ${folderPath || 'Root'}`);
    let results = { found: 0, processed: 0, skipped: 0, errors: [] };

    try {
        const response = await drive.files.list({
            q: `'${folderId}' in parents and (mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.folder') and trashed=false`,
            fields: 'files(id, name, mimeType, createdTime)',
        });

        const items = response.data.files || [];

        for (const item of items) {
            if (item.mimeType === 'application/vnd.google-apps.folder') {
                const subResults = await scanFolderForTranscripts(item.id, `${folderPath}/${item.name}`);
                results.found += subResults.found;
                results.processed += subResults.processed;
                results.skipped += subResults.skipped;
                results.errors.push(...subResults.errors);
            } else if (item.mimeType === 'application/vnd.google-apps.document') {
                results.found++;
                if (!processedFiles.includes(item.id)) {
                    console.log(`Found New Transcript: ${item.name}`);
                    const success = await processTranscript(item);
                    if (success) {
                        results.processed++;
                    } else {
                        results.errors.push(`Failed on ${item.name}`);
                    }
                } else {
                    results.skipped++;
                }
            }
        }
    } catch (error) {
        console.error(`Error scanning folder ${folderId}:`, error.message);
        results.errors.push(error.message);
    }
    return results;
}

async function processTranscript(file) {
    try {
        // Extract 10-12 digit phone number (e.g. from "( 9994336681 )" or just "9994336681")
        const match = file.name.match(/\(\s*(\d{10,12})\s*\)/) || file.name.match(/(\d{10,12})/);
        
        if (!match) {
            console.log(`⚠️ Skipped: Could not find a Phone Number in title: "${file.name}"`);
            markAsProcessed(file.id);
            return false; 
        }

        const phoneNumber = match[1];
        console.log(`✅ Extracted Phone Number ${phoneNumber} from title "${file.name}"`);

        // Look up the prospect_id in the database
        const { data: rows, error } = await supabase.from('leads').select('id').like('phone', `%${phoneNumber}%`).limit(1);
        if (error || !rows || rows.length === 0) {
            console.log(`⚠️ Skipped: Could not find a lead with phone number matching ${phoneNumber} in database.`);
            markAsProcessed(file.id);
            return false;
        }

        const leadNumber = rows[0].id;
        console.log(`✅ Mapped Phone ${phoneNumber} to Prospect ID ${leadNumber}`);

        const exportResponse = await drive.files.export({
            fileId: file.id,
            mimeType: 'text/plain',
        });
        const transcriptText = exportResponse.data;
        
        // --- 1. Push raw to LSQ ---
        const LS_API_HOST = process.env.LSQ_API_HOST || 'https://api-in21.leadsquared.com';
        const LS_ACCESS_KEY = process.env.LSQ_ACCESS_KEY;
        const LS_SECRET_KEY = process.env.LSQ_SECRET_KEY;
        
        if (LS_ACCESS_KEY && LS_SECRET_KEY) {
            const url = `${LS_API_HOST}/v2/ProspectActivity.svc/Create?accessKey=${LS_ACCESS_KEY}&secretKey=${LS_SECRET_KEY}`;
            const payload = {
                RelatedProspectId: leadNumber, 
                ActivityEvent: 201, 
                ActivityNote: `Transcript from: ${file.name}\n\n${transcriptText}`
            };
            try {
                await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
                console.log(`🚀 Successfully pushed ${file.name} to LeadSquared for Lead ${leadNumber}!`);
            } catch (err) {
                console.error('LeadSquared API Error:', err.response?.data || err.message);
            }
        }

        // --- 2. Feed into QC coaching pipeline via local loopback ---
        try {
            await axios.post(`http://localhost:${process.env.PORT || 3000}/api/qc/evaluate_call`, {
                prospect_id: leadNumber,
                transcript: transcriptText,
                source: 'google_meet'
            }, { timeout: 180000 });
            console.log(`🧠 QC Coaching evaluation triggered for Lead ${leadNumber}`);
        } catch (qcErr) {
            console.error(`QC Coaching failed for Lead ${leadNumber} (non-fatal):`, qcErr.message);
        }
        
        markAsProcessed(file.id);
        return true;
    } catch (error) {
        console.error(`Failed to process ${file.name}:`, error.message);
        return false;
    }
}

async function triggerManualSync() {
    if (!drive) {
        throw new Error("Google Drive is not configured correctly in .env");
    }
    console.log(`[${new Date().toISOString()}] Starting Manual Meet Sync...`);
    try {
        await auth.getClient();
        const results = await scanFolderForTranscripts(TOP_LEVEL_FOLDER_ID);
        console.log(`[${new Date().toISOString()}] Meet Sync Finished: ${JSON.stringify(results)}`);
        return results;
    } catch (e) {
        console.error("Manual Meet Sync Error:", e.message);
        throw e;
    }
}

module.exports = {
    triggerManualSync
};
