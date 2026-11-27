CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS year_level INTEGER,
  ADD COLUMN IF NOT EXISTS teaching_model TEXT,
  ADD COLUMN IF NOT EXISTS class_teacher_id INTEGER REFERENCES users(id) ON DELETE RESTRICT;

UPDATE classes
SET class_teacher_id = teacher_id
WHERE class_teacher_id IS NULL AND teacher_id IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_teaching_model_check') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_teaching_model_check
      CHECK (teaching_model IN ('class_teacher', 'subject_teacher'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_classes_school_year ON classes (school_id, year_level, name);

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

DROP TRIGGER IF EXISTS classes_validate_class_teacher ON classes;
CREATE TRIGGER classes_validate_class_teacher
  BEFORE INSERT OR UPDATE OF school_id, teacher_id, class_teacher_id ON classes
  FOR EACH ROW EXECUTE FUNCTION validate_class_teacher_assignment();

ALTER TABLE subject_weekly_requirements
  ADD COLUMN IF NOT EXISTS double_periods_per_week INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS room_required BOOLEAN NOT NULL DEFAULT FALSE;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subject_weekly_requirements_double_period_check') THEN
    ALTER TABLE subject_weekly_requirements
      ADD CONSTRAINT subject_weekly_requirements_double_period_check
      CHECK (double_periods_per_week >= 0 AND double_periods_per_week * 2 <= lessons_per_week);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS teacher_workload_limits (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_periods_per_week INTEGER NOT NULL CHECK (max_periods_per_week > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, teacher_id)
);

CREATE TABLE IF NOT EXISTS timetable_versions (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'VALIDATED', 'PUBLISHED', 'ARCHIVED')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, id),
  UNIQUE (school_id, academic_year, term, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_one_published_version
  ON timetable_versions (school_id, academic_year, term) WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX IF NOT EXISTS idx_timetable_one_draft_version
  ON timetable_versions (school_id, academic_year, term) WHERE status = 'DRAFT';
CREATE INDEX IF NOT EXISTS idx_timetable_versions_current
  ON timetable_versions (school_id, academic_year, term, status, revision DESC);

ALTER TABLE timetables
  ADD COLUMN IF NOT EXISTS version_id INTEGER,
  ADD COLUMN IF NOT EXISTS period_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetables_period_count_check') THEN
    ALTER TABLE timetables ADD CONSTRAINT timetables_period_count_check CHECK (period_count IN (1, 2));
  END IF;
END $$;

DO $$
DECLARE
  has_term_scope BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'timetable_versions' AND column_name = 'term_id'
  ) INTO has_term_scope;

  IF has_term_scope THEN
    INSERT INTO timetable_terms (school_id, academic_year, term)
    SELECT id, COALESCE(NULLIF(academic_year, ''), 'Unassigned'),
           CASE WHEN current_term IN ('Term 1', 'Term 2', 'Term 3') THEN current_term ELSE 'Term 1' END
    FROM schools
    ON CONFLICT (school_id, academic_year, term) DO NOTHING;

    INSERT INTO timetable_terms (school_id, academic_year, term)
    SELECT DISTINCT t.school_id,
           COALESCE(NULLIF(t.academic_year, ''), NULLIF(s.academic_year, ''), 'Unassigned'),
           CASE
             WHEN t.term IN ('Term 1', 'Term 2', 'Term 3') THEN t.term
             WHEN lower(t.term) LIKE '%first%' THEN 'Term 1'
             WHEN lower(t.term) LIKE '%second%' THEN 'Term 2'
             WHEN lower(t.term) LIKE '%third%' THEN 'Term 3'
             ELSE 'Term 1'
           END
    FROM timetables t JOIN schools s ON s.id = t.school_id
    ON CONFLICT (school_id, academic_year, term) DO NOTHING;

    INSERT INTO timetable_versions (school_id, academic_year, term, term_id, status, created_at, updated_at)
    SELECT t.school_id, tt.academic_year, tt.term, tt.id,
           CASE WHEN bool_or(t.status = 'PUBLISHED') THEN 'PUBLISHED' ELSE 'DRAFT' END,
           MIN(t.created_at), NOW()
    FROM timetables t
    JOIN schools s ON s.id = t.school_id
    JOIN timetable_terms tt ON tt.school_id = t.school_id
      AND tt.academic_year = COALESCE(NULLIF(t.academic_year, ''), NULLIF(s.academic_year, ''), 'Unassigned')
      AND tt.term = CASE
        WHEN t.term IN ('Term 1', 'Term 2', 'Term 3') THEN t.term
        WHEN lower(t.term) LIKE '%first%' THEN 'Term 1'
        WHEN lower(t.term) LIKE '%second%' THEN 'Term 2'
        WHEN lower(t.term) LIKE '%third%' THEN 'Term 3'
        ELSE 'Term 1'
      END
    WHERE t.version_id IS NULL
    GROUP BY t.school_id, tt.academic_year, tt.term, tt.id
    ON CONFLICT DO NOTHING;

    INSERT INTO timetable_versions (school_id, academic_year, term, term_id, status, created_at, updated_at)
    SELECT tt.school_id, tt.academic_year, tt.term, tt.id, 'DRAFT', NOW(), NOW()
    FROM timetable_terms tt
    WHERE NOT EXISTS (SELECT 1 FROM timetable_versions v WHERE v.school_id = tt.school_id AND v.status = 'DRAFT')
      AND NOT EXISTS (SELECT 1 FROM timetable_versions v WHERE v.school_id = tt.school_id AND v.status = 'PUBLISHED')
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO timetable_versions (school_id, academic_year, term, status, created_at, updated_at)
    SELECT DISTINCT t.school_id,
           COALESCE(t.academic_year, s.academic_year, 'Unassigned'),
           COALESCE(t.term, s.current_term, 'Unassigned'),
           CASE WHEN bool_or(t.status = 'PUBLISHED') THEN 'PUBLISHED' ELSE 'DRAFT' END,
           MIN(t.created_at), NOW()
    FROM timetables t
    JOIN schools s ON s.id = t.school_id
    WHERE t.version_id IS NULL
    GROUP BY t.school_id, COALESCE(t.academic_year, s.academic_year, 'Unassigned'),
             COALESCE(t.term, s.current_term, 'Unassigned')
    ON CONFLICT DO NOTHING;

    INSERT INTO timetable_versions (school_id, academic_year, term, status, created_at, updated_at)
    SELECT id, COALESCE(academic_year, 'Unassigned'), COALESCE(current_term, 'Unassigned'), 'DRAFT', NOW(), NOW()
    FROM schools s
    WHERE NOT EXISTS (SELECT 1 FROM timetable_versions v WHERE v.school_id = s.id AND v.status = 'DRAFT')
      AND NOT EXISTS (SELECT 1 FROM timetable_versions v WHERE v.school_id = s.id AND v.status = 'PUBLISHED');
  END IF;
END $$;

DO $$
DECLARE
  unresolved RECORD;
BEGIN
  SELECT t.id AS timetable_id,
         t.school_id,
         COALESCE(t.academic_year, s.academic_year, 'Unassigned') AS academic_year,
         COALESCE(t.term, s.current_term, 'Unassigned') AS term,
         CASE WHEN t.status = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END AS status,
         COUNT(v.id)::INTEGER AS matching_versions
  INTO unresolved
  FROM timetables t
  JOIN schools s ON s.id = t.school_id
  LEFT JOIN timetable_versions v
    ON v.school_id = t.school_id
   AND v.academic_year = COALESCE(t.academic_year, s.academic_year, 'Unassigned')
   AND v.term = COALESCE(t.term, s.current_term, 'Unassigned')
   AND v.status = CASE WHEN t.status = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END
  WHERE t.version_id IS NULL
  GROUP BY t.id, t.school_id,
           COALESCE(t.academic_year, s.academic_year, 'Unassigned'),
           COALESCE(t.term, s.current_term, 'Unassigned'),
           CASE WHEN t.status = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END
  HAVING COUNT(v.id) <> 1
  ORDER BY t.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Cannot assign timetable entry % in school % to a version for academic year "%", term "%", status "%": expected exactly one matching version, found %.',
      unresolved.timetable_id, unresolved.school_id, unresolved.academic_year,
      unresolved.term, unresolved.status, unresolved.matching_versions;
  END IF;
END
$$;

UPDATE timetables t
SET version_id = v.id
FROM timetable_versions v
JOIN schools s ON s.id = v.school_id
WHERE t.version_id IS NULL AND t.school_id = v.school_id
  AND v.academic_year = COALESCE(t.academic_year, s.academic_year, 'Unassigned')
  AND v.term = COALESCE(t.term, s.current_term, 'Unassigned')
  AND v.status = CASE WHEN t.status = 'PUBLISHED' THEN 'PUBLISHED' ELSE 'DRAFT' END;

ALTER TABLE timetables ALTER COLUMN version_id SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetables_version_school_fk') THEN
    ALTER TABLE timetables ADD CONSTRAINT timetables_version_school_fk
      FOREIGN KEY (school_id, version_id) REFERENCES timetable_versions(school_id, id) ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_timetables_version_class ON timetables (school_id, version_id, class_id);
CREATE INDEX IF NOT EXISTS idx_timetables_version_teacher ON timetables (school_id, version_id, teacher_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_class_no_overlap') THEN
    ALTER TABLE timetables ADD CONSTRAINT timetable_class_no_overlap EXCLUDE USING gist (
      school_id WITH =, version_id WITH =, class_id WITH =, day_of_week WITH =,
      (tsrange(TIMESTAMP '2000-01-01' + start_time, TIMESTAMP '2000-01-01' + end_time, '[)')) WITH &&
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_teacher_no_overlap') THEN
    ALTER TABLE timetables ADD CONSTRAINT timetable_teacher_no_overlap EXCLUDE USING gist (
      school_id WITH =, version_id WITH =, teacher_id WITH =, day_of_week WITH =,
      (tsrange(TIMESTAMP '2000-01-01' + start_time, TIMESTAMP '2000-01-01' + end_time, '[)')) WITH &&
    ) WHERE (teacher_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'timetable_room_no_overlap') THEN
    ALTER TABLE timetables ADD CONSTRAINT timetable_room_no_overlap EXCLUDE USING gist (
      school_id WITH =, version_id WITH =, room_id WITH =, day_of_week WITH =,
      (tsrange(TIMESTAMP '2000-01-01' + start_time, TIMESTAMP '2000-01-01' + end_time, '[)')) WITH &&
    ) WHERE (room_id IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS timetable_audit_log (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  version_id INTEGER NOT NULL REFERENCES timetable_versions(id) ON DELETE CASCADE,
  entry_id INTEGER,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  before_data JSONB,
  after_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timetable_audit_version ON timetable_audit_log (school_id, version_id, created_at DESC);
