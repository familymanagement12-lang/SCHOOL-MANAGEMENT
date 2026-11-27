const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const pool = require('./config/db');

const app = express();

app.use(helmet());
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map((value) => value.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api', routes);
app.use('/api/fee-structures', require('./routes/feeStructures'));

app.get('/', (req, res) => {
  res.json({ message: 'School Management System API is running' });
});

app.get('/health/ready', async (req,res) => {
  try {
    await pool.query('SELECT 1');
    res.setHeader('Cache-Control','no-store');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).setHeader('Cache-Control','no-store').json({ status: 'unavailable' });
  }
});

app.use(errorHandler);

module.exports = app;
