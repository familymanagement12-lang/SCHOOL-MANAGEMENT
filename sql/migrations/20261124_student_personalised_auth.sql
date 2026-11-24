BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS users_student_username_unique
  ON users (username)
  WHERE role = 'student' AND username IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_school_student_username_idx
  ON users (school_id, username)
  WHERE role = 'student';

ALTER TABLE student_portal_audit_log
  DROP CONSTRAINT IF EXISTS student_portal_audit_log_action_check;

ALTER TABLE student_portal_audit_log
  ADD CONSTRAINT student_portal_audit_log_action_check
  CHECK (action IN (
    'ACCOUNT_ACTIVATED',
    'ACCOUNT_DEACTIVATED',
    'PASSWORD_RESET',
    'PASSWORD_CHANGED',
    'ACCOUNT_CREATED',
    'USERNAME_ASSIGNED',
    'RESULTS_PUBLISHED',
    'RESULTS_UNPUBLISHED'
  ));

COMMIT;
