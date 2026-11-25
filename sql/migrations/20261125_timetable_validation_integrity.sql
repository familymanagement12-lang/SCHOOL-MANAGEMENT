BEGIN;

DELETE FROM subject_scheduling_preferences older
USING subject_scheduling_preferences newer
WHERE older.id < newer.id
  AND older.school_id = newer.school_id
  AND older.subject_id = newer.subject_id
  AND older.class_id IS NOT DISTINCT FROM newer.class_id
  AND older.preferred_day_of_week IS NOT DISTINCT FROM newer.preferred_day_of_week
  AND older.preferred_period_slot IS NOT DISTINCT FROM newer.preferred_period_slot
  AND older.avoid_period_slot IS NOT DISTINCT FROM newer.avoid_period_slot;

CREATE UNIQUE INDEX IF NOT EXISTS subject_scheduling_preferences_null_safe_unique_idx
  ON subject_scheduling_preferences (
    school_id,
    subject_id,
    COALESCE(class_id, 0),
    COALESCE(preferred_day_of_week, ''),
    COALESCE(preferred_period_slot, 0),
    COALESCE(avoid_period_slot, 0)
  );

COMMIT;
