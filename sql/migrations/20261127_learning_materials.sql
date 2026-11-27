BEGIN;

CREATE TABLE public.learning_materials (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  teacher_id INTEGER NOT NULL,
  class_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  academic_year TEXT NOT NULL,
  term TEXT NOT NULL,
  term_id INTEGER NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 5000),
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id,teacher_id) REFERENCES public.users(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id,class_id) REFERENCES public.classes(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id,subject_id) REFERENCES public.subjects(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id,academic_year,term,term_id)
    REFERENCES public.timetable_terms(school_id,academic_year,term,id) ON DELETE RESTRICT,
  UNIQUE (school_id,id)
);

CREATE TABLE public.learning_material_files (
  id BIGSERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL,
  material_id BIGINT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL CHECK (file_size > 0),
  uploaded_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (school_id,material_id) REFERENCES public.learning_materials(school_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (school_id,uploaded_by) REFERENCES public.users(school_id,id) ON DELETE RESTRICT
);

CREATE INDEX learning_materials_class_term_idx
  ON public.learning_materials(school_id,class_id,term_id,status,created_at DESC);
CREATE INDEX learning_material_files_lookup_idx
  ON public.learning_material_files(school_id,material_id,created_at,id);

ALTER TABLE public.learning_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_materials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_material_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_material_files FORCE ROW LEVEL SECURITY;

CREATE POLICY learning_materials_staff_scope ON public.learning_materials
  FOR ALL USING (public.assignment_staff_scope(school_id,teacher_id,class_id,subject_id,term_id))
  WITH CHECK (public.assignment_staff_scope(school_id,teacher_id,class_id,subject_id,term_id));
CREATE POLICY learning_materials_student_read ON public.learning_materials
  FOR SELECT USING (
    school_id=NULLIF(current_setting('app.school_id',TRUE),'')::INTEGER
    AND current_setting('app.role',TRUE)='student'
    AND status='PUBLISHED'
    AND EXISTS (SELECT 1 FROM public.students st
      WHERE st.school_id=learning_materials.school_id
        AND st.class_id=learning_materials.class_id
        AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER)
  );

CREATE POLICY learning_material_files_staff_scope ON public.learning_material_files
  FOR ALL USING (EXISTS (
    SELECT 1 FROM public.learning_materials m
    WHERE m.school_id=learning_material_files.school_id AND m.id=learning_material_files.material_id
      AND public.assignment_staff_scope(m.school_id,m.teacher_id,m.class_id,m.subject_id,m.term_id)
  )) WITH CHECK (EXISTS (
    SELECT 1 FROM public.learning_materials m
    WHERE m.school_id=learning_material_files.school_id AND m.id=learning_material_files.material_id
      AND public.assignment_staff_scope(m.school_id,m.teacher_id,m.class_id,m.subject_id,m.term_id)
  ));
CREATE POLICY learning_material_files_student_read ON public.learning_material_files
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.learning_materials m
    JOIN public.students st ON st.school_id=m.school_id AND st.class_id=m.class_id
    WHERE m.school_id=learning_material_files.school_id AND m.id=learning_material_files.material_id
      AND m.status='PUBLISHED'
      AND st.user_id=NULLIF(current_setting('app.user_id',TRUE),'')::INTEGER
      AND current_setting('app.role',TRUE)='student'
  ));

DO $$
DECLARE runtime_role TEXT := 'mccarthy_runtime_70aef860';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname=runtime_role) THEN
    RAISE EXCEPTION 'Expected restricted runtime role % was not found.', runtime_role;
  END IF;
  EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.learning_materials,public.learning_material_files FROM %I', runtime_role);
  EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.learning_materials_id_seq,public.learning_material_files_id_seq FROM %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON public.learning_materials TO %I', runtime_role);
  EXECUTE format('GRANT SELECT,INSERT ON public.learning_material_files TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.learning_materials_id_seq TO %I', runtime_role);
  EXECUTE format('GRANT USAGE,SELECT ON SEQUENCE public.learning_material_files_id_seq TO %I', runtime_role);
END $$;

INSERT INTO public.app_schema_migrations(migration_name)
VALUES ('20261127_learning_materials')
ON CONFLICT (migration_name) DO NOTHING;

COMMIT;
