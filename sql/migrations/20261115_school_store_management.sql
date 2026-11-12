BEGIN;

CREATE TABLE IF NOT EXISTS inventory_suppliers (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, name)
);

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS item_code TEXT,
  ADD COLUMN IF NOT EXISTS barcode TEXT,
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'consumable',
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'piece',
  ADD COLUMN IF NOT EXISTS minimum_stock INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES inventory_suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS storage_location TEXT,
  ADD COLUMN IF NOT EXISTS item_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_item_type_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_item_type_check
      CHECK (item_type IN ('consumable', 'asset'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_quantity_nonnegative_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_quantity_nonnegative_check CHECK (quantity >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_minimum_stock_nonnegative_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_minimum_stock_nonnegative_check CHECK (minimum_stock >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_purchase_price_nonnegative_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_purchase_price_nonnegative_check CHECK (purchase_price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_item_status_check') THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_item_status_check
      CHECK (item_status IN ('active', 'discontinued', 'archived'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_school_item_code_unique
  ON inventory (school_id, lower(item_code)) WHERE item_code IS NOT NULL AND item_code <> '';
CREATE UNIQUE INDEX IF NOT EXISTS inventory_school_barcode_unique
  ON inventory (school_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';
CREATE INDEX IF NOT EXISTS inventory_school_stock_idx ON inventory (school_id, quantity, minimum_stock);
UPDATE inventory
SET item_code = COALESCE(NULLIF(item_code, ''), CONCAT('MH-ITM-', id)),
    barcode = COALESCE(NULLIF(barcode, ''), NULLIF(item_code, ''), CONCAT('MH-ITM-', id))
WHERE item_code IS NULL OR item_code = '' OR barcode IS NULL OR barcode = '';

CREATE TABLE IF NOT EXISTS inventory_purchases (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  supplier_id BIGINT NOT NULL REFERENCES inventory_suppliers(id) ON DELETE RESTRICT,
  purchase_reference TEXT NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  invoice_number TEXT,
  status TEXT NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'partially_received', 'received', 'cancelled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, purchase_reference)
);

CREATE TABLE IF NOT EXISTS inventory_purchase_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES inventory_purchases(id) ON DELETE RESTRICT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  quantity_ordered INTEGER NOT NULL CHECK (quantity_ordered > 0),
  quantity_received INTEGER NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  expiry_date DATE,
  CHECK (quantity_received <= quantity_ordered)
);
CREATE INDEX IF NOT EXISTS inventory_purchase_items_purchase_idx
  ON inventory_purchase_items (school_id, purchase_id);

CREATE TABLE IF NOT EXISTS inventory_purchase_receipts (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  purchase_id BIGINT NOT NULL REFERENCES inventory_purchases(id) ON DELETE RESTRICT,
  delivery_reference TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, delivery_reference)
);

CREATE TABLE IF NOT EXISTS inventory_purchase_receipt_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  receipt_id BIGINT NOT NULL REFERENCES inventory_purchase_receipts(id) ON DELETE RESTRICT,
  purchase_item_id BIGINT NOT NULL REFERENCES inventory_purchase_items(id) ON DELETE RESTRICT,
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
  expiry_date DATE
);

ALTER TABLE inventory_purchase_receipt_items
  ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE TABLE IF NOT EXISTS inventory_stock_batches (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  receipt_item_id BIGINT UNIQUE REFERENCES inventory_purchase_receipt_items(id) ON DELETE RESTRICT,
  quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
  quantity_remaining INTEGER NOT NULL CHECK (quantity_remaining >= 0),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  expiry_date DATE,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity_remaining <= quantity_received)
);
CREATE INDEX IF NOT EXISTS inventory_stock_batches_expiry_idx
  ON inventory_stock_batches (school_id, inventory_id, expiry_date)
  WHERE quantity_remaining > 0;

CREATE TABLE IF NOT EXISTS inventory_issuances (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL
    CHECK (recipient_type IN ('student', 'teacher', 'employee', 'department')),
  recipient_id INTEGER,
  recipient_name TEXT NOT NULL,
  department TEXT,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  purpose TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, reference_number),
  UNIQUE (school_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS inventory_issuance_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  issuance_id BIGINT NOT NULL REFERENCES inventory_issuances(id) ON DELETE RESTRICT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS inventory_assets (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  asset_code TEXT NOT NULL,
  serial_number TEXT,
  barcode TEXT,
  condition TEXT NOT NULL DEFAULT 'good'
    CHECK (condition IN ('new', 'good', 'fair', 'damaged', 'missing', 'disposed')),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'assigned', 'maintenance', 'missing', 'disposed')),
  assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  assigned_department TEXT,
  location TEXT,
  purchase_date DATE,
  purchase_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (purchase_price >= 0),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, asset_code),
  UNIQUE (school_id, barcode)
);
ALTER TABLE inventory_assets
  ADD COLUMN IF NOT EXISTS assigned_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_receipt_item_id BIGINT REFERENCES inventory_purchase_receipt_items(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS inventory_assets_receipt_item_idx
  ON inventory_assets (school_id, purchase_receipt_item_id)
  WHERE purchase_receipt_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_assets_school_status_idx
  ON inventory_assets (school_id, status, inventory_id);

CREATE TABLE IF NOT EXISTS inventory_asset_events (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES inventory_assets(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('registered', 'assigned', 'transferred', 'returned', 'condition_changed', 'damaged', 'missing', 'disposed')),
  from_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  to_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  from_department TEXT,
  to_department TEXT,
  condition TEXT,
  notes TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE inventory_asset_events
  ADD COLUMN IF NOT EXISTS from_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS to_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS inventory_maintenance (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  asset_id BIGINT NOT NULL REFERENCES inventory_assets(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  maintenance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  cost NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed')),
  completed_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_requests (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  department TEXT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  quantity_approved INTEGER NOT NULL DEFAULT 0 CHECK (quantity_approved >= 0),
  quantity_fulfilled INTEGER NOT NULL DEFAULT 0 CHECK (quantity_fulfilled >= 0),
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved', 'rejected', 'partially_fulfilled', 'fulfilled')),
  approval_comment TEXT,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (quantity_approved <= quantity_requested),
  CHECK (quantity_fulfilled <= quantity_approved)
);
CREATE INDEX IF NOT EXISTS inventory_requests_school_status_idx
  ON inventory_requests (school_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_stocktakes (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  reference_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reconciled_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, reference_number)
);

CREATE TABLE IF NOT EXISTS inventory_stocktake_items (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  stocktake_id BIGINT NOT NULL REFERENCES inventory_stocktakes(id) ON DELETE RESTRICT,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  system_quantity INTEGER NOT NULL CHECK (system_quantity >= 0),
  counted_quantity INTEGER NOT NULL CHECK (counted_quantity >= 0),
  reason TEXT NOT NULL,
  UNIQUE (school_id, stocktake_id, inventory_id)
);

CREATE TABLE IF NOT EXISTS inventory_stock_movements (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL
    CHECK (movement_type IN ('opening_balance', 'purchase_receipt', 'issuance', 'adjustment', 'stocktake', 'damage', 'return')),
  quantity_change INTEGER NOT NULL CHECK (quantity_change <> 0),
  quantity_after INTEGER NOT NULL CHECK (quantity_after >= 0),
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  reference_type TEXT NOT NULL,
  reference_id BIGINT,
  idempotency_key TEXT,
  reason TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE inventory_stock_movements
  DROP CONSTRAINT IF EXISTS inventory_stock_movements_movement_type_check;
ALTER TABLE inventory_stock_movements
  ADD CONSTRAINT inventory_stock_movements_movement_type_check
  CHECK (movement_type IN ('opening_balance', 'purchase_receipt', 'issuance', 'adjustment', 'stocktake', 'damage', 'return', 'asset_register'));
CREATE UNIQUE INDEX IF NOT EXISTS inventory_stock_movement_idempotency_unique
  ON inventory_stock_movements (school_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_stock_movement_history_idx
  ON inventory_stock_movements (school_id, inventory_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inventory_audit_log (
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
CREATE INDEX IF NOT EXISTS inventory_audit_school_created_idx
  ON inventory_audit_log (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_audit_record_idx
  ON inventory_audit_log (school_id, table_name, record_id, created_at DESC);

CREATE OR REPLACE FUNCTION audit_inventory_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  row_data JSONB;
  old_row JSONB;
  new_row JSONB;
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

DROP TRIGGER IF EXISTS inventory_audit_row ON inventory;
CREATE TRIGGER inventory_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON inventory
  FOR EACH ROW EXECUTE FUNCTION audit_inventory_row();

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'inventory_suppliers', 'inventory_purchases', 'inventory_purchase_items',
    'inventory_purchase_receipts', 'inventory_purchase_receipt_items',
    'inventory_stock_batches',
    'inventory_issuances', 'inventory_issuance_items', 'inventory_assets',
    'inventory_asset_events', 'inventory_maintenance', 'inventory_requests',
    'inventory_stocktakes', 'inventory_stocktake_items', 'inventory_stock_movements'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS inventory_audit_row ON %I', table_name);
    EXECUTE format(
      'CREATE TRIGGER inventory_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
       FOR EACH ROW EXECUTE FUNCTION audit_inventory_row()',
      table_name
    );
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS inventory_school_scope ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY inventory_school_scope ON %I
       USING (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER)
       WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER)',
      table_name
    );
  END LOOP;

  ALTER TABLE inventory_audit_log ENABLE ROW LEVEL SECURITY;
  ALTER TABLE inventory_audit_log FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS inventory_audit_school_scope ON inventory_audit_log;
  DROP POLICY IF EXISTS inventory_audit_insert_scope ON inventory_audit_log;
  CREATE POLICY inventory_audit_school_scope ON inventory_audit_log
    FOR SELECT
    USING (
      school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
      AND NULLIF(current_setting('app.role', TRUE), '') IN ('admin', 'inventory', 'store', 'storekeeper')
    );
  CREATE POLICY inventory_audit_insert_scope ON inventory_audit_log
    FOR INSERT
    WITH CHECK (school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER);
END $$;

-- New tables inherit the access already granted to the restricted runtime roles
-- for the existing inventory catalogue, without granting privileges to PUBLIC.
DO $$
DECLARE
  grantee TEXT;
  relation_name TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.inventory', 'SELECT')
      AND rolname <> current_user
  LOOP
    FOREACH relation_name IN ARRAY ARRAY[
      'inventory_suppliers', 'inventory_purchases', 'inventory_purchase_items',
      'inventory_purchase_receipts', 'inventory_purchase_receipt_items',
      'inventory_stock_batches',
      'inventory_issuances', 'inventory_issuance_items', 'inventory_assets',
      'inventory_asset_events', 'inventory_maintenance', 'inventory_requests',
      'inventory_stocktakes', 'inventory_stocktake_items', 'inventory_stock_movements'
    ] LOOP
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I',
        relation_name, grantee
      );
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE inventory_audit_log TO %I', grantee);
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE
       inventory_suppliers_id_seq, inventory_purchases_id_seq, inventory_purchase_items_id_seq,
       inventory_purchase_receipts_id_seq, inventory_purchase_receipt_items_id_seq,
       inventory_stock_batches_id_seq,
       inventory_issuances_id_seq, inventory_issuance_items_id_seq, inventory_assets_id_seq,
       inventory_asset_events_id_seq, inventory_maintenance_id_seq, inventory_requests_id_seq,
       inventory_stocktakes_id_seq, inventory_stocktake_items_id_seq,
       inventory_stock_movements_id_seq, inventory_audit_log_id_seq TO %I',
      grantee
    );
  END LOOP;
END $$;

COMMIT;
