-- Keep the application login away from migration metadata and append-only history.
-- The timetable runner applies this only as neondb_owner on the pinned dev branch.
DO $$
DECLARE
  runtime_oid OID;
  runtime_role RECORD;
BEGIN
  IF current_database() <> 'neondb'
     OR current_user <> 'neondb_owner'
     OR session_user <> 'neondb_owner' THEN
    RAISE EXCEPTION 'Refusing runtime privilege hardening outside the approved development owner session.';
  END IF;

  SELECT * INTO runtime_role
  FROM pg_roles
  WHERE rolname = 'mccarthy_runtime_70aef860';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expected development runtime role mccarthy_runtime_70aef860 was not found.';
  END IF;
  runtime_oid := runtime_role.oid;
  IF runtime_role.rolsuper OR runtime_role.rolbypassrls
     OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole THEN
    RAISE EXCEPTION 'Runtime role has elevated attributes; manual review is required.';
  END IF;
  IF pg_has_role(runtime_oid, 'neondb_owner'::regrole, 'MEMBER') THEN
    RAISE EXCEPTION 'Runtime role is a member of neondb_owner; manual review is required.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relowner = runtime_oid
  ) OR EXISTS (
    SELECT 1 FROM pg_namespace n
    WHERE n.nspname = 'public' AND n.nspowner = runtime_oid
  ) THEN
    RAISE EXCEPTION 'Runtime role owns public schema objects; manual review is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.app_schema_migrations'::regclass
      AND c.relowner = 'neondb_owner'::regrole
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.class_configuration_audit'::regclass
      AND c.relowner = 'neondb_owner'::regrole
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class c
    WHERE c.oid = 'public.student_class_history'::regclass
      AND c.relowner = 'neondb_owner'::regrole
      AND c.relrowsecurity AND c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'Expected owner-owned ledger and forced-RLS audit/history tables were not found.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.class_configuration_audit'::regclass
      AND polname = 'class_configuration_audit_admin_all'
      AND polcmd = '*'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.class_configuration_audit'::regclass
      AND polname = 'class_configuration_audit_teacher_insert'
      AND polcmd = 'a'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.student_class_history'::regclass
      AND polname = 'student_class_history_admin_all'
      AND polcmd = '*'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.student_class_history'::regclass
      AND polname = 'student_class_history_parent_read'
      AND polcmd = 'r'
  ) THEN
    RAISE EXCEPTION 'Expected audit/history RLS policies differ; manual review is required.';
  END IF;
END
$$;

-- Future objects receive no implicit runtime grants. New migrations must grant
-- only the privileges their application paths actually require.
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE ALL ON TABLES FROM mccarthy_runtime_70aef860;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM mccarthy_runtime_70aef860;

REVOKE ALL PRIVILEGES ON TABLE public.app_schema_migrations
  FROM mccarthy_runtime_70aef860;

REVOKE ALL PRIVILEGES ON TABLE public.class_configuration_audit
  FROM mccarthy_runtime_70aef860;
GRANT INSERT ON TABLE public.class_configuration_audit
  TO mccarthy_runtime_70aef860;
REVOKE ALL PRIVILEGES ON SEQUENCE public.class_configuration_audit_id_seq
  FROM mccarthy_runtime_70aef860;
GRANT USAGE ON SEQUENCE public.class_configuration_audit_id_seq
  TO mccarthy_runtime_70aef860;

DROP POLICY class_configuration_audit_admin_all ON public.class_configuration_audit;
CREATE POLICY class_configuration_audit_admin_insert
  ON public.class_configuration_audit
  FOR INSERT
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  );

REVOKE ALL PRIVILEGES ON TABLE public.student_class_history
  FROM mccarthy_runtime_70aef860;
GRANT SELECT ON TABLE public.student_class_history
  TO mccarthy_runtime_70aef860;
REVOKE ALL PRIVILEGES ON SEQUENCE public.student_class_history_id_seq
  FROM mccarthy_runtime_70aef860;

DROP POLICY student_class_history_admin_all ON public.student_class_history;
CREATE POLICY student_class_history_admin_read
  ON public.student_class_history
  FOR SELECT
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  );
