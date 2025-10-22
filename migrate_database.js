const { Pool } = require('pg');

// Enhanced Database Migration Script
// Version: 2.1 - User Authentication Addition
// Preserves all existing functionality and adds user authentication safely

let db;

async function initializeDatabase() {
    console.log('🔄 Starting enhanced database migration...');
    
    try {
        // Use existing database connection or create new one
        if (process.env.DATABASE_URL) {
            db = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
            });
        } else {
            console.log('⚠️  No DATABASE_URL found, skipping database migration');
            return false;
        }

        // Test database connection
        const client = await db.connect();
        console.log('✅ Database connection established');
        client.release();

        // Run all migrations in sequence
        await runExistingMigrations();
        await runUserAuthenticationMigrations();
        
        console.log('🎉 Enhanced database migration completed successfully!');
        return true;
        
    } catch (error) {
        console.error('❌ Database migration failed:', error.message);
        return false;
    }
}

// EXISTING MIGRATIONS (PRESERVED EXACTLY AS THEY WERE)
async function runExistingMigrations() {
    console.log('📋 Running existing migrations...');
    
    try {
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

        // Create existing indexes (UNCHANGED)
        await db.query(`CREATE INDEX IF NOT EXISTS idx_scans_url ON scans(url)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scan_date)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_violations_scan_id ON violations(scan_id)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_violations_impact ON violations(impact)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_website_connections_user_id ON website_connections(user_id)`);
        await db.query(`CREATE INDEX IF NOT EXISTS idx_deployment_history_user_id ON deployment_history(user_id)`);
        
        console.log('✅ All existing migrations completed successfully');
        
    } catch (error) {
        console.error('❌ Existing migrations failed:', error.message);
        throw error;
    }
}

// NEW: USER AUTHENTICATION MIGRATIONS
async function runUserAuthenticationMigrations() {
    console.log('🆕 Running user authentication migrations...');
    
    try {
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

        // Create user authentication indexes
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

        // Safely add user_id to scans table if it doesn't exist
        const userIdColumnExists = await checkColumnExists('scans', 'user_id');
        if (!userIdColumnExists) {
            await db.query(`ALTER TABLE scans ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
            await db.query(`CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id)`);
            console.log('✅ Added user_id column to scans table');
        } else {
            console.log('✅ User_id column already exists in scans table');
        }

        // Create default admin user for testing (only if doesn't exist)
        const adminExists = await checkUserExists('admin@sentryprime.com');
        if (!adminExists) {
            // Note: In production, use proper password hashing
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
        } else {
            console.log('✅ Admin user already exists');
        }

        console.log('🎉 User authentication migrations completed successfully!');
        
    } catch (error) {
        console.error('❌ User authentication migrations failed:', error.message);
        throw error;
    }
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
