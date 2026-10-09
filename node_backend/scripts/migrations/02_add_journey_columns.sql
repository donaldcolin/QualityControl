-- Add journey_insights and journey_coaching columns for holistic evaluation
ALTER TABLE leads ADD COLUMN IF NOT EXISTS journey_insights JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS journey_coaching JSONB;
