BEGIN;

CREATE TABLE IF NOT EXISTS feeding_marketing_income (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  income_date DATE NOT NULL DEFAULT CURRENT_DATE,
  academic_year TEXT CHECK (academic_year IS NULL OR academic_year ~ '^[0-9]{4}[-_/][0-9]{4}$'),
  term TEXT CHECK (term IS NULL OR term IN ('Term 1', 'Term 2', 'Term 3')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  income_source TEXT NOT NULL CHECK (length(trim(income_source)) BETWEEN 1 AND 120),
  description TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 500),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer', 'other')),
  reference TEXT CHECK (reference IS NULL OR length(reference) <= 120),
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, idempotency_key),
  CHECK (term IS NULL OR academic_year IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS feeding_marketing_income_history_idx
  ON feeding_marketing_income (school_id, income_date DESC, id DESC);

ALTER TABLE feeding_marketing_income ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeding_marketing_income FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_scope ON feeding_marketing_income;
CREATE POLICY school_scope ON feeding_marketing_income
  USING (school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER)
  WITH CHECK (school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER);

DROP TRIGGER IF EXISTS operational_audit_row ON feeding_marketing_income;
CREATE TRIGGER operational_audit_row AFTER INSERT OR UPDATE OR DELETE ON feeding_marketing_income
  FOR EACH ROW EXECUTE FUNCTION audit_feeding_tuckshop_row();

DO $$
DECLARE
  grantee TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.fees', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON TABLE feeding_marketing_income TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE feeding_marketing_income_id_seq TO %I', grantee);
  END LOOP;
END $$;

COMMIT;
