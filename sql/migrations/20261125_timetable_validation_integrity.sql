DO $$
DECLARE
  duplicate_groups INTEGER;
BEGIN
  SELECT COUNT(*)::INTEGER
  INTO duplicate_groups
  FROM (
    SELECT 1
    FROM subject_scheduling_preferences
    GROUP BY
      school_id,
      subject_id,
      COALESCE(class_id, 0),
      COALESCE(preferred_day_of_week, ''),
      COALESCE(preferred_period_slot, 0),
      COALESCE(avoid_period_slot, 0)
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce unique subject scheduling preferences: % duplicate groups require administrator review. No preference rows were deleted.',
      duplicate_groups;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS subject_scheduling_preferences_null_safe_unique_idx
  ON subject_scheduling_preferences (
    school_id,
    subject_id,
    COALESCE(class_id, 0),
    COALESCE(preferred_day_of_week, ''),
    COALESCE(preferred_period_slot, 0),
    COALESCE(avoid_period_slot, 0)
  );
