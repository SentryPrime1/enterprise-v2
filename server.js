const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Database connection - PRESERVED FROM WORKING VERSION
let db = null;

// Initialize database connection if environment variables are provided
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    console.log('🔄 Initializing database connection...');
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

    db = new Pool(dbConfig);
    
    // Test database connection with detailed logging
    db.query('SELECT NOW() as current_time, version() as pg_version')
        .then((result) => {
            console.log('✅ Database connected successfully!');
            console.log('⏰ Server time:', result.rows[0].current_time);
            console.log('🐘 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
        })
        .catch(err => {
            console.log('❌ Database connection failed, running in standalone mode');
            console.log('🔍 Error details:', err.message);
            console.log('🔍 Error code:', err.code);
            db = null;
        });
} else {
    console.log('ℹ️ No database configuration found, running in standalone mode');
}

// OpenAI client initialization
let openai = null;
if (process.env.OPENAI_API_KEY) {
    console.log('🤖 Initializing OpenAI client...');
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
    console.log('✅ OpenAI client initialized successfully');
} else {
    console.log('⚠️ No OpenAI API key found, AI suggestions will use predefined responses');
}

// Database helper functions - PRESERVED FROM WORKING VERSION
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned, violations) {
    if (!db) {
        console.log('⚠️ No database connection, skipping scan save');
        return null;
    }
    
    try {
        const result = await db.query(
            `INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, violations_data, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) 
             RETURNING id`,
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned || 1, JSON.stringify(violations)]
        );
        
        const scanId = result.rows[0].id;
        console.log('✅ Scan saved to database with ID:', scanId);
        return scanId;
    } catch (error) {
        console.log('❌ Database error saving scan:', error.message);
        return null;
    }
}

async function getRecentScans(userId = 1, limit = 10) {
    if (!db) {
        // Return mock data when no database connection
        console.log('⚠️ No database connection, returning mock data');
        return [
            {
                id: 1,
                url: 'https://company.com',
                scan_type: 'single',
                total_issues: 8,
                score: 94,
                created_at: '2024-09-18T10:30:00Z'
            },
            {
                id: 2,
                url: 'https://company.com/products',
                scan_type: 'crawl',
                total_issues: 15,
                score: 87,
                created_at: '2024-09-18T09:15:00Z'
            },
            {
                id: 3,
                url: 'https://company.com/about',
                scan_type: 'single',
                total_issues: 3,
                score: 96,
                created_at: '2024-09-17T14:45:00Z'
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, 
                    CASE 
                        WHEN total_issues = 0 THEN 100
                        ELSE GREATEST(0, 100 - (total_issues * 2))
                    END as score,
                    created_at
             FROM scans 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        return result.rows;
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

async function getDashboardStats(userId = 1) {
    if (!db) {
        // Return mock data when no database connection
        console.log('⚠️ No database connection, returning mock data');
        return {
            totalScans: 3,
            totalIssues: 22,
            averageScore: 92,
            thisWeekScans: 2
        };
    }
    
    try {
        const result = await db.query(`
            SELECT 
                COUNT(*) as total_scans,
                COALESCE(SUM(total_issues), 0) as total_issues,
                COALESCE(AVG(CASE 
                    WHEN total_issues = 0 THEN 100
                    ELSE GREATEST(0, 100 - (total_issues * 2))
                END), 0) as average_score,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as this_week_scans
            FROM scans 
            WHERE user_id = $1
        `, [userId]);
        
        const stats = result.rows[0];
        return {
            totalScans: parseInt(stats.total_scans),
            totalIssues: parseInt(stats.total_issues),
            averageScore: Math.round(parseFloat(stats.average_score)),
            thisWeekScans: parseInt(stats.this_week_scans)
        };
    } catch (error) {
        console.log('❌ Database error getting dashboard stats:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0
        };
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local'
    });
});

// PHASE 2G: Platform Integration API Endpoints
app.post('/api/platforms/connect/wordpress', async (req, res) => {
    try {
        const { url, username, password } = req.body;
        
        console.log('🌐 Attempting WordPress connection:', url);
        
        // Validate WordPress REST API
        const testUrl = `${url}/wp-json/wp/v2/users/me`;
        const authHeader = Buffer.from(`${username}:${password}`).toString('base64');
        
        try {
            const response = await fetch(testUrl, {
                headers: {
                    'Authorization': `Basic ${authHeader}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const userData = await response.json();
                
                // Save connection to database (mock for now)
                const platformId = `wp_${Date.now()}`;
                
                res.json({
                    success: true,
                    message: 'WordPress site connected successfully',
                    platform: {
                        id: platformId,
                        type: 'wordpress',
                        url: url,
                        name: userData.name || 'WordPress Site',
                        connectedAt: new Date().toISOString(),
                        capabilities: ['deploy', 'backup', 'scan']
                    }
                });
            } else {
                throw new Error('Authentication failed');
            }
        } catch (error) {
            res.status(400).json({
                success: false,
                error: 'Failed to connect to WordPress site. Please check your credentials and URL.'
            });
        }
    } catch (error) {
        console.error('WordPress connection error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during WordPress connection'
        });
    }
});

app.post('/api/platforms/connect/shopify', async (req, res) => {
    try {
        const { shopDomain, accessToken } = req.body;
        
        console.log('🛒 Attempting Shopify connection:', shopDomain);
        
        // Validate Shopify Admin API
        const testUrl = `https://${shopDomain}/admin/api/2023-10/shop.json`;
        
        try {
            const response = await fetch(testUrl, {
                headers: {
                    'X-Shopify-Access-Token': accessToken,
                    'Content-Type': 'application/json'
                }
            });
            
            if (response.ok) {
                const shopData = await response.json();
                
                // Save connection to database (mock for now)
                const platformId = `shopify_${Date.now()}`;
                
                res.json({
                    success: true,
                    message: 'Shopify store connected successfully',
                    platform: {
                        id: platformId,
                        type: 'shopify',
                        url: `https://${shopDomain}`,
                        name: shopData.shop.name || 'Shopify Store',
                        connectedAt: new Date().toISOString(),
                        capabilities: ['deploy', 'backup', 'scan']
                    }
                });
            } else {
                throw new Error('Authentication failed');
            }
        } catch (error) {
            res.status(400).json({
                success: false,
                error: 'Failed to connect to Shopify store. Please check your access token and shop domain.'
            });
        }
    } catch (error) {
        console.error('Shopify connection error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during Shopify connection'
        });
    }
});

app.post('/api/platforms/connect/custom', async (req, res) => {
    try {
        const { url, connectionType, credentials } = req.body;
        
        console.log('⚙️ Attempting custom site connection:', url, connectionType);
        
        // Mock validation for custom site connection
        // In a real implementation, you would test FTP/SFTP/SSH connection here
        
        const platformId = `custom_${Date.now()}`;
        
        res.json({
            success: true,
            message: 'Custom site connected successfully',
            platform: {
                id: platformId,
                type: 'custom',
                url: url,
                name: 'Custom Site',
                connectionType: connectionType,
                connectedAt: new Date().toISOString(),
                capabilities: ['deploy', 'backup', 'scan']
            }
        });
    } catch (error) {
        console.error('Custom site connection error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error during custom site connection'
        });
    }
});

app.get('/api/platforms/connected', async (req, res) => {
    try {
        console.log('📋 Fetching connected platforms');
        
        // Mock data for connected platforms
        if (!db) {
            console.log('⚠️ No database connection, returning mock data');
            const mockPlatforms = [
                {
                    id: 'demo_wp_001',
                    type: 'wordpress',
                    name: 'Demo WordPress Site',
                    url: 'https://demo-wordpress.com',
                    connectedAt: '2024-01-15T10:30:00Z',
                    deploymentsCount: 5,
                    lastDeployment: '2024-01-20T14:22:00Z',
                    status: 'active'
                },
                {
                    id: 'demo_shopify_001',
                    type: 'shopify',
                    name: 'Demo Shopify Store',
                    url: 'https://demo-store.myshopify.com',
                    connectedAt: '2024-01-10T09:15:00Z',
                    deploymentsCount: 3,
                    lastDeployment: '2024-01-18T11:45:00Z',
                    status: 'active'
                }
            ];
            
            return res.json({
                success: true,
                platforms: mockPlatforms
            });
        }
        
        // In a real implementation, fetch from database
        res.json({
            success: true,
            platforms: []
        });
    } catch (error) {
        console.error('Error fetching connected platforms:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch connected platforms'
        });
    }
});

// PHASE 2G.3: Automated Deployment Engine
app.post('/api/deploy/auto-fix', async (req, res) => {
    try {
        const { platformId, violations, deploymentOptions } = req.body;
        
        console.log('🚀 Starting automated deployment for platform:', platformId);
        console.log('📋 Violations to fix:', violations?.length || 0);
        
        // Generate deployment ID
        const deploymentId = `deploy_${Date.now()}`;
        
        // Mock deployment process
        const deployment = {
            id: deploymentId,
            platformId: platformId,
            status: 'in_progress',
            startedAt: new Date().toISOString(),
            violations: violations || [],
            deploymentOptions: deploymentOptions || {},
            steps: [
                { name: 'Analyzing violations', status: 'completed', completedAt: new Date().toISOString() },
                { name: 'Generating fixes', status: 'in_progress', startedAt: new Date().toISOString() },
                { name: 'Creating backup', status: 'pending' },
                { name: 'Testing fixes', status: 'pending' },
                { name: 'Deploying to live site', status: 'pending' },
                { name: 'Verifying deployment', status: 'pending' }
            ]
        };
        
        res.json({
            success: true,
            message: 'Automated deployment started successfully',
            deployment: deployment
        });
        
        // In a real implementation, you would:
        // 1. Queue the deployment job
        // 2. Process violations and generate fixes
        // 3. Create backup if requested
        // 4. Test fixes in staging environment
        // 5. Deploy to live platform
        // 6. Verify deployment success
        
    } catch (error) {
        console.error('Deployment error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start automated deployment'
        });
    }
});

app.get('/api/deploy/status/:deploymentId', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        
        console.log('📊 Checking deployment status:', deploymentId);
        
        // Mock deployment status
        const deployment = {
            id: deploymentId,
            status: 'completed',
            startedAt: new Date(Date.now() - 300000).toISOString(), // 5 minutes ago
            completedAt: new Date().toISOString(),
            violationsFixed: 8,
            violationsRemaining: 2,
            backupCreated: true,
            backupId: `backup_${Date.now()}`,
            deploymentLog: [
                'Starting deployment process...',
                'Analyzing 10 accessibility violations',
                'Generated fixes for 8 violations',
                'Created backup: backup_' + Date.now(),
                'Testing fixes in staging environment',
                'All tests passed',
                'Deploying fixes to live site',
                'Deployment completed successfully',
                'Verification: 8 violations resolved'
            ]
        };
        
        res.json({
            success: true,
            deployment: deployment
        });
    } catch (error) {
        console.error('Error checking deployment status:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check deployment status'
        });
    }
});

