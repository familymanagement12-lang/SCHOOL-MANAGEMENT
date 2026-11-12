BEGIN;

ALTER TABLE results
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS curriculum TEXT;

UPDATE results r
SET class_id = s.class_id,
    curriculum = COALESCE(s.curriculum, 'UNASSIGNED')
FROM students s
WHERE s.id = r.student_id AND s.school_id = r.school_id
  AND (r.class_id IS NULL OR r.curriculum IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'results_curriculum_check') THEN
    ALTER TABLE results ADD CONSTRAINT results_curriculum_check
      CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON', 'UNASSIGNED'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION set_result_curriculum_snapshot() RETURNS trigger AS $$
DECLARE
  student_class INTEGER;
  student_curriculum TEXT;
BEGIN
  SELECT class_id, curriculum INTO student_class, student_curriculum
  FROM students WHERE id = NEW.student_id AND school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found in this school.';
  END IF;
  NEW.class_id := student_class;
  NEW.curriculum := COALESCE(student_curriculum, 'UNASSIGNED');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS results_set_curriculum_snapshot ON results;
CREATE TRIGGER results_set_curriculum_snapshot
  BEFORE INSERT OR UPDATE OF student_id, school_id ON results
  FOR EACH ROW EXECUTE FUNCTION set_result_curriculum_snapshot();

CREATE INDEX IF NOT EXISTS idx_results_published_student
  ON results (school_id, student_id, term, is_published);
CREATE INDEX IF NOT EXISTS idx_results_curriculum_student
  ON results (school_id, student_id, curriculum, term);

CREATE TABLE IF NOT EXISTS student_portal_audit_log (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('ACCOUNT_ACTIVATED', 'ACCOUNT_DEACTIVATED', 'PASSWORD_RESET', 'RESULTS_PUBLISHED', 'RESULTS_UNPUBLISHED')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_student_portal_audit_student
  ON student_portal_audit_log (school_id, student_id, created_at DESC);

COMMIT;
