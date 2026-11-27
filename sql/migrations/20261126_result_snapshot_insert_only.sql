CREATE OR REPLACE FUNCTION set_result_curriculum_snapshot() RETURNS trigger AS $$
DECLARE
  student_class INTEGER;
  validated_class INTEGER;
  student_curriculum TEXT;
  snapshot_name TEXT;
  snapshot_year INTEGER;
  snapshot_academic_year TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT s.class_id, COALESCE(s.curriculum, 'UNASSIGNED'), sc.academic_year
  INTO student_class, student_curriculum, snapshot_academic_year
  FROM students s
  JOIN schools sc ON sc.id = s.school_id
  WHERE s.id = NEW.student_id AND s.school_id = NEW.school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found in this school.';
  END IF;

  IF student_class IS NOT NULL THEN
    SELECT c.id,
           canonical_curriculum_class_name(c.name, c.year_level, c.curriculum, c.education_stage),
           c.year_level
    INTO validated_class, snapshot_name, snapshot_year
    FROM classes c
    WHERE c.id = student_class AND c.school_id = NEW.school_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Student class % does not exist in this school.', student_class;
    END IF;
  END IF;

  NEW.class_id := validated_class;
  NEW.curriculum := student_curriculum;
  NEW.class_name_snapshot := snapshot_name;
  NEW.year_level_snapshot := snapshot_year;
  NEW.academic_year_snapshot := snapshot_academic_year;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS results_set_curriculum_snapshot ON results;
CREATE TRIGGER results_set_curriculum_snapshot
  BEFORE INSERT ON results
  FOR EACH ROW EXECUTE FUNCTION set_result_curriculum_snapshot();
