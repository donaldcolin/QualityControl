-- ============================================================
-- QC Platform v4: Smart Queue Priority & Dual Hardware Mode Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Ensure Columns Exist on callizer_queue
-- ============================================================
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS priority INT DEFAULT 2;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS dedup_hash TEXT;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'phone_call';
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS is_gated_admitted BOOLEAN DEFAULT FALSE;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS buffered_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS processing_duration_sec INT;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS retry_stage TEXT;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS error_category TEXT;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS cooldown_duration_sec INT DEFAULT 0;
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS claim_generation INT DEFAULT 0;

-- 2. Indexes for High-Velocity Priority Dispatch & Dead-Letter Isolation
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_callizer_queue_priority_dispatch 
  ON callizer_queue (status, priority ASC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_callizer_queue_dedup_hash 
  ON callizer_queue (dedup_hash) WHERE dedup_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_callizer_queue_dlq 
  ON callizer_queue (status) WHERE status = 'dead_letter';

-- 3. Production Atomic Claiming Function with Priority & DEV/PROD Gating
-- ============================================================
-- p_mode: 'prod' (Lights-Out: claims all pending jobs immediately)
--         'dev'  (Human-Maintained: claims only when is_gated_admitted = TRUE)
CREATE OR REPLACE FUNCTION claim_next_queue_job_v2(
  p_worker_id UUID, 
  p_mode TEXT DEFAULT 'prod',
  p_lease_minutes INT DEFAULT 10
)
RETURNS SETOF callizer_queue AS $$
DECLARE
  v_job callizer_queue%rowtype;
BEGIN
  -- Atomically claim the highest priority, oldest pending job (or recover expired lease)
  SELECT *
  INTO v_job
  FROM callizer_queue
  WHERE (
    -- Normal pending jobs (mode-sensitive)
    (status = 'pending' AND (p_mode = 'prod' OR is_gated_admitted = TRUE))
    -- Self-healing: recover zombie jobs whose lease expired
    OR (status = 'claimed' AND lease_expires_at < NOW())
  )
  ORDER BY 
    priority ASC,        -- 1 (Urgent Demo) > 2 (Telephony) > 3 (Backfill)
    created_at ASC       -- FIFO within the same tier
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF FOUND THEN
    UPDATE callizer_queue
    SET 
      status = 'claimed',
      worker_id = p_worker_id,
      claimed_at = NOW(),
      lease_expires_at = NOW() + (p_lease_minutes || ' minutes')::INTERVAL,
      claim_generation = COALESCE(claim_generation, 0) + 1,
      attempt_count = COALESCE(attempt_count, 0) + 1
    WHERE id = v_job.id
    RETURNING * INTO v_job;

    RETURN NEXT v_job;
  END IF;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- 4. Backward Compatibility: Overload original claim_next_queue_job
-- ============================================================
-- Keeps existing workers functioning while automatically upgrading them to priority order.
CREATE OR REPLACE FUNCTION claim_next_queue_job(
  p_worker_id UUID, 
  p_lease_minutes INT DEFAULT 15
)
RETURNS SETOF callizer_queue AS $$
BEGIN
  RETURN QUERY SELECT * FROM claim_next_queue_job_v2(p_worker_id, 'prod', p_lease_minutes);
END;
$$ LANGUAGE plpgsql;
