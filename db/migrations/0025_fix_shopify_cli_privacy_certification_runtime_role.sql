BEGIN;

-- El runtime HTTP asume tiendaiq_web_runtime; la migracion anterior apunto al
-- rol legado sin LOGIN. Reemplazar las dos politicas conserva la misma regla
-- acotada, pero la hace efectiva para la conexion real de certificacion.
DROP POLICY IF EXISTS inbox_events_certification_unbound ON control_plane.inbox_events;
CREATE POLICY inbox_events_certification_unbound ON control_plane.inbox_events
  FOR SELECT TO tiendaiq_web_runtime
  USING (
    tenant_id IS NULL
    AND current_setting('app.certification_evidence', true) = current_setting('app.tenant_id', true)
  );

DROP POLICY IF EXISTS privacy_requests_certification_unbound ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_certification_unbound ON control_plane.privacy_requests
  FOR SELECT TO tiendaiq_web_runtime
  USING (
    tenant_id <> current_setting('app.tenant_id', true)
    AND current_setting('app.certification_evidence', true) = current_setting('app.tenant_id', true)
  );

COMMIT;
