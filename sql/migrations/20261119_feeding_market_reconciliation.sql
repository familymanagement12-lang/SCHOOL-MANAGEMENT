BEGIN;

ALTER TABLE feeding_payments
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

ALTER TABLE feeding_payments
  DROP CONSTRAINT IF EXISTS feeding_payments_payment_method_check;
ALTER TABLE feeding_payments
  ADD CONSTRAINT feeding_payments_payment_method_check
  CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'other'));

ALTER TABLE tuckshop_sales
  DROP CONSTRAINT IF EXISTS tuckshop_sales_payment_method_check;
ALTER TABLE tuckshop_sales
  ADD CONSTRAINT tuckshop_sales_payment_method_check
  CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'card', 'other'));

ALTER TABLE tuckshop_products
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  ADD COLUMN IF NOT EXISTS reorder_level INTEGER NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  ADD COLUMN IF NOT EXISTS supplier TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS tuckshop_products_barcode_unique
  ON tuckshop_products (school_id, barcode)
  WHERE barcode IS NOT NULL AND barcode <> '';

ALTER TABLE tuckshop_sale_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2) CHECK (unit_cost >= 0),
  ADD COLUMN IF NOT EXISTS line_cost NUMERIC(10,2) CHECK (line_cost >= 0);

ALTER TABLE kitchen_purchases
  ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS buyer_name TEXT,
  ADD COLUMN IF NOT EXISTS supporting_reference TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS advance_id BIGINT,
  ADD COLUMN IF NOT EXISTS transport_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
  ADD COLUMN IF NOT EXISTS cutting_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cutting_cost >= 0),
  ADD COLUMN IF NOT EXISTS porter_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (porter_cost >= 0),
  ADD COLUMN IF NOT EXISTS grinding_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (grinding_cost >= 0),
  ADD COLUMN IF NOT EXISTS other_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0);

ALTER TABLE kitchen_purchases
  DROP CONSTRAINT IF EXISTS kitchen_purchases_expense_category_check;
ALTER TABLE kitchen_purchases
  ADD CONSTRAINT kitchen_purchases_expense_category_check
  CHECK (expense_category IN (
    'Feeding Supplies', 'Kitchen Supplies', 'Food Supplies', 'Gas',
    'Repairs', 'Transport', 'Market Charges', 'Other Feeding Expenses',
    'Other Kitchen Expenses'
  ));

ALTER TABLE kitchen_purchase_items
  ALTER COLUMN stock_item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS tax_inclusive_unit_cost NUMERIC(10,2);

UPDATE kitchen_purchase_items i
SET item_name = s.name
FROM kitchen_stock_items s
WHERE i.stock_item_id = s.id AND i.school_id = s.school_id AND i.item_name IS NULL;

ALTER TABLE kitchen_purchase_items
  ALTER COLUMN item_name SET NOT NULL;

CREATE TABLE IF NOT EXISTS shopping_advances (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  amount_issued NUMERIC(10,2) NOT NULL CHECK (amount_issued > 0),
  recipient_name TEXT NOT NULL,
  recipient_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  issued_date DATE NOT NULL DEFAULT CURRENT_DATE,
  purpose TEXT NOT NULL,
  returned_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (returned_amount >= 0),
  status TEXT NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'partially_reconciled', 'fully_reconciled', 'awaiting_approval')),
  idempotency_key TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, idempotency_key),
  CHECK (returned_amount <= amount_issued)
);

