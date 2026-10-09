-- ============================================================
-- QC Platform v3: Sprint 1 Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Queue Concurrency & Fencing Tokens
-- ============================================================
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS worker_id UUID;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS claim_generation INT DEFAULT 0;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS attempt_count INT DEFAULT 0;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS retry_after TIMESTAMPTZ;

-- 2. Atomic Queue Claim Function (RPC)
-- ============================================================
-- This function atomically locks the oldest pending row and assigns it to a worker.
-- It prevents race conditions when multiple Mac Minis poll the queue.
CREATE OR REPLACE FUNCTION claim_next_queue_job(p_worker_id UUID, p_lease_minutes INT DEFAULT 15)
RETURNS SETOF callizer_queue AS $$
DECLARE
  v_job callizer_queue%rowtype;
BEGIN
  -- Find the oldest pending or expired lease job and lock it
  SELECT *
  INTO v_job
  FROM callizer_queue
  WHERE status = 'pending' 
     OR (status = 'claimed' AND lease_expires_at < NOW())
  ORDER BY created_at ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    -- Update the job with the worker's lease
    UPDATE callizer_queue
    SET 
      status = 'claimed',
      worker_id = p_worker_id,
      claimed_at = NOW(),
      lease_expires_at = NOW() + (p_lease_minutes || ' minutes')::INTERVAL,
      claim_generation = claim_generation + 1,
      attempt_count = attempt_count + 1
    WHERE id = v_job.id
    RETURNING * INTO v_job;

    RETURN NEXT v_job;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- 3. Deduplication Constraint
-- ============================================================
-- Requires stable provider ID to prevent duplicate billing on webhook retries
ALTER TABLE calls ADD COLUMN IF NOT EXISTS provider_recording_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS provider_source TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS source_tenant TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS role_assignment_method TEXT;

-- Drop existing unique constraints if necessary before adding the compound one
-- ALTER TABLE calls DROP CONSTRAINT IF EXISTS calls_provider_recording_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calls_dedup 
ON calls (provider_recording_id, provider_source, source_tenant) 
WHERE provider_recording_id IS NOT NULL;

-- 4. Immutable Evaluation & Rubric History
-- ============================================================
CREATE TABLE IF NOT EXISTS rubric_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    parameters JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by TEXT NOT NULL,
    notes TEXT,
    UNIQUE (source, content_hash)
);

CREATE TABLE IF NOT EXISTS evaluation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_id TEXT REFERENCES calls(id) ON DELETE CASCADE,
    rubric_version_id UUID REFERENCES rubric_versions(id),
    model_id TEXT NOT NULL,
    input_snapshot JSONB NOT NULL,
    results JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS human_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluation_run_id UUID REFERENCES evaluation_runs(id) ON DELETE CASCADE,
    field_path TEXT NOT NULL,
    old_value JSONB,
    new_value JSONB NOT NULL,
    reviewer_id TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
