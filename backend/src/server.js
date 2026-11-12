const dotenv = require('dotenv');
dotenv.config();

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Configure backend/.env before starting the API.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be configured with at least 32 characters.');
if (process.env.NODE_ENV === 'production' && !process.env.APP_DATABASE_URL) {
  throw new Error('APP_DATABASE_URL is required in production. Use a dedicated database role without superuser or BYPASSRLS privileges.');
}

const app = require('./app');
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => { console.log(`The McCarthy Hill School API listening on http://localhost:${PORT}`); });
