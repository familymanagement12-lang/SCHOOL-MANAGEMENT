BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS staff_id TEXT,
  ADD COLUMN IF NOT EXISTS pension_member_id TEXT,
  ADD COLUMN IF NOT EXISTS ssnit_number TEXT,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS ghana_card TEXT,
  ADD COLUMN IF NOT EXISTS employment_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS termination_date DATE;

UPDATE employees
SET employment_status = CASE
  WHEN is_active = TRUE THEN 'active'
  ELSE 'inactive'
END
WHERE employment_status IS NULL OR employment_status = '';

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_employment_status_check,
  ALTER COLUMN employment_status SET DEFAULT 'active';

ALTER TABLE employees
  ADD CONSTRAINT employees_employment_status_check
  CHECK (employment_status IN ('active', 'inactive', 'terminated', 'on_leave'));

CREATE UNIQUE INDEX IF NOT EXISTS employees_school_staff_id_unique
  ON employees (school_id, staff_id)
  WHERE staff_id IS NOT NULL AND BTRIM(staff_id) <> '';

CREATE INDEX IF NOT EXISTS employees_school_ssnit_idx
  ON employees (school_id, ssnit_number)
  WHERE ssnit_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS employees_school_ghana_card_idx
  ON employees (school_id, ghana_card)
  WHERE ghana_card IS NOT NULL;

COMMIT;
