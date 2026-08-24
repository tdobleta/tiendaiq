-- bind_app_registration is SECURITY DEFINER. With FORCE RLS, policies are
-- still evaluated as the function owner, not as the caller. The table remains
-- inaccessible directly (all table privileges are revoked); this policy only
-- lets the reviewed, EXECUTE-granted function perform its singleton write.
DROP POLICY IF EXISTS app_registration_binding_migrator ON control_plane.app_registration_binding;
CREATE POLICY app_registration_binding_security_definer
  ON control_plane.app_registration_binding
  FOR ALL TO PUBLIC
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE control_plane.app_registration_binding
  FROM PUBLIC, tiendaiq_web_runtime, tiendaiq_worker_runtime;
