-- Aggregate-only queue status for operational monitors.
-- Web remains tenant-scoped and never receives worker capability; this function
-- exposes only counts needed for alerts and readiness gates.

CREATE OR REPLACE FUNCTION control_plane.operational_queue_status()
RETURNS TABLE (
  type text,
  queued integer,
  running integer,
  failed integer,
  oldest_queued_seconds double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
  SELECT jobs.type,
         count(*) FILTER (WHERE jobs.status = 'queued')::integer AS queued,
         count(*) FILTER (WHERE jobs.status = 'running')::integer AS running,
         count(*) FILTER (WHERE jobs.status = 'failed')::integer AS failed,
         coalesce(
           extract(epoch FROM (statement_timestamp() - min(jobs.created_at) FILTER (WHERE jobs.status = 'queued'))),
           0
         )::double precision AS oldest_queued_seconds
    FROM control_plane.jobs AS jobs
   WHERE jobs.status IN ('queued', 'running', 'failed')
   GROUP BY jobs.type
   ORDER BY jobs.type
$$;

REVOKE ALL ON FUNCTION control_plane.operational_queue_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION control_plane.operational_queue_status()
  FROM tiendaiq_web, tiendaiq_worker;
GRANT EXECUTE ON FUNCTION control_plane.operational_queue_status()
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

COMMENT ON FUNCTION control_plane.operational_queue_status() IS
  'Aggregate-only queue status for operational readiness and alerts; never exposes tenants, payloads or job rows.';
