BEGIN;

CREATE TABLE IF NOT EXISTS feeding_tuckshop_imported_workbooks (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$'),
  file_data BYTEA NOT NULL CHECK (octet_length(file_data) > 0),
  sheet_summary JSONB NOT NULL CHECK (jsonb_typeof(sheet_summary) = 'array'),
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, file_name, file_hash)
);

CREATE INDEX IF NOT EXISTS feeding_tuckshop_imported_workbooks_history_idx
  ON feeding_tuckshop_imported_workbooks (school_id, imported_at DESC, id DESC);

ALTER TABLE feeding_tuckshop_imported_workbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE feeding_tuckshop_imported_workbooks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS school_scope ON feeding_tuckshop_imported_workbooks;
CREATE POLICY school_scope ON feeding_tuckshop_imported_workbooks
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
      'GRANT SELECT, INSERT ON TABLE feeding_tuckshop_imported_workbooks TO %I',
      grantee
    );
    EXECUTE format(
      'GRANT USAGE, SELECT ON SEQUENCE feeding_tuckshop_imported_workbooks_id_seq TO %I',
      grantee
    );
  END LOOP;
END $$;

COMMIT;
