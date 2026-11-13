import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';

const moneyFormat = '"GH₵"#,##0.00';

const addTableSheet = (workbook, name, columns, rows) => {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  columns.forEach((column, index) => {
    sheet.getCell(1, index + 1).value = column.header;
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + columns.length)}1` };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  sheet.addRows(rows);
  return sheet;
};

const downloadWorkbook = async (workbook, filename) => {
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), filename);
};

export const downloadOperationsReport = async (report, startDate, endDate) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The McCarthy Hill School';
  workbook.created = new Date();

  const feedingRows = (report.feedingWeeklyCollections || []).map((row) => ({
    ...row,
    monday: Number(row.monday || 0),
    tuesday: Number(row.tuesday || 0),
    wednesday: Number(row.wednesday || 0),
    thursday: Number(row.thursday || 0),
    friday: Number(row.friday || 0),
    saturday: Number(row.saturday || 0),
    sunday: Number(row.sunday || 0),
    total: Number(row.total || 0),
    feeding_days: Number(row.feeding_days || 0),
  }));
  addTableSheet(workbook, 'Feeding Weekday Income', [
    { header: 'Week beginning', key: 'week_start', width: 18 },
    ...['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      .map((day) => ({ header: day, key: day.toLowerCase(), width: 15, style: { numFmt: moneyFormat } })),
    { header: 'Total income', key: 'total', width: 16, style: { numFmt: moneyFormat } },
    { header: 'Feeding days covered', key: 'feeding_days', width: 22 },
  ], feedingRows);

  const weeklyRows = (report.weeklyOperations || []).map((row) => ({
    ...row,
    feeding_income: Number(row.feeding_income || 0),
    tuckshop_sales: Number(row.tuckshop_sales || 0),
    feeding_expenses: Number(row.feeding_expenses || 0),
    kitchen_expenses: Number(row.kitchen_expenses || 0),
    tuckshop_purchases: Number(row.tuckshop_purchases || 0),
    tuckshop_cogs: Number(row.tuckshop_cogs || 0),
    total_income: Number(row.total_income || 0),
    total_expenses: Number(row.total_expenses || 0),
    net: Number(row.total_income || 0) - Number(row.total_expenses || 0),
  }));
  addTableSheet(workbook, 'Weekly Income and Expenses', [
    { header: 'Week beginning', key: 'week_start', width: 18 },
    { header: 'Feeding income', key: 'feeding_income', width: 17, style: { numFmt: moneyFormat } },
    { header: 'Tuckshop sales', key: 'tuckshop_sales', width: 17, style: { numFmt: moneyFormat } },
    { header: 'Feeding expenses', key: 'feeding_expenses', width: 19, style: { numFmt: moneyFormat } },
    { header: 'Kitchen expenses', key: 'kitchen_expenses', width: 19, style: { numFmt: moneyFormat } },
    { header: 'Tuckshop stock purchases', key: 'tuckshop_purchases', width: 22, style: { numFmt: moneyFormat } },
    { header: 'Cost of goods sold', key: 'tuckshop_cogs', width: 19, style: { numFmt: moneyFormat } },
    { header: 'Total income', key: 'total_income', width: 16, style: { numFmt: moneyFormat } },
    { header: 'Total expenses', key: 'total_expenses', width: 17, style: { numFmt: moneyFormat } },
    { header: 'Net', key: 'net', width: 15, style: { numFmt: moneyFormat } },
  ], weeklyRows);

  addTableSheet(workbook, 'Operational I and E Detail', [
    { header: 'Date', key: 'entry_date', width: 15 },
    { header: 'Type', key: 'type', width: 18 },
    { header: 'Category', key: 'category', width: 30 },
    { header: 'Reference', key: 'reference', width: 24 },
    { header: 'Description', key: 'description', width: 42 },
    { header: 'Amount', key: 'amount', width: 16, style: { numFmt: moneyFormat } },
  ], (report.operationalLedgerEntries || []).map((entry) => ({
    ...entry,
    amount: Number(entry.amount || 0),
  })));

  addTableSheet(workbook, 'Purchase Details', [
    { header: 'Date', key: 'purchase_date', width: 15 },
    { header: 'Source', key: 'source', width: 20 },
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Supplier', key: 'supplier', width: 24 },
    { header: 'Reference', key: 'reference', width: 22 },
    { header: 'Items', key: 'items', width: 60 },
    { header: 'Total', key: 'total_amount', width: 15, style: { numFmt: moneyFormat } },
    { header: 'Status', key: 'status', width: 15 },
  ], (report.purchaseDetails || []).map((purchase) => ({
    ...purchase,
    total_amount: Number(purchase.total_amount || 0),
  })));

  await downloadWorkbook(workbook, `feeding-tuckshop-report-${startDate}-to-${endDate}.xlsx`);
};

export const downloadDailyFeedingRegister = async (entries, date) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The McCarthy Hill School';
  const sheet = addTableSheet(workbook, 'Daily Feeding Register', [
    { header: 'Student name', key: 'student_name', width: 32 },
    { header: 'Class', key: 'class_name', width: 20 },
    { header: 'Receipt', key: 'receipt_number', width: 24 },
    { header: 'Service status', key: 'status', width: 20 },
    { header: 'Served by', key: 'served_by_name', width: 28 },
  ], entries.map((entry) => ({
    ...entry,
    status: entry.is_served ? 'Served' : 'Not served',
    served_by_name: entry.served_by_name || '',
  })));
  sheet.getCell('A1').note = `School date: ${date}`;
  await downloadWorkbook(workbook, `daily-feeding-register-${date}.xlsx`);
};
