const dotenv = require('dotenv');
dotenv.config();
const { validateRuntimeConfig } = require('./config/runtimeConfig');
validateRuntimeConfig(process.env);

const app = require('./app');
const { startCurriculumSelectionScheduler } = require('./services/curriculumSelectionScheduler');
const pool = require('./config/db');
const PORT = process.env.PORT || 5000;

async function startServer() {
  const client = await pool.connect();
  client.release();
  app.listen(PORT, () => {
    console.log(`The McCarthy Hill School API listening on http://localhost:${PORT}`);
    startCurriculumSelectionScheduler();
  });
}

startServer().catch(async (error) => {
  console.error('API startup refused because runtime database verification failed:', error.message);
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
