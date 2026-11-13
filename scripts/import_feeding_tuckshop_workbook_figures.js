require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require(path.join(__dirname, '../frontend/node_modules/exceljs'));

const expectedFiles = [
  'FEEDING AND MARKETING 2024_2025.xlsx',
  'MARKET STOCK SEPT TO DEC, 2026.xlsx',
  'PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx',
  'LUNCH 2026_2027.xlsx',
];

const textValue = (cell) => {
  const value = cell?.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === 'object') {
    if (typeof value.result === 'string') return value.result;
    if (value.text) return value.text;
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
    return '';
  }
  return value === null || value === undefined ? '' : String(value).trim();
};

const numericValue = (cell) => {
  let value = cell?.value;
  if (value && typeof value === 'object') value = value.result;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[,\s₵GH]/gi, '');
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  if (/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)+$/.test(normalized)) {
    return normalized.split('+').reduce((total, part) => total + Number(part), 0);
  }
  return null;
};

const columnName = (column) => {
  let n = column;
  let name = '';
  while (n > 0) {
    n -= 1;
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26);
  }
  return name;
};

const amountFor = (sheet, row, column) => numericValue(sheet.getCell(row, column));
const textFor = (sheet, row, column) => textValue(sheet.getCell(row, column));
const nonemptyText = (value) => typeof value === 'string' && value.trim() !== '';

function addFigure(records, file, sheet, options) {
  const amount = Number(options.amount);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const importKey = crypto.createHash('sha256').update([
    file.hash, sheet.name, options.row, options.column, options.module, options.entryType,
    options.role, amount.toFixed(2),
  ].join('\0')).digest('hex');
  records.push({
    module: options.module,
    entryType: options.entryType,
    amount: amount.toFixed(2),
    periodLabel: options.periodLabel,
    description: options.description.slice(0, 500),
    sourceFile: file.name,
    sourceHash: file.hash,
    sheetName: sheet.name,
    sourceRow: options.row,
    sourceColumn: columnName(options.column),
    importKey,
    countsInTotals: options.role === 'ledger',
    supportReason: options.supportReason || null,
  });
}

