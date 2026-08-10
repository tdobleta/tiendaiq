-- El migrador posee el esquema. Web y worker reciben solo DML; la capacidad
-- transversal del worker es una membresía PostgreSQL, no un GUC falsificable.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_web')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_worker')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiendaiq_worker_capability') THEN
    RAISE EXCEPTION 'Faltan los roles de runtime; ejecutar el bootstrap de infraestructura antes de migrar';
  END IF;
END
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public, control_plane, app_data FROM PUBLIC;

GRANT USAGE ON SCHEMA public, control_plane, app_data
  TO tiendaiq_web, tiendaiq_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.tiendas,
  public.paginas,
  public.estados_oauth,
  control_plane.tenants,
  control_plane.inbox_events,
  control_plane.jobs,
  control_plane.outbox_events,
  control_plane.privacy_requests,
  control_plane.usage_reservations,
  app_data.pages,
  app_data.page_versions,
  app_data.publications
TO tiendaiq_web, tiendaiq_worker;

DROP POLICY IF EXISTS jobs_worker_claim ON control_plane.jobs;
CREATE POLICY jobs_worker_claim ON control_plane.jobs
  USING (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'));

DROP POLICY IF EXISTS inbox_events_worker ON control_plane.inbox_events;
CREATE POLICY inbox_events_worker ON control_plane.inbox_events
  USING (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'));

DROP POLICY IF EXISTS privacy_requests_worker ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_worker ON control_plane.privacy_requests
  USING (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'));

COMMENT ON POLICY jobs_worker_claim ON control_plane.jobs IS
  'Cross-tenant claims require database role membership; app.worker_id is audit identity only.';
