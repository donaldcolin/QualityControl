const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function runFfmpegAsync(inputPath, outputPath, timeoutMs = 10 * 60 * 1000) {
    return new Promise((resolve, reject) => {
        const args = [
            '-err_detect', 'ignore_err',
            '-i', inputPath,
            '-map', 'a',
            '-c:a', 'pcm_s16le', // 16 kHz mono WAV: what the ASR wants, so no MP3 encode + decode round trip
            '-ac', '1',
            '-ar', '16000',
            '-y', outputPath
        ];

        const proc = spawn('ffmpeg', args);
        let stdout = '';
        let stderr = '';
        let isTimedOut = false;

        const timer = setTimeout(() => {
            isTimedOut = true;
            console.error(`⚠️ [FFmpeg] Process exceeded ${Math.round(timeoutMs / 60000)}m limit. Killing process.`);
            try { proc.kill('SIGKILL'); } catch (_) {}
            reject(new Error(`FFmpeg conversion timed out after ${Math.round(timeoutMs / 60000)} minutes`));
        }, timeoutMs);
        if (timer.unref) timer.unref();

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            clearTimeout(timer);
            if (isTimedOut) return;
            if (code === 0) {
                resolve();
            } else {
                const err = new Error(`FFmpeg failed with code ${code}: ${stderr || stdout}`);
                err.stdout = stdout;
                err.stderr = stderr;
                reject(err);
            }
        });

        proc.on('error', err => {
            clearTimeout(timer);
            if (isTimedOut) return;
            reject(new Error(`Failed to start FFmpeg: ${err.message}`));
        });
    });
}

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

// Parallel Range requests speed up big Meet recordings when Drive throttles each connection.
// DRIVE_DOWNLOAD_PARTS=1 restores the single-stream download.
const DOWNLOAD_PARTS = Math.max(1, parseInt(process.env.DRIVE_DOWNLOAD_PARTS || '4', 10) || 1);
const MIN_PARALLEL_BYTES = 64 * 1024 * 1024;

/**
 * Streams bytes [start, end] (or the whole file when range is null) into destPath at offset start.
 * Resolves with the number of bytes written; rejects if Drive ignores the Range header.
 */
async function downloadRange(fileId, destPath, range) {
    const response = await drive.files.get(
        { fileId, alt: 'media', acknowledgeAbuse: true, supportsAllDrives: true },
        { responseType: 'stream', headers: range ? { Range: `bytes=${range[0]}-${range[1]}` } : {} }
    );
    if (range && response.status !== 206) {
        response.data.destroy();
        throw new Error(`Drive ignored Range request (HTTP ${response.status})`);
    }
    const dest = fs.createWriteStream(destPath, range ? { flags: 'r+', start: range[0] } : {});
    let written = 0;
    response.data.on('data', chunk => { written += chunk.length; });
    await new Promise((resolve, reject) => {
        response.data.pipe(dest);
        dest.on('finish', resolve);
        dest.on('error', reject);
        response.data.on('error', reject);
    });
    return written;
}

/**
 * Downloads a Drive file to destPath, in DOWNLOAD_PARTS parallel ranges when it is big enough.
 * Any failure in the parallel path falls back to one plain stream. Returns the number of parts used.
 */
async function downloadDriveFile(fileId, destPath) {
    let size = 0;
    if (DOWNLOAD_PARTS > 1) {
        try {
            const { data } = await drive.files.get({ fileId, fields: 'size', supportsAllDrives: true });
            size = Number(data.size) || 0;
        } catch (err) {
            console.warn(`[Drive] Could not read file size (${err.message}); using a single stream.`);
        }
    }

    if (DOWNLOAD_PARTS > 1 && size >= MIN_PARALLEL_BYTES) {
        try {
            fs.writeFileSync(destPath, '');
            fs.truncateSync(destPath, size); // pre-size so each part writes at its own offset
            const partSize = Math.ceil(size / DOWNLOAD_PARTS);
            const ranges = [];
            for (let start = 0; start < size; start += partSize) ranges.push([start, Math.min(size, start + partSize) - 1]);
            // allSettled: never fall back while another part is still writing into the file
            const results = await Promise.allSettled(ranges.map(r => downloadRange(fileId, destPath, r)));
            ranges.forEach((r, i) => {
                const res = results[i];
                if (res.status === 'rejected') throw new Error(`Part ${i + 1} failed: ${res.reason?.message}`);
                if (res.value !== r[1] - r[0] + 1) throw new Error(`Part ${i + 1} incomplete: ${res.value} of ${r[1] - r[0] + 1} bytes`);
            });
            return ranges.length;
        } catch (err) {
            console.warn(`[Drive] Parallel download failed (${err.message}); retrying as a single stream.`);
        }
    }

    await downloadRange(fileId, destPath, null);
    return 1;
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

    const audioPath = path.join(storageDir, `${queueId}.wav`);
    const tempVideoPath = path.join(storageDir, `${queueId}_temp.mp4`);

    try {
        console.log(`[Drive] Streaming video to extract audio...`);
        const downloadStart = Date.now();
        
        const parts = await downloadDriveFile(fileId, tempVideoPath);

        const stat = fs.statSync(tempVideoPath);
        const downloadSec = (Date.now() - downloadStart) / 1000;
        console.log(`[Drive] Download complete (${parts} part${parts > 1 ? 's' : ''}): ${(stat.size / 1e6).toFixed(0)} MB in ${downloadSec.toFixed(1)}s (${(stat.size / 1e6 / downloadSec).toFixed(1)} MB/s). Extracting Audio...`);
        const ffmpegStart = Date.now();

        // Extract Audio using ffmpeg
        try {
            await runFfmpegAsync(tempVideoPath, audioPath);
        } catch (ffmpegErr) {
            console.error("[Drive] FFmpeg failed:", ffmpegErr.message);
            throw ffmpegErr;
        }
        
        console.log(`[Drive] Audio extraction complete in ${((Date.now() - ffmpegStart) / 1000).toFixed(1)}s: ${audioPath}`);

        // DO NOT delete the heavy video file yet!
        // The Python ASR worker will run OpenCV OCR on it for Google Meet slide analysis,
        // and the Python worker is responsible for deleting it after analysis is complete.
        // if (fs.existsSync(tempVideoPath)) {
        //     fs.unlinkSync(tempVideoPath);
        // }

        return audioPath;
    } catch (error) {
        if (fs.existsSync(tempVideoPath)) fs.unlinkSync(tempVideoPath);
        if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
        console.error("Drive Audio Extraction Error:", error);
        throw error;
    }
}

module.exports = { extractAudioFromDrive, downloadDriveFile };