function importAnnualSheet(file, sheet, records) {
  const year = Number(sheet.name);
  if (!Number.isInteger(year) || year < 2024 || year > 2026) return;
  const layout = year === 2024
    ? {
      incomeHeader: 4, expenseHeader: 31, incomeDataStart: 5, incomeDataEnd: 19,
      expenseDataStart: 32, expenseDataEnd: 46,
      blocks: [[3, 9], [11, 17], [19, 25]],
      incomeLabelRow: 2, expenseLabelRow: 29,
    }
    : year === 2025
      ? {
        incomeHeader: 4, expenseHeader: 31, incomeDataStart: 5, incomeDataEnd: 19,
        expenseDataStart: 32, expenseDataEnd: 46,
        blocks: [[1, 7], [9, 15], [18, 24]],
        incomeLabelRow: 2, expenseLabelRow: 29,
      }
      : {
        incomeHeader: 3, expenseHeader: 25, incomeDataStart: 4, incomeDataEnd: 18,
        expenseDataStart: 26, expenseDataEnd: 40,
        blocks: [[1, 7], [9, 15], [18, 24]],
        incomeLabelRow: 1, expenseLabelRow: 23,
      };

  for (const [sectionIndex, [startColumn, endColumn]] of layout.blocks.entries()) {
    for (const section of [
      {
        entryType: 'income',
        module: 'feeding',
        headerRow: layout.incomeHeader,
        startRow: layout.incomeDataStart,
        endRow: layout.incomeDataEnd,
        labelRow: layout.incomeLabelRow,
      },
      {
        entryType: 'expense',
        module: 'marketing',
        headerRow: layout.expenseHeader,
        startRow: layout.expenseDataStart,
        endRow: layout.expenseDataEnd,
        labelRow: layout.expenseLabelRow,
      },
    ]) {
      const labelParts = [];
      for (let column = startColumn; column <= endColumn; column += 1) {
        const label = textFor(sheet, section.labelRow, column);
        if (nonemptyText(label) && !labelParts.includes(label)) labelParts.push(label);
      }
      const periodName = labelParts.join(' ').replace(/\s+/g, ' ').trim() || String(year);
      const isOverlapping2026 = year === 2026 && sectionIndex === 2;
      const overlapReason = isOverlapping2026
        ? 'September–December 2026 also appears in the term ledger. Kept for source comparison, not added again.'
        : null;
      const weekdays = [];
      for (let column = startColumn + 1; column < endColumn; column += 1) {
        weekdays.push({ column, name: textFor(sheet, section.headerRow, column) || `Column ${columnName(column)}` });
      }
      for (let row = section.startRow; row <= section.endRow; row += 1) {
        const week = textFor(sheet, row, startColumn);
        if (!/^\d+$/.test(week)) continue;
        for (const weekday of weekdays) {
          const amount = amountFor(sheet, row, weekday.column);
          if (!amount) continue;
          addFigure(records, file, sheet, {
            module: section.module,
            entryType: section.entryType,
            amount,
            row,
            column: weekday.column,
            periodLabel: `${periodName} · Week ${week} · ${weekday.name}`,
            description: `${section.entryType === 'income' ? 'Feeding income' : 'Marketing expense'} from the weekly workbook.`,
            role: isOverlapping2026 ? 'support' : 'ledger',
            supportReason: overlapReason,
          });
        }
      }

      const totalRow = section.endRow + 1;
      const totalAmount = amountFor(sheet, totalRow, endColumn);
      if (totalAmount) {
        addFigure(records, file, sheet, {
          module: section.module,
          entryType: section.entryType,
          amount: totalAmount,
          row: totalRow,
          column: endColumn,
          periodLabel: `${periodName} · Workbook total`,
          description: 'Workbook subtotal; the daily figures are imported separately.',
          role: 'support',
          supportReason: isOverlapping2026
            ? overlapReason
            : 'Workbook subtotal retained for comparison and excluded from totals to prevent double-counting.',
        });
      }
    }
  }

  for (let row = 1; row <= sheet.rowCount; row += 1) {
    let totalLabel = '';
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const value = textFor(sheet, row, column);
      if (/OVERALL TOTAL/i.test(value)) totalLabel = value;
    }
    if (!totalLabel) continue;
    const isExpenseTotal = row > layout.expenseHeader;
    const module = isExpenseTotal ? 'marketing' : 'feeding';
    const entryType = isExpenseTotal ? 'expense' : 'income';
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const amount = amountFor(sheet, row, column);
      if (!amount) continue;
      addFigure(records, file, sheet, {
        module,
        entryType,
        amount,
        row,
        column,
        periodLabel: `${year} · Overall workbook total`,
        description: totalLabel,
        role: 'support',
        supportReason: 'Overall workbook total retained for audit and excluded from totals to prevent double-counting.',
      });
    }
  }
}

function importTermLedger(file, sheet, records) {
  let currentWeek = 'Term 1';
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    const firstCell = textFor(sheet, row, 1);
    const rowValues = [1, 2, 3, 4].map((column) => textFor(sheet, row, column));
    const weekMatch = firstCell.match(/^WEEK\s+(\d+)/i);
    if (weekMatch) currentWeek = `Term 1 · Week ${weekMatch[1]}`;

    if (/^TOTAL$/i.test(firstCell)) {
      for (const [column, entryType] of [[2, 'income'], [3, 'expense']]) {
        const amount = amountFor(sheet, row, column);
        if (amount) {
          addFigure(records, file, sheet, {
            module: sheet.name.startsWith('TUCK SHOP') ? 'tuckshop' : 'feeding',
            entryType,
            amount,
            row,
            column,
            periodLabel: `${currentWeek} · Workbook total`,
            description: `${entryType === 'income' ? 'Income' : 'Expense'} subtotal.`,
            role: 'support',
            supportReason: 'Weekly subtotal retained for comparison and excluded from totals to prevent double-counting.',
          });
        }
      }
      continue;
    }

    if (rowValues.some((value) => /^P\/L$/i.test(value))) {
      for (const column of [2, 3]) {
        const amount = amountFor(sheet, row, column);
        if (amount) {
          addFigure(records, file, sheet, {
            module: sheet.name.startsWith('TUCK SHOP') ? 'tuckshop' : 'feeding',
            entryType: 'summary',
            amount,
            row,
            column,
            periodLabel: `${currentWeek} · Profit/loss`,
            description: 'Workbook profit/loss summary; not added to income or expense totals.',
            role: 'support',
            supportReason: 'Derived workbook figure; excluded from totals to prevent double-counting.',
          });
        }
      }
      continue;
    }

    const module = sheet.name.startsWith('TUCK SHOP') ? 'tuckshop' : 'feeding';
    const dateOrReference = firstCell && !/^WEEK\b/i.test(firstCell) ? firstCell : '';
    const description = textFor(sheet, row, 4);
    for (const [column, entryType] of [[2, 'income'], [3, 'expense']]) {
      const amount = amountFor(sheet, row, column);
      if (!amount) continue;
      const context = dateOrReference ? ` · ${dateOrReference}` : '';
      const lineDescription = entryType === 'expense'
        ? description || 'Operational expense'
        : /MOMO/i.test(dateOrReference) ? 'Mobile money income' : 'Operational income';
      addFigure(records, file, sheet, {
        module,
        entryType,
        amount,
        row,
        column,
        periodLabel: `${currentWeek}${context}`,
        description: lineDescription,
        role: 'ledger',
      });
    }
  }
}

