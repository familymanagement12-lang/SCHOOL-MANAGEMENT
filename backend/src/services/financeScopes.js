const OPERATIONAL_FINANCE_SOURCE_TYPES = Object.freeze([
  'feeding_payment',
  'tuckshop_sale',
  'tuckshop_sale_cogs',
  'kitchen_purchase',
]);
const sourceTypesSql = OPERATIONAL_FINANCE_SOURCE_TYPES.map((sourceType) => `'${sourceType}'`).join(', ');

const MAIN_FINANCE_TRANSACTION_FILTER = `COALESCE(source_type, '') NOT IN (${sourceTypesSql})`;
const MAIN_FINANCE_AUDIT_FILTER = `
  (
    a.table_name <> 'transactions'
    OR COALESCE(a.new_data->>'source_type', a.old_data->>'source_type', '') NOT IN (${sourceTypesSql})
  )
`;

const isMainFinanceTransaction = (sourceType) => !OPERATIONAL_FINANCE_SOURCE_TYPES.includes(sourceType);

module.exports = {
  isMainFinanceTransaction,
  MAIN_FINANCE_AUDIT_FILTER,
  MAIN_FINANCE_TRANSACTION_FILTER,
};
