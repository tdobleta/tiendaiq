CREATE OR REPLACE FUNCTION control_plane.operational_inbox_status()
RETURNS TABLE (
  received integer,
  processing integer,
  failed integer,
  failed_recent integer,
  stale_processing integer,
  oldest_received_seconds double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'received')::integer AS received,
    count(*) FILTER (WHERE status = 'processing')::integer AS processing,
    count(*) FILTER (WHERE status = 'failed')::integer AS failed,
    count(*) FILTER (
      WHERE status = 'failed'
        AND updated_at >= statement_timestamp() - interval '15 minutes'
    )::integer AS failed_recent,
    count(*) FILTER (
      WHERE status = 'processing'
        AND locked_at < statement_timestamp() - interval '3 minutes'
    )::integer AS stale_processing,
    COALESCE(
      GREATEST(
        0,
        extract(epoch FROM statement_timestamp() - min(run_after) FILTER (WHERE status = 'received'))
      ),
      0
    )::double precision AS oldest_received_seconds
  FROM control_plane.inbox_events
  WHERE status IN ('received', 'processing', 'failed');
$$;

REVOKE ALL ON FUNCTION control_plane.operational_inbox_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION control_plane.operational_inbox_status() FROM tiendaiq_web;
REVOKE ALL ON FUNCTION control_plane.operational_inbox_status() FROM tiendaiq_worker;
GRANT EXECUTE ON FUNCTION control_plane.operational_inbox_status() TO tiendaiq_web_runtime;
GRANT EXECUTE ON FUNCTION control_plane.operational_inbox_status() TO tiendaiq_worker_runtime;

COMMENT ON FUNCTION control_plane.operational_inbox_status() IS
  'Agregado operacional sin datos de tenant para readiness de la bandeja durable de webhooks.';
