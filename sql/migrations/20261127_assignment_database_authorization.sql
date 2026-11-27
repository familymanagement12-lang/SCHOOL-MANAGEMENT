BEGIN;

CREATE OR REPLACE FUNCTION public.assignment_staff_scope(
  row_school_id INTEGER,
  row_teacher_id INTEGER,
  row_class_id INTEGER,
  row_subject_id INTEGER,
  row_term_id INTEGER
) RETURNS BOOLEAN
LANGUAGE SQL STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT row_school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND (
      current_setting('app.role', TRUE) = 'admin'
      OR (
        current_setting('app.role', TRUE) = 'teacher'
        AND (
          row_teacher_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
          OR EXISTS (
            SELECT 1 FROM public.teacher_subject_assignments tsa
            WHERE tsa.school_id=row_school_id AND tsa.term_id=row_term_id
              AND tsa.class_id=row_class_id AND tsa.subject_id=row_subject_id
              AND tsa.teacher_id=NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
          )
          OR EXISTS (
            SELECT 1 FROM public.timetable_class_teacher_assignments tca
            JOIN public.subject_weekly_requirements r
              ON r.school_id=tca.school_id AND r.term_id=tca.term_id
               AND r.class_id=tca.class_id AND r.subject_id=row_subject_id
            WHERE tca.school_id=row_school_id AND tca.term_id=row_term_id
              AND tca.class_id=row_class_id
              AND tca.teacher_id=NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
          )
        )
      )
    )
$$;
REVOKE ALL ON FUNCTION public.assignment_staff_scope(INTEGER,INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC;

DROP POLICY IF EXISTS learning_assignments_school_scope ON public.learning_assignments;
DROP POLICY IF EXISTS assignment_recipients_school_scope ON public.assignment_recipients;
DROP POLICY IF EXISTS assignment_submissions_school_scope ON public.assignment_submissions;
DROP POLICY IF EXISTS assignment_submission_versions_school_scope ON public.assignment_submission_versions;
DROP POLICY IF EXISTS assignment_attachments_school_scope ON public.assignment_attachments;
DROP POLICY IF EXISTS assignment_submission_files_school_scope ON public.assignment_submission_files;
DROP POLICY IF EXISTS assignment_marks_school_scope ON public.assignment_marks;
DROP POLICY IF EXISTS assignment_audit_log_school_scope ON public.assignment_audit_log;

CREATE POLICY learning_assignments_staff_scope ON public.learning_assignments
  FOR ALL
  USING (public.assignment_staff_scope(school_id,teacher_id,class_id,subject_id,term_id))
  WITH CHECK (public.assignment_staff_scope(school_id,teacher_id,class_id,subject_id,term_id));
CREATE POLICY learning_assignments_student_read ON public.learning_assignments
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND status IN ('PUBLISHED','CLOSED')
    AND EXISTS (
      SELECT 1 FROM public.assignment_recipients ar
      JOIN public.students st ON st.school_id=ar.school_id AND st.id=ar.student_id
      WHERE ar.school_id=learning_assignments.school_id
        AND ar.assignment_id=learning_assignments.id
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER
    )
  );
CREATE POLICY learning_assignments_parent_read ON public.learning_assignments
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='parent' AND status IN ('PUBLISHED','CLOSED')
    AND EXISTS (
      SELECT 1 FROM public.assignment_recipients ar
      JOIN public.student_parent sp ON sp.school_id=ar.school_id AND sp.student_id=ar.student_id
      JOIN public.parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id
      WHERE ar.school_id=learning_assignments.school_id AND ar.assignment_id=learning_assignments.id
        AND p.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER
    )
  );

CREATE POLICY assignment_recipients_staff_scope ON public.assignment_recipients
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.learning_assignments a
    WHERE a.school_id=assignment_recipients.school_id AND a.id=assignment_recipients.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.learning_assignments a
    WHERE a.school_id=assignment_recipients.school_id AND a.id=assignment_recipients.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_recipients_student_read ON public.assignment_recipients
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND EXISTS (SELECT 1 FROM public.students st WHERE st.school_id=assignment_recipients.school_id
      AND st.id=assignment_recipients.student_id
      AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );
