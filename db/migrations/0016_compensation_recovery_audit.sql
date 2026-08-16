-- A dead-letter compensation can be retried only through a deliberate,
-- single-job administrative action. Runtime processes cannot read the audit
-- trail or execute the recovery function.

CREATE TABLE IF NOT EXISTS control_plane.compensation_recovery_audit (
  id                UUID PRIMARY KEY,
  job_id            UUID NOT NULL REFERENCES control_plane.jobs(id) ON DELETE RESTRICT,
  tenant_id         TEXT NOT NULL,
  actor              TEXT NOT NULL CHECK (length(actor) BETWEEN 2 AND 128),
  reason             TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 500),
  source             TEXT NOT NULL CHECK (length(source) BETWEEN 8 AND 500),
  previous_attempts  INTEGER NOT NULL CHECK (previous_attempts >= 0),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE control_plane.compensation_recovery_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE control_plane.compensation_recovery_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compensation_recovery_audit_migrator_select
  ON control_plane.compensation_recovery_audit;
CREATE POLICY compensation_recovery_audit_migrator_select
  ON control_plane.compensation_recovery_audit
  FOR SELECT TO tiendaiq_migrator
  USING (true);

DROP POLICY IF EXISTS compensation_recovery_audit_migrator_insert
  ON control_plane.compensation_recovery_audit;
CREATE POLICY compensation_recovery_audit_migrator_insert
  ON control_plane.compensation_recovery_audit
  FOR INSERT TO tiendaiq_migrator
  WITH CHECK (true);

REVOKE ALL ON TABLE control_plane.compensation_recovery_audit FROM PUBLIC;
REVOKE ALL ON TABLE control_plane.compensation_recovery_audit
  FROM tiendaiq_web, tiendaiq_worker, tiendaiq_web_runtime, tiendaiq_worker_runtime;

CREATE OR REPLACE FUNCTION control_plane.requeue_compensation_dead_letter(
  p_job_id UUID,
  p_audit_id UUID,
  p_actor TEXT,
  p_reason TEXT,
  p_source TEXT
)
RETURNS TABLE (
  recovered_job_id UUID,
  previous_attempts INTEGER,
  compensation_status TEXT,
  requeued_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, control_plane
AS $$
DECLARE
  v_tenant_id TEXT;
  v_previous_attempts INTEGER;
  v_status TEXT;
  v_requeued_at TIMESTAMPTZ;
BEGIN
  IF p_job_id IS NULL OR p_audit_id IS NULL THEN
    RAISE EXCEPTION 'job_id y audit_id son obligatorios';
  END IF;
  IF length(btrim(coalesce(p_actor, ''))) NOT BETWEEN 2 AND 128 THEN
    RAISE EXCEPTION 'actor invalido';
  END IF;
  IF length(btrim(coalesce(p_reason, ''))) NOT BETWEEN 20 AND 500 THEN
    RAISE EXCEPTION 'reason debe tener entre 20 y 500 caracteres';
  END IF;
  IF length(btrim(coalesce(p_source, ''))) NOT BETWEEN 8 AND 500 THEN
    RAISE EXCEPTION 'source invalido';
  END IF;

  SELECT jobs.tenant_id, jobs.compensation_attempts
    INTO v_tenant_id, v_previous_attempts
    FROM control_plane.jobs AS jobs
   WHERE jobs.id = p_job_id
     AND jobs.status = 'failed'
     AND jobs.compensation_status = 'dead_letter'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'el job no existe o su compensacion no esta en dead_letter';
  END IF;

  INSERT INTO control_plane.compensation_recovery_audit (
    id, job_id, tenant_id, actor, reason, source, previous_attempts
  ) VALUES (
    p_audit_id,
    p_job_id,
    v_tenant_id,
    btrim(p_actor),
    btrim(p_reason),
    btrim(p_source),
    v_previous_attempts
  );

  UPDATE control_plane.jobs AS jobs
     SET compensation_status = 'pending',
         compensation_attempts = 0,
         compensation_run_after = statement_timestamp(),
         compensation_locked_at = NULL,
         compensation_lease_expires_at = NULL,
         compensation_locked_by = NULL,
         compensation_last_error = NULL,
         updated_at = statement_timestamp()
   WHERE jobs.id = p_job_id
  RETURNING jobs.compensation_status, jobs.updated_at
       INTO v_status, v_requeued_at;

  RETURN QUERY SELECT p_job_id, v_previous_attempts, v_status, v_requeued_at;
END
$$;

REVOKE ALL ON FUNCTION control_plane.requeue_compensation_dead_letter(UUID, UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, tiendaiq_web, tiendaiq_worker, tiendaiq_web_runtime, tiendaiq_worker_runtime;
GRANT EXECUTE ON FUNCTION control_plane.requeue_compensation_dead_letter(UUID, UUID, TEXT, TEXT, TEXT)
  TO tiendaiq_migrator;

COMMENT ON TABLE control_plane.compensation_recovery_audit IS
  'Immutable audit trail for deliberate dead-letter compensation recovery.';
COMMENT ON FUNCTION control_plane.requeue_compensation_dead_letter(UUID, UUID, TEXT, TEXT, TEXT) IS
  'Migrator-only, one-job recovery from compensation dead_letter to pending.';