function importLunchDetail(file, sheet, records) {
  const weekColumns = [];
  for (let column = 5; column <= 19; column += 1) {
    const week = textFor(sheet, 2, column);
    if (/^\d+$/.test(week)) weekColumns.push({ column, week });
  }
  for (let row = 4; row <= 225; row += 1) {
    for (const { column, week } of weekColumns) {
      const amount = amountFor(sheet, row, column);
      if (!amount) continue;
      addFigure(records, file, sheet, {
        module: 'feeding',
        entryType: 'income',
        amount,
        row,
        column,
        periodLabel: `Term 1 · Week ${week} · Student lunch payment detail`,
        description: 'Lunch payment detail; student identity is not copied into the finance ledger.',
        role: 'support',
        supportReason: 'Supporting student payment figure; the term income ledger is used for totals and student balances remain unchanged.',
      });
    }
  }

  for (const { column, week } of weekColumns) {
    const amount = amountFor(sheet, 227, column);
    if (!amount) continue;
    addFigure(records, file, sheet, {
      module: 'feeding',
      entryType: 'income',
      amount,
      row: 227,
      column,
      periodLabel: `Term 1 · Week ${week} · Workbook total`,
      description: 'Weekly lunch workbook total; retained for reconciliation.',
      role: 'support',
      supportReason: week === '4'
        ? 'Conflicts with the dated feeding ledger: GH₵12,620 in the lunch/annual summaries versus GH₵11,125 in the dated ledger. The dated ledger drives totals; this figure is retained for review.'
        : 'Weekly summary overlaps the term income ledger and is excluded from totals to prevent double-counting.',
    });
  }
}

function amountHeaderRank(value) {
  const normalized = value.toUpperCase().replace(/\s+/g, ' ').trim();
  if (normalized === 'TOTAL PRICE' || normalized === 'TOTAL AMOUNT') return 5;
  if (normalized === 'AMT' || normalized === 'AMOUNT') return 4;
  if (normalized === 'PRICE') return 3;
  if (normalized.includes('TAX INCLUSIVE')) return 2;
  if (normalized.includes('UNIT PRICE')) return 1;
  return 0;
}