app.get('/api/deploy/history/:platformId', async (req, res) => {
    try {
        const { platformId } = req.params;
        
        console.log('📜 Fetching deployment history for platform:', platformId);
        
        // Mock deployment history
        const deployments = [
            {
                id: 'deploy_1728234567890',
                platformId: platformId,
                status: 'completed',
                startedAt: '2024-01-20T14:22:00Z',
                completedAt: '2024-01-20T14:28:00Z',
                violationsFixed: 5,
                backupId: 'backup_1728234567890',
                canRollback: true,
                changes: [
                    'Added alt text to 3 images',
                    'Fixed color contrast on 2 buttons',
                    'Added ARIA labels to form inputs'
                ]
            },
            {
                id: 'deploy_1728134567890',
                platformId: platformId,
                status: 'completed',
                startedAt: '2024-01-18T11:45:00Z',
                completedAt: '2024-01-18T11:52:00Z',
                violationsFixed: 3,
                backupId: 'backup_1728134567890',
                canRollback: true,
                changes: [
                    'Fixed heading hierarchy',
                    'Added skip navigation link',
                    'Improved focus indicators'
                ]
            },
            {
                id: 'deploy_1728034567890',
                platformId: platformId,
                status: 'failed',
                startedAt: '2024-01-15T09:30:00Z',
                error: 'Connection timeout during deployment',
                canRollback: false
            }
        ];
        
        res.json({
            success: true,
            deployments: deployments
        });
    } catch (error) {
        console.error('Error fetching deployment history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch deployment history'
        });
    }
});

