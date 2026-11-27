CREATE TABLE IF NOT EXISTS timetable_terms (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL CHECK (term IN ('Term 1', 'Term 2', 'Term 3')),
  subject_teaching_starts_from TEXT DEFAULT 'Class 4',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, academic_year, term),
  UNIQUE (school_id, id)
);
ALTER TABLE timetable_terms ADD COLUMN IF NOT EXISTS subject_teaching_starts_from TEXT DEFAULT 'Class 4';
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_terms_scope_ref ON timetable_terms (school_id, academic_year, term, id);

UPDATE timetable_versions SET term = CASE
  WHEN term IN ('Term 1','Term 2','Term 3') THEN term
  WHEN lower(term) LIKE '%first%' THEN 'Term 1'
  WHEN lower(term) LIKE '%second%' THEN 'Term 2'
  WHEN lower(term) LIKE '%third%' THEN 'Term 3'
  ELSE 'Term 1' END;

INSERT INTO timetable_terms (school_id, academic_year, term)
SELECT id, COALESCE(NULLIF(academic_year, ''), 'Unassigned'),
       CASE WHEN current_term IN ('Term 1', 'Term 2', 'Term 3') THEN current_term ELSE 'Term 1' END
FROM schools
ON CONFLICT (school_id, academic_year, term) DO NOTHING;

INSERT INTO timetable_terms (school_id, academic_year, term)
SELECT school_id, academic_year, term FROM timetable_versions
ON CONFLICT (school_id, academic_year, term) DO NOTHING;

ALTER TABLE timetable_versions ADD COLUMN IF NOT EXISTS term_id INTEGER;
UPDATE timetable_versions v SET term_id = tt.id
FROM timetable_terms tt
WHERE v.term_id IS NULL AND tt.school_id = v.school_id
  AND tt.academic_year = v.academic_year AND tt.term = v.term;
