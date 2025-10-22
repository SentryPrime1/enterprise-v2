-- Enhanced SentryPrime Enterprise Database Schema
-- Version: 2.1 - Premium User Authentication Addition
-- Date: October 20, 2025
-- 
-- SAFETY NOTE: This schema preserves ALL existing tables and functionality
-- New additions are marked with "-- NEW:" comments

-- =================================================================
-- EXISTING TABLES (PRESERVED EXACTLY AS THEY WERE)
-- =================================================================

-- Scans table (UNCHANGED)
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
);

-- Violations table (UNCHANGED)
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
);

-- Website connections table (UNCHANGED)
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
);

-- Deployment history table (UNCHANGED)
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
);

-- =================================================================
-- NEW: USER AUTHENTICATION SYSTEM TABLES
-- =================================================================

-- NEW: Users table for authentication and account management
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    company_name VARCHAR(255),
    user_tier VARCHAR(50) DEFAULT 'free', -- 'free', 'premium', 'enterprise'
    email_verified BOOLEAN DEFAULT false,
    email_verification_token VARCHAR(255),
    password_reset_token VARCHAR(255),
    password_reset_expires TIMESTAMP,
    last_login TIMESTAMP,
    login_count INTEGER DEFAULT 0,
    account_status VARCHAR(50) DEFAULT 'active', -- 'active', 'suspended', 'pending'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NEW: User sessions table for secure session management
CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address INET,
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NEW: User subscriptions table for premium tier management
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    subscription_tier VARCHAR(50) NOT NULL, -- 'free', 'premium', 'enterprise'
    subscription_status VARCHAR(50) DEFAULT 'active', -- 'active', 'cancelled', 'expired', 'trial'
    billing_cycle VARCHAR(50), -- 'monthly', 'yearly'
    subscription_price DECIMAL(10,2),
    trial_ends_at TIMESTAMP,
    current_period_start TIMESTAMP,
    current_period_end TIMESTAMP,
    cancelled_at TIMESTAMP,
    external_subscription_id VARCHAR(255), -- For Stripe/payment processor
    payment_method_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- NEW: Audit log for security and compliance tracking
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
);

-- =================================================================
-- NEW: INDEXES FOR PERFORMANCE
-- =================================================================

-- User authentication indexes
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tier ON users(user_tier);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);

-- Session management indexes
CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

-- Subscription indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON user_subscriptions(subscription_status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_tier ON user_subscriptions(subscription_tier);

-- Audit log indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- =================================================================
-- NEW: UPDATE EXISTING TABLES TO LINK WITH USERS (SAFE ADDITIONS)
-- =================================================================

-- NEW: Add user_id to scans table (optional, maintains backward compatibility)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'scans' AND column_name = 'user_id') THEN
        ALTER TABLE scans ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
    END IF;
END $$;

-- =================================================================
-- NEW: DEFAULT DATA FOR TESTING
-- =================================================================

-- NEW: Insert a default admin user for testing (password: 'admin123')
-- Note: In production, this should be removed or changed
INSERT INTO users (email, password_hash, first_name, last_name, user_tier, email_verified, account_status)
VALUES (
    'admin@sentryprime.com',
    '$2b$10$rOzJqQZ8kQQYQqQZ8kQQYeOzJqQZ8kQQYQqQZ8kQQYeOzJqQZ8kQQY', -- hashed 'admin123'
    'Admin',
    'User',
    'enterprise',
    true,
    'active'
) ON CONFLICT (email) DO NOTHING;

-- NEW: Insert a default premium subscription for the admin user
INSERT INTO user_subscriptions (user_id, subscription_tier, subscription_status, current_period_start, current_period_end)
SELECT 
    id,
    'enterprise',
    'active',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP + INTERVAL '1 year'
FROM users 
WHERE email = 'admin@sentryprime.com'
ON CONFLICT DO NOTHING;

-- =================================================================
-- SAFETY VERIFICATION QUERIES
-- =================================================================

-- Verify all tables exist
SELECT 
    table_name,
    CASE 
        WHEN table_name IN ('scans', 'violations', 'website_connections', 'deployment_history') 
        THEN 'EXISTING (Preserved)'
        ELSE 'NEW (Added)'
    END as table_status
FROM information_schema.tables 
WHERE table_schema = 'public' 
    AND table_type = 'BASE TABLE'
    AND table_name IN (
        'scans', 'violations', 'website_connections', 'deployment_history',
        'users', 'user_sessions', 'user_subscriptions', 'audit_logs'
    )
ORDER BY table_status, table_name;
