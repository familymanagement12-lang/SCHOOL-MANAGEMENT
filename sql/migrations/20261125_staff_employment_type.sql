BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS employment_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'employees_employment_type_check'
      AND conrelid = 'employees'::regclass
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_employment_type_check
      CHECK (employment_type IS NULL OR employment_type IN (
        'full_time', 'part_time_contract', 'national_service_intern'
      ));
  END IF;
END $$;

COMMIT;
