-- Remove only two reviewed schema artifacts from the development baseline.
-- No existing row values are changed.
DO $$
DECLARE
  observed_default TEXT;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid)
    INTO observed_default
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.classes'::regclass
    AND a.attname = 'teaching_model';

  IF observed_default IS NULL THEN
    RETURN;
  END IF;
  IF observed_default <> '''subject_teacher''::text' THEN
    RAISE EXCEPTION
      'Refusing schema reconciliation: unexpected classes.teaching_model default %.',
      observed_default;
  END IF;

  ALTER TABLE public.classes ALTER COLUMN teaching_model DROP DEFAULT;
END
$$;

DO $$
DECLARE
  duplicate_index_oid OID;
  observed_definition TEXT;
BEGIN
  SELECT c.oid, pg_get_indexdef(c.oid)
    INTO duplicate_index_oid, observed_definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'timetable_terms_school_year_term_id_unique_idx';

  IF duplicate_index_oid IS NULL THEN
    RETURN;
  END IF;
  IF observed_definition <>
     'CREATE UNIQUE INDEX timetable_terms_school_year_term_id_unique_idx ON public.timetable_terms USING btree (school_id, academic_year, term, id)' THEN
    RAISE EXCEPTION
      'Refusing schema reconciliation: unexpected timetable-term index definition %.',
      observed_definition;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conindid = duplicate_index_oid
  ) THEN
    RAISE EXCEPTION
      'Refusing schema reconciliation: duplicate timetable-term index backs a constraint.';
  END IF;

  DROP INDEX public.timetable_terms_school_year_term_id_unique_idx;
END
$$;
