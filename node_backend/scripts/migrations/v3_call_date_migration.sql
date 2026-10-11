-- ============================================================
-- QC Platform: Call Date & Chronological Queue Ordering Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Add call_date column to callizer_queue and calls tables
ALTER TABLE callizer_queue ADD COLUMN IF NOT EXISTS call_date TIMESTAMPTZ;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_date TIMESTAMPTZ;

-- 2. Indexes for performant chronological sorting
CREATE INDEX IF NOT EXISTS idx_calls_prospect_call_date 
ON calls (prospect_id, call_date ASC);

CREATE INDEX IF NOT EXISTS idx_callizer_queue_call_date 
ON callizer_queue (call_date ASC);

-- 3. Update atomic queue claim function to prioritize by actual call_date
CREATE OR REPLACE FUNCTION claim_next_queue_job(p_worker_id UUID, p_lease_minutes INT DEFAULT 15)
RETURNS SETOF callizer_queue AS $$
DECLARE
  v_job callizer_queue%rowtype;
BEGIN
  -- Find the oldest pending or expired lease job, ordered chronologically by call_date (falling back to created_at)
  SELECT *
  INTO v_job
  FROM callizer_queue
  WHERE status = 'pending' 
     OR (status = 'claimed' AND lease_expires_at < NOW())
  ORDER BY COALESCE(call_date, created_at) ASC, created_at ASC
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
