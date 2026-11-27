BEGIN;

CREATE TABLE IF NOT EXISTS app_schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_school_id_id_unique_idx
  ON users (school_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS classes_school_id_id_unique_idx
  ON classes (school_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS subjects_school_id_id_unique_idx
  ON subjects (school_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS students_school_id_id_unique_idx
  ON students (school_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS timetable_terms_school_year_term_id_unique_idx
  ON timetable_terms (school_id, academic_year, term, id);

CREATE TABLE IF NOT EXISTS learning_assignments (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  term_id INTEGER NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  instructions TEXT NOT NULL CHECK (length(trim(instructions)) > 0),
  category TEXT NOT NULL CHECK (category IN
    ('homework','classwork','project','research','practical','revision','test','other')),
  issue_at TIMESTAMPTZ,
  due_at TIMESTAMPTZ NOT NULL,
  total_marks NUMERIC(8,2) NOT NULL CHECK (total_marks > 0),
  submission_method TEXT NOT NULL CHECK (submission_method IN ('online','file','both')),
  allow_late BOOLEAN NOT NULL DEFAULT FALSE,
  allow_resubmission BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','CLOSED','CANCELLED')),
  published_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, teacher_id) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, subject_id) REFERENCES subjects(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, academic_year, term, term_id)
    REFERENCES timetable_terms(school_id, academic_year, term, id) ON DELETE RESTRICT,
  UNIQUE (school_id, id),
  UNIQUE (school_id, id, class_id)
);

CREATE INDEX IF NOT EXISTS learning_assignments_teacher_term_idx
  ON learning_assignments (school_id, teacher_id, term_id, status, due_at);
CREATE INDEX IF NOT EXISTS learning_assignments_class_term_idx
  ON learning_assignments (school_id, class_id, term_id, status, due_at);

CREATE TABLE IF NOT EXISTS assignment_recipients (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  assignment_id BIGINT NOT NULL,
  class_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, assignment_id, class_id)
    REFERENCES learning_assignments(school_id, id, class_id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, class_id) REFERENCES classes(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT,
  UNIQUE (school_id, assignment_id, student_id),
  UNIQUE (school_id, assignment_id, id)
);

CREATE INDEX IF NOT EXISTS assignment_recipients_student_idx
  ON assignment_recipients (school_id, student_id, assignment_id);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  assignment_id BIGINT NOT NULL,
  recipient_id BIGINT NOT NULL,
  student_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN
    ('ASSIGNED','VIEWED','DRAFT','SUBMITTED','SUBMITTED_LATE','AWAITING_MARKING',
     'MARKED','RETURNED','RESUBMISSION_REQUESTED','OVERDUE','EXCUSED')),
  draft_answer TEXT NOT NULL DEFAULT '',
  viewed_at TIMESTAMPTZ,
  latest_version INTEGER NOT NULL DEFAULT 0 CHECK (latest_version >= 0),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, assignment_id, recipient_id)
    REFERENCES assignment_recipients(school_id, assignment_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, assignment_id, student_id)
    REFERENCES assignment_recipients(school_id, assignment_id, student_id) ON DELETE RESTRICT,
  UNIQUE (school_id, id),
  UNIQUE (school_id, assignment_id, student_id),
  UNIQUE (school_id, assignment_id, id)
);

CREATE TABLE IF NOT EXISTS assignment_submission_versions (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  submission_id BIGINT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  answer TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ NOT NULL,
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, submission_id)
    REFERENCES assignment_submissions(school_id, id) ON DELETE RESTRICT,
  UNIQUE (school_id, id),
  UNIQUE (school_id, submission_id, version_number),
  UNIQUE (school_id, id, submission_id)
);

CREATE INDEX IF NOT EXISTS assignment_submission_versions_latest_idx
  ON assignment_submission_versions (school_id, submission_id, version_number DESC);

CREATE TABLE IF NOT EXISTS assignment_attachments (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  assignment_id BIGINT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  uploaded_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, assignment_id)
    REFERENCES learning_assignments(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, uploaded_by) REFERENCES users(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS assignment_submission_files (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  assignment_id BIGINT NOT NULL,
  submission_id BIGINT NOT NULL,
  version_id BIGINT,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, assignment_id, submission_id)
    REFERENCES assignment_submissions(school_id, assignment_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, version_id, submission_id)
    REFERENCES assignment_submission_versions(school_id, id, submission_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS assignment_submission_files_lookup_idx
  ON assignment_submission_files (school_id, assignment_id, submission_id, version_id);

CREATE TABLE IF NOT EXISTS assignment_marks (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  assignment_id BIGINT NOT NULL,
  submission_id BIGINT NOT NULL,
  version_id BIGINT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  marked_by INTEGER NOT NULL,
  score NUMERIC(8,2) NOT NULL CHECK (score >= 0),
  feedback TEXT NOT NULL DEFAULT '',
  private_notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('DRAFT','RELEASED','RESUBMISSION_REQUESTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, assignment_id, submission_id)
    REFERENCES assignment_submissions(school_id, assignment_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, version_id, submission_id)
    REFERENCES assignment_submission_versions(school_id, id, submission_id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, marked_by) REFERENCES users(school_id, id) ON DELETE RESTRICT,
  UNIQUE (school_id, submission_id, revision)
);

CREATE INDEX IF NOT EXISTS assignment_marks_submission_idx
  ON assignment_marks (school_id, submission_id, revision DESC);

CREATE TABLE IF NOT EXISTS assignment_audit_log (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assignment_id BIGINT NOT NULL,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN
    ('CREATED','UPDATED','PUBLISHED','CLOSED','SUBMISSION_SAVED','SUBMITTED',
     'RESUBMITTED','MARKED','FEEDBACK_RELEASED','RESUBMISSION_REQUESTED')),
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id, assignment_id)
    REFERENCES learning_assignments(school_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id, actor_id) REFERENCES users(school_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS assignment_audit_log_history_idx
  ON assignment_audit_log (school_id, assignment_id, created_at DESC);

DO $$
DECLARE
  table_name TEXT;
  policy_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'learning_assignments',
    'assignment_recipients',
    'assignment_submissions',
    'assignment_submission_versions',
    'assignment_attachments',
    'assignment_submission_files',
    'assignment_marks',
    'assignment_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    policy_name := table_name || '_school_scope';
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER) WITH CHECK (school_id = NULLIF(current_setting(''app.school_id'', TRUE), '''')::INTEGER)',
        policy_name, table_name
      );
    END IF;
  END LOOP;
END $$;

INSERT INTO app_schema_migrations (migration_name)
VALUES ('20261126_learning_assignments')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
