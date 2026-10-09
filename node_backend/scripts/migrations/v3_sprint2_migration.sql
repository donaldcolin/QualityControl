-- ============================================================
-- QC Platform v3: Sprint 2 Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. CRM Outbox Pattern (Transactional safety for LSQ pushes)
-- ============================================================
CREATE TABLE IF NOT EXISTS crm_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prospect_id TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT DEFAULT 'pending', -- pending, processing, success, failed
    retry_count INT DEFAULT 0,
    next_retry_at TIMESTAMPTZ DEFAULT NOW(),
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

-- Index for the worker to quickly find pending jobs
CREATE INDEX IF NOT EXISTS idx_crm_outbox_pending 
ON crm_outbox(next_retry_at) 
WHERE status IN ('pending', 'failed');
