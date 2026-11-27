CREATE TABLE IF NOT EXISTS class_configuration_audit (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 5),
  previous_configuration JSONB NOT NULL,
  new_configuration JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS class_configuration_audit_history_idx
  ON class_configuration_audit (school_id, class_id, created_at DESC);

ALTER TABLE class_configuration_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_configuration_audit FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS class_configuration_audit_admin_all ON class_configuration_audit;
CREATE POLICY class_configuration_audit_admin_all ON class_configuration_audit
  FOR ALL
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  );
