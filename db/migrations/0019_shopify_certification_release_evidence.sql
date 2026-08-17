BEGIN;

ALTER TABLE control_plane.jobs
  ADD COLUMN IF NOT EXISTS worker_release_sha TEXT;

ALTER TABLE control_plane.inbox_events
  ADD COLUMN IF NOT EXISTS worker_release_sha TEXT;

ALTER TABLE control_plane.privacy_requests
  ADD COLUMN IF NOT EXISTS worker_release_sha TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_worker_release_sha_format'
      AND conrelid = 'control_plane.jobs'::regclass
  ) THEN
    ALTER TABLE control_plane.jobs
      ADD CONSTRAINT jobs_worker_release_sha_format
      CHECK (worker_release_sha IS NULL OR worker_release_sha ~ '^[a-f0-9]{40}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'jobs_succeeded_requires_release_sha'
      AND conrelid = 'control_plane.jobs'::regclass
  ) THEN
    ALTER TABLE control_plane.jobs
      ADD CONSTRAINT jobs_succeeded_requires_release_sha
      CHECK (
        status <> 'succeeded'
        OR (worker_release_sha IS NOT NULL AND worker_release_sha ~ '^[a-f0-9]{40}$')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inbox_events_worker_release_sha_format'
      AND conrelid = 'control_plane.inbox_events'::regclass
  ) THEN
    ALTER TABLE control_plane.inbox_events
      ADD CONSTRAINT inbox_events_worker_release_sha_format
      CHECK (worker_release_sha IS NULL OR worker_release_sha ~ '^[a-f0-9]{40}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inbox_processed_requires_release_sha'
      AND conrelid = 'control_plane.inbox_events'::regclass
  ) THEN
    ALTER TABLE control_plane.inbox_events
      ADD CONSTRAINT inbox_processed_requires_release_sha
      CHECK (
        status <> 'processed'
        OR (worker_release_sha IS NOT NULL AND worker_release_sha ~ '^[a-f0-9]{40}$')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'privacy_requests_worker_release_sha_format'
      AND conrelid = 'control_plane.privacy_requests'::regclass
  ) THEN
    ALTER TABLE control_plane.privacy_requests
      ADD CONSTRAINT privacy_requests_worker_release_sha_format
      CHECK (worker_release_sha IS NULL OR worker_release_sha ~ '^[a-f0-9]{40}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'privacy_completed_requires_release_sha'
      AND conrelid = 'control_plane.privacy_requests'::regclass
  ) THEN
    ALTER TABLE control_plane.privacy_requests
      ADD CONSTRAINT privacy_completed_requires_release_sha
      CHECK (
        status <> 'completed'
        OR (worker_release_sha IS NOT NULL AND worker_release_sha ~ '^[a-f0-9]{40}$')
      ) NOT VALID;
  END IF;
END $$;

ALTER TABLE control_plane.privacy_requests
  VALIDATE CONSTRAINT privacy_requests_worker_release_sha_format;

ALTER TABLE control_plane.jobs
  VALIDATE CONSTRAINT jobs_worker_release_sha_format;

ALTER TABLE control_plane.inbox_events
  VALIDATE CONSTRAINT inbox_events_worker_release_sha_format;

CREATE INDEX IF NOT EXISTS jobs_release_evidence_idx
  ON control_plane.jobs (tenant_id, type, worker_release_sha, completed_at DESC)
  WHERE status = 'succeeded';

CREATE INDEX IF NOT EXISTS inbox_release_evidence_idx
  ON control_plane.inbox_events (tenant_id, topic, worker_release_sha, processed_at DESC)
  WHERE status = 'processed';

CREATE INDEX IF NOT EXISTS privacy_requests_release_evidence_idx
  ON control_plane.privacy_requests (tenant_id, type, worker_release_sha, completed_at DESC)
  WHERE status = 'completed';

COMMIT;
