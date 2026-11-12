BEGIN;

UPDATE timetable_generation_runs r SET
  academic_year = COALESCE(NULLIF(r.academic_year, ''), tt.academic_year),
  term = COALESCE(NULLIF(r.term, ''), tt.term)
FROM timetable_terms tt
WHERE tt.school_id = r.school_id AND tt.id = r.term_id
  AND (r.academic_year IS NULL OR r.academic_year = '' OR r.term IS NULL OR r.term = '');
ALTER TABLE timetable_generation_runs ALTER COLUMN academic_year SET NOT NULL;
ALTER TABLE timetable_generation_runs ALTER COLUMN term SET NOT NULL;

-- Keep the denormalized labels on a version consistent with its canonical
-- academic-year/term record, rather than merely checking school and term id.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_versions_full_term_scope_fk') THEN
    ALTER TABLE timetable_versions ADD CONSTRAINT timetable_versions_full_term_scope_fk
      FOREIGN KEY (school_id, academic_year, term, term_id)
      REFERENCES timetable_terms(school_id, academic_year, term, id) ON DELETE RESTRICT;
  END IF;
END $$;

-- Generation runs are retained as history and must point at the same term
-- named in their report metadata.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_runs_full_term_scope_fk') THEN
    ALTER TABLE timetable_generation_runs ADD CONSTRAINT timetable_runs_full_term_scope_fk
      FOREIGN KEY (school_id, academic_year, term, term_id)
      REFERENCES timetable_terms(school_id, academic_year, term, id) ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
