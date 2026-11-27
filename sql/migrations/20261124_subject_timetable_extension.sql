ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_compulsory BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS lesson_duration_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS applicable_year_levels INTEGER[],
  ADD COLUMN IF NOT EXISTS applicable_education_stages TEXT[],
  ADD COLUMN IF NOT EXISTS scheduling_preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE subjects
  DROP CONSTRAINT IF EXISTS subjects_lesson_duration_check;
ALTER TABLE subjects
  ADD CONSTRAINT subjects_lesson_duration_check
  CHECK (lesson_duration_minutes IS NULL OR lesson_duration_minutes BETWEEN 15 AND 240);
ALTER TABLE subjects
  DROP CONSTRAINT IF EXISTS subjects_applicable_education_stages_check;
ALTER TABLE subjects
  ADD CONSTRAINT subjects_applicable_education_stages_check
  CHECK (
    applicable_education_stages IS NULL
    OR (
      cardinality(applicable_education_stages) > 0
      AND applicable_education_stages <@ ARRAY['EARLY_YEARS', 'PRIMARY', 'JHS', 'OTHER']::TEXT[]
    )
  );

CREATE TABLE IF NOT EXISTS subject_class_assignments (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  curriculum TEXT NOT NULL CHECK (curriculum IN ('COMMON', 'GES', 'PEARSON')),
  is_compulsory BOOLEAN NOT NULL DEFAULT TRUE,
  lesson_duration_minutes INTEGER,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id, subject_id),
  CONSTRAINT subject_class_assignment_duration_check
    CHECK (lesson_duration_minutes IS NULL OR lesson_duration_minutes BETWEEN 15 AND 240)
);

CREATE INDEX IF NOT EXISTS subject_class_assignments_lookup_idx
  ON subject_class_assignments (school_id, class_id, curriculum, subject_id);

CREATE TABLE IF NOT EXISTS subject_scheduling_preferences (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  preferred_day_of_week TEXT CHECK (
    preferred_day_of_week IS NULL OR preferred_day_of_week IN
    ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')
  ),
  preferred_period_slot INTEGER CHECK (preferred_period_slot IS NULL OR preferred_period_slot >= 1),
  avoid_period_slot INTEGER CHECK (avoid_period_slot IS NULL OR avoid_period_slot >= 1),
  preference_rank INTEGER NOT NULL DEFAULT 1 CHECK (preference_rank BETWEEN 1 AND 10),
  reason TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, subject_id, class_id, preferred_day_of_week, preferred_period_slot, avoid_period_slot)
);

CREATE INDEX IF NOT EXISTS subject_scheduling_preferences_lookup_idx
  ON subject_scheduling_preferences (school_id, subject_id, class_id);

DO $$
DECLARE
  invalid_requirements INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER INTO invalid_requirements
  FROM subject_weekly_requirements r
  JOIN classes c ON c.id = r.class_id AND c.school_id = r.school_id
  JOIN subjects s ON s.id = r.subject_id AND s.school_id = r.school_id
  WHERE c.education_stage = 'UNASSIGNED'
     OR c.curriculum IS NULL
     OR c.curriculum = 'UNASSIGNED'
     OR s.applicable_education_stages IS NULL
     OR NOT c.education_stage = ANY(s.applicable_education_stages)
     OR NOT EXISTS (
       SELECT 1 FROM curriculum_subjects cs
       WHERE cs.school_id = r.school_id
         AND cs.subject_id = r.subject_id
         AND cs.curriculum = c.curriculum
     )
     OR (
       s.applicable_year_levels IS NOT NULL
       AND (c.year_level IS NULL OR NOT c.year_level = ANY(s.applicable_year_levels))
     );

  IF invalid_requirements > 0 THEN
    RAISE EXCEPTION
      'Cannot create class-subject assignments: % weekly requirement(s) need confirmed class classification, compatible curriculum mapping, and applicable levels. No assignment rows were inserted.',
      invalid_requirements;
  END IF;
END
$$;

INSERT INTO subject_class_assignments
  (school_id, class_id, subject_id, curriculum, is_compulsory, lesson_duration_minutes)
SELECT r.school_id, r.class_id, r.subject_id,
       c.curriculum,
       COALESCE(s.is_compulsory, TRUE),
       s.lesson_duration_minutes
FROM subject_weekly_requirements r
JOIN classes c ON c.id=r.class_id AND c.school_id=r.school_id
JOIN subjects s ON s.id=r.subject_id AND s.school_id=r.school_id
JOIN curriculum_subjects cs ON cs.school_id=r.school_id
  AND cs.subject_id=r.subject_id AND cs.curriculum=c.curriculum
WHERE c.education_stage <> 'UNASSIGNED'
  AND c.curriculum <> 'UNASSIGNED'
  AND s.applicable_education_stages IS NOT NULL
  AND c.education_stage = ANY(s.applicable_education_stages)
  AND (
    s.applicable_year_levels IS NULL
    OR (c.year_level IS NOT NULL AND c.year_level = ANY(s.applicable_year_levels))
  )
ON CONFLICT (school_id, class_id, subject_id) DO NOTHING;
