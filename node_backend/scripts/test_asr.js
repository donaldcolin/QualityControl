const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const axios = require('axios');
const FormData = require('form-data');

// ---------------------------------------------------------
// CONFIGURATION: Plug your existing ASR API details here
// ---------------------------------------------------------
const ASR_API_URL = process.env.ASR_API_URL || 'YOUR_ASR_API_ENDPOINT_HERE';
const ASR_API_KEY = process.env.ASR_API_KEY || 'YOUR_API_KEY_HERE';

/**
 * Extracts audio from a video file using ffmpeg.
 * @param {string} videoPath - The path to the input video file (e.g., .mp4)
 * @returns {string} - The path to the extracted audio file (.mp3)
 */
function extractAudio(videoPath) {
    const audioPath = videoPath.replace(path.extname(videoPath), '.mp3');
    console.log(`\n🎧 Extracting audio from video: ${videoPath}`);
    
    try {
        // Run ffmpeg synchronously to extract audio (1 channel, 16kHz for better ASR performance)
        execSync(`ffmpeg -i "${videoPath}" -q:a 0 -map a -ac 1 -ar 16000 -y "${audioPath}"`, { stdio: 'ignore' });
        console.log(`✅ Audio extracted successfully: ${audioPath}`);
        return audioPath;
    } catch (error) {
        console.error('❌ Failed to extract audio. Make sure ffmpeg is installed on your system.');
        console.error(error);
        process.exit(1);
    }
}

/**
 * Sends the audio file to your ASR API to get a diarized transcript.
 * @param {string} audioPath - The path to the extracted audio file
 */
async function testVideoASR(audioPath) {
    console.log(`\n🚀 Sending audio to ASR for transcription and diarization...`);

    if (ASR_API_URL === 'YOUR_ASR_API_ENDPOINT_HERE') {
        console.warn('⚠️ WARNING: You have not set your ASR_API_URL. Please update the configuration in this script.');
        return;
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(audioPath));
    
    // Most ASRs require flags for diarization and language. Adjust to match your specific ASR's parameters.
    form.append('language', 'ta'); // Tamil
    form.append('diarize', 'true');

    try {
        const response = await axios.post(ASR_API_URL, form, {
            headers: {
                ...form.getHeaders(),
                'Authorization': `Bearer ${ASR_API_KEY}`
            }
        });

        console.log(`\n✅ ASR Transcription Successful!\n`);
        
        // This assumes a standard JSON response format. Adjust based on your ASR.
        const transcript = response.data;
        console.log(JSON.stringify(transcript, null, 2));

        // Cleanup the temporary audio file
        fs.unlinkSync(audioPath);
        console.log(`\n🧹 Cleaned up temporary audio file.`);
        
    } catch (error) {
        console.error('❌ ASR Request Failed:');
        console.error(error.response ? error.response.data : error.message);
    }
}

// ---------------------------------------------------------
// EXECUTION
// ---------------------------------------------------------
const inputFile = process.argv[2];

if (!inputFile || !fs.existsSync(inputFile)) {
    console.error('Usage: node test_asr.js <path_to_video_or_audio_file>');
    process.exit(1);
}

// If it's a video, extract the audio first. If it's already audio, just use it.
const ext = path.extname(inputFile).toLowerCase();
const isVideo = ['.mp4', '.mkv', '.avi', '.mov'].includes(ext);

const audioToProcess = isVideo ? extractAudio(inputFile) : inputFile;

// Run the test
testVideoASR(audioToProcess);
