ALTER TABLE classes ALTER COLUMN class_teacher_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION validate_class_teacher_assignment() RETURNS trigger AS $$
BEGIN
  IF NEW.class_teacher_id IS NULL THEN
    NEW.teacher_id := NULL;
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.class_teacher_id AND school_id = NEW.school_id
      AND role = 'teacher' AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Class teacher must be an active teacher in the same school.';
  END IF;
  NEW.teacher_id := NEW.class_teacher_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
