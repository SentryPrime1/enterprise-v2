-- SentryPrime Platform Connections Database Schema
-- This schema stores user platform connections from onboarding

-- Users table (if not already exists)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    tier_name VARCHAR(50) DEFAULT 'basic',
    subscription_status VARCHAR(50) DEFAULT 'inactive',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User tier information table
CREATE TABLE IF NOT EXISTS user_tier_info (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    tier_name VARCHAR(50) NOT NULL DEFAULT 'basic',
    tier_features JSONB DEFAULT '{}',
    subscription_status VARCHAR(50) DEFAULT 'inactive',
    is_active BOOLEAN DEFAULT true,
    connected_platforms INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Platform connections table - stores user's connected websites and platforms
CREATE TABLE IF NOT EXISTS website_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    platform_type VARCHAR(50) NOT NULL, -- 'shopify', 'wordpress', 'wix', 'squarespace', 'custom'
    website_url VARCHAR(500) NOT NULL,
    connection_name VARCHAR(255) NOT NULL,
    connection_status VARCHAR(50) DEFAULT 'active', -- 'active', 'inactive', 'error'
    connection_config JSONB DEFAULT '{}', -- Store platform-specific config
    api_credentials JSONB DEFAULT '{}', -- Encrypted API keys/tokens
    last_connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_deployment_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    UNIQUE(user_id, website_url), -- One connection per user per website
    CHECK (platform_type IN ('shopify', 'wordpress', 'wix', 'squarespace', 'custom')),
    CHECK (connection_status IN ('active', 'inactive', 'error', 'pending'))
);

-- Deployment history table - tracks all deployments
CREATE TABLE IF NOT EXISTS deployment_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    connection_id INTEGER REFERENCES website_connections(id) ON DELETE CASCADE,
    website_url VARCHAR(500) NOT NULL,
    platform_type VARCHAR(50) NOT NULL,
    violation_id VARCHAR(100) NOT NULL,
    deployment_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'success', 'failed', 'rolled_back'
    deployment_method VARCHAR(100), -- 'shopify_api', 'wordpress_rest', 'ftp_upload', etc.
    fixes_applied JSONB DEFAULT '[]', -- Array of fixes that were applied
    rollback_data JSONB DEFAULT '{}', -- Data needed for rollback
    error_message TEXT NULL,
    deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    rolled_back_at TIMESTAMP NULL,
    
    -- Indexes for performance
    INDEX idx_deployment_user_id (user_id),
    INDEX idx_deployment_connection_id (connection_id),
    INDEX idx_deployment_status (deployment_status),
    INDEX idx_deployment_date (deployed_at)
);

-- Platform capabilities table - defines what each platform supports
CREATE TABLE IF NOT EXISTS platform_capabilities (
    id SERIAL PRIMARY KEY,
    platform_type VARCHAR(50) UNIQUE NOT NULL,
    supports_auto_deployment BOOLEAN DEFAULT false,
    supported_fix_types JSONB DEFAULT '[]', -- Array of violation types that can be auto-fixed
    deployment_methods JSONB DEFAULT '[]', -- Available deployment methods
    required_credentials JSONB DEFAULT '[]', -- Required API credentials
    documentation_url VARCHAR(500),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default platform capabilities
INSERT INTO platform_capabilities (platform_type, supports_auto_deployment, supported_fix_types, deployment_methods, required_credentials) VALUES
('shopify', true, '["color-contrast", "image-alt", "link-name", "button-name"]', '["shopify_api", "theme_files"]', '["api_key", "store_url"]'),
('wordpress', true, '["color-contrast", "image-alt", "link-name", "button-name", "heading-order"]', '["rest_api", "ftp_upload", "plugin_api"]', '["username", "password", "api_key"]'),
('wix', false, '[]', '["manual_instructions"]', '[]'),
('squarespace', false, '[]', '["manual_instructions"]', '[]'),
('custom', true, '["color-contrast", "image-alt", "link-name"]', '["ftp_upload", "sftp_upload"]', '["host", "username", "password"]')
ON CONFLICT (platform_type) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_website_connections_user_id ON website_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_website_connections_platform_type ON website_connections(platform_type);
CREATE INDEX IF NOT EXISTS idx_website_connections_status ON website_connections(connection_status);
CREATE INDEX IF NOT EXISTS idx_website_connections_url ON website_connections(website_url);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at columns
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_tier_info_updated_at BEFORE UPDATE ON user_tier_info FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_website_connections_updated_at BEFORE UPDATE ON website_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_platform_capabilities_updated_at BEFORE UPDATE ON platform_capabilities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
