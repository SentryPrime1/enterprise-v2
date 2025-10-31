import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDb() {
  if (!pool) {
    // Detect if we're running in Cloud Run with Cloud SQL connection
    const isCloudRun = process.env.K_SERVICE && process.env.DB_HOST?.includes(':');
    
    let dbConfig;
    
    if (isCloudRun) {
      // Cloud Run with Cloud SQL connection - use Unix socket
      dbConfig = {
        host: `/cloudsql/${process.env.DB_HOST}`,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10
      };
    } else {
      // Local or other environment - use TCP connection
      dbConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10
      };
    }

    pool = new Pool(dbConfig);
    
    // Test connection
    pool.query('SELECT NOW() as current_time')
      .then((result) => {
        console.log('✅ Database connected successfully!');
        console.log('⏰ Server time:', result.rows[0].current_time);
      })
      .catch((err) => {
        console.log('❌ Database connection failed:', err.message);
      });
  }
  
  return pool;
}

export async function query(text: string, params?: any[]) {
  const db = getDb();
  if (!db) {
    throw new Error('Database not initialized');
  }
  return db.query(text, params);
}

