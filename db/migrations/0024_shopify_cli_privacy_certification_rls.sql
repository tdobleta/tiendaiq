BEGIN;

-- Shopify CLI firma sus payloads de muestra pero no los puede asociar a una
-- instalacion real. La certificacion necesita comprobar que el handler y el
-- worker los procesaron, sin abrir esos payloads a las consultas normales de
-- un tenant. Este permiso solo se activa dentro de la transaccion interna de
-- certificacion, que fija ambos settings de forma local.
DROP POLICY IF EXISTS inbox_events_certification_unbound ON control_plane.inbox_events;
CREATE POLICY inbox_events_certification_unbound ON control_plane.inbox_events
  FOR SELECT TO tiendaiq_web
  USING (
    tenant_id IS NULL
    AND current_setting('app.certification_evidence', true) = current_setting('app.tenant_id', true)
  );

DROP POLICY IF EXISTS privacy_requests_certification_unbound ON control_plane.privacy_requests;
CREATE POLICY privacy_requests_certification_unbound ON control_plane.privacy_requests
  FOR SELECT TO tiendaiq_web
  USING (
    tenant_id <> current_setting('app.tenant_id', true)
    AND current_setting('app.certification_evidence', true) = current_setting('app.tenant_id', true)
  );

COMMIT;
