const { google } = require('googleapis');
const auth = new google.auth.GoogleAuth({
  keyFile: './config/credentials.json',
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});
const drive = google.drive({ version: 'v3', auth });

async function getFile() {
  const res = await drive.files.get({
    fileId: '1TiwiU84-5yU4ZvisygiEqgFUE276iugeahAOUMcwDX0',
    fields: '*',
  });
  console.log(res.data);
}
getFile().catch(console.error);