ALTER TABLE timetable_versions ALTER COLUMN term_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_versions_school_term_fk') THEN
    ALTER TABLE timetable_versions ADD CONSTRAINT timetable_versions_school_term_fk
      FOREIGN KEY (school_id, term_id) REFERENCES timetable_terms(school_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_versions_term_ref
  ON timetable_versions (school_id, id, academic_year, term, term_id);

ALTER TABLE timetables ADD COLUMN IF NOT EXISTS term_id INTEGER;
UPDATE timetables t SET term_id = v.term_id, academic_year = v.academic_year, term = v.term
FROM timetable_versions v WHERE t.version_id = v.id AND t.school_id = v.school_id;
ALTER TABLE timetables ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE timetables ALTER COLUMN academic_year SET NOT NULL;
ALTER TABLE timetables ALTER COLUMN term SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetables_school_term_fk') THEN
    ALTER TABLE timetables ADD CONSTRAINT timetables_school_term_fk
      FOREIGN KEY (school_id, term_id) REFERENCES timetable_terms(school_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetables_version_term_scope_fk') THEN
    ALTER TABLE timetables DROP CONSTRAINT IF EXISTS timetables_version_school_fk;
    ALTER TABLE timetables ADD CONSTRAINT timetables_version_term_scope_fk
      FOREIGN KEY (school_id, version_id, academic_year, term, term_id)
      REFERENCES timetable_versions(school_id, id, academic_year, term, term_id) ON DELETE RESTRICT;
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_audit_version_restrict_fk') THEN
    ALTER TABLE timetable_audit_log DROP CONSTRAINT IF EXISTS timetable_audit_log_version_id_fkey;
    ALTER TABLE timetable_audit_log ADD CONSTRAINT timetable_audit_version_restrict_fk
      FOREIGN KEY (school_id, version_id) REFERENCES timetable_versions(school_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE timetable_periods ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE teacher_subject_assignments ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE teacher_availability ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE class_availability ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE room_availability ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE subject_weekly_requirements ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE teacher_workload_limits ADD COLUMN IF NOT EXISTS term_id INTEGER;
ALTER TABLE timetables ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS timetable_class_teacher_assignments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  term_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE RESTRICT,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, term_id, class_id),
  FOREIGN KEY (school_id, term_id) REFERENCES timetable_terms(school_id, id) ON DELETE RESTRICT
);
INSERT INTO timetable_class_teacher_assignments (school_id, term_id, class_id, teacher_id)
SELECT tt.school_id, tt.id, c.id, c.class_teacher_id FROM timetable_terms tt
JOIN classes c ON c.school_id = tt.school_id AND c.class_teacher_id IS NOT NULL
ON CONFLICT (school_id, term_id, class_id) DO NOTHING;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['timetable_periods','teacher_subject_assignments','teacher_availability',
    'class_availability','room_availability','subject_weekly_requirements','teacher_workload_limits'] LOOP
    EXECUTE format(
      'UPDATE %I x SET term_id = tt.id FROM schools s JOIN timetable_terms tt ON tt.school_id = s.id AND tt.academic_year = COALESCE(NULLIF(s.academic_year, ''''), ''Unassigned'') AND tt.term = CASE WHEN s.current_term IN (''Term 1'',''Term 2'',''Term 3'') THEN s.current_term ELSE ''Term 1'' END WHERE x.term_id IS NULL AND x.school_id = s.id',
      tbl
    );
  END LOOP;
END $$;

ALTER TABLE timetable_periods ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE teacher_subject_assignments ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE teacher_availability ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE class_availability ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE room_availability ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE subject_weekly_requirements ALTER COLUMN term_id SET NOT NULL;
ALTER TABLE teacher_workload_limits ALTER COLUMN term_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_periods_term_ref ON timetable_periods (school_id, term_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetables_period_term_scope_fk') THEN
    ALTER TABLE timetables DROP CONSTRAINT IF EXISTS timetables_period_id_fkey;
    ALTER TABLE timetables ADD CONSTRAINT timetables_period_term_scope_fk
      FOREIGN KEY (school_id, term_id, period_id) REFERENCES timetable_periods(school_id, term_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['timetable_periods','teacher_subject_assignments','teacher_availability',
    'class_availability','room_availability','subject_weekly_requirements','teacher_workload_limits'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_school_term_fk') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (school_id, term_id) REFERENCES timetable_terms(school_id, id) ON DELETE RESTRICT', tbl, tbl || '_school_term_fk');
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  old_definition TEXT;
  term_definition TEXT;
  alternate_name TEXT;
  alternate_definition TEXT;
BEGIN
  SELECT unique_object.object_name, unique_object.definition
  INTO alternate_name, alternate_definition
  FROM (
    SELECT c.conname AS object_name,
           pg_get_constraintdef(c.oid) AS definition,
           ARRAY(
             SELECT a.attname::TEXT
             FROM unnest(c.conkey) AS key(attnum)
             JOIN pg_attribute a
               ON a.attrelid = c.conrelid AND a.attnum = key.attnum
             ORDER BY a.attname
           ) AS key_columns,
           TRUE AS is_constraint
    FROM pg_constraint c
    WHERE c.conrelid = 'public.teacher_subject_assignments'::regclass
      AND c.contype = 'u'
    UNION ALL
    SELECT index_class.relname AS object_name,
           pg_get_indexdef(i.indexrelid) AS definition,
           ARRAY(
             SELECT a.attname::TEXT
             FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinal)
             JOIN pg_attribute a
               ON a.attrelid = i.indrelid AND a.attnum = key.attnum
             WHERE key.ordinal <= i.indnkeyatts
             ORDER BY a.attname
           ) AS key_columns,
           FALSE AS is_constraint
    FROM pg_index i
    JOIN pg_class index_class ON index_class.oid = i.indexrelid
    WHERE i.indrelid = 'public.teacher_subject_assignments'::regclass
      AND i.indisunique
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid
      )
  ) unique_object
  WHERE unique_object.key_columns =
        ARRAY['class_id', 'school_id', 'subject_id', 'teacher_id']::TEXT[]
    AND NOT (
      unique_object.is_constraint
      AND unique_object.object_name = 'teacher_subject_assignments_school_id_teacher_id_subject_id_key'
    )
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Equivalent legacy teacher-subject uniqueness exists under unexpected object "%": observed "%". Expected only the known constraint teacher_subject_assignments_school_id_teacher_id_subject_id_key with definition "UNIQUE (school_id, teacher_id, subject_id, class_id)"; no unknown object was dropped.',
      alternate_name, alternate_definition;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO old_definition
  FROM pg_constraint
  WHERE conrelid = 'public.teacher_subject_assignments'::regclass
    AND conname = 'teacher_subject_assignments_school_id_teacher_id_subject_id_key'
    AND contype = 'u';

  IF old_definition = 'UNIQUE (school_id, teacher_id, subject_id, class_id)' THEN
    ALTER TABLE public.teacher_subject_assignments
      DROP CONSTRAINT teacher_subject_assignments_school_id_teacher_id_subject_id_key;
  ELSIF old_definition IS NOT NULL THEN
    RAISE EXCEPTION
      'Constraint teacher_subject_assignments_school_id_teacher_id_subject_id_key has an unexpected definition; manual review is required.';
  END IF;

  SELECT pg_get_constraintdef(oid) INTO term_definition
  FROM pg_constraint
  WHERE conrelid = 'public.teacher_subject_assignments'::regclass
    AND conname = 'teacher_subject_assignments_term_unique'
    AND contype = 'u';

  IF term_definition IS NULL THEN
    ALTER TABLE public.teacher_subject_assignments
      ADD CONSTRAINT teacher_subject_assignments_term_unique
      UNIQUE (school_id, term_id, teacher_id, subject_id, class_id);
  ELSIF term_definition <> 'UNIQUE (school_id, term_id, teacher_id, subject_id, class_id)' THEN
    RAISE EXCEPTION
      'Constraint teacher_subject_assignments_term_unique has an unexpected definition; manual review is required.';
  END IF;
END
$$;
ALTER TABLE subject_weekly_requirements DROP CONSTRAINT IF EXISTS subject_weekly_requirements_school_id_class_id_subject_id_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subject_weekly_requirements_term_unique') THEN
    ALTER TABLE subject_weekly_requirements ADD CONSTRAINT subject_weekly_requirements_term_unique UNIQUE (school_id, term_id, class_id, subject_id);
  END IF;
END $$;
ALTER TABLE teacher_workload_limits DROP CONSTRAINT IF EXISTS teacher_workload_limits_school_id_teacher_id_key;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teacher_workload_limits_term_unique') THEN
    ALTER TABLE teacher_workload_limits ADD CONSTRAINT teacher_workload_limits_term_unique UNIQUE (school_id, term_id, teacher_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_timetable_periods_term ON timetable_periods (school_id, term_id, day_of_week, sort_order, start_time);
CREATE INDEX IF NOT EXISTS idx_timetable_assignments_term ON teacher_subject_assignments (school_id, term_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_timetable_requirements_term ON subject_weekly_requirements (school_id, term_id, class_id);

ALTER TABLE timetable_generation_runs ADD COLUMN IF NOT EXISTS term_id INTEGER;
INSERT INTO timetable_terms (school_id, academic_year, term)
SELECT r.school_id, COALESCE(NULLIF(r.academic_year, ''), s.academic_year, 'Unassigned'),
       CASE WHEN r.term IN ('Term 1','Term 2','Term 3') THEN r.term
            WHEN lower(r.term) LIKE '%first%' THEN 'Term 1'
            WHEN lower(r.term) LIKE '%second%' THEN 'Term 2'
            WHEN lower(r.term) LIKE '%third%' THEN 'Term 3'
            WHEN s.current_term IN ('Term 1','Term 2','Term 3') THEN s.current_term ELSE 'Term 1' END
FROM timetable_generation_runs r JOIN schools s ON s.id = r.school_id
ON CONFLICT (school_id, academic_year, term) DO NOTHING;
UPDATE timetable_generation_runs r SET term_id = tt.id FROM timetable_terms tt
WHERE r.term_id IS NULL AND tt.school_id = r.school_id
 AND tt.academic_year = r.academic_year AND tt.term = r.term;
UPDATE timetable_generation_runs r SET academic_year = COALESCE(NULLIF(r.academic_year, ''), s.academic_year, 'Unassigned'),
  term = CASE WHEN r.term IN ('Term 1','Term 2','Term 3') THEN r.term
       WHEN lower(r.term) LIKE '%first%' THEN 'Term 1'
       WHEN lower(r.term) LIKE '%second%' THEN 'Term 2'
       WHEN lower(r.term) LIKE '%third%' THEN 'Term 3'
       WHEN s.current_term IN ('Term 1','Term 2','Term 3') THEN s.current_term ELSE 'Term 1' END
FROM schools s WHERE r.school_id = s.id AND r.term_id IS NULL;
UPDATE timetable_generation_runs r SET term_id = tt.id FROM timetable_terms tt
WHERE r.term_id IS NULL AND tt.school_id = r.school_id
 AND tt.academic_year = COALESCE(r.academic_year, 'Unassigned') AND tt.term = COALESCE(r.term, 'Term 1');
ALTER TABLE timetable_generation_runs ALTER COLUMN term_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_runs_school_term_fk') THEN
    ALTER TABLE timetable_generation_runs ADD CONSTRAINT timetable_runs_school_term_fk
      FOREIGN KEY (school_id, term_id) REFERENCES timetable_terms(school_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE timetables ADD COLUMN IF NOT EXISTS class_name_snapshot TEXT;
ALTER TABLE timetables ADD COLUMN IF NOT EXISTS subject_name_snapshot TEXT;
ALTER TABLE timetables ADD COLUMN IF NOT EXISTS teacher_name_snapshot TEXT;
ALTER TABLE timetables ADD COLUMN IF NOT EXISTS room_name_snapshot TEXT;
UPDATE timetables t SET
  class_name_snapshot = COALESCE(t.class_name_snapshot, (SELECT c.name FROM classes c WHERE c.id = t.class_id)),
  subject_name_snapshot = COALESCE(t.subject_name_snapshot, (SELECT s.name FROM subjects s WHERE s.id = t.subject_id), t.subject),
  teacher_name_snapshot = COALESCE(t.teacher_name_snapshot, (SELECT u.name FROM users u WHERE u.id = t.teacher_id)),
  room_name_snapshot = COALESCE(t.room_name_snapshot, (SELECT r.name FROM timetable_rooms r WHERE r.id = t.room_id));

ALTER TABLE timetables ALTER COLUMN class_id DROP NOT NULL;
ALTER TABLE timetables DROP CONSTRAINT IF EXISTS timetables_class_id_fkey;
ALTER TABLE timetables ADD CONSTRAINT timetables_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL;
