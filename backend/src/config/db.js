const { Pool } = require('pg');
const dotenv = require('dotenv');
const requestContext = require('./requestContext');

dotenv.config();

const pool = new Pool({
  connectionString: process.env.APP_DATABASE_URL,
});

const originalConnect = pool.connect.bind(pool);
const verifiedClients = new WeakSet();
const verifyRlsRole = async (client) => {
  if (verifiedClients.has(client)) return;
  const result = await client.query(
    `SELECT (
       r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole
       OR EXISTS (
         SELECT 1 FROM pg_roles owner_role
         WHERE owner_role.rolname = 'neondb_owner'
           AND pg_has_role(r.oid, owner_role.oid, 'MEMBER')
       )
       OR EXISTS (
         SELECT 1 FROM pg_class owned
         JOIN pg_namespace schema ON schema.oid = owned.relnamespace
         WHERE schema.nspname = 'public' AND owned.relowner = r.oid
       )
       OR EXISTS (
         SELECT 1 FROM pg_namespace schema
         WHERE schema.nspname = 'public' AND schema.nspowner = r.oid
       )
     ) AS unsafe_role
     FROM pg_roles r
     WHERE r.rolname = current_user`
  );
  if (!result.rows.length || result.rows[0].unsafe_role) {
    throw new Error('The application database role must be non-owner, non-privileged, and unable to bypass RLS. Configure APP_DATABASE_URL with a restricted runtime role.');
  }
  verifiedClients.add(client);
};
const setRequestScope = (client, user) => client.query(
  `SELECT set_config('app.school_id', $1, false),
          set_config('app.user_id', $2, false),
          set_config('app.role', $3, false)`,
  [String(user.school_id), String(user.id), String(user.role)]
);
const clearRequestScope = (client) => client.query(
  `SELECT set_config('app.school_id', '', false),
          set_config('app.user_id', '', false),
          set_config('app.role', '', false)`
);

pool.connect = function connectWithRequestScope(callback) {
  const user = requestContext.getStore();
  if (typeof callback === 'function') {
    return originalConnect((error, client, release) => {
      if (error) return callback(error, client, release);
      verifyRlsRole(client)
        .then(() => user ? setRequestScope(client, user) : undefined)
        .then(() => {
          if (!user) return callback(null, client, release);
          const scopedClient = wrapClient(client, release);
          callback(null, scopedClient, scopedClient.release);
        })
        .catch((scopeError) => {
          release(scopeError);
          callback(scopeError);
        });
    });
  }
  return originalConnect().then(async (client) => {
    try {
      await verifyRlsRole(client);
      if (!user) return client;
      await setRequestScope(client, user);
      return wrapClient(client, client.release.bind(client));
    } catch (error) {
      client.release(error);
      throw error;
    }
  });
}

function wrapClient(client, release) {
  const query = client.query.bind(client);
  let transactionOpen = false;
  client.query = (...args) => {
    const sql = typeof args[0] === 'string' ? args[0].trim().toUpperCase() : '';
    const result = query(...args);
    if (sql === 'BEGIN' || sql.startsWith('BEGIN ')) transactionOpen = true;
    if (sql === 'COMMIT' || sql === 'END' || sql === 'ROLLBACK') transactionOpen = false;
    return result;
  };
  client.release = (error) => releaseClient(client, release, error, transactionOpen);
  return client;
}

function releaseClient(client, release, error, transactionOpen = false) {
  const query = client.query.bind(client);
  const cleanup = transactionOpen
    ? query('ROLLBACK').catch(() => undefined)
    : Promise.resolve();
  cleanup
    .then(() => clearRequestScope(client))
    .then(() => release(error))
    .catch((cleanupError) => {
      console.error('Failed to clear PostgreSQL request scope:', cleanupError);
      release(cleanupError || error);
    });
}

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(-1);
});

module.exports = pool;