// PHASE 2G.4: Backup and Rollback Management
app.post('/api/backup/create/:platformId', async (req, res) => {
    try {
        const { platformId } = req.params;
        const { backupType, description } = req.body;
        
        console.log('💾 Creating backup for platform:', platformId, 'Type:', backupType);
        
        const backupId = `backup_${Date.now()}`;
        
        // Mock backup creation
        const backup = {
            id: backupId,
            platformId: platformId,
            type: backupType || 'full',
            description: description || 'Manual backup',
            status: 'in_progress',
            startedAt: new Date().toISOString(),
            size: '0 MB',
            estimatedCompletion: new Date(Date.now() + 120000).toISOString() // 2 minutes
        };
        
        res.json({
            success: true,
            message: 'Backup creation started',
            backup: backup
        });
        
        // In a real implementation, you would:
        // 1. Connect to the platform
        // 2. Create a full backup of files and database
        // 3. Store backup in secure location
        // 4. Update backup status
        
    } catch (error) {
        console.error('Backup creation error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create backup'
        });
    }
});

app.get('/api/backup/list/:platformId', async (req, res) => {
    try {
        const { platformId } = req.params;
        
        console.log('📋 Fetching backups for platform:', platformId);
        
        // Mock backup list
        const backups = [
            {
                id: 'backup_1728234567890',
                platformId: platformId,
                type: 'full',
                description: 'Pre-deployment backup',
                createdAt: '2024-01-20T14:20:00Z',
                size: '45.2 MB',
                status: 'completed'
            },
            {
                id: 'backup_1728134567890',
                platformId: platformId,
                type: 'full',
                description: 'Weekly automated backup',
                createdAt: '2024-01-18T11:40:00Z',
                size: '44.8 MB',
                status: 'completed'
            },
            {
                id: 'backup_1728034567890',
                platformId: platformId,
                type: 'partial',
                description: 'Theme files backup',
                createdAt: '2024-01-15T09:25:00Z',
                size: '12.3 MB',
                status: 'completed'
            }
        ];
        
        res.json({
            success: true,
            backups: backups
        });
    } catch (error) {
        console.error('Error fetching backups:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch backups'
        });
    }
});

app.post('/api/backup/restore/:backupId', async (req, res) => {
    try {
        const { backupId } = req.params;
        const { confirmRestore } = req.body;
        
        if (!confirmRestore) {
            return res.status(400).json({
                success: false,
                error: 'Restore confirmation required'
            });
        }
        
        console.log('🔄 Starting backup restore:', backupId);
        
        const restoreId = `restore_${Date.now()}`;
        
        // Mock restore process
        const restore = {
            id: restoreId,
            backupId: backupId,
            status: 'in_progress',
            startedAt: new Date().toISOString(),
            estimatedCompletion: new Date(Date.now() + 180000).toISOString() // 3 minutes
        };
        
        res.json({
            success: true,
            message: 'Backup restore started',
            restore: restore
        });
        
        // In a real implementation, you would:
        // 1. Validate backup integrity
        // 2. Create a pre-restore backup
        // 3. Restore files and database
        // 4. Verify restore success
        
    } catch (error) {
        console.error('Backup restore error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to start backup restore'
        });
    }
});

app.delete('/api/backup/delete/:backupId', async (req, res) => {
    try {
        const { backupId } = req.params;
        
        console.log('🗑️ Deleting backup:', backupId);
        
        // Mock backup deletion
        res.json({
            success: true,
            message: 'Backup deleted successfully'
        });
        
        // In a real implementation, you would:
        // 1. Verify backup exists
        // 2. Check if backup is being used
        // 3. Delete backup files
        // 4. Update database records
        
    } catch (error) {
        console.error('Backup deletion error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete backup'
        });
    }
});

app.post('/api/backup/cleanup/:platformId', async (req, res) => {
    try {
        const { platformId } = req.params;
        const { retentionDays } = req.body;
        
        console.log('🧹 Cleaning up old backups for platform:', platformId);
        
        // Mock cleanup process
        const cleanupResult = {
            deletedBackups: 3,
            freedSpace: '127.4 MB',
            retentionPolicy: `${retentionDays || 30} days`
        };
        
        res.json({
            success: true,
            message: 'Backup cleanup completed',
            result: cleanupResult
        });
        
    } catch (error) {
        console.error('Backup cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup backups'
        });
    }
});

app.post('/api/deploy/rollback/:deploymentId', async (req, res) => {
    try {
        const { deploymentId } = req.params;
        const { reason, restoreBackup } = req.body;
        
        console.log('🔄 Starting rollback for deployment:', deploymentId);
        console.log('📝 Rollback reason:', reason);
        
        const rollbackId = `rollback_${Date.now()}`;
        
        // Mock rollback process
        const rollback = {
            id: rollbackId,
            originalDeploymentId: deploymentId,
            status: 'completed',
            startedAt: new Date().toISOString(),
            completedAt: new Date(Date.now() + 30000).toISOString(), // 30 seconds later
            reason: reason,
            restoreBackup: restoreBackup,
            message: 'Deployment rolled back successfully'
        };
        
        res.json({
            success: true,
            message: 'Deployment rolled back successfully',
            rollback: rollback
        });
        
        // In a real implementation, you would:
        // 1. Identify changes made in the deployment
        // 2. Reverse the changes or restore from backup
        // 3. Verify rollback success
        // 4. Update deployment status
        
    } catch (error) {
        console.error('Rollback error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to rollback deployment'
        });
    }
});

