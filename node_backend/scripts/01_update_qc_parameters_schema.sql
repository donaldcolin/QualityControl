-- Migration to add v3 parameters for Phone Call evaluation
ALTER TABLE public.qc_parameters
ADD COLUMN IF NOT EXISTS param_id text,
ADD COLUMN IF NOT EXISTS category_weight_pct numeric,
ADD COLUMN IF NOT EXISTS scale text,
ADD COLUMN IF NOT EXISTS polarity text,
ADD COLUMN IF NOT EXISTS embedded_breach_flag boolean,
ADD COLUMN IF NOT EXISTS evidence_required text;
