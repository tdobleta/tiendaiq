ALTER TABLE control_plane.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jobs_tenant_isolation ON control_plane.jobs;
CREATE POLICY jobs_tenant_isolation ON control_plane.jobs
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- El claim es la unica operacion intencionalmente transversal. La capacidad
-- se habilita de forma local a la transaccion y se pierde en COMMIT/ROLLBACK.
DROP POLICY IF EXISTS jobs_worker_claim ON control_plane.jobs;
CREATE POLICY jobs_worker_claim ON control_plane.jobs
  USING (current_setting('app.worker_id', true) <> '')
  WITH CHECK (current_setting('app.worker_id', true) <> '');
