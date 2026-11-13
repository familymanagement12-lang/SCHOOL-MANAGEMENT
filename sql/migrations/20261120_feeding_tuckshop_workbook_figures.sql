BEGIN;

CREATE TABLE IF NOT EXISTS feeding_tuckshop_workbook_figures (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('feeding', 'tuckshop', 'marketing')),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense', 'summary')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  period_label TEXT NOT NULL,
  description TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  sheet_name TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK (source_row > 0),
  source_column TEXT NOT NULL,
  import_key TEXT NOT NULL,
  counts_in_totals BOOLEAN NOT NULL DEFAULT FALSE,
  support_reason TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, import_key)
);

CREATE INDEX IF NOT EXISTS feeding_tuckshop_workbook_figures_scope_idx
  ON feeding_tuckshop_workbook_figures (school_id, module, counts_in_totals, id);

ALTER TABLE feeding_tuckshop_workbook_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeding_tuckshop_workbook_figures FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_scope ON feeding_tuckshop_workbook_figures;
CREATE POLICY school_scope ON feeding_tuckshop_workbook_figures
  USING (school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER)
  WITH CHECK (school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER);

DO $$
DECLARE
  grantee TEXT;
BEGIN
  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.fees', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT ON TABLE feeding_tuckshop_workbook_figures TO %I',
      grantee
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE feeding_tuckshop_workbook_figures_id_seq TO %I',
      grantee
    );
  END LOOP;
END $$;

COMMIT;
