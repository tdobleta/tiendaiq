-- Webhook processing uses an explicit expiry so claim, renewal and readiness
-- agree even when the configured lease duration changes.

ALTER TABLE control_plane.inbox_events
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;

UPDATE control_plane.inbox_events
SET lease_expires_at = locked_at + interval '3 minutes'
WHERE status = 'processing'
  AND lease_expires_at IS NULL
  AND locked_at IS NOT NULL;

DROP INDEX IF EXISTS control_plane.inbox_events_reclaim_idx;
CREATE INDEX inbox_events_reclaim_idx
  ON control_plane.inbox_events (status, lease_expires_at)
  WHERE status = 'processing';

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
        AND coalesce(
          lease_expires_at,
          locked_at + interval '3 minutes',
          '-infinity'::timestamptz
        ) < statement_timestamp()
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
REVOKE ALL ON FUNCTION control_plane.operational_inbox_status()
  FROM tiendaiq_web, tiendaiq_worker;
GRANT EXECUTE ON FUNCTION control_plane.operational_inbox_status()
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

COMMENT ON COLUMN control_plane.inbox_events.lease_expires_at IS
  'Authoritative expiry for the webhook worker lease.';
