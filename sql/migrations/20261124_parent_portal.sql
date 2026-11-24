BEGIN;

CREATE TABLE IF NOT EXISTS parent_portal_audit_log (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS parent_portal_audit_parent_idx
  ON parent_portal_audit_log (school_id, parent_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS parent_portal_audit_student_idx
  ON parent_portal_audit_log (school_id, student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS student_parent_parent_school_idx
  ON student_parent (school_id, parent_id, student_id);
CREATE INDEX IF NOT EXISTS parent_users_role_school_idx
  ON users (school_id, id) WHERE role = 'parent';

CREATE TABLE IF NOT EXISTS parent_notification_preferences (
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcements BOOLEAN NOT NULL DEFAULT TRUE,
  fee_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  feeding_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  emergency_notices BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, user_id)
);

CREATE TABLE IF NOT EXISTS parent_enquiries (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  parent_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('enquiry', 'profile_correction')),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 120),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_review', 'responded', 'closed')),
  school_response TEXT,
  responded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS parent_enquiries_school_status_idx
  ON parent_enquiries (school_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS parent_enquiries_parent_idx
  ON parent_enquiries (school_id, parent_user_id, created_at DESC);

ALTER TABLE parent_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_enquiries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS parent_enquiry_scope ON parent_enquiries;
CREATE POLICY parent_enquiry_scope ON parent_enquiries FOR ALL
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND (
      current_setting('app.role', TRUE) = 'admin'
      OR (
        current_setting('app.role', TRUE) = 'parent'
        AND parent_user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
      )
    )
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND (
      current_setting('app.role', TRUE) = 'admin'
      OR (
        current_setting('app.role', TRUE) = 'parent'
        AND parent_user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
        AND (
          student_id IS NULL OR EXISTS (
            SELECT 1 FROM student_parent sp
            JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
            WHERE sp.school_id = parent_enquiries.school_id
              AND sp.student_id = parent_enquiries.student_id
              AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS parent_fee_read ON fees;
CREATE POLICY parent_fee_read ON fees FOR SELECT
  USING (
    current_setting('app.role', TRUE) = 'parent'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND EXISTS (
      SELECT 1 FROM student_parent sp
      JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
      WHERE sp.school_id = fees.school_id AND sp.student_id = fees.student_id
        AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    )
  );

DROP POLICY IF EXISTS parent_fee_structure_read ON fee_structures;
CREATE POLICY parent_fee_structure_read ON fee_structures FOR SELECT
  USING (
    current_setting('app.role', TRUE) = 'parent'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND EXISTS (
      SELECT 1 FROM fees f
      JOIN student_parent sp ON sp.student_id = f.student_id AND sp.school_id = f.school_id
      JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
      WHERE f.school_id = fee_structures.school_id
        AND f.fee_structure_id = fee_structures.id
        AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    )
  );

DROP POLICY IF EXISTS parent_fee_structure_item_read ON fee_structure_items;
CREATE POLICY parent_fee_structure_item_read ON fee_structure_items FOR SELECT
  USING (
    current_setting('app.role', TRUE) = 'parent'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND EXISTS (
      SELECT 1 FROM fees f
      JOIN student_parent sp ON sp.student_id = f.student_id AND sp.school_id = f.school_id
      JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
      WHERE f.school_id = fee_structure_items.school_id
        AND f.fee_structure_id = fee_structure_items.fee_structure_id
        AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    )
  );

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'feeding_obligations', 'feeding_coverage_days', 'school_payment_receipts',
    'school_payment_allocations', 'school_payment_refunds'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS parent_portal_read ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY parent_portal_read ON %I FOR SELECT
       USING (
         current_setting(''app.role'', TRUE) = ''parent''
         AND school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER
         AND EXISTS (
           SELECT 1 FROM student_parent sp
           JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
           WHERE sp.school_id = %I.school_id
             AND sp.student_id = %I.student_id
             AND p.user_id = NULLIF(current_setting(''app.user_id'', TRUE), '''')::INTEGER
         )
       )',
      table_name, table_name, table_name
    );
  END LOOP;

  EXECUTE 'DROP POLICY IF EXISTS parent_portal_read ON school_payment_refund_allocations';
  EXECUTE $policy$
    CREATE POLICY parent_portal_read ON school_payment_refund_allocations FOR SELECT
    USING (
      current_setting('app.role', TRUE) = 'parent'
      AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
      AND EXISTS (
        SELECT 1
        FROM school_payment_allocations a
        JOIN student_parent sp
          ON sp.school_id = a.school_id AND sp.student_id = a.student_id
        JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
        WHERE a.id = school_payment_refund_allocations.payment_allocation_id
          AND a.school_id = school_payment_refund_allocations.school_id
          AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
      )
    )
  $policy$;
END $$;

COMMIT;
