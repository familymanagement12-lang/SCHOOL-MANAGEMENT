BEGIN;

CREATE TABLE IF NOT EXISTS feeding_terms (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  scheduled_weekdays SMALLINT[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::SMALLINT[],
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, academic_year, term),
  CHECK (start_date <= end_date),
  CHECK (cardinality(scheduled_weekdays) BETWEEN 1 AND 7),
  CHECK (scheduled_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::SMALLINT[])
);

CREATE TABLE IF NOT EXISTS feeding_calendar_exceptions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  term_id BIGINT NOT NULL REFERENCES feeding_terms(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('holiday', 'vacation', 'school_day')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS feeding_calendar_exceptions_range_idx
  ON feeding_calendar_exceptions (school_id, term_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS feeding_class_rates (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  daily_rate NUMERIC(10, 2) NOT NULL CHECK (daily_rate > 0),
  effective_date DATE NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id, academic_year, term, effective_date)
);

CREATE INDEX IF NOT EXISTS feeding_class_rates_effective_idx
  ON feeding_class_rates (school_id, class_id, academic_year, term, effective_date DESC);

CREATE TABLE IF NOT EXISTS feeding_student_accounts (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  payment_frequency TEXT NOT NULL DEFAULT 'termly'
    CHECK (payment_frequency IN ('daily', 'weekly', 'monthly', 'termly')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id)
);

CREATE TABLE IF NOT EXISTS feeding_frequency_history (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  payment_frequency TEXT NOT NULL
    CHECK (payment_frequency IN ('daily', 'weekly', 'monthly', 'termly')),
  effective_from DATE NOT NULL,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feeding_frequency_history_student_idx
  ON feeding_frequency_history (school_id, student_id, effective_from DESC);

CREATE TABLE IF NOT EXISTS feeding_student_class_history (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_from <= effective_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS feeding_student_class_current_idx
  ON feeding_student_class_history (school_id, student_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS feeding_student_class_dates_idx
  ON feeding_student_class_history (school_id, student_id, effective_from, effective_to);

CREATE TABLE IF NOT EXISTS feeding_obligations (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  feeding_date DATE NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  class_name_snapshot TEXT,
  rate_id BIGINT NOT NULL REFERENCES feeding_class_rates(id) ON DELETE RESTRICT,
  daily_rate NUMERIC(10, 2) NOT NULL CHECK (daily_rate > 0),
  amount_due NUMERIC(10, 2) NOT NULL CHECK (amount_due > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, student_id, feeding_date)
);

CREATE INDEX IF NOT EXISTS feeding_obligations_date_idx
  ON feeding_obligations (school_id, feeding_date, class_id);

CREATE TABLE IF NOT EXISTS feeding_coverage_days (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  obligation_id BIGINT NOT NULL REFERENCES feeding_obligations(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  coverage_date DATE NOT NULL,
  is_served BOOLEAN NOT NULL DEFAULT FALSE,
  served_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  served_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, obligation_id),
  UNIQUE (school_id, student_id, coverage_date)
);

CREATE INDEX IF NOT EXISTS feeding_coverage_register_idx
  ON feeding_coverage_days (school_id, coverage_date, is_served);

CREATE TABLE IF NOT EXISTS school_payment_receipts (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  receipt_number TEXT NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'other')),
  reference TEXT,
  amount_total NUMERIC(10, 2) NOT NULL CHECK (amount_total > 0),
  school_fee_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (school_fee_amount >= 0),
  feeding_amount NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (feeding_amount >= 0),
  feeding_academic_year TEXT,
  feeding_term TEXT,
  idempotency_key TEXT NOT NULL,
  received_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, receipt_number),
  UNIQUE (school_id, idempotency_key),
  CHECK (amount_total = school_fee_amount + feeding_amount),
  CHECK (
    (feeding_amount = 0 AND feeding_academic_year IS NULL AND feeding_term IS NULL)
    OR (feeding_amount > 0 AND feeding_academic_year IS NOT NULL AND feeding_term IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS school_payment_receipts_student_idx
  ON school_payment_receipts (school_id, student_id, payment_date DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS school_payment_receipts_reference_unique
  ON school_payment_receipts (school_id, reference)
  WHERE reference IS NOT NULL AND BTRIM(reference) <> '';

CREATE TABLE IF NOT EXISTS school_payment_allocations (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  receipt_id BIGINT NOT NULL REFERENCES school_payment_receipts(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  component TEXT NOT NULL CHECK (component IN ('school_fee', 'feeding')),
  fee_id INTEGER REFERENCES fees(id) ON DELETE RESTRICT,
  obligation_id BIGINT REFERENCES feeding_obligations(id) ON DELETE RESTRICT,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (component = 'school_fee' AND fee_id IS NOT NULL AND obligation_id IS NULL)
    OR (component = 'feeding' AND fee_id IS NULL AND obligation_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS school_payment_allocations_receipt_idx
  ON school_payment_allocations (school_id, receipt_id, component);
CREATE INDEX IF NOT EXISTS school_payment_allocations_obligation_idx
  ON school_payment_allocations (school_id, obligation_id)
  WHERE obligation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS school_payment_allocations_fee_idx
  ON school_payment_allocations (school_id, fee_id)
  WHERE fee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS school_payment_refunds (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  receipt_id BIGINT NOT NULL REFERENCES school_payment_receipts(id) ON DELETE RESTRICT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  component TEXT NOT NULL CHECK (component IN ('school_fee', 'feeding')),
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  reference TEXT,
  idempotency_key TEXT NOT NULL,
  refunded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  refund_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS school_payment_refunds_receipt_idx
  ON school_payment_refunds (school_id, receipt_id, component);

CREATE TABLE IF NOT EXISTS school_payment_refund_allocations (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  refund_id BIGINT NOT NULL REFERENCES school_payment_refunds(id) ON DELETE RESTRICT,
  payment_allocation_id BIGINT REFERENCES school_payment_allocations(id) ON DELETE RESTRICT,
  component TEXT NOT NULL CHECK (component IN ('school_fee', 'feeding')),
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (component = 'feeding' OR payment_allocation_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS school_payment_refund_allocations_allocation_idx
  ON school_payment_refund_allocations (school_id, payment_allocation_id)
  WHERE payment_allocation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS feeding_payment_ledger (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'refund')),
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  payment_date DATE NOT NULL,
  receipt_id BIGINT REFERENCES school_payment_receipts(id) ON DELETE RESTRICT,
  refund_id BIGINT REFERENCES school_payment_refunds(id) ON DELETE RESTRICT,
  reference TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (entry_type = 'income' AND receipt_id IS NOT NULL AND refund_id IS NULL)
    OR (entry_type = 'refund' AND refund_id IS NOT NULL AND receipt_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS feeding_ledger_receipt_unique
  ON feeding_payment_ledger (school_id, receipt_id)
  WHERE receipt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS feeding_ledger_refund_unique
  ON feeding_payment_ledger (school_id, refund_id)
  WHERE refund_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS feeding_ledger_history_idx
  ON feeding_payment_ledger (school_id, student_id, payment_date DESC, id DESC);

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_receipt_id BIGINT
    REFERENCES school_payment_receipts(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS payment_refund_id BIGINT
    REFERENCES school_payment_refunds(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS transactions_payment_receipt_unique
  ON transactions (school_id, payment_receipt_id)
  WHERE payment_receipt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_payment_refund_unique
  ON transactions (school_id, payment_refund_id)
  WHERE payment_refund_id IS NOT NULL;

CREATE OR REPLACE FUNCTION initialize_student_feeding_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  account_id BIGINT;
  account_frequency TEXT;
BEGIN
  INSERT INTO public.feeding_student_accounts (school_id, student_id)
  VALUES (NEW.school_id, NEW.id)
  ON CONFLICT (school_id, student_id) DO NOTHING
  RETURNING id INTO account_id;

  IF account_id IS NULL THEN
    SELECT id INTO account_id
    FROM public.feeding_student_accounts
    WHERE school_id = NEW.school_id AND student_id = NEW.id;
  END IF;

  SELECT payment_frequency INTO account_frequency
  FROM public.feeding_student_accounts
  WHERE school_id = NEW.school_id AND student_id = NEW.id;

  INSERT INTO public.feeding_frequency_history (school_id, student_id, payment_frequency, effective_from)
  SELECT NEW.school_id, NEW.id, account_frequency, CURRENT_DATE
  WHERE NOT EXISTS (
    SELECT 1 FROM public.feeding_frequency_history
    WHERE school_id = NEW.school_id AND student_id = NEW.id
  );

  INSERT INTO public.feeding_student_class_history (school_id, student_id, class_id, effective_from)
  VALUES (NEW.school_id, NEW.id, NEW.class_id, CURRENT_DATE)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_initialize_feeding_account ON students;
CREATE TRIGGER students_initialize_feeding_account
  AFTER INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION initialize_student_feeding_account();

CREATE OR REPLACE FUNCTION track_student_feeding_class_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  change_date DATE := CURRENT_DATE;
BEGIN
  IF OLD.class_id IS DISTINCT FROM NEW.class_id THEN
    UPDATE public.feeding_student_class_history
    SET effective_to = change_date - 1
    WHERE school_id = NEW.school_id AND student_id = NEW.id
      AND effective_to IS NULL AND effective_from < change_date;

    UPDATE public.feeding_student_class_history
    SET class_id = NEW.class_id
    WHERE school_id = NEW.school_id AND student_id = NEW.id
      AND effective_to IS NULL AND effective_from >= change_date;

    IF NOT FOUND THEN
      INSERT INTO public.feeding_student_class_history
        (school_id, student_id, class_id, effective_from)
      VALUES (NEW.school_id, NEW.id, NEW.class_id, change_date);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS students_track_feeding_class_history ON students;
CREATE TRIGGER students_track_feeding_class_history
  AFTER UPDATE OF class_id ON students
  FOR EACH ROW EXECUTE FUNCTION track_student_feeding_class_history();

INSERT INTO feeding_student_accounts (school_id, student_id)
SELECT school_id, id FROM students
ON CONFLICT (school_id, student_id) DO NOTHING;

INSERT INTO feeding_frequency_history (school_id, student_id, payment_frequency, effective_from)
SELECT a.school_id, a.student_id, a.payment_frequency, CURRENT_DATE
FROM feeding_student_accounts a
WHERE NOT EXISTS (
  SELECT 1 FROM feeding_frequency_history h
  WHERE h.school_id = a.school_id AND h.student_id = a.student_id
);

INSERT INTO feeding_student_class_history (school_id, student_id, class_id, effective_from)
SELECT s.school_id, s.id, s.class_id, CURRENT_DATE
FROM students s
WHERE NOT EXISTS (
  SELECT 1 FROM feeding_student_class_history h
  WHERE h.school_id = s.school_id AND h.student_id = s.id
);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'feeding_terms', 'feeding_calendar_exceptions', 'feeding_class_rates',
    'feeding_student_accounts', 'feeding_frequency_history',
    'feeding_student_class_history', 'feeding_obligations', 'feeding_coverage_days',
    'school_payment_receipts', 'school_payment_allocations', 'school_payment_refunds',
    'school_payment_refund_allocations', 'feeding_payment_ledger'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    IF table_name NOT IN (
      'feeding_student_accounts', 'feeding_frequency_history', 'feeding_student_class_history'
    ) THEN
      EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS feeding_school_scope ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY feeding_school_scope ON %I
       USING (
         current_setting(''app.role'', TRUE) IN (''admin'', ''accountant'', ''feeding_tuckshop_officer'')
         AND school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER
       )
       WITH CHECK (
         current_setting(''app.role'', TRUE) IN (''admin'', ''accountant'', ''feeding_tuckshop_officer'')
         AND school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER
       )',
      table_name
    );
    IF table_name NOT IN (
      'feeding_student_accounts', 'feeding_frequency_history', 'feeding_student_class_history'
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS finance_audit_row ON %I', table_name);
      EXECUTE format(
        'CREATE TRIGGER finance_audit_row AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION audit_finance_row()',
        table_name
      );
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS finance_audit_append ON finance_audit_log;
CREATE POLICY finance_audit_append ON finance_audit_log FOR INSERT
  WITH CHECK (
    current_setting('app.role', TRUE) IN ('admin', 'accountant', 'feeding_tuckshop_officer')
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
  );

COMMIT;
