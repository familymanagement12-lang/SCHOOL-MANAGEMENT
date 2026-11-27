ALTER TABLE classes ADD COLUMN IF NOT EXISTS curriculum TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS curriculum TEXT;

UPDATE classes
SET curriculum = 'UNASSIGNED'
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
DECLARE
  stage TEXT := COALESCE(NULLIF(to_jsonb(NEW)->>'education_stage', ''), 'UNASSIGNED');
  class_year INTEGER := NULLIF(to_jsonb(NEW)->>'year_level', '')::INTEGER;
  model TEXT := COALESCE(NULLIF(to_jsonb(NEW)->>'teaching_model', ''), '');
BEGIN
  IF class_year IS NOT NULL AND (class_year < 1 OR class_year > 11) THEN
    RAISE EXCEPTION 'Year level must be between 1 and 11.';
  END IF;
  NEW.curriculum := COALESCE(NULLIF(BTRIM(NEW.curriculum), ''), 'UNASSIGNED');

  IF stage = 'PRIMARY' THEN
    IF class_year IS NULL OR class_year NOT BETWEEN 1 AND 6 THEN
      RAISE EXCEPTION 'Primary classes require a confirmed year level from 1 to 6.';
    END IF;
    IF NULLIF(to_jsonb(NEW)->>'class_teacher_id', '') IS NULL THEN
      RAISE EXCEPTION 'Every Primary class requires an assigned class teacher.';
    END IF;
    IF class_year <= 3 AND model <> 'class_teacher' THEN
      RAISE EXCEPTION 'Primary years 1 to 3 use the class-teacher teaching model.';
    END IF;
  ELSIF stage = 'EARLY_YEARS' THEN
    IF class_year IS NOT NULL THEN
      RAISE EXCEPTION 'Early Years classes do not use a numeric year level.';
    END IF;
  ELSIF stage = 'JHS' THEN
    IF class_year IS NULL OR class_year NOT BETWEEN 7 AND 9 THEN
      RAISE EXCEPTION 'JHS classes require a confirmed level from 7 to 9.';
    END IF;
    IF model <> 'subject_teacher' THEN
      RAISE EXCEPTION 'JHS classes use the subject-teacher teaching model.';
    END IF;
  ELSIF stage NOT IN ('EARLY_YEARS', 'OTHER', 'UNASSIGNED') THEN
    RAISE EXCEPTION 'Select a supported education section.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS classes_validate_curriculum ON classes;
CREATE TRIGGER classes_validate_curriculum
  BEFORE INSERT OR UPDATE OF curriculum ON classes
  FOR EACH ROW EXECUTE FUNCTION validate_school_curriculum();

CREATE OR REPLACE FUNCTION sync_student_curriculum() RETURNS trigger AS $$
DECLARE
  class_curriculum TEXT;
  class_stage TEXT;
BEGIN
  IF NEW.class_id IS NULL THEN
    IF NEW.curriculum IS NOT NULL AND NEW.curriculum <> 'UNASSIGNED' THEN
      RAISE EXCEPTION 'Assign a class before assigning a curriculum.';
    END IF;
    NEW.curriculum := 'UNASSIGNED';
    RETURN NEW;
  END IF;

  SELECT curriculum,
         COALESCE(NULLIF(to_jsonb(c)->>'education_stage', ''), 'UNASSIGNED')
  INTO class_curriculum, class_stage
  FROM classes c
  WHERE c.id = NEW.class_id AND c.school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found in this school.';
  END IF;
  IF class_stage = 'JHS' AND class_curriculum = 'UNASSIGNED' THEN
    IF TG_OP = 'UPDATE' AND OLD.class_id = NEW.class_id
       AND OLD.curriculum = 'UNASSIGNED' THEN
      NEW.curriculum := 'UNASSIGNED';
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Assign an explicit curriculum to this JHS class before assigning students.';
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

DROP TRIGGER IF EXISTS classes_sync_student_curriculum ON classes;
DROP FUNCTION IF EXISTS sync_class_student_curriculum();

CREATE TABLE IF NOT EXISTS curriculum_subjects (
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  curriculum TEXT NOT NULL CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON')),
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (school_id, curriculum, subject_id)
);

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
