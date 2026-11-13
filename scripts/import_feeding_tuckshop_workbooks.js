require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const ExcelJS = require(path.join(__dirname, '../frontend/node_modules/exceljs'));

const expectedFiles = 4;

const inspectWorkbook = async (filePath) => {
  const fileData = fs.readFileSync(filePath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileData);
  const sheets = workbook.worksheets.map((sheet) => {
    let nonEmptyRows = 0;
    sheet.eachRow((row) => {
      if (row.values.slice(1).some((value) => value !== null && value !== undefined && value !== '')) {
        nonEmptyRows += 1;
      }
    });
    return {
      name: sheet.name,
      rows: sheet.rowCount,
      columns: sheet.columnCount,
      nonEmptyRows,
    };
  });
  return {
    fileName: path.basename(filePath),
    fileData,
    fileHash: crypto.createHash('sha256').update(fileData).digest('hex'),
    sheets,
    rowCount: sheets.reduce((sum, sheet) => sum + sheet.nonEmptyRows, 0),
  };
};

async function main() {
  const files = process.argv.slice(2);
  if (files.length !== expectedFiles) {
    throw new Error(`Pass exactly ${expectedFiles} workbook paths, in any order.`);
  }
  for (const file of files) {
    if (path.extname(file).toLowerCase() !== '.xlsx' || !fs.existsSync(file)) {
      throw new Error(`Workbook path is missing or is not an .xlsx file: ${file}`);
    }
  }
  if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_UNPOOLED) {
    throw new Error('Set DATABASE_URL in backend/.env first.');
  }

  const workbooks = await Promise.all(files.map(inspectWorkbook));
  const adminConnectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  const directUrl = new URL(adminConnectionString);
  if (directUrl.hostname.includes('-pooler.')) {
    if (!directUrl.hostname.endsWith('.neon.tech')) {
      throw new Error('Set DATABASE_URL_UNPOOLED to a direct, non-pooled database connection.');
    }
    directUrl.hostname = directUrl.hostname.replace('-pooler.', '.');
  }
  const adminPool = new Pool({ connectionString: directUrl.toString() });
  const appPool = new Pool({
    connectionString: process.env.APP_DATABASE_URL || directUrl.toString(),
  });
  let client;
  try {
    const schoolResult = await adminPool.query('SELECT id FROM schools ORDER BY id');
    if (schoolResult.rows.length !== 1) {
      throw new Error(`Expected exactly one school in the database; found ${schoolResult.rows.length}.`);
    }
    const schoolId = schoolResult.rows[0].id;

    client = await appPool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.school_id', $1, TRUE)", [String(schoolId)]);
    const imported = [];
    for (const workbook of workbooks) {
      const result = await client.query(
        `INSERT INTO feeding_tuckshop_imported_workbooks
           (school_id, file_name, file_hash, file_data, sheet_summary)
         VALUES ($1, $2, $3, $4, $5::JSONB)
         ON CONFLICT (school_id, file_name, file_hash) DO NOTHING
         RETURNING id`,
        [
          schoolId,
          workbook.fileName,
          workbook.fileHash,
          workbook.fileData,
          JSON.stringify(workbook.sheets),
        ]
      );
      imported.push({ ...workbook, inserted: result.rowCount === 1 });
    }
    await client.query('COMMIT');

    for (const workbook of imported) {
      console.log(
        `${workbook.inserted ? 'Imported' : 'Already present'}: ${workbook.fileName} ` +
        `(${workbook.sheets.length} sheets, ${workbook.rowCount} non-empty rows)`
      );
    }
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client?.release();
    await Promise.all([adminPool.end(), appPool.end()]);
  }
}

main().catch((error) => {
  console.error('Feeding and tuckshop workbook import failed:', error.message);
  process.exitCode = 1;
});
