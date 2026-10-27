-- Source: SYSTEM_BUILD_GUIDE.md §15 ("rate-limit the public /join and /confirm ... a small table").
-- Phase 6 hardening. Added after 0001-0003 (never edit applied migrations).
-- Fixed-window counter. Only the server (service role) may call it; the API roles cannot.

CREATE TABLE public.rate_limits (
  key TEXT NOT NULL,                       -- e.g. 'join:<hashed ip>'
  window_start TIMESTAMPTZ NOT NULL,
  hits INT NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;   -- no policies: service role only

CREATE FUNCTION public.rate_limit_hit(p_key TEXT, p_window_seconds INT, p_limit INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window TIMESTAMPTZ := to_timestamp(floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
  v_hits INT;
BEGIN
  INSERT INTO public.rate_limits AS r (key, window_start, hits)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (key, window_start) DO UPDATE SET hits = r.hits + 1
  RETURNING r.hits INTO v_hits;

  -- Housekeeping: now and then drop windows older than a day.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN v_hits <= p_limit;
END
$$;

REVOKE ALL ON public.rate_limits FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INT, INT) TO service_role;
