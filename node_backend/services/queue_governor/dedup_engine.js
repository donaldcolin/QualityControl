const crypto = require('crypto');
const supabase = require('../../config/supabase');

/**
 * Computes a deterministic SHA-256 content fingerprint for an incoming call/audio.
 * 
 * @param {object} params
 * @param {string} params.source - e.g. 'phone_call', 'google_meet', 'lsq_auto', 'dropzone'
 * @param {string} [params.externalId] - LeadSquared activity ID or Drive file ID
 * @param {number} [params.durationSec] - Audio duration in seconds
 * @param {string} [params.audioUrl] - Audio URL or relative storage path
 * @param {string} [params.filename] - Original filename
 * @returns {string} SHA-256 hex string
 */
function computeAudioFingerprint({ source = 'phone_call', externalId, durationSec = 0, audioUrl, filename }) {
  const normSource = String(source || 'phone_call').trim().toLowerCase();
  const normExtId = String(externalId || '').trim();
  const normDuration = Math.round(Number(durationSec) || 0);
  const normUrl = String(audioUrl || filename || '').trim();

  // Combine stable immutable attributes
  const rawPayload = `${normSource}::${normExtId}::${normDuration}::${normUrl}`;
  return crypto.createHash('sha256').update(rawPayload).digest('hex');
}

/**
 * Checks whether an audio item with this fingerprint has already been processed or is currently in flight.
 * 
 * @param {string} dedupHash - SHA-256 fingerprint
 * @returns {Promise<{ isDuplicate: boolean, existingItem: object|null }>}
 */
async function checkDuplicate(dedupHash) {
  if (!supabase || !dedupHash) {
    return { isDuplicate: false, existingItem: null };
  }

  try {
    const { data, error } = await supabase
      .from('callizer_queue')
      .select('id, call_id, status, priority, audio_url, created_at')
      .eq('dedup_hash', dedupHash)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(`[DedupEngine] Query warning: ${error.message}`);
      return { isDuplicate: false, existingItem: null };
    }

    if (data) {
      return {
        isDuplicate: true,
        existingItem: data
      };
    }

    return { isDuplicate: false, existingItem: null };
  } catch (err) {
    console.warn(`[DedupEngine] Non-fatal check warning: ${err.message}`);
    return { isDuplicate: false, existingItem: null };
  }
}

module.exports = {
  computeAudioFingerprint,
  checkDuplicate
};
