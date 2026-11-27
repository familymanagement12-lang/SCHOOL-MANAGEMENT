BEGIN;

-- assignment_recipients' staff policy reads learning_assignments, while the
-- student/parent assignment policies read assignment_recipients. Avoid that
-- RLS cycle through a tightly scoped owner function that can inspect the
-- referenced assignment without recursively evaluating its RLS policies.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname=current_user AND rolbypassrls
  ) THEN
    RAISE EXCEPTION 'The assignment recipient scope function requires the approved BYPASSRLS migration owner.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.assignment_recipient_staff_scope(
  p_school_id INTEGER,
  p_assignment_id BIGINT
) RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.learning_assignments AS a
    WHERE a.school_id=p_school_id
      AND a.id=p_assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )
$$;
REVOKE ALL ON FUNCTION public.assignment_recipient_staff_scope(INTEGER,BIGINT) FROM PUBLIC;

DROP POLICY assignment_recipients_staff_scope ON public.assignment_recipients;
CREATE POLICY assignment_recipients_staff_scope ON public.assignment_recipients
  FOR ALL USING (public.assignment_recipient_staff_scope(school_id,assignment_id))
  WITH CHECK (public.assignment_recipient_staff_scope(school_id,assignment_id));

DO $$
DECLARE runtime_role TEXT := 'mccarthy_runtime_70aef860';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
    RAISE EXCEPTION 'Expected restricted runtime role % was not found.', runtime_role;
  END IF;
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION public.assignment_recipient_staff_scope(INTEGER,BIGINT) TO %I',
    runtime_role
  );
END $$;

INSERT INTO public.app_schema_migrations(migration_name)
VALUES ('20261127_assignment_rls_recursion_fix')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
