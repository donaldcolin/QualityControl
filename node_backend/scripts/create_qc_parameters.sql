CREATE TABLE public.qc_parameters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL,
  category text NOT NULL,
  parameter text NOT NULL,
  description text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Optional: Create an index on source for faster filtering
CREATE INDEX idx_qc_parameters_source ON public.qc_parameters(source);