CREATE POLICY assignment_recipients_parent_read ON public.assignment_recipients
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='parent'
    AND EXISTS (SELECT 1 FROM public.student_parent sp JOIN public.parents p
      ON p.school_id=sp.school_id AND p.id=sp.parent_id
      WHERE sp.school_id=assignment_recipients.school_id AND sp.student_id=assignment_recipients.student_id
        AND p.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );

CREATE POLICY assignment_submissions_staff_scope ON public.assignment_submissions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.learning_assignments a
    WHERE a.school_id=assignment_submissions.school_id AND a.id=assignment_submissions.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.learning_assignments a
    WHERE a.school_id=assignment_submissions.school_id AND a.id=assignment_submissions.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_submissions_student_read ON public.assignment_submissions
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND EXISTS (SELECT 1 FROM public.students st WHERE st.school_id=assignment_submissions.school_id
      AND st.id=assignment_submissions.student_id
      AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );
CREATE POLICY assignment_submissions_parent_read ON public.assignment_submissions
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='parent'
    AND EXISTS (SELECT 1 FROM public.student_parent sp JOIN public.parents p
      ON p.school_id=sp.school_id AND p.id=sp.parent_id
      WHERE sp.school_id=assignment_submissions.school_id AND sp.student_id=assignment_submissions.student_id
        AND p.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );
CREATE POLICY assignment_submissions_student_update ON public.assignment_submissions
  FOR UPDATE USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND EXISTS (SELECT 1 FROM public.students st WHERE st.school_id=assignment_submissions.school_id
      AND st.id=assignment_submissions.student_id
      AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  ) WITH CHECK (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND EXISTS (SELECT 1 FROM public.students st WHERE st.school_id=assignment_submissions.school_id
      AND st.id=assignment_submissions.student_id
      AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );

CREATE POLICY assignment_submission_versions_staff_scope ON public.assignment_submission_versions
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    JOIN public.learning_assignments a ON a.school_id=sub.school_id AND a.id=sub.assignment_id
    WHERE sub.school_id=assignment_submission_versions.school_id
      AND sub.id=assignment_submission_versions.submission_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    JOIN public.learning_assignments a ON a.school_id=sub.school_id AND a.id=sub.assignment_id
    WHERE sub.school_id=assignment_submission_versions.school_id
      AND sub.id=assignment_submission_versions.submission_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_submission_versions_student_read ON public.assignment_submission_versions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    WHERE sub.school_id=assignment_submission_versions.school_id
      AND sub.id=assignment_submission_versions.submission_id
      AND sub.student_id IN (SELECT st.id FROM public.students st
        WHERE st.school_id=sub.school_id
          AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
      AND current_setting('app.role',TRUE)='student'
  ));
CREATE POLICY assignment_submission_versions_student_insert ON public.assignment_submission_versions
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    WHERE sub.school_id=assignment_submission_versions.school_id
      AND sub.id=assignment_submission_versions.submission_id
      AND sub.student_id IN (SELECT st.id FROM public.students st
        WHERE st.school_id=sub.school_id
          AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
      AND current_setting('app.role',TRUE)='student'
  ));

CREATE POLICY assignment_attachments_staff_scope ON public.assignment_attachments
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.learning_assignments a WHERE a.school_id=assignment_attachments.school_id
      AND a.id=assignment_attachments.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.learning_assignments a WHERE a.school_id=assignment_attachments.school_id
      AND a.id=assignment_attachments.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_attachments_student_read ON public.assignment_attachments
  FOR SELECT USING (
    current_setting('app.role',TRUE)='student'
    AND EXISTS (
      SELECT 1 FROM public.learning_assignments a
      JOIN public.assignment_recipients ar ON ar.school_id=a.school_id AND ar.assignment_id=a.id
      JOIN public.students st ON st.school_id=ar.school_id AND st.id=ar.student_id
      WHERE a.school_id=assignment_attachments.school_id AND a.id=assignment_attachments.assignment_id
        AND a.status IN ('PUBLISHED','CLOSED')
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER
    )
  );

