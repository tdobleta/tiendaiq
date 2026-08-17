-- Render can attach provider-managed memberships whose grantor is its own
-- postgres role. Rotate the application capability instead of requiring
-- elevated privileges to revoke those historical edges.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_worker_capability_v2') THEN
    RAISE EXCEPTION 'Falta tiendaiq_worker_capability_v2; ejecutar el bootstrap antes de migrar';
  END IF;
END
$$;

DROP POLICY IF EXISTS jobs_worker_claim ON control_plane.jobs;
CREATE POLICY jobs_worker_claim ON control_plane.jobs
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'));

DROP POLICY IF EXISTS inbox_events_worker ON control_plane.inbox_events;
CREATE POLICY inbox_events_worker ON control_plane.inbox_events
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'));

DROP POLICY IF EXISTS privacy_requests_worker ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_worker ON control_plane.privacy_requests
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'));

DROP POLICY IF EXISTS outbox_worker_dispatch ON control_plane.outbox_events;
CREATE POLICY outbox_worker_dispatch ON control_plane.outbox_events
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability_v2', 'member'));

COMMENT ON POLICY jobs_worker_claim ON control_plane.jobs IS
  'Worker-only access authorized by the versioned application-owned capability.';
