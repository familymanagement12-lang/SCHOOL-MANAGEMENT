ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS education_stage TEXT NOT NULL DEFAULT 'UNASSIGNED',
  ADD COLUMN IF NOT EXISTS programme TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.classes'::regclass
      AND conname = 'classes_education_stage_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_education_stage_check
      CHECK (education_stage IN ('EARLY_YEARS', 'PRIMARY', 'JHS', 'OTHER', 'UNASSIGNED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.classes'::regclass
      AND conname = 'classes_other_programme_required'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_other_programme_required
      CHECK (
        education_stage <> 'OTHER'
        OR NULLIF(BTRIM(programme), '') IS NOT NULL
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_classes_school_education_stage
  ON public.classes (school_id, education_stage, year_level, curriculum);

DROP TRIGGER IF EXISTS classes_validate_curriculum ON public.classes;
CREATE TRIGGER classes_validate_curriculum
  BEFORE INSERT OR UPDATE OF year_level, curriculum, education_stage, teaching_model ON public.classes
  FOR EACH ROW EXECUTE FUNCTION public.validate_school_curriculum();
