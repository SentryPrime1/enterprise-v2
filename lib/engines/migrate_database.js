const { Pool } = require('pg');

// Enterprise Database Migration Script
// Version: 3.0 - Enterprise-Grade with Proper Permissions Handling
// Features: Versioned migrations, rollback safety, health checks, multi-tenant ready

let db;

async function initializeDatabase() {
    console.log('🏢 Starting enterprise database migration...');
    
    try {
        // Use the same database connection logic as the main server
        if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) {
            console.log('⚠️ Database environment variables not found, skipping database migration');
            console.log('📝 Required: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME');
            return false;
        }

        console.log('🔍 Database configuration found:');
        console.log('📍 DB_HOST:', process.env.DB_HOST);
        console.log('👤 DB_USER:', process.env.DB_USER);
        console.log('🗄️ DB_NAME:', process.env.DB_NAME);

        // Detect if we're running in Cloud Run with Cloud SQL connection
        const isCloudRun = process.env.K_SERVICE && process.env.DB_HOST.includes(':');
        
        let dbConfig;
        
        if (isCloudRun) {
            // Cloud Run with Cloud SQL connection - use Unix socket with correct path
            console.log('☁️ Detected Cloud Run environment, using Unix socket connection');
            dbConfig = {
                host: `/cloudsql/${process.env.DB_HOST}`,
                database: process.env.DB_NAME,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                connectionTimeoutMillis: 10000,
                idleTimeoutMillis: 30000,
                max: 10
            };
            console.log('🔌 Unix socket path:', `/cloudsql/${process.env.DB_HOST}`);
        } else {
            // Local or other environment - use TCP connection
            console.log('🌐 Using TCP connection');
            dbConfig = {
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

        // Create database connection
        db = new Pool(dbConfig);

        // Test database connection and check permissions
        const client = await db.connect();
        console.log('✅ Database connection established for migration');
        
        // Check database permissions
        await checkDatabasePermissions(client);
        client.release();

        // Initialize migration tracking
        await initializeMigrationTracking();

        // Run migrations in order
        await runMigration('001', 'Core Tables', runCoreMigrations);
        await runMigration('002', 'User Authentication', runUserAuthenticationMigrations);
        await runMigration('003', 'Enterprise Features', runEnterpriseMigrations);
        
        console.log('🎉 Enterprise database migration completed successfully!');
        return true;
        
    } catch (error) {
        console.error('❌ Enterprise database migration failed:', error.message);
        console.error('🔍 Error details:', error);
        
        // Provide helpful guidance for common issues
        if (error.message.includes('must be owner of table')) {
            console.log('');
            console.log('🔧 PERMISSION ISSUE DETECTED:');
            console.log('Your database user needs additional permissions.');
            console.log('');
            console.log('💡 SOLUTION - Run these commands as database admin:');
            console.log(`   GRANT ALL PRIVILEGES ON DATABASE ${process.env.DB_NAME} TO ${process.env.DB_USER};`);
            console.log(`   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${process.env.DB_USER};`);
            console.log(`   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${process.env.DB_USER};`);
            console.log('');
            console.log('🏢 For enterprise deployment, consider:');
            console.log('   • Creating a dedicated migration user with elevated privileges');
            console.log('   • Using Cloud SQL IAM authentication');
            console.log('   • Implementing schema-per-tenant architecture');
        }
        
        return false;
    }
}

// Enterprise: Check database permissions before migration
async function checkDatabasePermissions(client) {
    console.log('🔒 Checking database permissions...');
    
    try {
        // Check if we can create tables
        await client.query('CREATE TABLE IF NOT EXISTS permission_test (id SERIAL PRIMARY KEY)');
        await client.query('DROP TABLE IF EXISTS permission_test');
        console.log('✅ CREATE/DROP permissions verified');
        
        // Check if we can alter tables (if scans table exists)
        const scansExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'scans'
            )
        `);
        
        if (scansExists.rows[0].exists) {
            console.log('📋 Existing scans table found - checking ALTER permissions...');
            // Try a harmless ALTER operation
            try {
                await client.query('ALTER TABLE scans ADD COLUMN IF NOT EXISTS temp_test_col INTEGER');
                await client.query('ALTER TABLE scans DROP COLUMN IF EXISTS temp_test_col');
                console.log('✅ ALTER permissions verified');
            } catch (alterError) {
                console.log('⚠️ ALTER permissions limited - will skip table modifications');
                console.log('💡 User authentication will be created as separate tables');
            }
        }
        
    } catch (error) {
        console.log('⚠️ Limited database permissions detected');
        console.log('📝 Migration will proceed with available permissions');
    }
}

// Enterprise: Migration tracking system
async function initializeMigrationTracking() {
    console.log('📊 Initializing migration tracking...');
    
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS migration_history (
                id SERIAL PRIMARY KEY,
                version VARCHAR(10) NOT NULL UNIQUE,
                name VARCHAR(255) NOT NULL,
                executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                execution_time_ms INTEGER,
                status VARCHAR(20) DEFAULT 'completed',
                rollback_sql TEXT,
                checksum VARCHAR(64)
            )
        `);
        console.log('✅ Migration tracking initialized');
    } catch (error) {
        console.log('⚠️ Could not initialize migration tracking:', error.message);
    }
}