CREATE INDEX IF NOT EXISTS shopping_advances_history_idx
  ON shopping_advances (school_id, issued_date DESC, id DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kitchen_purchases_advance_school_fk'
  ) THEN
    ALTER TABLE kitchen_purchases
      ADD CONSTRAINT kitchen_purchases_advance_school_fk
      FOREIGN KEY (advance_id) REFERENCES shopping_advances(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS kitchen_purchase_charges (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES kitchen_purchases(id) ON DELETE RESTRICT,
  charge_type TEXT NOT NULL CHECK (
    charge_type IN ('transport', 'cutting', 'porter', 'grinding', 'loading', 'unloading', 'other')
  ),
  description TEXT,
  amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS kitchen_purchase_charges_purchase_idx
  ON kitchen_purchase_charges (school_id, purchase_id);

CREATE TABLE IF NOT EXISTS tuckshop_product_purchases (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier TEXT,
  reference TEXT,
  supporting_reference TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'other')),
  transport_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (transport_cost >= 0),
  other_cost NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (other_cost >= 0),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
  advance_id BIGINT REFERENCES shopping_advances(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS tuckshop_product_purchases_history_idx
  ON tuckshop_product_purchases (school_id, purchase_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS tuckshop_product_purchase_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES tuckshop_product_purchases(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES tuckshop_products(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS tuckshop_daily_reconciliations (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  reconciliation_date DATE NOT NULL,
  cash_counted NUMERIC(10,2) NOT NULL CHECK (cash_counted >= 0),
  reconciled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, reconciliation_date)
);

CREATE TABLE IF NOT EXISTS operational_audit_log (
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

CREATE INDEX IF NOT EXISTS operational_audit_history_idx
  ON operational_audit_log (school_id, created_at DESC);

CREATE OR REPLACE FUNCTION audit_feeding_tuckshop_row() RETURNS trigger
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

  INSERT INTO public.operational_audit_log (
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

DO $$
DECLARE
  table_name TEXT;
  grantee TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_permissions', 'feeding_class_rates', 'school_calendar_events',
    'feeding_student_credits', 'feeding_payments', 'feeding_coverage_days',
    'tuckshop_products', 'tuckshop_sales', 'tuckshop_sale_items',
    'kitchen_stock_items', 'kitchen_purchases', 'kitchen_purchase_items',
    'shopping_advances', 'kitchen_purchase_charges',
    'tuckshop_product_purchases', 'tuckshop_product_purchase_items',
    'tuckshop_daily_reconciliations', 'operational_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS school_scope ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY school_scope ON %I
       USING (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER)
       WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER)',
      table_name
    );
    IF table_name <> 'operational_audit_log' THEN
      EXECUTE format('DROP TRIGGER IF EXISTS operational_audit_row ON %I', table_name);
      EXECUTE format(
        'CREATE TRIGGER operational_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_feeding_tuckshop_row()',
        table_name
      );
    END IF;
  END LOOP;

  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.fees', 'SELECT')
      AND rolname <> current_user
  LOOP
    FOREACH table_name IN ARRAY ARRAY[
      'shopping_advances', 'kitchen_purchase_charges',
      'tuckshop_product_purchases', 'tuckshop_product_purchase_items',
      'tuckshop_daily_reconciliations', 'operational_audit_log'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', table_name, grantee);
    END LOOP;
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE shopping_advances_id_seq,
       kitchen_purchase_charges_id_seq, tuckshop_product_purchases_id_seq,
       tuckshop_product_purchase_items_id_seq, tuckshop_daily_reconciliations_id_seq,
       operational_audit_log_id_seq TO %I',
      grantee
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS feeding_operational_finance_insert ON transactions;
CREATE POLICY feeding_operational_finance_insert ON transactions
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.user_id', TRUE), '') IS NOT NULL
    AND source_type IN ('feeding_payment', 'tuckshop_sale', 'tuckshop_sale_cogs', 'kitchen_purchase')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

DROP POLICY IF EXISTS feeding_operational_finance_audit_append ON finance_audit_log;
CREATE POLICY feeding_operational_finance_audit_append ON finance_audit_log
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.user_id', TRUE), '') IS NOT NULL
    AND table_name = 'transactions'
    AND new_data->>'source_type' IN ('feeding_payment', 'tuckshop_sale', 'tuckshop_sale_cogs', 'kitchen_purchase')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

COMMIT;
