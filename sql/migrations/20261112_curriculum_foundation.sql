BEGIN;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS curriculum TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS curriculum TEXT;

UPDATE classes
SET curriculum = CASE
  WHEN year_level BETWEEN 1 AND 6 THEN 'COMMON'
  WHEN year_level BETWEEN 7 AND 9 THEN 'UNASSIGNED'
  WHEN year_level BETWEEN 10 AND 11 THEN 'PEARSON'
  ELSE 'UNASSIGNED'
END
WHERE curriculum IS NULL;

UPDATE students st
SET curriculum = COALESCE(c.curriculum, 'UNASSIGNED')
FROM classes c
WHERE st.class_id = c.id AND st.curriculum IS NULL;
UPDATE students SET curriculum = 'UNASSIGNED' WHERE curriculum IS NULL;

ALTER TABLE classes ALTER COLUMN curriculum SET DEFAULT 'UNASSIGNED';
ALTER TABLE students ALTER COLUMN curriculum SET DEFAULT 'UNASSIGNED';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_curriculum_check') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_curriculum_check
      CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON', 'UNASSIGNED'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_curriculum_check') THEN
    ALTER TABLE students ADD CONSTRAINT students_curriculum_check
      CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON', 'UNASSIGNED'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION validate_school_curriculum() RETURNS trigger AS $$
BEGIN
  IF NEW.year_level IS NULL THEN
    NEW.curriculum := COALESCE(NEW.curriculum, 'UNASSIGNED');
    RETURN NEW;
  END IF;
  IF NEW.year_level < 1 OR NEW.year_level > 11 THEN
    RAISE EXCEPTION 'Year level must be between 1 and 11.';
  END IF;
  IF NEW.year_level <= 6 THEN
    IF NEW.curriculum IS NOT NULL AND NEW.curriculum NOT IN ('COMMON', 'UNASSIGNED') THEN
      RAISE EXCEPTION 'Years 1–6 use the common school curriculum.';
    END IF;
    NEW.curriculum := 'COMMON';
  ELSIF NEW.year_level <= 9 THEN
    IF NEW.curriculum IS NULL OR NEW.curriculum NOT IN ('GES', 'PEARSON') THEN
      IF TG_OP = 'UPDATE' AND OLD.curriculum = 'UNASSIGNED'
         AND NEW.curriculum = 'UNASSIGNED' AND NEW.year_level = OLD.year_level THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Years 7–9 require either GES or Pearson curriculum.';
    END IF;
  ELSE
    IF NEW.curriculum = 'GES' OR NEW.curriculum = 'COMMON' THEN
      RAISE EXCEPTION 'Years 10–11 use Pearson curriculum only.';
    END IF;
    NEW.curriculum := 'PEARSON';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_validate_curriculum ON classes;
CREATE TRIGGER classes_validate_curriculum
  BEFORE INSERT OR UPDATE OF year_level, curriculum ON classes
  FOR EACH ROW EXECUTE FUNCTION validate_school_curriculum();

CREATE OR REPLACE FUNCTION sync_student_curriculum() RETURNS trigger AS $$
DECLARE
  class_year INTEGER;
  class_curriculum TEXT;
BEGIN
  IF NEW.class_id IS NULL THEN
    IF NEW.curriculum IS NOT NULL AND NEW.curriculum <> 'UNASSIGNED' THEN
      RAISE EXCEPTION 'Assign a class before assigning a curriculum.';
    END IF;
    NEW.curriculum := 'UNASSIGNED';
    RETURN NEW;
  END IF;

  SELECT year_level, curriculum INTO class_year, class_curriculum
  FROM classes WHERE id = NEW.class_id AND school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found in this school.';
  END IF;
  IF class_year BETWEEN 7 AND 9 AND class_curriculum = 'UNASSIGNED' THEN
    IF TG_OP = 'UPDATE' AND OLD.class_id = NEW.class_id
       AND OLD.curriculum = 'UNASSIGNED' THEN
      NEW.curriculum := 'UNASSIGNED';
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Set this class to GES or Pearson before assigning students.';
  END IF;
  IF NEW.curriculum IS NOT NULL
     AND NEW.curriculum NOT IN (class_curriculum, 'UNASSIGNED') THEN
    RAISE EXCEPTION 'Student curriculum must match the assigned class curriculum.';
  END IF;
  NEW.curriculum := class_curriculum;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS students_sync_curriculum ON students;
CREATE TRIGGER students_sync_curriculum
  BEFORE INSERT OR UPDATE OF school_id, class_id, curriculum ON students
  FOR EACH ROW EXECUTE FUNCTION sync_student_curriculum();

CREATE OR REPLACE FUNCTION sync_class_student_curriculum() RETURNS trigger AS $$
BEGIN
  IF NEW.curriculum IS DISTINCT FROM OLD.curriculum THEN
    UPDATE students SET curriculum = NEW.curriculum
    WHERE school_id = NEW.school_id AND class_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_sync_student_curriculum ON classes;
CREATE TRIGGER classes_sync_student_curriculum
  AFTER UPDATE OF curriculum ON classes
  FOR EACH ROW EXECUTE FUNCTION sync_class_student_curriculum();

CREATE TABLE IF NOT EXISTS curriculum_subjects (
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  curriculum TEXT NOT NULL CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON')),
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, curriculum, subject_id)
);

INSERT INTO curriculum_subjects (school_id, curriculum, subject_id)
SELECT school_id, 'COMMON', id FROM subjects
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_curriculum_subjects_lookup
  ON curriculum_subjects (school_id, curriculum, subject_id);

CREATE TABLE IF NOT EXISTS curriculum_grading_configurations (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  curriculum TEXT NOT NULL CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON')),
  academic_year TEXT NOT NULL,
  configuration JSONB NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, curriculum, academic_year)
);

COMMIT;
