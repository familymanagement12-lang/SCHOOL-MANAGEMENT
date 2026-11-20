BEGIN;

CREATE TABLE IF NOT EXISTS kitchen_item_plans (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  inventory_id INTEGER REFERENCES inventory(id) ON DELETE SET NULL,
  supplier_id BIGINT REFERENCES inventory_suppliers(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  estimated_quantity NUMERIC(12, 3) NOT NULL CHECK (estimated_quantity > 0),
  expected_monthly_quantity NUMERIC(12, 3) CHECK (expected_monthly_quantity > 0),
  unit TEXT NOT NULL,
  purchasing_frequency TEXT NOT NULL
    CHECK (purchasing_frequency IN ('daily', 'weekly', 'fortnightly', 'monthly', 'custom')),
  custom_interval_days INTEGER CHECK (custom_interval_days BETWEEN 1 AND 365),
  estimated_unit_cost NUMERIC(12, 2) NOT NULL CHECK (estimated_unit_cost >= 0),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK ((purchasing_frequency = 'custom') = (custom_interval_days IS NOT NULL)),
  UNIQUE (school_id, id)
);
CREATE INDEX IF NOT EXISTS kitchen_item_plans_school_active_idx
  ON kitchen_item_plans (school_id, is_active, category, item_name);

ALTER TABLE inventory_purchases
  ADD COLUMN IF NOT EXISTS decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decision_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approval_comment TEXT;

ALTER TABLE inventory_purchases DROP CONSTRAINT IF EXISTS inventory_purchases_status_check;
UPDATE inventory_purchases SET status = 'approved' WHERE status = 'ordered';
ALTER TABLE inventory_purchases
  ADD CONSTRAINT inventory_purchases_status_check
  CHECK (status IN ('pending_approval', 'approved', 'rejected', 'ordered', 'partially_received', 'received', 'cancelled'));

ALTER TABLE inventory_purchase_items
  ADD COLUMN IF NOT EXISTS kitchen_item_plan_id BIGINT REFERENCES kitchen_item_plans(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS inventory_purchase_items_kitchen_plan_idx
  ON inventory_purchase_items (school_id, kitchen_item_plan_id)
  WHERE kitchen_item_plan_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS operational_financial_entries (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('tuckshop', 'feeding_marketing')),
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('revenue', 'expense')),
  transaction_date DATE NOT NULL,
  week_start DATE NOT NULL,
  academic_year TEXT,
  term TEXT,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT,
  category TEXT,
  description TEXT NOT NULL CHECK (length(trim(description)) > 0),
  reference TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (week_start = transaction_date - (EXTRACT(ISODOW FROM transaction_date)::INTEGER - 1))
);
CREATE INDEX IF NOT EXISTS operational_financial_entries_period_idx
  ON operational_financial_entries (school_id, module, transaction_date, transaction_type);
CREATE INDEX IF NOT EXISTS operational_financial_entries_term_idx
  ON operational_financial_entries (school_id, module, academic_year, term, week_start);

CREATE OR REPLACE FUNCTION audit_kitchen_plan_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row JSONB;
  new_row JSONB;
  row_data JSONB;
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

  INSERT INTO public.inventory_audit_log (
    school_id, actor_id, actor_role, table_name, record_id, action, old_data, new_data
  ) VALUES (
    (row_data->>'school_id')::INTEGER,
    NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER,
    COALESCE(NULLIF(current_setting('app.role', TRUE), ''), 'system'),
    TG_TABLE_NAME,
    row_data->>'id',
    TG_OP,
    old_row,
    new_row
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS kitchen_item_plans_audit ON kitchen_item_plans;
CREATE TRIGGER kitchen_item_plans_audit
  AFTER INSERT OR UPDATE OR DELETE ON kitchen_item_plans
  FOR EACH ROW EXECUTE FUNCTION audit_kitchen_plan_row();
DROP TRIGGER IF EXISTS operational_financial_entries_audit ON operational_financial_entries;
CREATE TRIGGER operational_financial_entries_audit
  AFTER INSERT OR UPDATE OR DELETE ON operational_financial_entries
  FOR EACH ROW EXECUTE FUNCTION audit_finance_row();

ALTER TABLE kitchen_item_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_item_plans FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kitchen_item_plan_school_scope ON kitchen_item_plans;
CREATE POLICY kitchen_item_plan_school_scope ON kitchen_item_plans
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND NULLIF(current_setting('app.role', TRUE), '') IN ('admin', 'accountant', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer')
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND NULLIF(current_setting('app.role', TRUE), '') IN ('admin', 'accountant', 'inventory', 'store', 'storekeeper', 'feeding_tuckshop_officer')
  );

ALTER TABLE operational_financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_financial_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_finance_school_scope ON operational_financial_entries;
CREATE POLICY operational_finance_school_scope ON operational_financial_entries
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND NULLIF(current_setting('app.role', TRUE), '') IN ('admin', 'accountant', 'feeding_tuckshop_officer')
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND NULLIF(current_setting('app.role', TRUE), '') IN ('admin', 'accountant', 'feeding_tuckshop_officer')
  );

DROP POLICY IF EXISTS finance_audit_append ON finance_audit_log;
CREATE POLICY finance_audit_append ON finance_audit_log
  FOR INSERT
  WITH CHECK (
    current_setting('app.role', TRUE) IN ('admin', 'accountant', 'feeding_tuckshop_officer')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

DO $$
DECLARE
  grantee TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.inventory', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE kitchen_item_plans TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE kitchen_item_plans_id_seq TO %I', grantee);
  END LOOP;

  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.transactions', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE operational_financial_entries TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE operational_financial_entries_id_seq TO %I', grantee);
  END LOOP;
END $$;

COMMIT;