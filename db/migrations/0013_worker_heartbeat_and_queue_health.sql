-- Operational evidence for the background worker. This table never stores
-- tenant identifiers or payloads. Only the isolated worker role can write it;
-- web can read a single aggregate row through a SECURITY DEFINER function.

CREATE TABLE IF NOT EXISTS control_plane.worker_heartbeats (
  worker_id text PRIMARY KEY,
  release_sha text NOT NULL CHECK (release_sha ~ '^[a-f0-9]{40}$'),
  runtime_role text NOT NULL,
  isolation_ok boolean NOT NULL,
  generation_concurrency integer NOT NULL CHECK (generation_concurrency BETWEEN 1 AND 32),
  publication_concurrency integer NOT NULL CHECK (publication_concurrency BETWEEN 1 AND 32),
  webhook_concurrency integer NOT NULL CHECK (webhook_concurrency BETWEEN 1 AND 32),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE control_plane.worker_heartbeats FROM PUBLIC;
REVOKE ALL ON TABLE control_plane.worker_heartbeats FROM tiendaiq_web, tiendaiq_worker;
REVOKE ALL ON TABLE control_plane.worker_heartbeats
  FROM tiendaiq_web_runtime, tiendaiq_worker_runtime;

CREATE OR REPLACE FUNCTION control_plane.record_worker_heartbeat(
  p_worker_id text,
  p_release_sha text,
  p_generation_concurrency integer,
  p_publication_concurrency integer,
  p_webhook_concurrency integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
BEGIN
  IF length(p_worker_id) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'worker_id invalido';
  END IF;
  IF p_release_sha !~ '^[a-f0-9]{40}$' THEN
    RAISE EXCEPTION 'release_sha invalido';
  END IF;
  IF p_generation_concurrency NOT BETWEEN 1 AND 32
     OR p_publication_concurrency NOT BETWEEN 1 AND 32
     OR p_webhook_concurrency NOT BETWEEN 1 AND 32 THEN
    RAISE EXCEPTION 'capacidad worker fuera de rango';
  END IF;

  DELETE FROM control_plane.worker_heartbeats
   WHERE last_seen_at < statement_timestamp() - interval '24 hours';

  INSERT INTO control_plane.worker_heartbeats
    (worker_id, release_sha, runtime_role, isolation_ok,
     generation_concurrency, publication_concurrency, webhook_concurrency)
  VALUES
    (p_worker_id, p_release_sha, 'tiendaiq_worker_runtime', true,
     p_generation_concurrency, p_publication_concurrency, p_webhook_concurrency)
  ON CONFLICT (worker_id) DO UPDATE
  SET release_sha = EXCLUDED.release_sha,
      runtime_role = EXCLUDED.runtime_role,
      isolation_ok = EXCLUDED.isolation_ok,
      generation_concurrency = EXCLUDED.generation_concurrency,
      publication_concurrency = EXCLUDED.publication_concurrency,
      webhook_concurrency = EXCLUDED.webhook_concurrency,
      last_seen_at = statement_timestamp();
END
$$;

REVOKE ALL ON FUNCTION control_plane.record_worker_heartbeat(text, text, integer, integer, integer)
  FROM PUBLIC, tiendaiq_web, tiendaiq_worker, tiendaiq_web_runtime;
GRANT EXECUTE ON FUNCTION control_plane.record_worker_heartbeat(text, text, integer, integer, integer)
  TO tiendaiq_worker_runtime;

CREATE OR REPLACE FUNCTION control_plane.operational_worker_status()
RETURNS TABLE (
  worker_id text,
  release_sha text,
  runtime_role text,
  isolation_ok boolean,
  generation_concurrency integer,
  publication_concurrency integer,
  webhook_concurrency integer,
  age_seconds double precision,
  uptime_seconds double precision,
  started_at timestamptz,
  last_seen_at timestamptz,
  active_workers integer,
  release_variants integer,
  runtime_role_variants integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
  WITH active AS (
    SELECT *
      FROM control_plane.worker_heartbeats
     WHERE last_seen_at >= statement_timestamp() - interval '60 seconds'
  )
  SELECT CASE WHEN count(*) = 1 THEN max(active.worker_id) END,
         CASE WHEN count(DISTINCT active.release_sha) = 1 THEN min(active.release_sha) END,
         CASE WHEN count(DISTINCT active.runtime_role) = 1 THEN min(active.runtime_role) END,
         coalesce(bool_and(active.isolation_ok), false),
         coalesce(sum(active.generation_concurrency), 0)::integer,
         coalesce(sum(active.publication_concurrency), 0)::integer,
         coalesce(sum(active.webhook_concurrency), 0)::integer,
         coalesce(
           max(extract(epoch FROM (statement_timestamp() - active.last_seen_at))),
           2147483647
         )::double precision,
         coalesce(
           min(extract(epoch FROM (statement_timestamp() - active.started_at))),
           0
         )::double precision,
         min(active.started_at),
         max(active.last_seen_at),
         count(*)::integer,
         count(DISTINCT active.release_sha)::integer,
         count(DISTINCT active.runtime_role)::integer
    FROM active
$$;

REVOKE ALL ON FUNCTION control_plane.operational_worker_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION control_plane.operational_worker_status()
  FROM tiendaiq_web, tiendaiq_worker;
GRANT EXECUTE ON FUNCTION control_plane.operational_worker_status()
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

-- Replace the aggregate with bounded operational signals. Extra columns do
-- not reveal tenant data and let readiness distinguish historical failures
-- from active incidents and abandoned leases.
DROP FUNCTION control_plane.operational_queue_status();
CREATE FUNCTION control_plane.operational_queue_status()
RETURNS TABLE (
  type text,
  queued integer,
  running integer,
  failed integer,
  failed_recent integer,
  stale_running integer,
  oldest_queued_seconds double precision
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
             AND jobs.locked_at < statement_timestamp() - interval '6 minutes'
         )::integer,
         coalesce(
           extract(epoch FROM (statement_timestamp() - min(jobs.created_at) FILTER (WHERE jobs.status = 'queued'))),
           0
         )::double precision
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

COMMENT ON TABLE control_plane.worker_heartbeats IS
  'Tenant-free worker liveness and release evidence for deployment gates.';
COMMENT ON FUNCTION control_plane.record_worker_heartbeat(text, text, integer, integer, integer) IS
  'Bounded heartbeat writer available only through the isolated worker runtime role.';
COMMENT ON FUNCTION control_plane.operational_worker_status() IS
  'Latest tenant-free worker heartbeat exposed to authenticated operational monitors.';
