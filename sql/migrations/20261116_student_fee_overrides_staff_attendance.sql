BEGIN;

ALTER TABLE fees
  ADD COLUMN IF NOT EXISTS fee_structure_id INTEGER REFERENCES fee_structures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_fee_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fee_override_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS fees_school_student_structure_unique
  ON fees (school_id, student_id, fee_structure_id)
  WHERE fee_structure_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS staff_attendance (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
  reason TEXT,
  marked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS staff_attendance_school_date_idx
  ON staff_attendance (school_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS staff_attendance_employee_date_idx
  ON staff_attendance (school_id, employee_id, attendance_date DESC);

CREATE TABLE IF NOT EXISTS staff_attendance_audit (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  staff_attendance_id BIGINT NOT NULL REFERENCES staff_attendance(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  attendance_date DATE NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  old_reason TEXT,
  new_reason TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_staff_attendance_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.staff_attendance_audit (
    school_id, staff_attendance_id, employee_id, attendance_date,
    old_status, new_status, old_reason, new_reason, actor_id
  ) VALUES (
    NEW.school_id, NEW.id, NEW.employee_id, NEW.attendance_date,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END,
    NEW.status,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.reason ELSE NULL END,
    NEW.reason,
    NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_attendance_audit_change ON staff_attendance;
CREATE TRIGGER staff_attendance_audit_change
  AFTER INSERT OR UPDATE ON staff_attendance
  FOR EACH ROW EXECUTE FUNCTION audit_staff_attendance_change();

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_attendance_school_scope ON staff_attendance;
CREATE POLICY staff_attendance_school_scope ON staff_attendance
  USING (
    current_setting('app.role', TRUE) = 'admin'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  )
  WITH CHECK (
    current_setting('app.role', TRUE) = 'admin'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

ALTER TABLE staff_attendance_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staff_attendance_audit_school_scope ON staff_attendance_audit;
CREATE POLICY staff_attendance_audit_school_scope ON staff_attendance_audit
  FOR SELECT
  USING (
    current_setting('app.role', TRUE) = 'admin'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );
DROP POLICY IF EXISTS staff_attendance_audit_insert_scope ON staff_attendance_audit;
CREATE POLICY staff_attendance_audit_insert_scope ON staff_attendance_audit
  FOR INSERT
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

DO $$
DECLARE
  grantee TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.fees', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE staff_attendance TO %I', grantee);
    EXECUTE format('GRANT SELECT ON TABLE staff_attendance_audit TO %I', grantee);
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE staff_attendance_id_seq, staff_attendance_audit_id_seq TO %I',
      grantee
    );
  END LOOP;
END $$;

COMMIT;
