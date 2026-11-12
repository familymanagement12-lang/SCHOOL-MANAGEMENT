BEGIN;

CREATE TABLE IF NOT EXISTS finance_audit_log (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_finance_audit_school_created
  ON finance_audit_log (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_finance_audit_record
  ON finance_audit_log (school_id, table_name, record_id, created_at DESC);

ALTER TABLE fee_structure_items
  ADD COLUMN IF NOT EXISTS school_id INTEGER REFERENCES schools(id) ON DELETE CASCADE;
UPDATE fee_structure_items i
SET school_id = fs.school_id
FROM fee_structures fs
WHERE fs.id = i.fee_structure_id AND i.school_id IS NULL;
ALTER TABLE fee_structure_items ALTER COLUMN school_id SET NOT NULL;

CREATE OR REPLACE FUNCTION set_fee_structure_item_school() RETURNS trigger AS $$
BEGIN
  SELECT school_id INTO NEW.school_id
  FROM fee_structures
  WHERE id = NEW.fee_structure_id;
  IF NEW.school_id IS NULL THEN
    RAISE EXCEPTION 'Fee structure not found.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS fee_structure_items_set_school ON fee_structure_items;
CREATE TRIGGER fee_structure_items_set_school
  BEFORE INSERT OR UPDATE OF fee_structure_id ON fee_structure_items
  FOR EACH ROW EXECUTE FUNCTION set_fee_structure_item_school();

CREATE OR REPLACE FUNCTION audit_finance_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  row_data JSONB;
  target_school_id INTEGER;
  target_record_id TEXT;
  operation_name TEXT := TG_OP;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_row := to_jsonb(NEW);
    row_data := new_row;
  ELSIF TG_OP = 'UPDATE' THEN
    old_row := to_jsonb(OLD);
    new_row := to_jsonb(NEW);
    row_data := new_row;
  ELSE
    old_row := to_jsonb(OLD);
    row_data := old_row;
  END IF;

  target_school_id := NULLIF(row_data->>'school_id', '')::INTEGER;
  target_record_id := row_data->>'id';

  IF target_school_id IS NOT NULL AND target_record_id IS NOT NULL THEN
    INSERT INTO public.finance_audit_log (
      school_id, actor_id, actor_role, table_name, record_id,
      action, old_data, new_data
    ) VALUES (
      target_school_id,
      NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER,
      COALESCE(NULLIF(current_setting('app.role', TRUE), ''), 'system'),
      TG_TABLE_NAME,
      target_record_id,
      operation_name,
      old_row,
      new_row
    );
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fees', 'transactions', 'fee_structures', 'fee_structure_items',
    'student_fee_accounts', 'payroll', 'payroll_deductions', 'employees'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS finance_audit_row ON %I', table_name);
    EXECUTE format(
      'CREATE TRIGGER finance_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION audit_finance_row()',
      table_name
    );
  END LOOP;
END $$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'fees', 'transactions', 'fee_structures', 'fee_structure_items',
    'student_fee_accounts', 'payroll', 'payroll_deductions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS finance_school_scope ON %I', table_name);
    EXECUTE format(
        'CREATE POLICY finance_school_scope ON %I
         USING (
           current_setting(''app.role'', TRUE) IN (''admin'', ''accountant'')
           AND school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER
         )
         WITH CHECK (
           current_setting(''app.role'', TRUE) IN (''admin'', ''accountant'')
           AND school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER
         )',
        table_name
    );
  END LOOP;
END $$;

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employees FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_employee_read ON employees;
CREATE POLICY finance_employee_read ON employees FOR SELECT
  USING (
    current_setting('app.role', TRUE) IN ('admin', 'accountant')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );
DROP POLICY IF EXISTS admin_employee_write ON employees;
CREATE POLICY admin_employee_write ON employees FOR ALL
  USING (
    current_setting('app.role', TRUE) = 'admin'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  )
  WITH CHECK (
    current_setting('app.role', TRUE) = 'admin'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

ALTER TABLE finance_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance_audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_audit_read ON finance_audit_log;
CREATE POLICY finance_audit_read ON finance_audit_log FOR SELECT
  USING (
    current_setting('app.role', TRUE) IN ('admin', 'accountant')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );
DROP POLICY IF EXISTS finance_audit_append ON finance_audit_log;
CREATE POLICY finance_audit_append ON finance_audit_log FOR INSERT
  WITH CHECK (
    current_setting('app.role', TRUE) IN ('admin', 'accountant')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

COMMIT;
