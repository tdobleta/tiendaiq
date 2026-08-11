-- Administrative access remains explicit even with FORCE RLS. Runtime roles
-- never receive these policies; only the non-runtime migrator can cross tenants.

DROP POLICY IF EXISTS tiendas_migrator_admin ON public.tiendas;
CREATE POLICY tiendas_migrator_admin ON public.tiendas
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paginas_migrator_admin ON public.paginas;
CREATE POLICY paginas_migrator_admin ON public.paginas
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS oauth_migrator_admin ON public.estados_oauth;
CREATE POLICY oauth_migrator_admin ON public.estados_oauth
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS tenants_migrator_admin ON control_plane.tenants;
CREATE POLICY tenants_migrator_admin ON control_plane.tenants
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inbox_migrator_admin ON control_plane.inbox_events;
CREATE POLICY inbox_migrator_admin ON control_plane.inbox_events
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS jobs_migrator_admin ON control_plane.jobs;
CREATE POLICY jobs_migrator_admin ON control_plane.jobs
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS outbox_migrator_admin ON control_plane.outbox_events;
CREATE POLICY outbox_migrator_admin ON control_plane.outbox_events
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS privacy_migrator_admin ON control_plane.privacy_requests;
CREATE POLICY privacy_migrator_admin ON control_plane.privacy_requests
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS usage_migrator_admin ON control_plane.usage_reservations;
CREATE POLICY usage_migrator_admin ON control_plane.usage_reservations
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS pages_migrator_admin ON app_data.pages;
CREATE POLICY pages_migrator_admin ON app_data.pages
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS page_versions_migrator_admin ON app_data.page_versions;
CREATE POLICY page_versions_migrator_admin ON app_data.page_versions
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS publications_migrator_admin ON app_data.publications;
CREATE POLICY publications_migrator_admin ON app_data.publications
  TO tiendaiq_migrator USING (true) WITH CHECK (true);

-- The web role can ask only for aggregate generation pressure. SECURITY
-- DEFINER is intentionally narrow: no parameters, tenant ids, payloads or rows.
CREATE OR REPLACE FUNCTION control_plane.generation_queue_pressure()
RETURNS TABLE (
  queued bigint,
  running bigint,
  oldest_queued_seconds double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
  SELECT count(*) FILTER (WHERE status = 'queued')::bigint,
         count(*) FILTER (WHERE status = 'running')::bigint,
         coalesce(
           extract(epoch FROM (statement_timestamp() - min(created_at) FILTER (WHERE status = 'queued'))),
           0
         )::double precision
    FROM control_plane.jobs
   WHERE type = 'generate-page'
     AND status IN ('queued', 'running')
$$;

REVOKE ALL ON FUNCTION control_plane.generation_queue_pressure() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control_plane.generation_queue_pressure()
TO tiendaiq_web, tiendaiq_worker;

COMMENT ON FUNCTION control_plane.generation_queue_pressure() IS
  'Aggregate-only admission signal; never exposes cross-tenant job rows.';