CREATE POLICY assignment_submission_files_staff_scope ON public.assignment_submission_files
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    JOIN public.learning_assignments a ON a.school_id=sub.school_id AND a.id=sub.assignment_id
    WHERE sub.school_id=assignment_submission_files.school_id
      AND sub.id=assignment_submission_files.submission_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    JOIN public.learning_assignments a ON a.school_id=sub.school_id AND a.id=sub.assignment_id
    WHERE sub.school_id=assignment_submission_files.school_id
      AND sub.id=assignment_submission_files.submission_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_submission_files_student_read ON public.assignment_submission_files
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    WHERE sub.school_id=assignment_submission_files.school_id
      AND sub.id=assignment_submission_files.submission_id
      AND sub.student_id IN (SELECT st.id FROM public.students st WHERE st.school_id=sub.school_id
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
      AND current_setting('app.role',TRUE)='student'
  ));
CREATE POLICY assignment_submission_files_student_insert ON public.assignment_submission_files
  FOR INSERT WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    WHERE sub.school_id=assignment_submission_files.school_id
      AND sub.id=assignment_submission_files.submission_id
      AND sub.student_id IN (SELECT st.id FROM public.students st WHERE st.school_id=sub.school_id
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
      AND current_setting('app.role',TRUE)='student'
  ));
CREATE POLICY assignment_submission_files_student_update ON public.assignment_submission_files
  FOR UPDATE USING (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    WHERE sub.school_id=assignment_submission_files.school_id
      AND sub.id=assignment_submission_files.submission_id
      AND sub.student_id IN (SELECT st.id FROM public.students st WHERE st.school_id=sub.school_id
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
      AND current_setting('app.role',TRUE)='student'
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_submissions sub
    WHERE sub.school_id=assignment_submission_files.school_id
      AND sub.id=assignment_submission_files.submission_id
      AND sub.student_id IN (SELECT st.id FROM public.students st WHERE st.school_id=sub.school_id
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
      AND current_setting('app.role',TRUE)='student'
  ));

CREATE POLICY assignment_marks_staff_scope ON public.assignment_marks
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.learning_assignments a WHERE a.school_id=assignment_marks.school_id
      AND a.id=assignment_marks.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.learning_assignments a WHERE a.school_id=assignment_marks.school_id
      AND a.id=assignment_marks.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_marks_student_read ON public.assignment_marks
  FOR SELECT USING (
    status='RELEASED' AND current_setting('app.role',TRUE)='student'
    AND EXISTS (SELECT 1 FROM public.assignment_submissions sub
      WHERE sub.school_id=assignment_marks.school_id AND sub.id=assignment_marks.submission_id
        AND sub.student_id IN (SELECT st.id FROM public.students st WHERE st.school_id=sub.school_id
          AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER))
  );

-- Keep teacher-only marking notes out of the student-readable mark relation.
CREATE TABLE public.assignment_mark_private_notes (
  school_id INTEGER NOT NULL,
  mark_id BIGINT NOT NULL,
  private_notes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mark_id),
  FOREIGN KEY (mark_id) REFERENCES public.assignment_marks(id) ON DELETE RESTRICT
);
INSERT INTO public.assignment_mark_private_notes(school_id,mark_id,private_notes)
SELECT school_id,id,private_notes FROM public.assignment_marks
WHERE private_notes IS NOT NULL AND private_notes<>'';
ALTER TABLE public.assignment_mark_private_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assignment_mark_private_notes FORCE ROW LEVEL SECURITY;
CREATE POLICY assignment_mark_private_notes_staff_scope ON public.assignment_mark_private_notes
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.assignment_marks mark
    JOIN public.learning_assignments a ON a.school_id=mark.school_id AND a.id=mark.assignment_id
    WHERE mark.school_id=assignment_mark_private_notes.school_id
      AND mark.id=assignment_mark_private_notes.mark_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.assignment_marks mark
    JOIN public.learning_assignments a ON a.school_id=mark.school_id AND a.id=mark.assignment_id
    WHERE mark.school_id=assignment_mark_private_notes.school_id
      AND mark.id=assignment_mark_private_notes.mark_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_marks_parent_read ON public.assignment_marks
  FOR SELECT USING (
    status='RELEASED' AND current_setting('app.role',TRUE)='parent'
    AND EXISTS (SELECT 1 FROM public.assignment_submissions sub
      JOIN public.student_parent sp ON sp.school_id=sub.school_id AND sp.student_id=sub.student_id
      JOIN public.parents p ON p.school_id=sp.school_id AND p.id=sp.parent_id
      WHERE sub.school_id=assignment_marks.school_id AND sub.id=assignment_marks.submission_id
        AND p.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );

CREATE POLICY assignment_audit_log_staff_read ON public.assignment_audit_log
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.learning_assignments a WHERE a.school_id=assignment_audit_log.school_id
      AND a.id=assignment_audit_log.assignment_id
      AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id)
  ));
