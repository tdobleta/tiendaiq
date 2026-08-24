-- The worker executes create-subscription, while the web admits its intent.
-- Keep their effective non-secret billing settings observable across services.
-- Existing workers remain compatible through the original heartbeat function;
-- until the new worker reports, the separate aggregate is fail-closed.

ALTER TABLE control_plane.worker_heartbeats
  ADD COLUMN IF NOT EXISTS billing_contract_version integer,
  ADD COLUMN IF NOT EXISTS billing_plan_test boolean,
  ADD COLUMN IF NOT EXISTS billing_app_handle text;

CREATE OR REPLACE FUNCTION control_plane.record_worker_heartbeat(
  p_worker_id text,
  p_release_sha text,
  p_generation_concurrency integer,
  p_publication_concurrency integer,
  p_webhook_concurrency integer,
  p_billing_contract_version integer,
  p_billing_plan_test boolean,
  p_billing_app_handle text
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
  IF p_billing_contract_version <> 1 THEN
    RAISE EXCEPTION 'version de contrato billing invalida';
  END IF;
  IF p_billing_app_handle IS NOT NULL
     AND p_billing_app_handle !~ '^[a-z0-9][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'app handle billing invalido';
  END IF;

  DELETE FROM control_plane.worker_heartbeats
   WHERE last_seen_at < statement_timestamp() - interval '24 hours';

  INSERT INTO control_plane.worker_heartbeats
    (worker_id, release_sha, runtime_role, isolation_ok,
     generation_concurrency, publication_concurrency, webhook_concurrency,
     billing_contract_version, billing_plan_test, billing_app_handle)
  VALUES
    (p_worker_id, p_release_sha, 'tiendaiq_worker_runtime', true,
     p_generation_concurrency, p_publication_concurrency, p_webhook_concurrency,
     p_billing_contract_version, p_billing_plan_test, p_billing_app_handle)
  ON CONFLICT (worker_id) DO UPDATE
  SET release_sha = EXCLUDED.release_sha,
      runtime_role = EXCLUDED.runtime_role,
      isolation_ok = EXCLUDED.isolation_ok,
      generation_concurrency = EXCLUDED.generation_concurrency,
      publication_concurrency = EXCLUDED.publication_concurrency,
      webhook_concurrency = EXCLUDED.webhook_concurrency,
      billing_contract_version = EXCLUDED.billing_contract_version,
      billing_plan_test = EXCLUDED.billing_plan_test,
      billing_app_handle = EXCLUDED.billing_app_handle,
      last_seen_at = statement_timestamp();
END
$$;

REVOKE ALL ON FUNCTION control_plane.record_worker_heartbeat(text, text, integer, integer, integer, integer, boolean, text)
  FROM PUBLIC, tiendaiq_web_runtime;
GRANT EXECUTE ON FUNCTION control_plane.record_worker_heartbeat(text, text, integer, integer, integer, integer, boolean, text)
  TO tiendaiq_worker_runtime;

CREATE OR REPLACE FUNCTION control_plane.operational_billing_worker_status()
RETURNS TABLE (
  contract_version integer,
  plan_test boolean,
  app_handle text,
  configured boolean,
  active_workers integer,
  version_variants integer,
  plan_test_variants integer,
  app_handle_variants integer
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
  SELECT CASE WHEN count(DISTINCT active.billing_contract_version) = 1
              THEN min(active.billing_contract_version) END,
         CASE WHEN count(DISTINCT active.billing_plan_test) = 1
              THEN bool_and(active.billing_plan_test) END,
         CASE WHEN count(DISTINCT active.billing_app_handle) = 1
              THEN min(active.billing_app_handle) END,
         coalesce(bool_and(
           active.billing_contract_version = 1
           AND active.billing_app_handle ~ '^[a-z0-9][a-z0-9-]*$'
         ), false),
         count(*)::integer,
         count(DISTINCT active.billing_contract_version)::integer,
         count(DISTINCT active.billing_plan_test)::integer,
         count(DISTINCT active.billing_app_handle)::integer
    FROM active
$$;

REVOKE ALL ON FUNCTION control_plane.operational_billing_worker_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION control_plane.operational_billing_worker_status()
  FROM tiendaiq_web_runtime, tiendaiq_worker_runtime;
GRANT EXECUTE ON FUNCTION control_plane.operational_billing_worker_status()
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

COMMENT ON FUNCTION control_plane.operational_billing_worker_status() IS
  'Tenant-free, non-secret worker billing contract for fail-closed operational checks.';
