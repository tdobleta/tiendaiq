-- Terminal job cleanup must survive a worker crash. The terminal transition
-- and the compensation request are persisted atomically; workers claim the
-- cleanup independently with the same cross-tenant capability used by jobs.

ALTER TABLE control_plane.jobs
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_status TEXT
    CHECK (compensation_status IN ('pending', 'running', 'succeeded', 'dead_letter')),
  ADD COLUMN IF NOT EXISTS compensation_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS compensation_run_after TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compensation_locked_by TEXT,
  ADD COLUMN IF NOT EXISTS compensation_last_error TEXT,
  ADD COLUMN IF NOT EXISTS compensated_at TIMESTAMPTZ;

-- Preserve leases held by the pre-explicit-lease worker during a rolling
-- upgrade. The compatibility trigger keeps following legacy renewals until
-- every worker writes lease_expires_at itself.
UPDATE control_plane.jobs
SET lease_expires_at = locked_at + interval '1 hour'
WHERE status = 'running'
  AND lease_expires_at IS NULL
  AND locked_at IS NOT NULL;

UPDATE control_plane.jobs
SET compensation_lease_expires_at = compensation_locked_at + interval '1 hour'
WHERE compensation_status = 'running'
  AND compensation_lease_expires_at IS NULL
  AND compensation_locked_at IS NOT NULL;

CREATE OR REPLACE FUNCTION control_plane.sync_legacy_job_lease_expiry()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, control_plane
AS $$
BEGIN
  IF NEW.status = 'running'
     AND NEW.locked_at IS DISTINCT FROM OLD.locked_at
     AND NEW.lease_expires_at IS NOT DISTINCT FROM OLD.lease_expires_at THEN
    NEW.lease_expires_at := NEW.locked_at + interval '1 hour';
  END IF;

  IF NEW.compensation_status = 'running'
     AND NEW.compensation_locked_at IS DISTINCT FROM OLD.compensation_locked_at
     AND NEW.compensation_lease_expires_at IS NOT DISTINCT FROM OLD.compensation_lease_expires_at THEN
    NEW.compensation_lease_expires_at := NEW.compensation_locked_at + interval '1 hour';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS jobs_sync_legacy_lease_expiry ON control_plane.jobs;
CREATE TRIGGER jobs_sync_legacy_lease_expiry
BEFORE UPDATE OF locked_at, lease_expires_at, compensation_locked_at, compensation_lease_expires_at
ON control_plane.jobs
FOR EACH ROW
EXECUTE FUNCTION control_plane.sync_legacy_job_lease_expiry();

REVOKE ALL ON FUNCTION control_plane.sync_legacy_job_lease_expiry() FROM PUBLIC;

CREATE INDEX IF NOT EXISTS jobs_compensation_ready_idx
  ON control_plane.jobs (compensation_status, compensation_run_after)
  WHERE compensation_status = 'pending';

CREATE INDEX IF NOT EXISTS jobs_compensation_reclaim_idx
  ON control_plane.jobs (compensation_status, compensation_lease_expires_at)
  WHERE compensation_status = 'running';

CREATE INDEX IF NOT EXISTS jobs_lease_reclaim_idx
  ON control_plane.jobs (status, lease_expires_at)
  WHERE status = 'running';

DROP FUNCTION IF EXISTS control_plane.operational_queue_status();
CREATE FUNCTION control_plane.operational_queue_status()
RETURNS TABLE (
  type text,
  queued integer,
  running integer,
  failed integer,
  failed_recent integer,
  stale_running integer,
  compensation_pending integer,
  compensation_dead_letter integer,
  stale_compensation integer,
  oldest_queued_seconds double precision,
  oldest_compensation_seconds double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
  SELECT jobs.type,
         count(*) FILTER (WHERE jobs.status = 'queued')::integer,
         count(*) FILTER (WHERE jobs.status = 'running')::integer,
         count(*) FILTER (WHERE jobs.status = 'failed')::integer,
         count(*) FILTER (
           WHERE jobs.status = 'failed'
             AND jobs.updated_at >= statement_timestamp() - interval '15 minutes'
         )::integer,
         count(*) FILTER (
           WHERE jobs.status = 'running'
             AND coalesce(
               jobs.lease_expires_at,
               jobs.locked_at + interval '1 hour',
               '-infinity'::timestamptz
             ) < statement_timestamp()
         )::integer,
         count(*) FILTER (
           WHERE jobs.compensation_status IN ('pending', 'running')
         )::integer,
         count(*) FILTER (
           WHERE jobs.compensation_status = 'dead_letter'
         )::integer,
         count(*) FILTER (
           WHERE jobs.compensation_status = 'running'
             AND coalesce(
               jobs.compensation_lease_expires_at,
               jobs.compensation_locked_at + interval '1 hour',
               '-infinity'::timestamptz
             ) < statement_timestamp()
         )::integer,
         coalesce(
           extract(epoch FROM (statement_timestamp() - min(jobs.created_at) FILTER (WHERE jobs.status = 'queued'))),
           0
         )::double precision,
         coalesce(
           extract(epoch FROM (
             statement_timestamp() - min(jobs.completed_at)
               FILTER (WHERE jobs.compensation_status IN ('pending', 'running'))
           )),
           0
         )::double precision
    FROM control_plane.jobs AS jobs
   WHERE jobs.status IN ('queued', 'running', 'failed')
      OR jobs.compensation_status IN ('pending', 'running', 'dead_letter')
   GROUP BY jobs.type
   ORDER BY jobs.type
$$;

REVOKE ALL ON FUNCTION control_plane.operational_queue_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION control_plane.operational_queue_status()
  FROM tiendaiq_web, tiendaiq_worker;
GRANT EXECUTE ON FUNCTION control_plane.operational_queue_status()
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

COMMENT ON COLUMN control_plane.jobs.compensation_status IS
  'Durable cleanup requested atomically with a terminal job failure.';

COMMENT ON COLUMN control_plane.jobs.lease_expires_at IS
  'Authoritative expiry for the primary worker lease.';

COMMENT ON COLUMN control_plane.jobs.compensation_lease_expires_at IS
  'Authoritative expiry for the durable compensation lease.';