CREATE POLICY assignment_audit_log_staff_insert ON public.assignment_audit_log
  FOR INSERT WITH CHECK (
    actor_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER
    AND EXISTS (SELECT 1 FROM public.learning_assignments a
      WHERE a.school_id=assignment_audit_log.school_id AND a.id=assignment_audit_log.assignment_id
        AND public.assignment_staff_scope(a.school_id,a.teacher_id,a.class_id,a.subject_id,a.term_id))
  );
CREATE POLICY assignment_audit_log_student_insert ON public.assignment_audit_log
  FOR INSERT WITH CHECK (
    actor_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND EXISTS (SELECT 1 FROM public.assignment_submissions sub
      WHERE sub.school_id=assignment_audit_log.school_id AND sub.assignment_id=assignment_audit_log.assignment_id
        AND sub.student_id IN (SELECT st.id FROM public.students st WHERE st.school_id=sub.school_id
          AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER))
  );

-- The development runtime role has no default privileges for tables created by the migration owner.
-- Grant only the DML needed by the HTTP application; RLS scopes each request to its role and school.
DO $$
DECLARE runtime_role TEXT := 'mccarthy_runtime_70aef860';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
    RAISE EXCEPTION 'Expected restricted runtime role % was not found.', runtime_role;
  END IF;
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.learning_assignments,public.assignment_recipients,public.assignment_submissions,public.assignment_submission_versions,public.assignment_attachments,public.assignment_submission_files,public.assignment_marks,public.assignment_mark_private_notes,public.assignment_audit_log FROM %I', runtime_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.assignment_staff_scope(INTEGER,INTEGER,INTEGER,INTEGER,INTEGER) TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.learning_assignments TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT,DELETE ON public.assignment_recipients TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.assignment_submissions TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT ON public.assignment_submission_versions TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT ON public.assignment_attachments TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.assignment_submission_files TO %I', runtime_role);
  EXECUTE format('REVOKE ALL ON public.assignment_marks FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT (id,school_id,assignment_id,submission_id,version_id,revision,marked_by,score,feedback,status,created_at) ON public.assignment_marks TO %I', runtime_role);
  EXECUTE format('GRANT INSERT (school_id,assignment_id,submission_id,version_id,revision,marked_by,score,feedback,status) ON public.assignment_marks TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT ON public.assignment_mark_private_notes TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT ON public.assignment_audit_log TO %I', runtime_role);
  EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.learning_assignments_id_seq,public.assignment_recipients_id_seq,public.assignment_submissions_id_seq,public.assignment_submission_versions_id_seq,public.assignment_attachments_id_seq,public.assignment_submission_files_id_seq,public.assignment_marks_id_seq,public.assignment_audit_log_id_seq FROM %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.learning_assignments_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_recipients_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_submissions_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_submission_versions_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_attachments_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_submission_files_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_marks_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.assignment_audit_log_id_seq TO %I', runtime_role);
END $$;

INSERT INTO public.app_schema_migrations(migration_name)
VALUES ('20261127_assignment_database_authorization')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
