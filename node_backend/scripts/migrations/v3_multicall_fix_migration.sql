-- ============================================================
-- QC Platform: Multi-Call Context Fix Migration
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. Per-call intent history for trend tracking
-- Stores an array of { call_number, call_id, intent_score, source, evaluated_at }
-- so the dashboard can show intent trajectory across calls.
-- ============================================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS call_history_snapshot JSONB DEFAULT '[]'::jsonb;

-- 2. Add index for faster lead state lookups during evaluation
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_call_id_created 
ON evaluation_runs (call_id, created_at DESC);
