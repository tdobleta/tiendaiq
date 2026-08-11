-- Expand: protege la tabla usada hoy sin mover todavía el JSONB histórico.
-- La aplicación debe ejecutar cada operación mediante withTenantTransaction().

INSERT INTO control_plane.tenants (id, shop_domain, status, isolation_mode)
SELECT dominio, dominio, 'active', 'shared_rls'
FROM public.tiendas
ON CONFLICT (id) DO UPDATE
SET shop_domain = EXCLUDED.shop_domain,
    updated_at = now();

ALTER TABLE public.paginas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paginas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legacy_pages_tenant_isolation ON public.paginas;
CREATE POLICY legacy_pages_tenant_isolation ON public.paginas
  USING (tienda = current_setting('app.tenant_id', true))
  WITH CHECK (tienda = current_setting('app.tenant_id', true));

COMMENT ON POLICY legacy_pages_tenant_isolation ON public.paginas IS
  'Fail closed: pages are visible and writable only inside a tenant transaction.';
