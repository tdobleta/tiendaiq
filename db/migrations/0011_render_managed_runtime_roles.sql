-- Render owns the LOGIN credentials and does not allow changing their grants.
-- Application queries instead begin as our distinct NOINHERIT runtime roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_web_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_worker_runtime')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_worker_capability') THEN
    RAISE EXCEPTION 'Faltan los roles runtime aislados; ejecutar el bootstrap antes de migrar';
  END IF;
END
$$;

-- Legacy managed logins receive no DML. RESET ROLE therefore cannot recover
-- access; each credential can assume only its explicitly granted runtime role.
REVOKE ALL ON ALL TABLES IN SCHEMA public, control_plane, app_data
  FROM tiendaiq_web, tiendaiq_worker;
REVOKE USAGE ON SCHEMA public, control_plane, app_data
  FROM tiendaiq_web, tiendaiq_worker;
REVOKE ALL ON FUNCTION control_plane.generation_queue_pressure()
  FROM tiendaiq_web, tiendaiq_worker;

GRANT USAGE ON SCHEMA public, control_plane, app_data
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.tiendas,
  public.paginas,
  control_plane.tenants,
  control_plane.inbox_events,
  control_plane.jobs,
  control_plane.outbox_events,
  control_plane.privacy_requests,
  control_plane.usage_reservations,
  app_data.pages,
  app_data.page_versions,
  app_data.publications
TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

GRANT INSERT, DELETE ON TABLE public.estados_oauth
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;
GRANT SELECT (estado, tienda, vence) ON public.estados_oauth
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;
GRANT EXECUTE ON FUNCTION control_plane.generation_queue_pressure()
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;

-- The role selected at connection startup is current_user. session_user would
-- still refer to the provider-managed login and would reintroduce capability
-- inheritance from that credential.
DROP POLICY IF EXISTS jobs_worker_claim ON control_plane.jobs;
CREATE POLICY jobs_worker_claim ON control_plane.jobs
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'));

DROP POLICY IF EXISTS inbox_events_worker ON control_plane.inbox_events;
CREATE POLICY inbox_events_worker ON control_plane.inbox_events
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'));

DROP POLICY IF EXISTS privacy_requests_worker ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_worker ON control_plane.privacy_requests
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'));

DROP POLICY IF EXISTS outbox_worker_dispatch ON control_plane.outbox_events;
CREATE POLICY outbox_worker_dispatch ON control_plane.outbox_events
  USING (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(current_user, 'tiendaiq_worker_capability', 'member'));