function importMarketDetail(file, sheet, records) {
  const headers = [];
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const value = textFor(sheet, row, column).toUpperCase().replace(/\s+/g, ' ').trim();
      const isItem = value === 'ITEM' || value === 'ITEMS';
      const isQuantity = value === 'QUANTITY' || value === 'QTY';
      if (!isItem && !isQuantity) continue;
      let itemColumn = isItem ? column : column - 1;
      if (itemColumn < 1) continue;
      let amountColumn = 0;
      let bestRank = 0;
      for (let candidate = column + 1; candidate <= Math.min(sheet.columnCount, column + 7); candidate += 1) {
        const rank = amountHeaderRank(textFor(sheet, row, candidate));
        if (rank > bestRank) {
          amountColumn = candidate;
          bestRank = rank;
        }
      }
      if (!amountColumn) continue;
      headers.push({ row, itemColumn, amountColumn, context: captureHeading(sheet, row, itemColumn, amountColumn) });
    }
  }

  const uniqueHeaders = [...new Map(headers.map((header) => [
    `${header.row}:${header.itemColumn}:${header.amountColumn}`,
    header,
  ])).values()];
  for (const header of uniqueHeaders) {
    const nextHeader = uniqueHeaders
      .filter((candidate) => candidate.row > header.row
        && candidate.itemColumn === header.itemColumn
        && candidate.amountColumn === header.amountColumn)
      .sort((a, b) => a.row - b.row)[0];
    const endRow = nextHeader ? nextHeader.row - 1 : Math.min(sheet.rowCount, header.row + 60);
    const module = /TUCK\s*SHOP/i.test(header.context) ? 'tuckshop' : 'feeding';
    let activeSection = sheet.name;
    for (let row = header.row + 1; row <= endRow; row += 1) {
      const label = textFor(sheet, row, header.itemColumn);
      const normalizedLabel = label.toUpperCase();
      const amount = amountFor(sheet, row, header.amountColumn);
      if (!label && amount === null) continue;
      if (/^(ITEM|ITEMS|QUANTITY|QTY|AMT|AMOUNT|PRICE|TOTAL PRICE)$/i.test(label)) continue;
      if (/(PURCHASES? FROM|BOUGHT AT|ITEMS? BOUGHT|PURCHASES? FOR|BOUGHT FOR)/i.test(label)) {
        activeSection = label;
        continue;
      }
      if (!amount || !nonemptyText(label)) continue;
      const isSummary = normalizedLabel.includes('TOTAL') || normalizedLabel.includes('BALANCE');
      addFigure(records, file, sheet, {
        module,
        entryType: isSummary ? 'summary' : 'expense',
        amount,
        row,
        column: header.amountColumn,
        periodLabel: `${sheet.name} · ${activeSection}`,
        description: isSummary ? label : `${label}${header.context ? ` · ${header.context}` : ''}`,
        role: 'support',
        supportReason: isSummary
          ? 'Workbook purchase subtotal retained for comparison and excluded from totals.'
          : 'Itemized market purchase detail supports weekly expense figures and is excluded from totals to prevent double-counting.',
      });
    }
  }
}

function captureHeading(sheet, headerRow, itemColumn, amountColumn) {
  const parts = [];
  for (let row = Math.max(1, headerRow - 2); row <= headerRow; row += 1) {
    for (let column = Math.max(1, itemColumn - 1); column <= Math.min(sheet.columnCount, amountColumn + 1); column += 1) {
      const value = textFor(sheet, row, column);
      if (nonemptyText(value) && !/^(ITEMS?|QUANTITY|QTY|AMT|AMOUNT|PRICE|TOTAL PRICE)$/i.test(value)) {
        parts.push(value);
      }
    }
  }
  return [...new Set(parts)].join(' ').replace(/\s+/g, ' ').trim();
}