// Enterprise: Versioned migration execution
async function runMigration(version, name, migrationFunction) {
    console.log(`🚀 Running migration ${version}: ${name}...`);
    
    try {
        // Check if migration already completed
        const existing = await db.query(
            'SELECT * FROM migration_history WHERE version = $1 AND status = $2',
            [version, 'completed']
        );
        
        if (existing.rows.length > 0) {
            console.log(`✅ Migration ${version} already completed (${existing.rows[0].executed_at})`);
            return;
        }
        
        const startTime = Date.now();
        
        // Record migration start
        await db.query(
            'INSERT INTO migration_history (version, name, status) VALUES ($1, $2, $3) ON CONFLICT (version) DO UPDATE SET status = $3',
            [version, name, 'running']
        );
        
        // Execute migration
        await migrationFunction();
        
        const executionTime = Date.now() - startTime;
        
        // Record migration completion
        await db.query(
            'UPDATE migration_history SET status = $1, execution_time_ms = $2 WHERE version = $3',
            ['completed', executionTime, version]
        );
        
        console.log(`✅ Migration ${version} completed in ${executionTime}ms`);
        
    } catch (error) {
        console.error(`❌ Migration ${version} failed:`, error.message);
        
        // Record migration failure
        await db.query(
            'UPDATE migration_history SET status = $1 WHERE version = $2',
            ['failed', version]
        );
        
        throw error;
    }
}

