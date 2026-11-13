const test = require('node:test');
const assert = require('node:assert/strict');
const { getFigureAccess, getWorkbookAccess } = require('./feedingWorkbookAccess');

test('market-only archive access is limited to the Market Stock workbook', () => {
  assert.deepEqual(
    getWorkbookAccess(new Set(['feeding.market.read'])),
    ['MARKET STOCK SEPT TO DEC, 2026.xlsx']
  );
});

test('marketing-only archive access excludes lunch and market workbooks', () => {
  assert.deepEqual(
    getWorkbookAccess(new Set(['feeding.marketing.read'])),
    ['FEEDING AND MARKETING 2024_2025.xlsx']
  );
});

test('market figure access is restricted to the Market Stock source workbook', () => {
  assert.deepEqual(
    getFigureAccess(new Set(['feeding.market.read'])),
    {
      modules: ['feeding', 'tuckshop'],
      sourceFiles: ['MARKET STOCK SEPT TO DEC, 2026.xlsx'],
    }
  );
});

test('marketing figure access is restricted to marketing entries from its workbook', () => {
  assert.deepEqual(
    getFigureAccess(new Set(['feeding.marketing.read'])),
    {
      modules: ['marketing'],
      sourceFiles: ['FEEDING AND MARKETING 2024_2025.xlsx'],
    }
  );
});

test('report and administrator access retains the full workbook scope', () => {
  assert.equal(getWorkbookAccess(new Set(['feeding.import.review'])).length, 4);
  assert.equal(getWorkbookAccess(new Set(), true).length, 4);
  assert.deepEqual(
    getFigureAccess(new Set(['feeding.reports.read'])),
    {
      modules: ['feeding', 'marketing'],
      sourceFiles: [
        'FEEDING AND MARKETING 2024_2025.xlsx',
        'MARKET STOCK SEPT TO DEC, 2026.xlsx',
        'PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx',
        'LUNCH 2026_2027.xlsx',
      ],
    }
  );
});
