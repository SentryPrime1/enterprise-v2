-- ============================================================================
-- SENTRYPRIME ENTERPRISE V2 - DATABASE SCHEMA
-- Platform Connections & Deployment System
-- ============================================================================

-- Create user tier information table
CREATE TABLE IF NOT EXISTS user_tier_info (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE NOT NULL,
    tier_name VARCHAR(50) NOT NULL DEFAULT 'free',
    is_premium BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    connected_platforms INTEGER DEFAULT 0,
    max_platforms INTEGER DEFAULT 1,
    deployment_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create website connections table (main platform connections)
CREATE TABLE IF NOT EXISTS website_connections (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    platform_type VARCHAR(50) NOT NULL,
    website_url VARCHAR(500) NOT NULL,
    connection_name VARCHAR(255) NOT NULL,
    connection_status VARCHAR(50) DEFAULT 'active',
    connection_config JSONB DEFAULT '{}',
    api_credentials JSONB DEFAULT '{}',
    deployment_method VARCHAR(100) DEFAULT 'api',
    last_connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, website_url)
);

-- Create deployment history table
CREATE TABLE IF NOT EXISTS deployment_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    website_connection_id INTEGER REFERENCES website_connections(id),
    scan_id VARCHAR(100),
    violation_type VARCHAR(100),
    fix_type VARCHAR(100),
    deployment_status VARCHAR(50) DEFAULT 'pending',
    deployment_method VARCHAR(100),
    fix_content TEXT,
    deployment_log TEXT,
    deployed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create platform capabilities table
CREATE TABLE IF NOT EXISTS platform_capabilities (
    id SERIAL PRIMARY KEY,
    platform_type VARCHAR(50) UNIQUE NOT NULL,
    supports_auto_deployment BOOLEAN DEFAULT FALSE,
    supported_fix_types TEXT[] DEFAULT '{}',
    deployment_methods TEXT[] DEFAULT '{}',
    required_credentials TEXT[] DEFAULT '{}',
    documentation_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_website_connections_user_id ON website_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_website_connections_platform_type ON website_connections(platform_type);
CREATE INDEX IF NOT EXISTS idx_website_connections_status ON website_connections(connection_status);
CREATE INDEX IF NOT EXISTS idx_deployment_history_user_id ON deployment_history(user_id);
CREATE INDEX IF NOT EXISTS idx_deployment_history_status ON deployment_history(deployment_status);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers to automatically update updated_at
CREATE TRIGGER update_user_tier_info_updated_at BEFORE UPDATE ON user_tier_info FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_website_connections_updated_at BEFORE UPDATE ON website_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- INSERT SAMPLE DATA FOR TESTING
-- ============================================================================

-- Insert sample user tier information
INSERT INTO user_tier_info (user_id, tier_name, is_premium, is_active, connected_platforms, max_platforms, deployment_enabled)
VALUES 
    (1, 'premium', TRUE, TRUE, 1, 10, TRUE),
    (2, 'free', FALSE, TRUE, 0, 1, FALSE),
    (3, 'premium', TRUE, TRUE, 2, 10, TRUE)
ON CONFLICT (user_id) DO UPDATE SET
    tier_name = EXCLUDED.tier_name,
    is_premium = EXCLUDED.is_premium,
    deployment_enabled = EXCLUDED.deployment_enabled;

-- Insert sample platform connections
INSERT INTO website_connections (user_id, platform_type, website_url, connection_name, connection_status, connection_config, api_credentials, deployment_method)
VALUES 
    (1, 'shopify', 'https://essolar.com', 'ESSolar Shopify Store', 'active', '{"store_domain": "essolar.myshopify.com", "theme_id": "12345"}', '{"api_key": "test_key", "access_token": "test_token"}', 'shopify_api'),
    (3, 'wordpress', 'https://demo.company.com', 'Company Main Site', 'active', '{"wp_version": "6.3", "theme": "twentytwentythree"}', '{"username": "admin", "app_password": "test_pass"}', 'rest_api')
ON CONFLICT (user_id, website_url) DO UPDATE SET
    platform_type = EXCLUDED.platform_type,
    connection_name = EXCLUDED.connection_name,
    connection_status = EXCLUDED.connection_status,
    updated_at = CURRENT_TIMESTAMP;

-- Insert platform capabilities
INSERT INTO platform_capabilities (platform_type, supports_auto_deployment, supported_fix_types, deployment_methods, required_credentials, documentation_url)
VALUES 
    ('shopify', TRUE, ARRAY['color-contrast', 'image-alt', 'link-name', 'button-name'], ARRAY['shopify_api', 'theme_files'], ARRAY['api_key', 'store_url'], 'https://help.shopify.com/en/api'),
    ('wordpress', TRUE, ARRAY['color-contrast', 'image-alt', 'link-name', 'button-name', 'heading-order'], ARRAY['rest_api', 'ftp_upload', 'plugin_api'], ARRAY['username', 'password', 'api_key'], 'https://developer.wordpress.org/rest-api/'),
    ('wix', FALSE, ARRAY[], ARRAY['manual_instructions'], ARRAY[], 'https://dev.wix.com/'),
    ('squarespace', FALSE, ARRAY[], ARRAY['manual_instructions'], ARRAY[], 'https://developers.squarespace.com/'),
    ('custom', TRUE, ARRAY['color-contrast', 'image-alt', 'link-name'], ARRAY['ftp_upload', 'sftp_upload'], ARRAY['host', 'username', 'password'], NULL)
ON CONFLICT (platform_type) DO UPDATE SET
    supports_auto_deployment = EXCLUDED.supports_auto_deployment,
    supported_fix_types = EXCLUDED.supported_fix_types,
    deployment_methods = EXCLUDED.deployment_methods,
    required_credentials = EXCLUDED.required_credentials;

-- Insert sample deployment history
INSERT INTO deployment_history (user_id, website_connection_id, scan_id, violation_type, fix_type, deployment_status, deployment_method, fix_content)
VALUES 
    (1, 1, 'scan_123', 'color-contrast', 'css-fix', 'completed', 'shopify_api', '.button { color: #000000; background-color: #ffffff; }'),
    (1, 1, 'scan_124', 'image-alt', 'html-fix', 'pending', 'shopify_api', '<img src="logo.png" alt="Company Logo">');
