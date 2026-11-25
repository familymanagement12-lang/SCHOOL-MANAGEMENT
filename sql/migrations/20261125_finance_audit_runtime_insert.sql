BEGIN;

DO $$
DECLARE
  runtime_role RECORD;
BEGIN
  FOR runtime_role IN
    SELECT rolname
    FROM pg_roles
    WHERE rolcanlogin
      AND rolname LIKE 'mccarthy_runtime_%'
      AND has_table_privilege(oid, 'public.finance_audit_log', 'SELECT')
      AND NOT has_table_privilege(oid, 'public.finance_audit_log', 'INSERT')
  LOOP
    EXECUTE format('GRANT INSERT ON TABLE public.finance_audit_log TO %I', runtime_role.rolname);
  END LOOP;
END $$;

COMMIT;
