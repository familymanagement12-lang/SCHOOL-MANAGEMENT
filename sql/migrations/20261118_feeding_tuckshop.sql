BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS source_type TEXT,
  ADD COLUMN IF NOT EXISTS source_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_operational_source_unique
  ON transactions (school_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_permissions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, user_id, permission)
);

CREATE TABLE IF NOT EXISTS feeding_class_rates (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  daily_rate NUMERIC(10,2) NOT NULL CHECK (daily_rate > 0),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id)
);

CREATE TABLE IF NOT EXISTS school_calendar_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('holiday', 'vacation', 'school_day')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS school_calendar_events_range_idx
  ON school_calendar_events (school_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS feeding_student_credits (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  balance NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id)
);

CREATE TABLE IF NOT EXISTS feeding_payments (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount_received NUMERIC(10,2) NOT NULL CHECK (amount_received > 0),
  daily_rate NUMERIC(10,2) NOT NULL CHECK (daily_rate > 0),
  credit_applied NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (credit_applied >= 0),
  days_covered INTEGER NOT NULL DEFAULT 0 CHECK (days_covered >= 0),
  credit_added NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (credit_added >= 0),
  coverage_start DATE,
  coverage_end DATE,
  payment_date DATE NOT NULL,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receipt_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, receipt_number),
  UNIQUE (school_id, idempotency_key),
  CHECK ((days_covered = 0 AND coverage_start IS NULL AND coverage_end IS NULL)
      OR (days_covered > 0 AND coverage_start IS NOT NULL AND coverage_end IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS feeding_payments_student_history_idx
  ON feeding_payments (school_id, student_id, payment_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS feeding_coverage_days (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  payment_id BIGINT NOT NULL REFERENCES feeding_payments(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  coverage_date DATE NOT NULL,
  is_served BOOLEAN NOT NULL DEFAULT FALSE,
  served_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  served_at TIMESTAMPTZ,
  UNIQUE (school_id, student_id, coverage_date)
);

CREATE INDEX IF NOT EXISTS feeding_coverage_register_idx
  ON feeding_coverage_days (school_id, coverage_date, is_served);

CREATE TABLE IF NOT EXISTS tuckshop_products (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS tuckshop_products_sku_unique
  ON tuckshop_products (school_id, lower(sku))
  WHERE sku IS NOT NULL AND sku <> '';

CREATE TABLE IF NOT EXISTS tuckshop_sales (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'mobile_money', 'card', 'other')),
  sold_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  receipt_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  sale_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, receipt_number),
  UNIQUE (school_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS tuckshop_sales_history_idx
  ON tuckshop_sales (school_id, sale_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS tuckshop_sale_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  sale_id BIGINT NOT NULL REFERENCES tuckshop_sales(id) ON DELETE RESTRICT,
  product_id BIGINT NOT NULL REFERENCES tuckshop_products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0)
);

CREATE TABLE IF NOT EXISTS kitchen_stock_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'unit',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  minimum_quantity NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS kitchen_purchases (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  purpose TEXT NOT NULL CHECK (purpose IN ('feeding', 'kitchen')),
  expense_category TEXT NOT NULL CHECK (expense_category IN ('Feeding Supplies', 'Kitchen Supplies')),
  total_amount NUMERIC(10,2) NOT NULL CHECK (total_amount > 0),
  supplier TEXT,
  reference TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS kitchen_purchases_history_idx
  ON kitchen_purchases (school_id, purchase_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS kitchen_purchase_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES kitchen_purchases(id) ON DELETE RESTRICT,
  stock_item_id BIGINT NOT NULL REFERENCES kitchen_stock_items(id) ON DELETE RESTRICT,
  quantity NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(10,2) NOT NULL CHECK (unit_cost >= 0),
  line_total NUMERIC(10,2) NOT NULL CHECK (line_total >= 0)
);

DO $$
DECLARE
  table_name TEXT;
  grantee TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_permissions', 'feeding_class_rates', 'school_calendar_events',
    'feeding_student_credits', 'feeding_payments', 'feeding_coverage_days',
    'tuckshop_products', 'tuckshop_sales', 'tuckshop_sale_items',
    'kitchen_stock_items', 'kitchen_purchases', 'kitchen_purchase_items'
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
  END LOOP;

  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.fees', 'SELECT')
      AND rolname <> current_user
  LOOP
    FOREACH table_name IN ARRAY ARRAY[
      'user_permissions', 'feeding_class_rates', 'school_calendar_events',
      'feeding_student_credits', 'feeding_payments', 'feeding_coverage_days',
      'tuckshop_products', 'tuckshop_sales', 'tuckshop_sale_items',
      'kitchen_stock_items', 'kitchen_purchases', 'kitchen_purchase_items'
    ] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', table_name, grantee);
    END LOOP;
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE user_permissions_id_seq,
       feeding_class_rates_id_seq, school_calendar_events_id_seq,
       feeding_student_credits_id_seq, feeding_payments_id_seq,
       feeding_coverage_days_id_seq, tuckshop_products_id_seq,
       tuckshop_sales_id_seq, tuckshop_sale_items_id_seq,
       kitchen_stock_items_id_seq, kitchen_purchases_id_seq,
       kitchen_purchase_items_id_seq TO %I',
      grantee
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS feeding_operational_finance_insert ON transactions;
CREATE POLICY feeding_operational_finance_insert ON transactions
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.user_id', TRUE), '') IS NOT NULL
    AND source_type IN ('feeding_payment', 'tuckshop_sale', 'kitchen_purchase')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

DROP POLICY IF EXISTS feeding_operational_finance_audit_append ON finance_audit_log;
CREATE POLICY feeding_operational_finance_audit_append ON finance_audit_log
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.user_id', TRUE), '') IS NOT NULL
    AND table_name = 'transactions'
    AND new_data->>'source_type' IN ('feeding_payment', 'tuckshop_sale', 'kitchen_purchase')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

DO $$
DECLARE
  grantee TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.transactions', 'INSERT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT INSERT ON TABLE transactions TO %I', grantee);
  END LOOP;
END $$;

COMMIT;
