const { Pool } = require('pg');
const fs = require('fs');

async function runMigration() {
    console.log('🔄 Starting database migration...');
    
    // Database connection configuration
    const dbConfig = {
        host: `/cloudsql/${process.env.DB_HOST}`,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10
    };

    // Validate environment variables
    const requiredEnvVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        console.error('❌ Missing required database environment variables:', missingVars.join(', '));
        console.log('Please set the following environment variables:');
        requiredEnvVars.forEach(varName => {
            console.log(`  export ${varName}="your_value"`);
        });
        process.exit(1);
    }

    const db = new Pool(dbConfig);
    
    try {
        // Test connection
        console.log('🔌 Testing database connection...');
        const testResult = await db.query('SELECT NOW() as current_time, version() as pg_version');
        console.log('✅ Database connected successfully');
        console.log('⏰ Server time:', testResult.rows[0].current_time);
        console.log('🗄️  PostgreSQL version:', testResult.rows[0].pg_version.split(' ')[0]);
        
        // Check if this is a fresh install or an update
        console.log('🔍 Checking existing database structure...');
        const existingTables = await db.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('user_tier_info', 'website_connections', 'deployment_history', 'platform_capabilities')
        `);
        
        const tableNames = existingTables.rows.map(row => row.table_name);
        console.log('📋 Existing tables:', tableNames.length > 0 ? tableNames.join(', ') : 'None');
        
        // Read and execute schema
        console.log('📝 Reading database schema file...');
        if (!fs.existsSync('database_schema.sql')) {
            console.error('❌ database_schema.sql file not found');
            console.log('Please ensure database_schema.sql is in the current directory');
            process.exit(1);
        }
        
        const schemaSql = fs.readFileSync('database_schema.sql', 'utf8');
        console.log('🚀 Executing database schema...');
        
        // Execute schema in a transaction
        await db.query('BEGIN');
        
        try {
            await db.query(schemaSql);
            await db.query('COMMIT');
            console.log('✅ Database schema executed successfully');
        } catch (schemaError) {
            await db.query('ROLLBACK');
            throw schemaError;
        }
        
        // Verify the migration
        console.log('🔍 Verifying migration results...');
        
        // Check table counts
        const verificationQueries = [
            { name: 'User Tier Info', query: 'SELECT COUNT(*) as count FROM user_tier_info' },
            { name: 'Website Connections', query: 'SELECT COUNT(*) as count FROM website_connections' },
            { name: 'Deployment History', query: 'SELECT COUNT(*) as count FROM deployment_history' },
            { name: 'Platform Capabilities', query: 'SELECT COUNT(*) as count FROM platform_capabilities' }
        ];
        
        for (const verification of verificationQueries) {
            try {
                const result = await db.query(verification.query);
                console.log(`📊 ${verification.name}: ${result.rows[0].count} records`);
            } catch (error) {
                console.log(`⚠️  ${verification.name}: Table not accessible (${error.message})`);
            }
        }
        
        // Test the getUserPlatforms functionality
        console.log('🧪 Testing platform connections for user 1...');
        try {
            const platformTest = await db.query(`
                SELECT 
                    wc.platform_type,
                    wc.website_url,
                    wc.connection_name,
                    wc.connection_status,
                    wc.deployment_method
                FROM website_connections wc
                WHERE wc.user_id = 1 AND wc.connection_status = 'active'
            `);
            
            if (platformTest.rows.length > 0) {
                console.log('✅ Platform connections found for user 1:');
                platformTest.rows.forEach(row => {
                    console.log(`   📱 ${row.platform_type}: ${row.website_url} (${row.connection_status})`);
                });
            } else {
                console.log('⚠️  No active platform connections found for user 1');
            }
        } catch (error) {
            console.log('⚠️  Could not test platform connections:', error.message);
        }
        
        console.log('🎉 Migration completed successfully!');
        console.log('');
        console.log('Next steps:');
        console.log('1. Deploy your updated server.js with the database integration');
        console.log('2. Test the platform connection functionality');
        console.log('3. Users can now connect platforms during onboarding');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error('🔍 Error details:', error);
        
        // Provide helpful error messages for common issues
        if (error.message.includes('ENOTFOUND')) {
            console.log('');
            console.log('💡 Connection troubleshooting:');
            console.log('- Ensure you are running this from Google Cloud Shell or a machine with access to your Cloud SQL instance');
            console.log('- Verify your DB_HOST format: "project:region:instance-name"');
            console.log('- Check that your Cloud SQL instance is running');
        }
        
        if (error.message.includes('authentication failed')) {
            console.log('');
            console.log('💡 Authentication troubleshooting:');
            console.log('- Verify DB_USER and DB_PASSWORD are correct');
            console.log('- Ensure the database user has CREATE and INSERT permissions');
        }
        
        process.exit(1);
    } finally {
        await db.end();
        console.log('🔌 Database connection closed');
    }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
    console.log('\n🛑 Migration interrupted by user');
    process.exit(1);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Migration terminated');
    process.exit(1);
});

// Run the migration
runMigration().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
});
