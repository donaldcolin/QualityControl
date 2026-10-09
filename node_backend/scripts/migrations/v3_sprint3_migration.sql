-- ============================================================
-- QC Platform v3: Sprint 3 Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Gemini Batch API Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS gemini_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_name TEXT NOT NULL,
    gcp_file_uri TEXT,
    gcp_batch_job_name TEXT,
    status TEXT DEFAULT 'pending_upload', -- pending_upload, processing, completed, failed
    total_requests INT DEFAULT 0,
    successful_requests INT DEFAULT 0,
    failed_requests INT DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 2. Triage / Batch Queue
-- ============================================================
-- We add a triage routing status to `evaluation_runs` so we know if it's 
-- waiting for the nightly batch or ran in real-time.
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS evaluation_tier TEXT DEFAULT 'T1_Batch'; 
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES gemini_batches(id);
ALTER TABLE evaluation_runs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending'; -- pending, completed, failed
