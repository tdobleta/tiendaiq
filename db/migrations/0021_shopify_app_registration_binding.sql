-- A database is bound to exactly one Shopify app registration.  Tenant ids are
-- shop domains, so allowing two registrations in one database would let the
-- same shop overwrite tokens, jobs, pages, or privacy state across apps.
CREATE TABLE IF NOT EXISTS control_plane.app_registration_binding (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  registration_id text NOT NULL CHECK (registration_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  bound_at timestamptz NOT NULL DEFAULT statement_timestamp()
);

ALTER TABLE control_plane.app_registration_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.app_registration_binding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_registration_binding_migrator ON control_plane.app_registration_binding;
CREATE POLICY app_registration_binding_migrator
  ON control_plane.app_registration_binding
  FOR ALL TO tiendaiq_migrator
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE control_plane.app_registration_binding
  FROM PUBLIC, tiendaiq_web, tiendaiq_worker, tiendaiq_web_runtime, tiendaiq_worker_runtime;

CREATE OR REPLACE FUNCTION control_plane.assert_app_registration(p_registration_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
DECLARE
  actual text;
BEGIN
  IF p_registration_id !~ '^[a-z][a-z0-9-]{2,63}$' THEN
    RAISE EXCEPTION 'identidad de registro Shopify invalida';
  END IF;
  SELECT registration_id INTO actual
    FROM control_plane.app_registration_binding
   WHERE singleton = true;
  IF actual IS NULL THEN
    RAISE EXCEPTION 'la base no esta vinculada a una app Shopify';
  END IF;
  IF actual <> p_registration_id THEN
    RAISE EXCEPTION 'la identidad de la app Shopify no coincide con esta base';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION control_plane.bind_app_registration(p_registration_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
DECLARE
  actual text;
BEGIN
  IF p_registration_id !~ '^[a-z][a-z0-9-]{2,63}$' THEN
    RAISE EXCEPTION 'identidad de registro Shopify invalida';
  END IF;
  INSERT INTO control_plane.app_registration_binding (singleton, registration_id)
  VALUES (true, p_registration_id)
  ON CONFLICT (singleton) DO NOTHING;
  SELECT registration_id INTO actual
    FROM control_plane.app_registration_binding
   WHERE singleton = true;
  IF actual <> p_registration_id THEN
    RAISE EXCEPTION 'esta base ya pertenece a otra app Shopify';
  END IF;
END
$$;

REVOKE ALL ON FUNCTION control_plane.assert_app_registration(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION control_plane.bind_app_registration(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control_plane.assert_app_registration(text)
  TO tiendaiq_web_runtime, tiendaiq_worker_runtime;
GRANT EXECUTE ON FUNCTION control_plane.bind_app_registration(text) TO tiendaiq_migrator;

COMMENT ON TABLE control_plane.app_registration_binding IS
  'Immutable singleton database-to-Shopify-registration binding; not a provider or billing binding.';