async function inspectWorkbook(filePath) {
  const fileData = fs.readFileSync(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileData);
  return {
    name: path.basename(filePath),
    hash: crypto.createHash('sha256').update(fileData).digest('hex'),
    workbook,
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const filePaths = process.argv.slice(2).filter((argument) => argument !== '--dry-run');
  if (filePaths.length !== expectedFiles.length) {
    throw new Error(`Pass exactly ${expectedFiles.length} workbook paths, in any order.`);
  }
  for (const file of filePaths) {
    if (path.extname(file).toLowerCase() !== '.xlsx' || !fs.existsSync(file)) {
      throw new Error(`Workbook path is missing or is not an .xlsx file: ${file}`);
    }
  }
  const providedNames = filePaths.map((file) => path.basename(file)).sort();
  if (JSON.stringify(providedNames) !== JSON.stringify([...expectedFiles].sort())) {
    throw new Error('The workbook paths must be the four known Feeding/Tuckshop source workbooks.');
  }
  if (!dryRun && !process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
    throw new Error('Set DATABASE_URL in backend/.env first.');
  }

  const files = await Promise.all(filePaths.map(inspectWorkbook));
  const records = [];
  for (const file of files) {
    for (const sheet of file.workbook.worksheets) {
      if (!sheet.rowCount) continue;
      if (file.name === 'FEEDING AND MARKETING 2024_2025.xlsx') importAnnualSheet(file, sheet, records);
      if (file.name === 'PURCHASES FOR TUCK SHOP AND KITCHEN 2026_2027.xlsx') importTermLedger(file, sheet, records);
      if (file.name === 'LUNCH 2026_2027.xlsx' && sheet.name.startsWith('Copy of TERM 1')) {
        importLunchDetail(file, sheet, records);
      }
      if (file.name === 'MARKET STOCK SEPT TO DEC, 2026.xlsx') importMarketDetail(file, sheet, records);
    }
  }
  if (!records.length) throw new Error('No financial figures were found in the workbooks.');

  const totals = new Map();
  const fileTotals = new Map();
  for (const record of records) {
    const key = `${record.module} ${record.entryType} ${record.countsInTotals ? 'counted' : 'supporting'}`;
    const summary = totals.get(key) || { count: 0, amount: 0 };
    summary.count += 1;
    summary.amount += Number(record.amount);
    totals.set(key, summary);

    const fileKey = `${record.sourceFile} · ${key}`;
    const fileSummary = fileTotals.get(fileKey) || { count: 0, amount: 0 };
    fileSummary.count += 1;
    fileSummary.amount += Number(record.amount);
    fileTotals.set(fileKey, fileSummary);
  }
  console.log(`${dryRun ? 'Parsed' : 'Prepared'} ${records.length} financial figures.`);
  for (const [key, summary] of totals) {
    console.log(`${key}: ${summary.count} figures, GH₵${summary.amount.toFixed(2)}`);
  }
  if (dryRun) {
    for (const [key, summary] of fileTotals) {
      console.log(`${key}: ${summary.count} figures, GH₵${summary.amount.toFixed(2)}`);
    }
  }
  if (dryRun) return;

  const connectionString = process.env.APP_DATABASE_URL
    || process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const databaseUrl = new URL(connectionString);
  if (databaseUrl.hostname.includes('-pooler.') && databaseUrl.hostname.endsWith('.neon.tech')) {
    databaseUrl.hostname = databaseUrl.hostname.replace('-pooler.', '.');
  }
  const pool = new Pool({ connectionString: databaseUrl.toString() });
  let client;
  try {
    const schools = await pool.query('SELECT id FROM schools ORDER BY id');
    if (schools.rows.length !== 1) {
      throw new Error(`Expected exactly one school in the database; found ${schools.rows.length}.`);
    }
    const schoolId = schools.rows[0].id;
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.school_id', $1, TRUE)", [String(schoolId)]);

    let inserted = 0;
    const batchSize = 100;
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);
      const values = [];
      const tuples = batch.map((record, index) => {
        const start = index * 14;
        values.push(
          schoolId, record.module, record.entryType, record.amount, record.periodLabel,
          record.description, record.sourceFile, record.sourceHash, record.sheetName,
          record.sourceRow, record.sourceColumn, record.importKey, record.countsInTotals,
          record.supportReason
        );
        return `(${Array.from({ length: 14 }, (_, column) => `$${start + column + 1}`).join(', ')})`;
      });
      const result = await client.query(
        `INSERT INTO feeding_tuckshop_workbook_figures (
           school_id, module, entry_type, amount, period_label, description,
           source_file, source_hash, sheet_name, source_row, source_column,
           import_key, counts_in_totals, support_reason
         ) VALUES ${tuples.join(', ')}
         ON CONFLICT (school_id, import_key) DO NOTHING`,
        values
      );
      inserted += result.rowCount;
    }
    await client.query('COMMIT');

    console.log(`Imported ${inserted} new figures; ${records.length - inserted} were already present.`);
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Feeding/Tuckshop workbook figure import failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  importAnnualSheet,
  importLunchDetail,
  importMarketDetail,
  importTermLedger,
  numericValue,
};
