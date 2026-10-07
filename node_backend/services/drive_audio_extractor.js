const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const GOOGLE_KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || path.join(__dirname, '..', 'config', 'credentials.json');

let auth = null;
let drive = null;

if (fs.existsSync(GOOGLE_KEY_FILE)) {
    auth = new google.auth.GoogleAuth({
        keyFile: GOOGLE_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/drive.readonly'],
    });
    drive = google.drive({ version: 'v3', auth });
}

async function extractAudioFromDrive(driveLink, queueId) {
    if (!drive) {
        throw new Error("Google Drive credentials not configured");
    }

    // Extract File ID from link
    const match = driveLink.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) throw new Error("Invalid Google Drive link");
    
    const fileId = match[1];
    console.log(`[Drive] Fetching metadata for ${fileId}...`);

    // Ensure temp_audio directory exists (same one the python worker uses)
    const storageDir = path.join(__dirname, '..', '..', 'storage', 'temp_audio');
    if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
    }

    const audioPath = path.join(storageDir, `${queueId}.mp3`);
    const tempVideoPath = path.join(storageDir, `${queueId}_temp.mp4`);

    try {
        console.log(`[Drive] Streaming video to extract audio...`);
        
        // Download the file stream from drive
        const response = await drive.files.get(
            { fileId: fileId, alt: 'media', acknowledgeAbuse: true, supportsAllDrives: true },
            { responseType: 'stream' }
        );

        // Pipe directly to a temp video file first
        const dest = fs.createWriteStream(tempVideoPath);
        
        await new Promise((resolve, reject) => {
            response.data.pipe(dest);
            dest.on('finish', () => resolve());
            dest.on('error', err => reject(err));
            response.data.on('error', err => reject(err));
        });

        const stat = fs.statSync(tempVideoPath);
        console.log(`[Drive] Download complete. Video file size: ${stat.size} bytes. Extracting Audio...`);

        // Extract Audio using ffmpeg
        try {
            execSync(`ffmpeg -err_detect ignore_err -i "${tempVideoPath}" -q:a 0 -map a -ac 1 -ar 16000 -y "${audioPath}"`);
        } catch (ffmpegErr) {
            console.error("[Drive] FFmpeg failed. Output:", ffmpegErr.stdout?.toString(), "Stderr:", ffmpegErr.stderr?.toString());
            throw new Error(`FFmpeg extraction failed: ${ffmpegErr.message}`);
        }
        
        console.log(`[Drive] Audio extraction complete: ${audioPath}`);

        // Delete the heavy video file
        if (fs.existsSync(tempVideoPath)) {
            fs.unlinkSync(tempVideoPath);
        }

        return audioPath;
    } catch (error) {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        console.error("Drive Audio Extraction Error:", error);
        throw error;
    }
}

module.exports = { extractAudioFromDrive };
