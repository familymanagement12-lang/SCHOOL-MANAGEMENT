BEGIN;

DROP TRIGGER IF EXISTS finance_audit_row ON feeding_student_accounts;
CREATE TRIGGER finance_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON feeding_student_accounts
  FOR EACH ROW EXECUTE FUNCTION audit_finance_row();

DROP TRIGGER IF EXISTS finance_audit_row ON feeding_frequency_history;
CREATE TRIGGER finance_audit_row
  AFTER INSERT OR UPDATE OR DELETE ON feeding_frequency_history
  FOR EACH ROW EXECUTE FUNCTION audit_finance_row();

DROP POLICY IF EXISTS feeding_officer_operations_audit_read ON finance_audit_log;
CREATE POLICY feeding_officer_operations_audit_read ON finance_audit_log
  FOR SELECT
  USING (
    current_setting('app.role', TRUE) = 'feeding_tuckshop_officer'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND (
      table_name IN (
        'operational_financial_entries', 'feeding_coverage_days', 'feeding_payment_ledger',
        'feeding_student_accounts', 'feeding_frequency_history', 'feeding_terms',
        'feeding_calendar_exceptions', 'feeding_class_rates', 'feeding_obligations'
      )
      OR (
        table_name = 'school_payment_receipts'
        AND GREATEST(
          COALESCE(NULLIF(new_data->>'feeding_amount', '')::NUMERIC, 0),
          COALESCE(NULLIF(old_data->>'feeding_amount', '')::NUMERIC, 0)
        ) > 0
      )
      OR (
        table_name = 'school_payment_refunds'
        AND COALESCE(new_data->>'component', old_data->>'component') = 'feeding'
      )
    )
  );

DROP POLICY IF EXISTS feeding_officer_inventory_audit_read ON inventory_audit_log;
CREATE POLICY feeding_officer_inventory_audit_read ON inventory_audit_log
  FOR SELECT
  USING (
    current_setting('app.role', TRUE) = 'feeding_tuckshop_officer'
    AND school_id = NULLIF(current_setting('app.school_id', TRUE), '')::INTEGER
    AND table_name IN (
      'kitchen_item_plans', 'inventory_purchases', 'inventory_purchase_items',
      'inventory_purchase_receipts', 'inventory_purchase_receipt_items'
    )
  );

COMMIT;