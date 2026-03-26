import pg from 'pg';
import config from '../config/index.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

export const query = async (text, params) => {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount });
  return res;
};

export const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  
  client.query = async (...args) => {
    const start = Date.now();
    const result = await originalQuery(...args);
    const duration = Date.now() - start;
    console.log('Query from client', { duration, rows: result.rowCount });
    return result;
  };
  
  client.release = () => {
    client.query = originalQuery;
    return release();
  };
  
  return client;
};

export default pool;
