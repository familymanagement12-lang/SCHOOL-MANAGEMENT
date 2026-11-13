const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ExcelJS = require(path.join(__dirname, '../../../frontend/node_modules/exceljs'));
const {
  importAnnualSheet,
  importLunchDetail,
  importMarketDetail,
  importTermLedger,
  numericValue,
  validateFigureRecords,
} = require('../../../scripts/import_feeding_tuckshop_workbook_figures');

const sourceFile = { hash: 'a'.repeat(64), name: 'test.xlsx' };

test('import preview validation requires source provenance and rejects duplicate source figures', () => {
  const record = {
    module: 'feeding',
    entryType: 'income',
    sourceFile: sourceFile.name,
    sourceHash: sourceFile.hash,
    sheetName: 'Sheet 1',
    sourceRow: 2,
    sourceColumn: 'B',
    amount: '10.00',
    importKey: 'same-key',
  };
  assert.equal(validateFigureRecords([record]), 1);
  assert.throws(() => validateFigureRecords([record, record]), /Duplicate source figure detected/);
  assert.throws(() => validateFigureRecords([{ ...record, sourceColumn: '' }]), /missing source\/import metadata/);
  assert.throws(() => validateFigureRecords([{ ...record, importKey: '' }]), /missing source\/import metadata/);
});

test('workbook amount parser reads numeric and additive text amounts without treating labels as money', () => {
  assert.equal(numericValue({ value: 12.5 }), 12.5);
  assert.equal(numericValue({ value: { result: 20 } }), 20);
  assert.equal(numericValue({ value: '800+100' }), 900);
  assert.equal(numericValue({ value: 'OUT OF 7500' }), null);
});

test('term ledger imports dated income and expense entries but not weekly totals or P/L as income', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('FEEDING TERM 1');
  sheet.addRow(['WEEK 1', 'WEEK 1', 'WEEK 1', 'WEEK 1']);
  sheet.addRow(['', 'REVENUE', 'EXPENSES', 'EXPENSES']);
  sheet.addRow(['DATE', 'AMOUNT', 'AMOUNT', 'DESCRIPTION']);
  sheet.addRow(['14/09/2026', 100, 25, 'eggs']);
  sheet.addRow(['TOTAL', 100, 25]);
  sheet.addRow(['', null, 75, 'P/L']);

  const records = [];
  importTermLedger(sourceFile, sheet, records);

  assert.deepEqual(records.map(({ entryType, amount, countsInTotals }) => [
    entryType, amount, countsInTotals,
  ]), [
    ['income', '100.00', true],
    ['expense', '25.00', true],
    ['income', '100.00', false],
    ['expense', '25.00', false],
    ['summary', '75.00', false],
  ]);
});

test('lunch figures are imported anonymously as supporting details and not counted twice', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Copy of TERM 1 (SEPT-DEC 2026)');
  sheet.getCell('E2').value = 1;
  sheet.getCell('F2').value = 2;
  sheet.getCell('B4').value = 'Student Name';
  sheet.getCell('E4').value = 75;
  sheet.getCell('F4').value = 125;
  sheet.getCell('E227').value = 75;
  sheet.getCell('F227').value = 125;

  const records = [];
  importLunchDetail(sourceFile, sheet, records);

  assert.equal(records.length, 4);
  assert.ok(records.every((record) => record.module === 'feeding' && !record.countsInTotals));
  assert.ok(records.every((record) => !record.description.includes('Student Name')));
  assert.deepEqual(records.map((record) => record.amount), ['75.00', '125.00', '75.00', '125.00']);
});

test('market item detail imports both line amounts and subtotals as supporting figures only', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('WEEK 1');
  sheet.addRow(['ITEM', 'QUANTITY', 'AMT']);
  sheet.addRow(['EGGS', '2 crates', 100]);
  sheet.addRow(['TOTAL', '', 100]);

  const records = [];
  importMarketDetail(sourceFile, sheet, records);

  assert.deepEqual(records.map(({ entryType, amount, countsInTotals }) => [
    entryType, amount, countsInTotals,
  ]), [
    ['expense', '100.00', false],
    ['summary', '100.00', false],
  ]);
});

test('annual overlapping weekly figures and workbook totals remain supporting, not double-counted', () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('2026');
  sheet.getCell('C1').value = 'REVENUE - JANUARY - APRIL 2026';
  sheet.getCell('S1').value = 'REVENUE - SEPTEMBER TO DECEMBER, 2026';
  sheet.getCell('A3').value = 'WEEK';
  sheet.getCell('B3').value = 'M';
  sheet.getCell('G3').value = 'TOTAL';
  sheet.getCell('R3').value = 'WEEK';
  sheet.getCell('S3').value = 'M';
  sheet.getCell('X3').value = 'TOTAL';
  sheet.getCell('A4').value = 1;
  sheet.getCell('B4').value = 100;
  sheet.getCell('R4').value = 1;
  sheet.getCell('S4').value = 200;
  sheet.getCell('G19').value = 100;
  sheet.getCell('X19').value = 200;
  sheet.getCell('U22').value = 'OVERALL TOTAL';
  sheet.getCell('W22').value = 300;

  const records = [];
  importAnnualSheet(sourceFile, sheet, records);

  assert.equal(records.find((record) => record.periodLabel.includes('Week 1 · M'))?.countsInTotals, true);
  assert.equal(records.find((record) => record.periodLabel.includes('Week 1 · M') && !record.countsInTotals)?.amount, '200.00');
  assert.ok(records.some((record) => record.periodLabel === '2026 · Overall workbook total'
    && record.amount === '300.00' && !record.countsInTotals));
});
