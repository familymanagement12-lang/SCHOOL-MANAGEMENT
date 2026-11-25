BEGIN;

ALTER TABLE employees
  DROP CONSTRAINT IF EXISTS employees_employment_type_check;

COMMIT;
