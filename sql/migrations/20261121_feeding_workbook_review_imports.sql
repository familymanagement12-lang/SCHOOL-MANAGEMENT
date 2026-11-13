BEGIN;

CREATE TABLE IF NOT EXISTS feeding_workbook_imports (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN ('lunch', 'purchases', 'market', 'marketing')),
  file_name TEXT NOT NULL CHECK (file_name IN (
    'LUNCH 2026_2027.xlsx',
    'PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx',
    'MARKET STOCK SEPT TO DEC, 2026.xlsx',
    'FEEDING AND MARKETING 2024_2025.xlsx'
  )),
  source_hash TEXT NOT NULL CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  file_data BYTEA NOT NULL,
  academic_year TEXT,
  term TEXT,
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'confirmed')),
  summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  imported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE (school_id, id),
  UNIQUE (school_id, module, source_hash)
);

CREATE TABLE IF NOT EXISTS feeding_workbook_import_rows (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  import_id BIGINT NOT NULL,
  import_key TEXT NOT NULL,
  sheet_name TEXT NOT NULL,
  source_row INTEGER NOT NULL CHECK (source_row > 0),
  row_kind TEXT NOT NULL CHECK (row_kind IN ('lunch_student', 'heading_or_summary', 'source_row')),
  original_values JSONB NOT NULL CHECK (jsonb_typeof(original_values) = 'object'),
  review_values JSONB NOT NULL CHECK (jsonb_typeof(review_values) = 'object'),
  issues JSONB NOT NULL DEFAULT '[]'::JSONB CHECK (jsonb_typeof(issues) = 'array'),
  matching_student_ids INTEGER[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('ready', 'incomplete', 'duplicate', 'rejected', 'excluded', 'skipped', 'imported')),
  exclusion_reason TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  UNIQUE (school_id, import_key),
  UNIQUE (school_id, import_id, sheet_name, source_row),
  UNIQUE (school_id, import_id, id),
  FOREIGN KEY (school_id, import_id)
    REFERENCES feeding_workbook_imports(school_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS feeding_workbook_import_audit (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  import_id BIGINT NOT NULL,
  row_id BIGINT,
  action TEXT NOT NULL CHECK (action IN ('previewed', 'corrected', 'excluded', 'confirmed')),
  old_data JSONB,
  new_data JSONB,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, import_id)
    REFERENCES feeding_workbook_imports(school_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS feeding_workbook_imports_school_created_idx
  ON feeding_workbook_imports (school_id, created_at DESC);
CREATE INDEX IF NOT EXISTS feeding_workbook_import_rows_import_status_idx
  ON feeding_workbook_import_rows (school_id, import_id, status, sheet_name, source_row);
CREATE INDEX IF NOT EXISTS feeding_workbook_import_audit_import_created_idx
  ON feeding_workbook_import_audit (school_id, import_id, created_at DESC);

DO $$
DECLARE
  table_name TEXT;
  grantee TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'feeding_workbook_imports',
    'feeding_workbook_import_rows',
    'feeding_workbook_import_audit'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS school_scope ON %I', table_name);
    EXECUTE format(
      'CREATE POLICY school_scope ON %I USING (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER) WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER)',
      table_name
    );
  END LOOP;

  FOR grantee IN
    SELECT rolname FROM pg_roles
    WHERE has_table_privilege(oid, 'public.fees', 'SELECT')
      AND rolname <> current_user
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE feeding_workbook_imports TO %I', grantee);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE feeding_workbook_import_rows TO %I', grantee);
    EXECUTE format('GRANT SELECT, INSERT ON TABLE feeding_workbook_import_audit TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE feeding_workbook_imports_id_seq TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE feeding_workbook_import_rows_id_seq TO %I', grantee);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE feeding_workbook_import_audit_id_seq TO %I', grantee);
  END LOOP;
END $$;

COMMIT;
