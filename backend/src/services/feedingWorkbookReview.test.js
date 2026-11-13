const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const {
  parseWorkbook,
  validateReviewValues,
} = require('./feedingWorkbookReview');

async function workbookBuffer(name, build) {
  const workbook = new ExcelJS.Workbook();
  build(workbook);
  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    name,
  };
}

test('workbook parser preserves source rows, formulas, and explicit lunch data-quality flags', async () => {
  const { buffer, name } = await workbookBuffer('LUNCH 2026_2027.xlsx', (workbook) => {
    const sheet = workbook.addWorksheet('Copy of TERM 1 (SEPT-DEC 2026)');
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow([]);
    sheet.addRow([null, 'NAME', 'CLASS', 'MODE OF PAYMENT', 1, 2, null, null, null, null, null, null, null, null, null, null, null, null, null, 'TOTAL']);
    sheet.addRow([1, 'VALID STUDENT', 'Y 4A', 'CASH', 100, null, null, null, null, null, null, null, null, null, null, null, null, null, null, { formula: 'E5', result: 100 }]);
    sheet.addRow([2, 'MISSING MODE', 'Y 4A', null, 50]);
    sheet.addRow([3, 'MISSING CLASS', null, 'MOMO', 75]);
    sheet.addRow([null, "STUDENT (DON'T EAT)", null, null, 25]);
  });
  const parsed = await parseWorkbook(buffer, name);
  const studentRows = parsed.rows.filter((row) => row.rowKind === 'lunch_student');
  assert.equal(parsed.module, 'lunch');
  assert.equal(parsed.rows.find((row) => row.sourceRow === 4).rowKind, 'heading_or_summary');
  assert.equal(studentRows.length, 4);
  assert.deepEqual(studentRows[0].originalValues.T, { formula: 'E5', value: 100 });
  assert.equal(studentRows[1].status, 'incomplete');
  assert.ok(studentRows[1].issues.some((issue) => issue.includes('Mode of payment is missing')));
  assert.equal(studentRows[2].status, 'incomplete');
  assert.ok(studentRows[2].issues.some((issue) => issue.includes('Class is missing')));
  assert.equal(studentRows[3].isNonEating, true);
  assert.equal(studentRows[3].status, 'ready');
  assert.ok(studentRows[3].issues.some((issue) => issue.includes('excluded from active payer totals')));
  assert.ok(studentRows.every((row) => row.importKey && row.sheetName && row.sourceRow > 0));
});

test('review corrections require missing fields and keep non-eating rows as historical detail', () => {
  assert.deepEqual(
    validateReviewValues('market', 'source_row', { 'not a column': 'value' }),
    ['Corrected values may contain no more than 100 valid spreadsheet columns.']
  );
  assert.deepEqual(
    validateReviewValues('market', 'source_row', { A: 'x'.repeat(2001) }),
    ['Each corrected cell must contain a supported value of no more than 2,000 characters.']
  );
  assert.deepEqual(
    validateReviewValues('lunch', 'lunch_student', { B: 'MISSING MODE', C: 'Y 4A', D: '' }),
    ['Mode of payment is required.']
  );
  assert.deepEqual(
    validateReviewValues('lunch', 'lunch_student', { B: 'KUKU', C: 'PG', D: 'CASH' }),
    []
  );
  assert.deepEqual(
    validateReviewValues(
      'lunch',
      'lunch_student',
      { B: "STUDENT (DON'T EAT)", C: 'PG', D: 'CASH' },
      { B: "STUDENT (DON'T EAT)" }
    ),
    []
  );
  assert.deepEqual(
    validateReviewValues('lunch', 'heading_or_summary', { B: 'TOTAL' }),
    ['Worksheet headings and subtotals cannot be imported as data rows.']
  );
});

test('parser rejects unsupported workbook names and corrupt non-xlsx content', async () => {
  await assert.rejects(() => parseWorkbook(Buffer.from('PKsomething'), 'other.xlsx'), /one of the four supported/);
  await assert.rejects(() => parseWorkbook(Buffer.from('not xlsx'), 'LUNCH 2026_2027.xlsx'), /not a valid .xlsx/);
});
