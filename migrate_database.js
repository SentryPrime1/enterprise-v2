// Database Migration Script for SentryPrime Platform Connections
// Run this script to set up the database tables for storing platform connections

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database configuration - same as server.js
function getDatabaseConfig() {
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
        throw new Error('Missing required database environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
    }

    const isCloudRun = process.env.K_SERVICE && process.env.DB_HOST.includes(':');
    
    if (isCloudRun) {
        return {
            host: `/cloudsql/${process.env.DB_HOST}`,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 10
        };
    } else {
        return {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 10
        };
    }
}

async function runMigration() {
    let db = null;
    
    try {
        console.log('🔄 Starting database migration...');
        
        // Connect to database
        const dbConfig = getDatabaseConfig();
        db = new Pool(dbConfig);
        
        // Test connection
        const testResult = await db.query('SELECT NOW() as current_time');
        console.log('✅ Database connected successfully');
        console.log('⏰ Server time:', testResult.rows[0].current_time);
        
        // Read and execute schema file
        const schemaPath = path.join(__dirname, 'database_schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        
        console.log('📝 Executing database schema...');
        await db.query(schemaSql);
        console.log('✅ Database schema created successfully');
        
        // Insert sample data for testing
        console.log('📝 Inserting sample data...');
        await insertSampleData(db);
        console.log('✅ Sample data inserted successfully');
        
        // Verify tables were created
        console.log('🔍 Verifying table creation...');
        const tables = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('users', 'user_tier_info', 'website_connections', 'deployment_history', 'platform_capabilities')
            ORDER BY table_name
        `);
        
        console.log('📊 Created tables:');
        tables.rows.forEach(row => {
            console.log(`  ✓ ${row.table_name}`);
        });
        
        console.log('🎉 Migration completed successfully!');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('🔍 Error details:', error);
        process.exit(1);
    } finally {
        if (db) {
            await db.end();
        }
    }
}

async function insertSampleData(db) {
    // Insert sample users
    await db.query(`
        INSERT INTO users (id, email, name, tier_name, subscription_status) VALUES
        (1, 'john@company.com', 'John Doe', 'premium', 'active'),
        (2, 'jane@startup.com', 'Jane Smith', 'basic', 'inactive')
        ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        name = EXCLUDED.name,
        tier_name = EXCLUDED.tier_name,
        subscription_status = EXCLUDED.subscription_status
    `);
    
    // Insert user tier info
    await db.query(`
        INSERT INTO user_tier_info (user_id, tier_name, tier_features, subscription_status, is_active, connected_platforms) VALUES
        (1, 'premium', '{"auto_deployment": true, "unlimited_scans": true, "priority_support": true}', 'active', true, 1),
        (2, 'basic', '{"auto_deployment": false, "unlimited_scans": false, "priority_support": false}', 'inactive', true, 0)
        ON CONFLICT (user_id) DO UPDATE SET
        tier_name = EXCLUDED.tier_name,
        tier_features = EXCLUDED.tier_features,
        subscription_status = EXCLUDED.subscription_status,
        is_active = EXCLUDED.is_active,
        connected_platforms = EXCLUDED.connected_platforms
    `);
    
    // Insert sample website connections
    await db.query(`
        INSERT INTO website_connections (user_id, platform_type, website_url, connection_name, connection_status, connection_config, last_connected_at) VALUES
        (1, 'shopify', 'https://essolar.com', 'ESSolar Shopify Store', 'active', '{"method": "shopify_api", "authenticated": true, "store_domain": "essolar.myshopify.com"}', CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, website_url) DO UPDATE SET
        platform_type = EXCLUDED.platform_type,
        connection_name = EXCLUDED.connection_name,
        connection_status = EXCLUDED.connection_status,
        connection_config = EXCLUDED.connection_config,
        last_connected_at = EXCLUDED.last_connected_at
    `);
    
    console.log('  ✓ Sample users created');
    console.log('  ✓ User tier info created');
    console.log('  ✓ Platform connections created');
    console.log('  ✓ User 1 (john@company.com) has premium tier with Shopify connection to essolar.com');
}

// Run migration if this file is executed directly
if (require.main === module) {
    runMigration();
}

module.exports = { runMigration, getDatabaseConfig };