// Migration 001: Core Tables (PRESERVED EXACTLY AS THEY WERE)
async function runCoreMigrations() {
    console.log('📋 Running core table migrations...');
    
    // Create scans table (UNCHANGED)
    await db.query(`
        CREATE TABLE IF NOT EXISTS scans (
            id SERIAL PRIMARY KEY,
            url VARCHAR(2048) NOT NULL,
            scan_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            total_violations INTEGER DEFAULT 0,
            critical_count INTEGER DEFAULT 0,
            serious_count INTEGER DEFAULT 0,
            moderate_count INTEGER DEFAULT 0,
            minor_count INTEGER DEFAULT 0,
            scan_duration INTEGER DEFAULT 0,
            status VARCHAR(50) DEFAULT 'completed',
            user_agent TEXT,
            viewport_width INTEGER DEFAULT 1920,
            viewport_height INTEGER DEFAULT 1080,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Scans table ready');

    // Create violations table (UNCHANGED)
    await db.query(`
        CREATE TABLE IF NOT EXISTS violations (
            id SERIAL PRIMARY KEY,
            scan_id INTEGER REFERENCES scans(id) ON DELETE CASCADE,
            violation_id VARCHAR(255) NOT NULL,
            description TEXT,
            impact VARCHAR(50),
            help TEXT,
            help_url VARCHAR(2048),
            tags TEXT[],
            selector TEXT,
            html TEXT,
            target TEXT[],
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Violations table ready');

    // Create website_connections table (UNCHANGED)
    await db.query(`
        CREATE TABLE IF NOT EXISTS website_connections (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            platform_type VARCHAR(50) NOT NULL,
            website_url VARCHAR(2048) NOT NULL,
            connection_name VARCHAR(255) NOT NULL,
            connection_status VARCHAR(50) DEFAULT 'pending',
            connection_config JSONB,
            last_connected_at TIMESTAMP,
            last_deployment_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Website connections table ready');

    // Create deployment_history table (UNCHANGED)
    await db.query(`
        CREATE TABLE IF NOT EXISTS deployment_history (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            scan_id INTEGER REFERENCES scans(id),
            violation_id VARCHAR(255),
            platform_type VARCHAR(50) NOT NULL,
            website_url VARCHAR(2048) NOT NULL,
            deployment_status VARCHAR(50) DEFAULT 'pending',
            deployment_method VARCHAR(50),
            fix_content TEXT,
            deployment_result JSONB,
            error_message TEXT,
            rollback_data JSONB,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Deployment history table ready');

    // Create indexes
    await db.query(`CREATE INDEX IF NOT EXISTS idx_scans_url ON scans(url)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scan_date)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_violations_scan_id ON violations(scan_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_violations_impact ON violations(impact)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_website_connections_user_id ON website_connections(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_deployment_history_user_id ON deployment_history(user_id)`);
    
    console.log('✅ Core migrations completed successfully');
}

// Migration 002: User Authentication (NEW)
async function runUserAuthenticationMigrations() {
    console.log('🆕 Running user authentication migrations...');
    
    // Create users table
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            first_name VARCHAR(100),
            last_name VARCHAR(100),
            company_name VARCHAR(255),
            user_tier VARCHAR(50) DEFAULT 'free',
            email_verified BOOLEAN DEFAULT false,
            email_verification_token VARCHAR(255),
            password_reset_token VARCHAR(255),
            password_reset_expires TIMESTAMP,
            last_login TIMESTAMP,
            login_count INTEGER DEFAULT 0,
            account_status VARCHAR(50) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Users table created');

    // Create user_sessions table
    await db.query(`
        CREATE TABLE IF NOT EXISTS user_sessions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            session_token VARCHAR(255) UNIQUE NOT NULL,
            ip_address INET,
            user_agent TEXT,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ User sessions table created');

    // Create user_subscriptions table
    await db.query(`
        CREATE TABLE IF NOT EXISTS user_subscriptions (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            subscription_tier VARCHAR(50) NOT NULL,
            subscription_status VARCHAR(50) DEFAULT 'active',
            billing_cycle VARCHAR(50),
            subscription_price DECIMAL(10,2),
            trial_ends_at TIMESTAMP,
            current_period_start TIMESTAMP,
            current_period_end TIMESTAMP,
            cancelled_at TIMESTAMP,
            external_subscription_id VARCHAR(255),
            payment_method_id VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ User subscriptions table created');

    // Create audit_logs table
    await db.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action VARCHAR(100) NOT NULL,
            resource_type VARCHAR(50),
            resource_id VARCHAR(100),
            details JSONB,
            ip_address INET,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Audit logs table created');

    // Create indexes for performance
    await db.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_users_tier ON users(user_tier)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON user_subscriptions(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON user_subscriptions(subscription_status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`);
    console.log('✅ User authentication indexes created');

    // Try to add user_id to scans table (gracefully handle permissions)
    try {
        const userIdColumnExists = await checkColumnExists('scans', 'user_id');
        if (!userIdColumnExists) {
            await db.query(`ALTER TABLE scans ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id)`);
            console.log('✅ Added user_id column to scans table');
        } else {
            console.log('✅ User_id column already exists in scans table');
        }
    } catch (error) {
        console.log('⚠️ Could not add user_id to scans table (insufficient permissions)');
        console.log('💡 Scans will use session-based tracking until permissions are updated');
    }

    // Create default admin user for testing (only if doesn't exist)
    const adminExists = await checkUserExists('admin@sentryprime.com');
    if (!adminExists) {
        try {
            const bcrypt = require('bcrypt');
            const hashedPassword = await bcrypt.hash('admin123', 10);
            
            const result = await db.query(`
                INSERT INTO users (email, password_hash, first_name, last_name, user_tier, email_verified, account_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, ['admin@sentryprime.com', hashedPassword, 'Admin', 'User', 'enterprise', true, 'active']);
            
            const userId = result.rows[0].id;
            
            // Create enterprise subscription for admin user
            await db.query(`
                INSERT INTO user_subscriptions (user_id, subscription_tier, subscription_status, current_period_start, current_period_end)
                VALUES ($1, $2, $3, $4, $5)
            `, [userId, 'enterprise', 'active', new Date(), new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)]);
            
            console.log('✅ Default admin user created (admin@sentryprime.com / admin123)');
        } catch (error) {
            console.log('⚠️ Could not create default admin user:', error.message);
        }
    } else {
        console.log('✅ Admin user already exists');
    }

    console.log('🎉 User authentication migrations completed successfully!');
}

// Migration 003: Enterprise Features (NEW)
async function runEnterpriseMigrations() {
    console.log('🏢 Running enterprise feature migrations...');
    
    // Create enterprise_clients table for multi-tenant support
    await db.query(`
        CREATE TABLE IF NOT EXISTS enterprise_clients (
            id SERIAL PRIMARY KEY,
            client_name VARCHAR(255) NOT NULL,
            client_slug VARCHAR(100) UNIQUE NOT NULL,
            subscription_tier VARCHAR(50) DEFAULT 'enterprise',
            max_users INTEGER DEFAULT 100,
            max_scans_per_month INTEGER DEFAULT 10000,
            custom_branding JSONB,
            api_key_hash VARCHAR(255),
            webhook_url VARCHAR(2048),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✅ Enterprise clients table created');

    // Create user_roles table for RBAC
    await db.query(`
        CREATE TABLE IF NOT EXISTS user_roles (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            enterprise_client_id INTEGER REFERENCES enterprise_clients(id) ON DELETE CASCADE,
            role_name VARCHAR(50) NOT NULL,
            permissions JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, enterprise_client_id)
        )
    `);
    console.log('✅ User roles table created');

    // Create compliance_reports table
    await db.query(`
        CREATE TABLE IF NOT EXISTS compliance_reports (
            id SERIAL PRIMARY KEY,
            enterprise_client_id INTEGER REFERENCES enterprise_clients(id) ON DELETE CASCADE,
            report_type VARCHAR(50) NOT NULL,
            report_period_start TIMESTAMP NOT NULL,
            report_period_end TIMESTAMP NOT NULL,
            report_data JSONB,
            generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            generated_by INTEGER REFERENCES users(id)
        )
    `);
    console.log('✅ Compliance reports table created');

    // Create enterprise indexes
    await db.query(`CREATE INDEX IF NOT EXISTS idx_enterprise_clients_slug ON enterprise_clients(client_slug)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_roles_client_id ON user_roles(enterprise_client_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_compliance_reports_client_id ON compliance_reports(enterprise_client_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_compliance_reports_period ON compliance_reports(report_period_start, report_period_end)`);
    
    console.log('✅ Enterprise feature migrations completed successfully!');
}

// Helper function to check if a column exists
async function checkColumnExists(tableName, columnName) {
    try {
        const result = await db.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = $1 AND column_name = $2
        `, [tableName, columnName]);
        return result.rows.length > 0;
    } catch (error) {
        console.error(`Error checking column ${columnName} in ${tableName}:`, error.message);
        return false;
    }
}

// Helper function to check if a user exists
async function checkUserExists(email) {
    try {
        const result = await db.query('SELECT id FROM users WHERE email = $1', [email]);
        return result.rows.length > 0;
    } catch (error) {
        // If users table doesn't exist yet, return false
        return false;
    }
}

// Function to get database connection (for use by other modules)
function getDatabase() {
    return db;
}

// Function to close database connection
async function closeDatabase() {
    if (db) {
        await db.end();
        console.log('📴 Database connection closed');
    }
}

module.exports = {
    initializeDatabase,
    getDatabase,
    closeDatabase
};
