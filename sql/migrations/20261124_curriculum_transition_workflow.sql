BEGIN;

CREATE TABLE IF NOT EXISTS curriculum_selection_periods (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year TEXT NOT NULL,
  opens_at TIMESTAMPTZ NOT NULL,
  deadline TIMESTAMPTZ NOT NULL,
  reminder_interval_days INTEGER NOT NULL DEFAULT 7
    CHECK (reminder_interval_days BETWEEN 1 AND 30),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, academic_year),
  CHECK (deadline > opens_at)
);

CREATE TABLE IF NOT EXISTS curriculum_pathway_selections (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  student_name_snapshot TEXT NOT NULL,
  admission_number_snapshot TEXT,
  parent_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  academic_year TEXT NOT NULL,
  request_type TEXT NOT NULL
    CHECK (request_type IN ('initial_selection', 'change_request')),
  selected_curriculum TEXT NOT NULL
    CHECK (selected_curriculum IN ('GES', 'PEARSON')),
  previous_curriculum TEXT
    CHECK (previous_curriculum IS NULL OR previous_curriculum IN ('COMMON', 'GES', 'PEARSON', 'UNASSIGNED')),
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval', 'approved_pending_class', 'assigned', 'rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  assigned_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS curriculum_initial_selection_active_unique
  ON curriculum_pathway_selections (school_id, student_id, academic_year)
  WHERE request_type = 'initial_selection'
    AND status IN ('pending_approval', 'approved_pending_class', 'assigned');
CREATE UNIQUE INDEX IF NOT EXISTS curriculum_change_request_active_unique
  ON curriculum_pathway_selections (school_id, student_id)
  WHERE request_type = 'change_request'
    AND status IN ('pending_approval', 'approved_pending_class');
CREATE INDEX IF NOT EXISTS curriculum_selections_review_queue_idx
  ON curriculum_pathway_selections (school_id, academic_year, status, submitted_at);
CREATE INDEX IF NOT EXISTS curriculum_selections_parent_idx
  ON curriculum_pathway_selections (school_id, parent_user_id, student_id, submitted_at DESC);

ALTER TABLE curriculum_pathway_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_pathway_selections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS curriculum_selection_admin_all ON curriculum_pathway_selections;
CREATE POLICY curriculum_selection_admin_all ON curriculum_pathway_selections
  FOR ALL
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  );
DROP POLICY IF EXISTS curriculum_selection_parent_read ON curriculum_pathway_selections;
CREATE POLICY curriculum_selection_parent_read ON curriculum_pathway_selections
  FOR SELECT
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'parent'
    AND EXISTS (
      SELECT 1
      FROM student_parent sp
      JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
      WHERE sp.school_id = curriculum_pathway_selections.school_id
        AND sp.student_id = curriculum_pathway_selections.student_id
        AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    )
  );
DROP POLICY IF EXISTS curriculum_selection_parent_insert ON curriculum_pathway_selections;
CREATE POLICY curriculum_selection_parent_insert ON curriculum_pathway_selections
  FOR INSERT
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND parent_user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'parent'
    AND status = 'pending_approval'
    AND reviewed_by IS NULL
    AND assigned_class_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM student_parent sp
      JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
      WHERE sp.school_id = curriculum_pathway_selections.school_id
        AND sp.student_id = curriculum_pathway_selections.student_id
        AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    )
  );

CREATE TABLE IF NOT EXISTS curriculum_selection_notification_log (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  academic_year TEXT NOT NULL,
  event_key TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, user_id, student_id, academic_year, event_key)
);

CREATE OR REPLACE FUNCTION canonical_curriculum_class_name(
  class_name TEXT,
  year_level INTEGER,
  curriculum TEXT
) RETURNS TEXT AS $$
  SELECT CASE
    WHEN UPPER(COALESCE(curriculum, '')) = 'GES'
      AND year_level BETWEEN 7 AND 9
      THEN 'JHS ' || (year_level - 6)::TEXT
        || CASE WHEN section_name <> '' THEN ' - ' || section_name ELSE '' END
    WHEN UPPER(COALESCE(curriculum, '')) = 'PEARSON'
      AND year_level BETWEEN 7 AND 11
      THEN 'Year ' || year_level::TEXT
        || CASE WHEN section_name <> '' THEN ' - ' || section_name ELSE '' END
    ELSE NULLIF(BTRIM(class_name), '')
  END
  FROM (
    SELECT BTRIM(regexp_replace(
      COALESCE(class_name, ''),
      '^(JHS[[:space:]]*[1-3]|Year[[:space:]]*[0-9]+)[[:space:]]*([-:][[:space:]]*)?',
      '', 'i'
    )) AS section_name
  ) section;
$$ LANGUAGE SQL IMMUTABLE;

ALTER TABLE results
  ADD COLUMN IF NOT EXISTS class_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS year_level_snapshot INTEGER,
  ADD COLUMN IF NOT EXISTS academic_year_snapshot TEXT;

UPDATE results r
SET class_name_snapshot = canonical_curriculum_class_name(c.name, c.year_level, c.curriculum),
    year_level_snapshot = c.year_level,
    academic_year_snapshot = sc.academic_year
FROM classes c
JOIN schools sc ON sc.id = c.school_id
WHERE r.class_id = c.id AND r.school_id = c.school_id
  AND (r.class_name_snapshot IS NULL
    OR r.year_level_snapshot IS NULL
    OR r.academic_year_snapshot IS NULL);

CREATE OR REPLACE FUNCTION set_result_curriculum_snapshot() RETURNS trigger AS $$
DECLARE
  student_class INTEGER;
  student_curriculum TEXT;
  snapshot_name TEXT;
  snapshot_year INTEGER;
  snapshot_academic_year TEXT;
