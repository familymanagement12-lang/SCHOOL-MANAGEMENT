const crypto = require('crypto');
const ExcelJS = require('exceljs');

const workbookModules = new Map([
  ['LUNCH 2026_2027.xlsx', 'lunch'],
  ['PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx', 'purchases'],
  ['MARKET STOCK SEPT TO DEC, 2026.xlsx', 'market'],
  ['FEEDING AND MARKETING 2024_2025.xlsx', 'marketing'],
]);

const plainValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value !== 'object') return value;
  if (value.formula || value.sharedFormula) {
    return { formula: value.formula || value.sharedFormula, value: plainValue(value.result) };
  }
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('');
  if (value.text) return value.text;
  if (value.result !== undefined) return plainValue(value.result);
  return JSON.stringify(value);
};

const cellText = (values, address) => {
  const value = values[address];
  return String(value && typeof value === 'object' ? value.value ?? '' : value ?? '').trim();
};

const isEmpty = (values) => Object.values(values).every((value) => (
  value === '' || value === null || value === undefined
));

function classifyRow(module, sheetName, sourceRow, values) {
  const keys = Object.keys(values).sort();
  const firstText = keys.map((key) => cellText(values, key)).find(Boolean) || '';
  if (module === 'lunch' && sheetName.startsWith('Copy of TERM') && sourceRow >= 4) {
    const name = cellText(values, 'B');
    if (name && !/^(NAME|STUDENT NAME|STUDENT['’]S NAME|WEEKLY|MONTHLY|TERM(?:LY)?|DAILY|TOTAL)$/i.test(name)) {
      const studentName = name;
      const className = cellText(values, 'C');
      const paymentMethod = cellText(values, 'D');
      const isNonEating = /DON['’]?T EAT|DO NOT EAT|NOT EATING/i.test(studentName);
      const issues = [];
      if (!className && !isNonEating) issues.push('Class is missing; do not assign a class without review.');
      if (!paymentMethod && !isNonEating) issues.push('Mode of payment is missing; do not infer a payment method.');
      if (isNonEating) issues.push('Workbook marks this student as not eating; preserved as historical detail and excluded from active payer totals.');
      return {
        rowKind: 'lunch_student',
        status: issues.some((issue) => !issue.startsWith('Workbook marks this student as not eating')) ? 'incomplete' : 'ready',
        issues,
        studentName,
        className,
        paymentMethod,
        isNonEating,
      };
    }
  }
  const isHeading = /^(NAME|STUDENT NAME|STUDENT['’]S NAME|WEEK|TERM|MONTH|TOTAL|REVENUE|EXPENSES?|DATE|ITEMS?|QUANTITY|AMT|AMOUNT|PRICE|DAILY|PURCHASES FROM|BOUGHT AT)/i.test(firstText);
  const rowKind = isHeading ? 'heading_or_summary' : 'source_row';
  return {
    rowKind,
    status: isHeading ? 'rejected' : 'ready',
    issues: isHeading ? ['This row appears to be a worksheet heading or subtotal, not a transaction. Review it before importing.'] : [],
  };
}

async function parseWorkbook(buffer, fileName) {
  const module = workbookModules.get(fileName);
  if (!module) throw Object.assign(new Error('Choose one of the four supported source workbooks.'), { status: 400 });
  if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.subarray(0, 2).toString() !== 'PK') {
    throw Object.assign(new Error('The uploaded file is not a valid .xlsx workbook.'), { status: 400 });
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw Object.assign(new Error('The uploaded workbook could not be read. Check the file and try again.'), { status: 400 });
  }
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const rows = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (row.cellCount > 100) {
        throw Object.assign(new Error(`Worksheet "${sheet.name}" has a row wider than the supported 100 columns.`), { status: 400 });
      }
      const originalValues = {};
      for (let column = 1; column <= row.cellCount; column += 1) {
        const cell = row.getCell(column);
        originalValues[cell.address.replace(/\d+$/, '')] = plainValue(cell.value);
      }
      if (isEmpty(originalValues)) return;
      const sourceRow = row.number;
      const classification = classifyRow(module, sheet.name, sourceRow, originalValues);
      const importKey = crypto.createHash('sha256').update([
        hash, module, sheet.name, sourceRow,
      ].join('\0')).digest('hex');
      rows.push({
        importKey,
        sheetName: sheet.name,
        sourceRow,
        originalValues,
        reviewValues: originalValues,
        ...classification,
      });
      if (rows.length > 6000) {
        throw Object.assign(new Error('A workbook preview may contain no more than 6,000 non-empty rows.'), { status: 413 });
      }
    });
  }
  if (!rows.length) throw Object.assign(new Error('The workbook contains no non-empty rows.'), { status: 400 });
  return { module, sourceHash: hash, rows };
}

function validateReviewValues(module, rowKind, values, originalValues = {}) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    return ['Corrected values must be an object keyed by spreadsheet column.'];
  }
  const columns = Object.keys(values);
  if (columns.length > 100 || columns.some((column) => !/^[A-Z]{1,3}$/.test(column))) {
    return ['Corrected values may contain no more than 100 valid spreadsheet columns.'];
  }
  if (Object.values(values).some((value) => (
    typeof value === 'string' && value.length > 2000
  ) || (
    typeof value === 'number' && !Number.isFinite(value)
  ) || (
    value !== null && typeof value === 'object'
      && (Array.isArray(value) || JSON.stringify(value).length > 2000)
  ))) {
    return ['Each corrected cell must contain a supported value of no more than 2,000 characters.'];
  }
  if (rowKind === 'heading_or_summary') {
    return ['Worksheet headings and subtotals cannot be imported as data rows.'];
  }
  if (module === 'lunch' && rowKind === 'lunch_student') {
    if (!cellText(values, 'B')) return ['Student name is required.'];
    if (/DON['’]?T EAT|DO NOT EAT|NOT EATING/i.test(cellText(originalValues, 'B'))) {
      return [];
    }
    const issues = [];
    if (!cellText(values, 'C')) issues.push('Class is required.');
    if (!cellText(values, 'D')) issues.push('Mode of payment is required.');
    return issues;
  }
  return [];
}

module.exports = { classifyRow, parseWorkbook, validateReviewValues, workbookModules };
