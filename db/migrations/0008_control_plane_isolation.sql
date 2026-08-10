-- Completa el aislamiento del registro de instalaciones y del control plane.
-- El runtime conserva DML, pero cada fila queda limitada por contexto verificado.

ALTER TABLE public.tiendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiendas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.estados_oauth ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_oauth FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE control_plane.outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.outbox_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tiendas_tenant_isolation ON public.tiendas;
CREATE POLICY tiendas_tenant_isolation ON public.tiendas
  USING (dominio = current_setting('app.tenant_id', true))
  WITH CHECK (dominio = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS oauth_state_insert ON public.estados_oauth;
CREATE POLICY oauth_state_insert ON public.estados_oauth
  FOR INSERT
  WITH CHECK (
    estado = current_setting('app.oauth_state', true)
    AND tienda = current_setting('app.oauth_shop', true)
  );

DROP POLICY IF EXISTS oauth_state_consume ON public.estados_oauth;
CREATE POLICY oauth_state_consume ON public.estados_oauth
  FOR DELETE
  USING (
    estado = current_setting('app.oauth_state', true)
    OR tienda = current_setting('app.tenant_id', true)
  );

DROP POLICY IF EXISTS tenants_tenant_isolation ON control_plane.tenants;
CREATE POLICY tenants_tenant_isolation ON control_plane.tenants
  USING (id = current_setting('app.tenant_id', true))
  WITH CHECK (id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS tenants_webhook_lookup ON control_plane.tenants;
CREATE POLICY tenants_webhook_lookup ON control_plane.tenants
  FOR SELECT
  USING (shop_domain = current_setting('app.webhook_shop', true));

DROP POLICY IF EXISTS outbox_tenant_isolation ON control_plane.outbox_events;
CREATE POLICY outbox_tenant_isolation ON control_plane.outbox_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS outbox_worker_dispatch ON control_plane.outbox_events;
CREATE POLICY outbox_worker_dispatch ON control_plane.outbox_events
  USING (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'))
  WITH CHECK (pg_has_role(session_user, 'tiendaiq_worker_capability', 'member'));

-- 0007 otorgaba DML uniforme. Se vuelve a declarar de forma explicita para que
-- estados OAuth nunca pueda leerse o actualizarse como una tabla ordinaria.
REVOKE ALL ON TABLE
  public.tiendas,
  public.estados_oauth,
  control_plane.tenants,
  control_plane.outbox_events
FROM tiendaiq_web, tiendaiq_worker;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.tiendas,
  control_plane.tenants,
  control_plane.outbox_events
TO tiendaiq_web, tiendaiq_worker;

GRANT INSERT, DELETE ON TABLE public.estados_oauth
TO tiendaiq_web, tiendaiq_worker;