BEGIN
  SELECT s.class_id, COALESCE(s.curriculum, 'UNASSIGNED'),
         canonical_curriculum_class_name(c.name, c.year_level, c.curriculum),
         c.year_level, sc.academic_year
  INTO student_class, student_curriculum, snapshot_name, snapshot_year,
       snapshot_academic_year
  FROM students s
  LEFT JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
  JOIN schools sc ON sc.id = s.school_id
  WHERE s.id = NEW.student_id AND s.school_id = NEW.school_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student not found in this school.';
  END IF;
  NEW.class_id := student_class;
  NEW.curriculum := student_curriculum;
  NEW.class_name_snapshot := snapshot_name;
  NEW.year_level_snapshot := snapshot_year;
  NEW.academic_year_snapshot := snapshot_academic_year;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS student_class_history (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  student_name_snapshot TEXT NOT NULL,
  class_name_snapshot TEXT NOT NULL,
  year_level_snapshot INTEGER,
  curriculum_snapshot TEXT NOT NULL
    CHECK (curriculum_snapshot IN ('COMMON', 'GES', 'PEARSON', 'UNASSIGNED')),
  academic_year_snapshot TEXT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_reason TEXT NOT NULL DEFAULT 'class_assignment',
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS student_class_history_active_unique
  ON student_class_history (school_id, student_id)
  WHERE student_id IS NOT NULL AND effective_to IS NULL;
CREATE INDEX IF NOT EXISTS student_class_history_student_idx
  ON student_class_history (school_id, student_id, effective_from DESC);

-- Existing class assignments are recorded as a baseline from this migration date forward.
INSERT INTO student_class_history
  (school_id, student_id, class_id, student_name_snapshot, class_name_snapshot,
   year_level_snapshot, curriculum_snapshot, academic_year_snapshot, effective_from,
   change_reason)
SELECT s.school_id, s.id, c.id, s.name,
       canonical_curriculum_class_name(c.name, c.year_level, c.curriculum),
       c.year_level, COALESCE(s.curriculum, 'UNASSIGNED'), sc.academic_year,
       CURRENT_DATE, 'migration_baseline'
FROM students s
JOIN classes c ON c.id = s.class_id AND c.school_id = s.school_id
JOIN schools sc ON sc.id = s.school_id
WHERE NOT EXISTS (
  SELECT 1 FROM student_class_history h
  WHERE h.school_id = s.school_id AND h.student_id = s.id AND h.effective_to IS NULL
);

ALTER TABLE student_class_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_class_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS student_class_history_admin_all ON student_class_history;
CREATE POLICY student_class_history_admin_all ON student_class_history
  FOR ALL
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  )
  WITH CHECK (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'admin'
  );
DROP POLICY IF EXISTS student_class_history_parent_read ON student_class_history;
CREATE POLICY student_class_history_parent_read ON student_class_history
  FOR SELECT
  USING (
    school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND current_setting('app.role', TRUE) = 'parent'
    AND EXISTS (
      SELECT 1 FROM student_parent sp
      JOIN parents p ON p.id = sp.parent_id AND p.school_id = sp.school_id
      WHERE sp.school_id = student_class_history.school_id
        AND sp.student_id = student_class_history.student_id
        AND p.user_id = NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER
    )
  );

CREATE OR REPLACE FUNCTION record_student_class_history() RETURNS trigger AS $$
DECLARE
  current_class_name TEXT;
  current_year_level INTEGER;
  current_curriculum TEXT;
  current_academic_year TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.class_id IS NOT DISTINCT FROM NEW.class_id THEN
    RETURN NEW;
  END IF;

  UPDATE student_class_history
  SET effective_to = CURRENT_DATE
  WHERE school_id = NEW.school_id AND student_id = NEW.id AND effective_to IS NULL;

  IF NEW.class_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT canonical_curriculum_class_name(c.name, c.year_level, c.curriculum),
         c.year_level, COALESCE(c.curriculum, 'UNASSIGNED'), sc.academic_year
  INTO current_class_name, current_year_level, current_curriculum, current_academic_year
  FROM classes c
  JOIN schools sc ON sc.id = c.school_id
  WHERE c.id = NEW.class_id AND c.school_id = NEW.school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Class not found in this school while recording student history.';
  END IF;

  INSERT INTO student_class_history (
    school_id, student_id, class_id, student_name_snapshot, class_name_snapshot,
    year_level_snapshot, curriculum_snapshot, academic_year_snapshot, changed_by,
    change_reason
  ) VALUES (
    NEW.school_id, NEW.id, NEW.class_id, NEW.name, current_class_name,
    current_year_level, current_curriculum, current_academic_year,
    NULLIF(current_setting('app.user_id', TRUE), '')::INTEGER,
    COALESCE(NULLIF(current_setting('app.class_change_reason', TRUE), ''), 'class_assignment')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS results_set_curriculum_snapshot ON results;
CREATE TRIGGER results_set_curriculum_snapshot
  BEFORE INSERT OR UPDATE OF student_id, school_id ON results
  FOR EACH ROW EXECUTE FUNCTION set_result_curriculum_snapshot();

DROP TRIGGER IF EXISTS students_record_class_history ON students;
CREATE TRIGGER students_record_class_history
  AFTER INSERT OR UPDATE OF class_id ON students
  FOR EACH ROW EXECUTE FUNCTION record_student_class_history();

CREATE INDEX IF NOT EXISTS idx_results_class_snapshot
  ON results (school_id, student_id, academic_year_snapshot, term);

COMMIT;
