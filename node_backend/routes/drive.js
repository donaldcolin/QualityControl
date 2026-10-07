const express = require('express');
const router = express.Router();
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

const CREDENTIALS_PATH = path.join(__dirname, '../config/credentials.json');

// Only init auth if credentials exist to prevent crashing
let drive = null;
if (fs.existsSync(CREDENTIALS_PATH)) {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
  drive = google.drive({ version: 'v3', auth });
}

const ROOT_FOLDER_ID = '1OgKj_unhEVQ_OhYGSu5rysW2_sfPyTsn';

router.get('/transcript', async (req, res) => {
  if (!drive) {
    return res.status(503).json({ error: 'Google Drive credentials not configured on backend.' });
  }

  try {
    const { phone, name } = req.query;
    if (!phone && !name) {
      return res.status(400).json({ error: 'Phone or name required' });
    }

    let query = `'${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and (`;
    const conditions = [];
    if (phone) {
        const digits = phone.replace(/\D/g, '');
        const last10 = digits.slice(-10);
        if (last10 && last10.length > 5) {
            conditions.push(`name contains '${last10}'`);
        }
    }
    if (name) {
        const firstName = name.split(' ')[0].toLowerCase();
        if (firstName.length > 2) {
            conditions.push(`name contains '${firstName}'`);
        }
    }
    
    if (conditions.length === 0) {
        return res.status(400).json({ error: 'Invalid search parameters' });
    }
    
    query += conditions.join(' or ') + ')';

    const foldersRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
    });

    if (!foldersRes.data.files || foldersRes.data.files.length === 0) {
      return res.status(404).json({ error: 'No matching meeting folder found for this lead in Drive' });
    }

    const folderId = foldersRes.data.files[0].id;

    const docsRes = await drive.files.list({
        q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.document' and name contains 'Transcript'`,
        fields: 'files(id, name, webViewLink)'
    });

    if (!docsRes.data.files || docsRes.data.files.length === 0) {
      return res.status(404).json({ error: 'Meeting folder found, but no Transcript document inside' });
    }

    const transcriptDoc = docsRes.data.files[0];

    const exportRes = await drive.files.export({
        fileId: transcriptDoc.id,
        mimeType: 'text/plain'
    });

    return res.json({
        success: true,
        docId: transcriptDoc.id,
        webViewLink: transcriptDoc.webViewLink,
        content: exportRes.data
    });

  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/recording', async (req, res) => {
  if (!drive) {
    return res.status(503).json({ error: 'Google Drive credentials not configured on backend.' });
  }

  try {
    const { phone, name } = req.query;
    if (!phone && !name) {
      return res.status(400).json({ error: 'Phone or name required' });
    }

    let query = `'${ROOT_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.folder' and (`;
    const conditions = [];
    if (phone) {
        const digits = phone.replace(/\D/g, '');
        const last10 = digits.slice(-10);
        if (last10 && last10.length > 5) {
            conditions.push(`name contains '${last10}'`);
        }
    }
    if (name) {
        const firstName = name.split(' ')[0].toLowerCase();
        if (firstName.length > 2) {
            conditions.push(`name contains '${firstName}'`);
        }
    }
    
    if (conditions.length === 0) {
        return res.status(400).json({ error: 'Invalid search parameters' });
    }
    
    query += conditions.join(' or ') + ')';

    const foldersRes = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
    });

    if (!foldersRes.data.files || foldersRes.data.files.length === 0) {
      return res.status(404).json({ error: 'No matching meeting folder found for this lead in Drive' });
    }

    const folderId = foldersRes.data.files[0].id;

    // Search for MP4 video
    const docsRes = await drive.files.list({
        q: `'${folderId}' in parents and mimeType='video/mp4'`,
        fields: 'files(id, name, webViewLink)'
    });

    if (!docsRes.data.files || docsRes.data.files.length === 0) {
      return res.status(404).json({ error: 'Meeting folder found, but no MP4 recording inside' });
    }

    const recordingFile = docsRes.data.files[0];

    return res.json({
        success: true,
        fileId: recordingFile.id,
        webViewLink: recordingFile.webViewLink,
        name: recordingFile.name
    });

  } catch (error) {
    console.error('Error fetching recording:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
