ALTER TABLE class_configuration_audit
  ADD COLUMN IF NOT EXISTS class_id_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'UPDATED';

DO $$
DECLARE
  action_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO action_definition
  FROM pg_constraint c
  WHERE c.conrelid = 'public.class_configuration_audit'::regclass
    AND c.conname = 'class_configuration_audit_action_check';

  IF action_definition IS NULL THEN
    ALTER TABLE class_configuration_audit
      ADD CONSTRAINT class_configuration_audit_action_check
      CHECK (action IN ('CREATED', 'UPDATED', 'DELETED'));
  ELSIF action_definition <> 'CHECK ((action = ANY (ARRAY[''CREATED''::text, ''UPDATED''::text, ''DELETED''::text])))' THEN
    RAISE EXCEPTION
      'Refusing class audit migration: expected class_configuration_audit_action_check to allow CREATED, UPDATED, DELETED; observed %',
      action_definition;
  END IF;
END $$;

DROP POLICY IF EXISTS class_configuration_audit_teacher_insert ON class_configuration_audit;
CREATE POLICY class_configuration_audit_teacher_insert ON class_configuration_audit
  FOR INSERT
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND changed_by = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'teacher'
  );

UPDATE class_configuration_audit
SET class_id_snapshot = class_id
WHERE class_id_snapshot IS NULL
  AND class_id IS NOT NULL;
