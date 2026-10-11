const fs = require('fs');
const path = require('path');

/**
 * Validates critical environment variables and ensures all required storage
 * subdirectories exist before the server accepts traffic.
 */
function validateEnvironment() {
  const isProd = process.env.NODE_ENV === 'production';
  const errors = [];
  const warnings = [];

  // 1. Required Variables Check
  const requiredKeys = ['SUPABASE_URL'];
  const hasSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

  if (!hasSupabaseKey) {
    if (isProd) {
      errors.push("Missing SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY in environment.");
    } else {
      warnings.push("SUPABASE_KEY not set. Database operations will fail.");
    }
  }

  for (const key of requiredKeys) {
    if (!process.env[key]) {
      if (isProd) {
        errors.push(`Missing required environment variable: ${key}`);
      } else {
        warnings.push(`Missing environment variable: ${key}`);
      }
    }
  }

  if (!process.env.GEMINI_API_KEY) {
    warnings.push("GEMINI_API_KEY is not set. AI evaluation will be unavailable.");
  }

  if (!process.env.JWT_SECRET && isProd) {
    warnings.push("JWT_SECRET is using default fallback secret. Set a unique JWT_SECRET for production.");
  }

  // 2. Ensure Required Storage Directories Exist
  const storageRoot = path.resolve(__dirname, '..', '..', 'storage');
  const requiredDirs = [
    storageRoot,
    path.join(storageRoot, 'temp_audio'),
    path.join(storageRoot, 'json_transcripts'),
    path.join(storageRoot, 'reference_slides'),
    path.join(storageRoot, 'reference_slides', 'images')
  ];

  for (const dir of requiredDirs) {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 [Boot Validator] Created directory: ${path.relative(process.cwd(), dir)}`);
      }
    } catch (err) {
      errors.push(`Failed to verify or create directory "${dir}": ${err.message}`);
    }
  }

  // 3. Print Diagnostics
  if (warnings.length > 0) {
    warnings.forEach(w => console.warn(`⚠️ [Boot Validator Warning] ${w}`));
  }

  if (errors.length > 0) {
    console.error('❌ [CRITICAL BOOT FAILURE] Pre-flight environment check failed:');
    errors.forEach(e => console.error(`   - ${e}`));
    if (isProd) {
      console.error('🛑 Halting process in production mode to prevent silent runtime failure.');
      process.exit(1);
    }
  } else {
    console.log('✅ [Boot Validator] Environment & storage directories validated successfully.');
  }

  return { errors, warnings };
}

module.exports = { validateEnvironment };
