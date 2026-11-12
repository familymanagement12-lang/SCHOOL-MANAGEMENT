BEGIN;

CREATE TABLE IF NOT EXISTS app_schema_migrations (
  migration_name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app_schema_migrations
    WHERE migration_name = '20261111_class_assessments'
  ) THEN
    UPDATE results
    SET class_score = ROUND(COALESCE(class_score, 0) * 1.25, 2),
        exam_score = ROUND(COALESCE(exam_score, 0) * (5.0 / 6.0), 2),
        score = ROUND(COALESCE(class_score, 0) * 1.25, 2)
              + ROUND(COALESCE(exam_score, 0) * (5.0 / 6.0), 2);
    INSERT INTO app_schema_migrations (migration_name)
    VALUES ('20261111_class_assessments');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS class_assessments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  term TEXT NOT NULL,
  title TEXT NOT NULL,
  assessment_type TEXT NOT NULL CHECK (assessment_type IN ('exercise', 'midterm')),
  max_score NUMERIC(7,2) NOT NULL CHECK (max_score > 0),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id, subject, term, title)
);

CREATE INDEX IF NOT EXISTS idx_class_assessments_lookup
  ON class_assessments (school_id, class_id, subject, term);

CREATE TABLE IF NOT EXISTS class_assessment_scores (
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  assessment_id INTEGER NOT NULL REFERENCES class_assessments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  score NUMERIC(7,2) NOT NULL CHECK (score >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assessment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_class_assessment_scores_school_student
  ON class_assessment_scores (school_id, student_id);

COMMIT;
