const { Pool } = require('pg');
const fs = require('fs');

async function runMigration() {
    console.log('🔄 Starting database migration...');
    
    // Use Unix socket for Cloud SQL connection
    const db = new Pool({
        host: `/cloudsql/${process.env.DB_HOST}`,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10
    });
    
    try {
        // Test connection
        const testResult = await db.query('SELECT NOW() as current_time');
        console.log('✅ Database connected successfully');
        console.log('⏰ Server time:', testResult.rows[0].current_time);
        
        // Read and execute schema
        const schemaSql = fs.readFileSync('database_schema.sql', 'utf8');
        console.log('📝 Executing database schema...');
        await db.query(schemaSql);
        console.log('✅ Database schema created successfully');
        
        console.log('🎉 Migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await db.end();
    }
}

runMigration();
