-- ============================================================
-- Migration: Lead-Centric Evaluation Architecture
-- Run this in Supabase SQL Editor
-- ============================================================

-- 1. New columns on `calls` table
-- ============================================================
ALTER TABLE calls ADD COLUMN IF NOT EXISTS talk_to_listen_ratio TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS participant_stats JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS conversation_topics JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_quality_score REAL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS call_quality_raw TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS insights_data JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS summary_data JSONB;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS quality_data JSONB;

-- 2. New columns on `leads` table
-- ============================================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_score INTEGER;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS intent_factors JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS bant_insights JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS data_capture JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS journey_summary TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_process_step TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS avg_call_quality_score REAL;

-- 3. Add scoring columns to existing `qc_parameters` table
-- ============================================================
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS check_question TEXT;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS max_score INTEGER DEFAULT 10;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS parameter_type TEXT DEFAULT 'Default';
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS mark_fatal BOOLEAN DEFAULT FALSE;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS enable_subjective_marking BOOLEAN DEFAULT FALSE;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS na_condition TEXT;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS auto_detect_na BOOLEAN DEFAULT TRUE;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS default_na BOOLEAN DEFAULT FALSE;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS applicable_only_once_per_customer BOOLEAN DEFAULT FALSE;
ALTER TABLE qc_parameters ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 4. Create `data_capture_questions` table
-- ============================================================
CREATE TABLE IF NOT EXISTS data_capture_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source TEXT NOT NULL DEFAULT 'phone_call',
    question TEXT NOT NULL,
    label TEXT NOT NULL,
    category TEXT DEFAULT 'Data Capture',
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Seed default data capture questions for phone_call source
-- ============================================================
INSERT INTO data_capture_questions (source, question, label, category, sort_order) VALUES
('phone_call', 'What competitors or alternative options did the customer mention?', 'Competitors Mentioned', 'Data Capture', 1),
('phone_call', 'What is the customer''s location (city/district)?', 'Customer Location', 'Data Capture', 2),
('phone_call', 'Is the customer preparing for JEE or have they written any other exams?', 'JEE/Other Exams', 'Data Capture', 3),
('phone_call', 'Who is the decision maker at home?', 'Decision Maker', 'Data Capture', 4),
('phone_call', 'Which course/college is the customer planning to join?', 'Course/College Interested In', 'Data Capture', 5),
('phone_call', 'What is the customer''s email ID?', 'Email ID', 'Data Capture', 6),
('phone_call', 'Is the student taking JEE coaching?', 'JEE Coaching', 'Data Capture', 7),
('phone_call', 'What is the student''s JEE percentile or score?', 'JEE Percentile', 'Data Capture', 8)
ON CONFLICT DO NOTHING;
