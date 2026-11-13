const OPERATIONAL_PERMISSIONS = [
  'feeding.access',
  'feeding.students.read',
  'feeding.rates.read',
  'feeding.rates.manage',
  'feeding.payments.read',
  'feeding.payments.create',
  'feeding.register.read',
  'feeding.register.manage',
  'feeding.calendar.manage',
  'feeding.purchases.create',
  'feeding.purchases.read',
  'feeding.purchases.approve',
  'feeding.advances.manage',
  'feeding.reports.read',
  'tuckshop.access',
  'tuckshop.products.read',
  'tuckshop.products.manage',
  'tuckshop.sales.read',
  'tuckshop.sales.create',
  'tuckshop.stock.read',
  'tuckshop.stock.manage',
  'tuckshop.purchases.create',
  'tuckshop.purchases.read',
  'tuckshop.purchases.approve',
  'tuckshop.sales.reconcile',
  'tuckshop.reports.read',
];

const DEFAULT_FEEDING_TUCKSHOP_PERMISSIONS = OPERATIONAL_PERMISSIONS;

module.exports = { OPERATIONAL_PERMISSIONS, DEFAULT_FEEDING_TUCKSHOP_PERMISSIONS };