// Main dashboard route
app.get('/', async (req, res) => {
    try {
        const stats = await getDashboardStats();
        const recentScans = await getRecentScans();
        
        res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SentryPrime Enterprise Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        
        .container {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 250px;
            background: #2c3e50;
            color: white;
            padding: 20px 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }
        
        .logo {
            padding: 0 20px 30px;
            border-bottom: 1px solid #34495e;
            margin-bottom: 20px;
        }
        
        .logo h1 {
            font-size: 1.5rem;
            font-weight: 600;
        }
        
        .logo p {
            font-size: 0.9rem;
            color: #bdc3c7;
            margin-top: 5px;
        }
        
        .nav-item {
            display: block;
            padding: 12px 20px;
            color: #ecf0f1;
            text-decoration: none;
            transition: background 0.3s;
            border-left: 3px solid transparent;
        }
        
        .nav-item:hover, .nav-item.active {
            background: #34495e;
            border-left-color: #3498db;
        }
        
        .nav-item.active {
            background: #1abc9c;
            border-left-color: #16a085;
        }
        
        .badge {
            background: #e74c3c;
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            margin-left: auto;
            float: right;
        }
        
        .main-content {
            margin-left: 250px;
            flex: 1;
            padding: 20px;
        }
        
        .header {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .search-bar {
            flex: 1;
            max-width: 400px;
            margin: 0 20px;
        }
        
        .search-bar input {
            width: 100%;
            padding: 10px 15px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .user-info {
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .avatar {
            width: 40px;
            height: 40px;
            background: #3498db;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
        
        .page-title {
            font-size: 2rem;
            margin-bottom: 10px;
            color: #2c3e50;
        }
        
        .page-subtitle {
            color: #7f8c8d;
            margin-bottom: 30px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        
        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .stat-label {
            color: #7f8c8d;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .stat-change {
            margin-top: 8px;
            font-size: 0.85rem;
        }
        
        .stat-change.positive {
            color: #27ae60;
        }
        
        .stat-change.negative {
            color: #e74c3c;
        }
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .action-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            text-decoration: none;
            color: inherit;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        
        .action-icon {
            font-size: 2rem;
            margin-bottom: 10px;
        }
        
        .action-title {
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .action-description {
            font-size: 0.9rem;
            color: #7f8c8d;
        }
        
        .recent-scans {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .section-header {
            padding: 20px;
            border-bottom: 1px solid #ecf0f1;
            font-weight: 600;
            color: #2c3e50;
        }
        
        .scan-item {
            padding: 15px 20px;
            border-bottom: 1px solid #ecf0f1;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            margin-bottom: 5px;
            color: #2c3e50;
        }
        
        .scan-meta {
            font-size: 0.85rem;
            color: #7f8c8d;
        }
        
        .scan-score {
            text-align: right;
        }
        
        .score-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 0.9rem;
            margin-bottom: 5px;
        }
        
        .score-excellent {
            background: #d4edda;
            color: #155724;
        }
        
        .score-good {
            background: #fff3cd;
            color: #856404;
        }
        
        .score-needs-work {
            background: #f8d7da;
            color: #721c24;
        }
        
        .view-report-btn {
            background: #3498db;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
            transition: background 0.2s;
        }
        
        .view-report-btn:hover {
            background: #2980b9;
        }
        
        .page {
            display: none;
        }
        
        .page.active {
            display: block;
        }
        
        .scan-form {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #2c3e50;
        }
        
        .form-group input, .form-group select {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .btn {
            background: #3498db;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: background 0.2s;
        }
        
        .btn:hover {
            background: #2980b9;
        }
        
        .btn:disabled {
            background: #bdc3c7;
            cursor: not-allowed;
        }
        
        .loading {
            display: none;
            text-align: center;
            padding: 40px;
        }
        
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .results {
            display: none;
        }
        
        .alert {
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        
        .alert-success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .alert-error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .violations-list {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
            margin-top: 20px;
        }
        
        .violation-item {
            padding: 20px;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .violation-item:last-child {
            border-bottom: none;
        }
        
        .violation-header {
            display: flex;
            justify-content: between;
            align-items: flex-start;
            margin-bottom: 10px;
        }
        
        .violation-title {
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .violation-impact {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .impact-critical {
            background: #f8d7da;
            color: #721c24;
        }
        
        .impact-serious {
            background: #fff3cd;
            color: #856404;
        }
        
        .impact-moderate {
            background: #cce5ff;
            color: #004085;
        }
        
        .impact-minor {
            background: #e2e3e5;
            color: #383d41;
        }
        
        .violation-description {
            color: #7f8c8d;
            margin-bottom: 10px;
            line-height: 1.5;
        }
        
        .violation-help {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-size: 0.9rem;
            color: #495057;
        }
        
        .violation-nodes {
            margin-top: 10px;
        }
        
        .violation-nodes summary {
            cursor: pointer;
            font-weight: 600;
            color: #3498db;
            margin-bottom: 10px;
        }
        
        .node-list {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 0.85rem;
            color: #495057;
        }
        
        .node-item {
            margin-bottom: 5px;
            padding: 5px;
            background: white;
            border-radius: 3px;
        }
        
        .platform-card {
            background: white;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .platform-card:hover {
            border-color: #3498db;
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
        }
        
        .platform-icon {
            font-size: 3rem;
            margin-bottom: 15px;
        }
        
        .platform-name {
            font-size: 1.2rem;
            font-weight: 600;
            margin-bottom: 10px;
            color: #2c3e50;
        }
        
        .platform-description {
            color: #7f8c8d;
            font-size: 0.9rem;
            margin-bottom: 15px;
        }
        
        .platform-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: bold;
        }
        
        .badge-popular {
            background: #e3f2fd;
            color: #1976d2;
        }
        
        .badge-ecommerce {
            background: #f3e5f5;
            color: #7b1fa2;
        }
        
        .badge-advanced {
            background: #fff3e0;
            color: #f57c00;
        }
        
        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
        }
        
        .modal-content {
            background: white;
            margin: 5% auto;
            padding: 30px;
            border-radius: 8px;
            max-width: 500px;
            width: 90%;
            position: relative;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid #ecf0f1;
        }
        
        .modal-title {
            font-size: 1.3rem;
            font-weight: 600;
            color: #2c3e50;
        }
        
        .close-btn {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #7f8c8d;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .close-btn:hover {
            color: #2c3e50;
        }
        
        .form-row {
            display: flex;
            gap: 15px;
        }
        
        .form-row .form-group {
            flex: 1;
        }
        
        .btn-group {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
        }
        
        .btn-secondary {
            background: #6c757d;
            color: white;
        }
        
        .btn-secondary:hover {
            background: #5a6268;
        }
        
        .connected-platforms-section {
            margin-bottom: 40px;
        }
        
        .section-title {
            font-size: 1.3rem;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .section-description {
            color: #7f8c8d;
            margin-bottom: 20px;
        }
        
        .platforms-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <nav class="sidebar">
            <div class="logo">
                <h1>🛡️ SentryPrime</h1>
                <p>Enterprise Dashboard</p>
            </div>
            <a href="#" class="nav-item active" onclick="showPage('dashboard')">📊 Dashboard</a>
            <a href="#" class="nav-item" onclick="showPage('scans')">🔍 Scans <span class="badge">2</span></a>
            <a href="#" class="nav-item" onclick="showPage('analytics')">📈 Analytics <span class="badge">8</span></a>
            <a href="#" class="nav-item" onclick="showPage('team')">👥 Team <span class="badge">4</span></a>
            <a href="#" class="nav-item" onclick="showPage('integrations')">🔗 Integrations <span class="badge">5</span></a>
            <a href="#" class="nav-item" onclick="showPage('api')">⚙️ API Management <span class="badge">6</span></a>
            <a href="#" class="nav-item" onclick="showPage('billing')">💳 Billing <span class="badge">7</span></a>
            <a href="#" class="nav-item" onclick="showPage('settings')">⚙️ Settings <span class="badge">8</span></a>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" placeholder="Search scans, reports, or settings...">
                </div>
                <div class="user-info">
                    <span>🔔</span>
                    <div class="avatar">JD</div>
                    <div>
                        <div style="font-weight: 600;">John Doe</div>
                        <div style="font-size: 0.8rem; color: #7f8c8d;">Acme Corporation</div>
                    </div>
                    <span>▼</span>
                </div>
            </header>
            
            <!-- Dashboard Page -->
            <div id="dashboard" class="page active">
                <h1 class="page-title">Dashboard Overview</h1>
                <p class="page-subtitle">Monitor your accessibility compliance and recent activity</p>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">${stats.totalScans}</div>
                        <div class="stat-label">Total Scans</div>
                        <div class="stat-change positive">+2 this week</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.totalIssues}</div>
                        <div class="stat-label">Issues Found</div>
                        <div class="stat-change negative">-5 from last week</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.averageScore}%</div>
                        <div class="stat-label">Average Score</div>
                        <div class="stat-change positive">+3% improvement</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${stats.thisWeekScans}</div>
                        <div class="stat-label">This Week</div>
                        <div class="stat-change">scans completed</div>
                    </div>
                </div>
                
                <div class="quick-actions">
                    <div class="action-card" onclick="showPage('scans')">
                        <div class="action-icon">🔍</div>
                        <div class="action-title">New Scan</div>
                        <div class="action-description">Start a new accessibility scan</div>
                    </div>
                    <div class="action-card" onclick="showPage('analytics')">
                        <div class="action-icon">📊</div>
                        <div class="action-title">View Analytics</div>
                        <div class="action-description">Analyze compliance trends</div>
                    </div>
                    <div class="action-card" onclick="showPage('team')">
                        <div class="action-icon">👥</div>
                        <div class="action-title">Manage Team</div>
                        <div class="action-description">Add or remove team members</div>
                    </div>
                    <div class="action-card" onclick="showPage('settings')">
                        <div class="action-icon">⚙️</div>
                        <div class="action-title">Settings</div>
                        <div class="action-description">Configure your preferences</div>
                    </div>
                </div>
                
                <div class="recent-scans">
                    <div class="section-header">Recent Scans</div>
                    <div class="section-subtitle">Your latest accessibility scan results</div>
                    ${recentScans.map(scan => `
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>${scan.url}</h4>
                                <div class="scan-meta">
                                    ${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • ${new Date(scan.created_at).toLocaleDateString()}
                                </div>
                            </div>
                            <div class="scan-score">
                                <div class="score-badge ${scan.score >= 95 ? 'score-excellent' : scan.score >= 80 ? 'score-good' : 'score-needs-work'}">
                                    ${scan.score}% Score
                                </div>
                                <div>
                                    <button class="view-report-btn" onclick="viewReport(${scan.id})">👁️ View Report</button>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <!-- Platform Integrations Page -->
            <div id="integrations" class="page">
                <h1 class="page-title">🔗 Platform Integrations</h1>
                <p class="page-subtitle">Connect your websites for automated accessibility fixes</p>
                
                <div class="connected-platforms-section">
                    <h2 class="section-title">Connected Platforms</h2>
                    <p class="section-description">Manage your connected websites and platforms</p>
                    
                    <div id="connected-platforms-container">
                        <div style="text-align: center; padding: 40px; color: #666;">
                            📡 Loading connected platforms...
                        </div>
                    </div>
                </div>
                
                <div class="connected-platforms-section">
                    <h2 class="section-title">Connect New Platform</h2>
                    <p class="section-description">Add a new website or platform for automated accessibility fixes</p>
                    
                    <div class="platforms-grid">
                        <div class="platform-card" onclick="showConnectModal('wordpress')">
                            <div class="platform-icon">🌐</div>
                            <div class="platform-name">WordPress</div>
                            <div class="platform-description">Connect your WordPress site via REST API</div>
                            <div class="platform-badge badge-popular">Most Popular</div>
                        </div>
                        
                        <div class="platform-card" onclick="showConnectModal('shopify')">
                            <div class="platform-icon">🛒</div>
                            <div class="platform-name">Shopify</div>
                            <div class="platform-description">Connect your Shopify store via Admin API</div>
                            <div class="platform-badge badge-ecommerce">E-commerce</div>
                        </div>
                        
                        <div class="platform-card" onclick="showConnectModal('custom')">
                            <div class="platform-icon">⚙️</div>
                            <div class="platform-name">Custom Site</div>
                            <div class="platform-description">Connect via FTP, SFTP, or SSH</div>
                            <div class="platform-badge badge-advanced">Advanced</div>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Other pages would go here -->
            <div id="scans" class="page">
                <h1 class="page-title">🔍 Accessibility Scans</h1>
                <p class="page-subtitle">Run comprehensive accessibility audits on your websites</p>
                
                <div class="scan-form">
                    <h3 style="margin-bottom: 20px;">Start New Scan</h3>
                    <form id="scanForm">
                        <div class="form-group">
                            <label for="url">Website URL</label>
                            <input type="url" id="url" name="url" placeholder="https://example.com" required>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="scanType">Scan Type</label>
                                <select id="scanType" name="scanType">
                                    <option value="single">Single Page</option>
                                    <option value="crawl">Full Site Crawl</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label for="standard">Accessibility Standard</label>
                                <select id="standard" name="standard">
                                    <option value="wcag2aa">WCAG 2.1 AA</option>
                                    <option value="wcag2aaa">WCAG 2.1 AAA</option>
                                    <option value="section508">Section 508</option>
                                </select>
                            </div>
                        </div>
                        <button type="submit" class="btn" id="scanBtn">Start Scan</button>
                    </form>
                </div>
                
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <p>Scanning your website for accessibility issues...</p>
                    <p id="loadingStatus">Initializing scan...</p>
                </div>
                
                <div class="results" id="results">
                    <!-- Results will be populated here -->
                </div>
            </div>
            
            <div id="analytics" class="page">
                <h1 class="page-title">📈 Analytics</h1>
                <p class="page-subtitle">Track your accessibility compliance over time</p>
                <div style="padding: 40px; text-align: center; color: #666;">
                    📊 Analytics dashboard coming soon...
                </div>
            </div>
            
            <div id="team" class="page">
                <h1 class="page-title">👥 Team Management</h1>
                <p class="page-subtitle">Manage team members and permissions</p>
                <div style="padding: 40px; text-align: center; color: #666;">
                    👥 Team management coming soon...
                </div>
            </div>
            
            <div id="api" class="page">
                <h1 class="page-title">⚙️ API Management</h1>
                <p class="page-subtitle">Manage API keys and integrations</p>
                <div style="padding: 40px; text-align: center; color: #666;">
                    🔑 API management coming soon...
                </div>
            </div>
            
            <div id="billing" class="page">
                <h1 class="page-title">💳 Billing</h1>
                <p class="page-subtitle">Manage your subscription and billing</p>
                <div style="padding: 40px; text-align: center; color: #666;">
                    💳 Billing dashboard coming soon...
                </div>
            </div>
            
            <div id="settings" class="page">
                <h1 class="page-title">⚙️ Settings</h1>
                <p class="page-subtitle">Configure your account and preferences</p>
                <div style="padding: 40px; text-align: center; color: #666;">
                    ⚙️ Settings panel coming soon...
                </div>
            </div>
        </main>
    </div>
    
    <!-- Platform Connection Modal -->
    <div id="connectModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="modalTitle">Connect Platform</h3>
                <button class="close-btn" onclick="closeModal()">&times;</button>
            </div>
            <form id="connectForm">
                <div id="modalContent">
                    <!-- Content will be populated based on platform type -->
                </div>
                <div class="btn-group">
                    <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
                    <button type="submit" class="btn" id="connectBtn">Connect</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        // Global variables
        let currentScanUrl = 'https://example.com';
        
        // Navigation
        function showPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            
            // Remove active class from all nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId).classList.add('active');
            
            // Add active class to clicked nav item
            event.target.classList.add('active');
            
            // Load connected platforms when integrations page is shown
            if (pageId === 'integrations') {
                loadConnectedPlatforms();
            }
        }
        
        // Platform Integration Functions
        function showConnectModal(platformType) {
            const modal = document.getElementById('connectModal');
            const modalTitle = document.getElementById('modalTitle');
            const modalContent = document.getElementById('modalContent');
            const connectBtn = document.getElementById('connectBtn');
            
            let title, content, buttonText;
            
            switch(platformType) {
                case 'wordpress':
                    title = '🌐 Connect WordPress Site';
                    buttonText = 'Connect WordPress';
                    content = `
                        <div class="form-group">
                            <label for="wpUrl">WordPress Site URL</label>
                            <input type="url" id="wpUrl" name="url" placeholder="https://yoursite.com" required>
                        </div>
                        <div class="form-group">
                            <label for="wpUsername">Username</label>
                            <input type="text" id="wpUsername" name="username" placeholder="admin" required>
                        </div>
                        <div class="form-group">
                            <label for="wpPassword">Application Password</label>
                            <input type="password" id="wpPassword" name="password" placeholder="xxxx xxxx xxxx xxxx" required>
                            <small style="color: #666; font-size: 0.8rem;">Generate an application password in WordPress admin → Users → Profile</small>
                        </div>
                    `;
                    break;
                    
                case 'shopify':
                    title = '🛒 Connect Shopify Store';
                    buttonText = 'Connect Shopify';
                    content = `
                        <div class="form-group">
                            <label for="shopDomain">Shop Domain</label>
                            <input type="text" id="shopDomain" name="shopDomain" placeholder="your-shop.myshopify.com" required>
                        </div>
                        <div class="form-group">
                            <label for="accessToken">Private App Access Token</label>
                            <input type="password" id="accessToken" name="accessToken" placeholder="shpat_..." required>
                            <small style="color: #666; font-size: 0.8rem;">Create a private app in Shopify admin → Apps → Develop apps</small>
                        </div>
                    `;
                    break;
                    
                case 'custom':
                    title = '⚙️ Connect Custom Site';
                    buttonText = 'Connect Site';
                    content = `
                        <div class="form-group">
                            <label for="customUrl">Site URL</label>
                            <input type="url" id="customUrl" name="url" placeholder="https://yoursite.com" required>
                        </div>
                        <div class="form-group">
                            <label for="connectionType">Connection Type</label>
                            <select id="connectionType" name="connectionType" required>
                                <option value="">Select connection method</option>
                                <option value="ftp">FTP</option>
                                <option value="sftp">SFTP</option>
                                <option value="ssh">SSH</option>
                            </select>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="host">Host</label>
                                <input type="text" id="host" name="host" placeholder="ftp.yoursite.com" required>
                            </div>
                            <div class="form-group">
                                <label for="port">Port</label>
                                <input type="number" id="port" name="port" placeholder="21" required>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="ftpUsername">Username</label>
                                <input type="text" id="ftpUsername" name="username" required>
                            </div>
                            <div class="form-group">
                                <label for="ftpPassword">Password</label>
                                <input type="password" id="ftpPassword" name="password" required>
                            </div>
                        </div>
                    `;
                    break;
            }
            
            modalTitle.textContent = title;
            modalContent.innerHTML = content;
            connectBtn.textContent = buttonText;
            connectBtn.setAttribute('data-platform', platformType);
            
            modal.style.display = 'block';
        }
        
        function closeModal() {
            document.getElementById('connectModal').style.display = 'none';
        }
        
        // Load connected platforms
        async function loadConnectedPlatforms() {
            try {
                const response = await fetch('/api/platforms/connected');
                const result = await response.json();
                
                if (result.success) {
                    const container = document.getElementById('connected-platforms-container');
                    
                    if (result.platforms.length === 0) {
                        container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No platforms connected yet. Connect your first platform below.</p>';
                    } else {
                        container.innerHTML = result.platforms.map(platform => `
                            <div style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 16px; background: white;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <div style="flex: 1;">
                                        <h4 style="margin: 0 0 8px 0;">${platform.type === 'wordpress' ? '🌐' : platform.type === 'shopify' ? '🛒' : '⚙️'} ${platform.name}</h4>
                                        <p style="margin: 0; color: #666; font-size: 0.9rem;">${platform.url}</p>
                                        <p style="margin: 4px 0 0 0; color: #28a745; font-size: 0.8rem;">✅ Connected on ${new Date(platform.connectedAt).toLocaleDateString()}</p>
                                    </div>
                                    <div style="text-align: right; min-width: 200px;">
                                        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                                            <button onclick="deployAutomatedFixes('${platform.id}')" style="background: #007bff; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">🚀 Deploy</button>
                                            <button onclick="showBackupManager('${platform.id}')" style="background: #28a745; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">💾 Backups</button>
                                            <button onclick="showDeploymentHistory('${platform.id}')" style="background: #6c757d; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">📋 History</button>
                                        </div>
                                        <small style="color: #666;">${platform.deploymentsCount || 0} deployments</small>
                                    </div>
                                </div>
                            </div>
                        `).join('');
                    }
                }
            } catch (error) {
                console.error('Error loading connected platforms:', error);
            }
        }
        
        // Deployment functions
        async function deployAutomatedFixes(platformId) {
            try {
                const mockViolations = [
                    { type: 'missing_alt_text', severity: 'high', count: 5 },
                    { type: 'low_contrast', severity: 'medium', count: 3 },
                    { type: 'missing_labels', severity: 'high', count: 2 }
                ];
                
                const deploymentOptions = {
                    createBackup: true,
                    testMode: false,
                    rollbackOnError: true
                };
                
                const response = await fetch('/api/deploy/auto-fix', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        platformId: platformId,
                        violations: mockViolations,
                        deploymentOptions: deploymentOptions
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('🚀 Automated deployment started successfully!\\n\\nDeployment ID: ' + result.deployment.id + '\\nStatus: ' + result.deployment.status + '\\nViolations to fix: ' + result.deployment.violations.length + '\\n\\n✅ Backup will be created automatically');
                    
                    setTimeout(() => {
                        alert('✅ Deployment completed successfully!\\n\\n• 8 fixes applied\\n• 6 violations resolved\\n• Backup created\\n• Rollback available');
                    }, 3000);
                } else {
                    alert('❌ Deployment failed: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error starting deployment: ' + error.message);
            }
        }
        
        async function showBackupManager(platformId) {
            try {
                const response = await fetch(`/api/backup/list/${platformId}`);
                const result = await response.json();
                
                if (result.success) {
                    const backupsList = result.backups.map(backup => `
                        <div style="border: 1px solid #eee; padding: 12px; margin: 8px 0; border-radius: 4px; background: #f9f9f9;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>${backup.description}</strong><br>
                                    <small>Type: ${backup.type} | Size: ${backup.size} | ${new Date(backup.createdAt).toLocaleString()}</small>
                                </div>
                                <div>
                                    <button onclick="restoreBackup('${backup.id}')" style="background: #ffc107; color: #000; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; margin-right: 4px;">🔄 Restore</button>
                                    <button onclick="deleteBackup('${backup.id}')" style="background: #dc3545; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer;">🗑️ Delete</button>
                                </div>
                            </div>
                        </div>
                    `).join('');
                    
                    const modalHtml = `
                        <div id="backupModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
                            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 600px; width: 90%; max-height: 80%; overflow-y: auto;">
                                <h3 style="margin-top: 0;">💾 Backup Manager - ${platformId}</h3>
                                <div style="margin: 20px 0;">
                                    <button onclick="createBackup('${platformId}')" style="background: #28a745; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; margin-bottom: 20px;">➕ Create New Backup</button>
                                </div>
                                <div>${backupsList}</div>
                                <div style="text-align: right; margin-top: 20px;">
                                    <button onclick="closeBackupModal()" style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Close</button>
                                </div>
                            </div>
                        </div>
                    `;
                    
                    document.body.insertAdjacentHTML('beforeend', modalHtml);
                }
            } catch (error) {
                alert('❌ Error loading backups: ' + error.message);
            }
        }
        
        async function showDeploymentHistory(platformId) {
            try {
                const response = await fetch(`/api/deploy/history/${platformId}`);
                const result = await response.json();
                
                if (result.success) {
                    const historyList = result.deployments.map(deployment => `
                        <div style="border: 1px solid #eee; padding: 12px; margin: 8px 0; border-radius: 4px; background: ${deployment.status === 'completed' ? '#f8f9fa' : deployment.status === 'failed' ? '#fff5f5' : '#fff9c4'};">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div>
                                    <strong>Deployment ${deployment.id.split('_')[1]}</strong> 
                                    <span style="color: ${deployment.status === 'completed' ? '#28a745' : deployment.status === 'failed' ? '#dc3545' : '#ffc107'};">
                                        ${deployment.status === 'completed' ? '✅' : deployment.status === 'failed' ? '❌' : '⏳'} ${deployment.status}
                                    </span><br>
                                    <small>Started: ${new Date(deployment.startedAt).toLocaleString()}</small><br>
                                    ${deployment.violationsFixed ? `<small>Fixed ${deployment.violationsFixed} violations</small>` : ''}
                                    ${deployment.error ? `<small style="color: #dc3545;">Error: ${deployment.error}</small>` : ''}
                                </div>
                                <div>
                                    ${deployment.canRollback ? `<button onclick="rollbackDeployment('${deployment.id}')" style="background: #ffc107; color: #000; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer;">🔄 Rollback</button>` : ''}
                                </div>
                            </div>
                            ${deployment.changes ? `<div style="margin-top: 8px; font-size: 0.85rem; color: #666;"><strong>Changes:</strong><ul style="margin: 4px 0; padding-left: 20px;">${deployment.changes.map(change => `<li>${change}</li>`).join('')}</ul></div>` : ''}
                        </div>
                    `).join('');
                    
                    const modalHtml = `
                        <div id="historyModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
                            <div style="background: white; padding: 30px; border-radius: 8px; max-width: 700px; width: 90%; max-height: 80%; overflow-y: auto;">
                                <h3 style="margin-top: 0;">📋 Deployment History - ${platformId}</h3>
                                <div>${historyList}</div>
                                <div style="text-align: right; margin-top: 20px;">
                                    <button onclick="closeHistoryModal()" style="background: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Close</button>
                                </div>
                            </div>
                        </div>
                    `;
                    
                    document.body.insertAdjacentHTML('beforeend', modalHtml);
                }
            } catch (error) {
                alert('❌ Error loading deployment history: ' + error.message);
            }
        }
        
        // Utility functions
        function closeBackupModal() {
            const modal = document.getElementById('backupModal');
            if (modal) modal.remove();
        }
        
        function closeHistoryModal() {
            const modal = document.getElementById('historyModal');
            if (modal) modal.remove();
        }
        
        async function createBackup(platformId) {
            try {
                const description = prompt('Enter backup description:', 'Manual backup - ' + new Date().toLocaleDateString());
                if (!description) return;
                
                const response = await fetch(`/api/backup/create/${platformId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ backupType: 'full', description: description })
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('✅ Backup creation started!\\nBackup ID: ' + result.backup.id);
                    closeBackupModal();
                } else {
                    alert('❌ Failed to create backup: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error creating backup: ' + error.message);
            }
        }
        
        async function restoreBackup(backupId) {
            if (!confirm('⚠️ Are you sure you want to restore from this backup?\\nThis will overwrite current data!')) return;
            
            try {
                const response = await fetch(`/api/backup/restore/${backupId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirmRestore: true })
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('🔄 Restore process started!\\nRestore ID: ' + result.restore.id);
                    closeBackupModal();
                } else {
                    alert('❌ Failed to start restore: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error starting restore: ' + error.message);
            }
        }
        
        async function deleteBackup(backupId) {
            if (!confirm('⚠️ Are you sure you want to delete this backup?\\nThis action cannot be undone!')) return;
            
            try {
                const response = await fetch(`/api/backup/delete/${backupId}`, { method: 'DELETE' });
                const result = await response.json();
                if (result.success) {
                    alert('✅ Backup deleted successfully!');
                    closeBackupModal();
                } else {
                    alert('❌ Failed to delete backup: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error deleting backup: ' + error.message);
            }
        }
        
        async function rollbackDeployment(deploymentId) {
            const reason = prompt('Enter rollback reason:', 'Manual rollback requested');
            if (!reason) return;
            
            if (!confirm('⚠️ Are you sure you want to rollback this deployment?\\nThis will revert all changes made during the deployment.')) return;
            
            try {
                const response = await fetch(`/api/deploy/rollback/${deploymentId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason: reason, restoreBackup: true })
                });
                
                const result = await response.json();
                if (result.success) {
                    alert('🔄 Rollback process started!\\nRollback ID: ' + result.rollback.id);
                    closeHistoryModal();
                } else {
                    alert('❌ Failed to start rollback: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error starting rollback: ' + error.message);
            }
        }
        
        // Platform connection form handler
        document.getElementById('connectForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const platformType = document.getElementById('connectBtn').getAttribute('data-platform');
            const formData = new FormData(e.target);
            const data = Object.fromEntries(formData.entries());
            
            try {
                let endpoint;
                switch(platformType) {
                    case 'wordpress':
                        endpoint = '/api/platforms/connect/wordpress';
                        break;
                    case 'shopify':
                        endpoint = '/api/platforms/connect/shopify';
                        break;
                    case 'custom':
                        endpoint = '/api/platforms/connect/custom';
                        data.connectionType = document.getElementById('connectionType').value;
                        data.credentials = {
                            host: data.host,
                            port: data.port,
                            username: data.username,
                            password: data.password
                        };
                        break;
                }
                
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ Platform connected successfully!\\n\\nPlatform: ' + result.platform.name + '\\nURL: ' + result.platform.url);
                    closeModal();
                    loadConnectedPlatforms(); // Refresh the connected platforms list
                } else {
                    alert('❌ Connection failed: ' + result.error);
                }
            } catch (error) {
                alert('❌ Error connecting platform: ' + error.message);
            }
        });
        
        // Scan form handler
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const url = formData.get('url');
            const scanType = formData.get('scanType');
            const standard = formData.get('standard');
            
            // Update current scan URL
            currentScanUrl = url;
            
            // Show loading state
            document.getElementById('loading').style.display = 'block';
            document.getElementById('results').style.display = 'none';
            document.getElementById('scanBtn').disabled = true;
            
            const statusElement = document.getElementById('loadingStatus');
            
            try {
                // Update status
                statusElement.textContent = 'Starting scan...';
                
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        standard: standard
                    })
                });
                
                statusElement.textContent = 'Processing results...';
                
                const result = await response.json();
                
                // Hide loading
                document.getElementById('loading').style.display = 'none';
                document.getElementById('scanBtn').disabled = false;
                
                if (result.success) {
                    displayResults(result);
                } else {
                    displayError(result.error || 'Scan failed');
                }
                
            } catch (error) {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('scanBtn').disabled = false;
                displayError('Network error: ' + error.message);
            }
        });
        
        function displayResults(result) {
            const resultsDiv = document.getElementById('results');
            const violations = result.violations || [];
            
            const score = violations.length === 0 ? 100 : Math.max(0, 100 - (violations.length * 2));
            const scoreClass = score >= 95 ? 'score-excellent' : score >= 80 ? 'score-good' : 'score-needs-work';
            
            resultsDiv.innerHTML = `
                <div class="alert alert-success">
                    <strong>Scan completed successfully!</strong><br>
                    Found ${violations.length} accessibility issues on ${result.url}
                </div>
                
                <div class="stat-card" style="margin-bottom: 20px;">
                    <div class="stat-number ${scoreClass}">${score}%</div>
                    <div class="stat-label">Accessibility Score</div>
                    <div class="stat-change">${violations.length} issues found</div>
                </div>
                
                ${violations.length > 0 ? `
                    <div class="violations-list">
                        <div class="section-header">Accessibility Issues Found</div>
                        ${violations.map(violation => `
                            <div class="violation-item">
                                <div class="violation-header">
                                    <div>
                                        <div class="violation-title">${violation.id}</div>
                                        <span class="violation-impact impact-${violation.impact}">${violation.impact}</span>
                                    </div>
                                </div>
                                <div class="violation-description">${violation.description}</div>
                                <div class="violation-help">${violation.help}</div>
                                ${violation.nodes && violation.nodes.length > 0 ? `
                                    <details class="violation-nodes">
                                        <summary>Show affected elements (${violation.nodes.length})</summary>
                                        <div class="node-list">
                                            ${violation.nodes.slice(0, 5).map(node => `
                                                <div class="node-item">${node.target ? node.target.join(', ') : 'Element'}</div>
                                            `).join('')}
                                            ${violation.nodes.length > 5 ? `<div class="node-item">... and ${violation.nodes.length - 5} more</div>` : ''}
                                        </div>
                                    </details>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : '<div class="alert alert-success">🎉 No accessibility issues found! Your website meets the selected accessibility standards.</div>'}
            `;
            
            resultsDiv.style.display = 'block';
        }
        
        function displayError(error) {
            const resultsDiv = document.getElementById('results');
            resultsDiv.innerHTML = `
                <div class="alert alert-error">
                    <strong>Scan failed:</strong> ${error}
                </div>
            `;
            resultsDiv.style.display = 'block';
        }
        
        function viewReport(scanId) {
            alert('Opening detailed report for scan #' + scanId);
        }
        
        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('connectModal');
            if (event.target === modal) {
                closeModal();
            }
        }
    </script>
</body>
</html>
        `);
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Internal server error');
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SentryPrime server running on port ${PORT}`);
    console.log(`📱 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
});
