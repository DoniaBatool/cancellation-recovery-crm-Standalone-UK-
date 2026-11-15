-- Supabase security advisor (function_search_path_mutable): the trigger function added in 0009 had no fixed
-- search_path. It only compares two columns of the row being updated, so the risk was low, but we pin it anyway.
-- 0009 is applied, so this is a new migration (never edit an applied one). No table or data change.

ALTER FUNCTION private.block_scrubbed_waitlist_reactivation() SET search_path = pg_catalog, pg_temp;
