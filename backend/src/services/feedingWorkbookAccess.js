const WORKBOOKS = {
  feedingMarketing: 'FEEDING AND MARKETING 2024_2025.xlsx',
  market: 'MARKET STOCK SEPT TO DEC, 2026.xlsx',
  purchases: 'PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx',
  lunch: 'LUNCH 2026_2027.xlsx',
};

const ALL_WORKBOOKS = Object.values(WORKBOOKS);

function getWorkbookAccess(granted, isAdmin = false) {
  if (isAdmin || granted.has('feeding.reports.read') || granted.has('feeding.import.review')) {
    return ALL_WORKBOOKS;
  }

  const allowed = new Set();
  if (granted.has('tuckshop.reports.read')) {
    allowed.add(WORKBOOKS.market);
    allowed.add(WORKBOOKS.purchases);
  }
  if (granted.has('feeding.market.read') || granted.has('feeding.market.manage')) {
    allowed.add(WORKBOOKS.market);
  }
  if (granted.has('feeding.marketing.read') || granted.has('feeding.marketing.manage')) {
    allowed.add(WORKBOOKS.feedingMarketing);
  }
  return [...allowed];
}

function getFigureAccess(granted, isAdmin = false) {
  const modules = new Set();
  const sourceFiles = new Set();
  const broadReportAccess = isAdmin
    || granted.has('feeding.reports.read')
    || granted.has('tuckshop.reports.read');

  if (isAdmin || granted.has('feeding.reports.read')) {
    modules.add('feeding');
    modules.add('marketing');
  }
  if (isAdmin || granted.has('tuckshop.reports.read')) modules.add('tuckshop');

  if (granted.has('feeding.market.read') || granted.has('feeding.market.manage')) {
    modules.add('feeding');
    modules.add('tuckshop');
    sourceFiles.add(WORKBOOKS.market);
  }
  if (granted.has('feeding.marketing.read') || granted.has('feeding.marketing.manage')) {
    modules.add('marketing');
    sourceFiles.add(WORKBOOKS.feedingMarketing);
  }

  return {
    modules: [...modules],
    sourceFiles: broadReportAccess ? ALL_WORKBOOKS : [...sourceFiles],
  };
}

module.exports = { getFigureAccess, getWorkbookAccess };
