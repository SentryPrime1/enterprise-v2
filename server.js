const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

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
        return [
            {
                id: 1,
                url: 'https://example.com',
                scan_type: 'single',
                total_issues: 5,
                created_at: new Date().toISOString(),
                score: 85
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, created_at, 
                    CASE 
                        WHEN total_issues = 0 THEN 100
                        WHEN total_issues <= 5 THEN 90
                        WHEN total_issues <= 10 THEN 80
                        WHEN total_issues <= 20 THEN 70
                        ELSE 60
                    END as score
             FROM scans 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        console.log(`✅ Retrieved ${result.rows.length} scans from database`);
        return result.rows;
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

// NEW: Get scan details by ID
async function getScanById(scanId, userId = 1) {
    if (!db) {
        return null;
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, scan_time_ms, pages_scanned, violations_data, created_at
             FROM scans 
             WHERE id = $1 AND user_id = $2`,
            [scanId, userId]
        );
        
        if (result.rows.length === 0) {
            return null;
        }
        
        const scan = result.rows[0];
        console.log(`✅ Retrieved scan details for ID: ${scanId}`);
        return scan;
    } catch (error) {
        console.log('❌ Database error getting scan details:', error.message);
        return null;
    }
}

// NEW: Get dashboard statistics
async function getDashboardStats(userId = 1) {
    if (!db) {
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0
        };
    }
    
    try {
        const result = await db.query(
            `SELECT 
                COUNT(*) as total_scans,
                COALESCE(SUM(total_issues), 0) as total_issues,
                COALESCE(AVG(CASE 
                    WHEN total_issues = 0 THEN 100
                    WHEN total_issues <= 5 THEN 90
                    WHEN total_issues <= 10 THEN 80
                    WHEN total_issues <= 20 THEN 70
                    ELSE 60
                END), 0) as average_score,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as this_week_scans
             FROM scans 
             WHERE user_id = $1`,
            [userId]
        );
        
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

// ENHANCED: Puppeteer browser launch with Cloud Run compatibility
async function launchBrowser() {
    const isCloudRun = process.env.K_SERVICE;
    
    let launchOptions = {
        headless: 'new',
        timeout: 60000,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
            '--disable-extensions',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--hide-scrollbars',
            '--mute-audio',
            '--no-default-browser-check',
            '--no-pings',
            '--single-process'
        ]
    };
    
    if (isCloudRun) {
        console.log('☁️ Launching browser for Cloud Run environment');
        // For Cloud Run, let Puppeteer find Chrome automatically
        // The Cloud Run container should have Chrome installed
    } else {
        console.log('🖥️ Launching browser for local environment');
    }
    
    try {
        const browser = await puppeteer.launch(launchOptions);
        console.log('✅ Browser launched successfully');
        return browser;
    } catch (error) {
        console.log('❌ Failed to launch browser with default settings:', error.message);
        
        // Fallback: try with minimal args
        console.log('🔄 Trying fallback browser launch...');
        const fallbackOptions = {
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        };
        
        try {
            const browser = await puppeteer.launch(fallbackOptions);
            console.log('✅ Browser launched with fallback settings');
            return browser;
        } catch (fallbackError) {
            console.log('❌ Fallback browser launch also failed:', fallbackError.message);
            throw new Error('Unable to launch browser. Chrome may not be installed in the container.');
        }
    }
}

// Health check - PRESERVED
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local'
    });
});

// API endpoint to get recent scans - PRESERVED
app.get('/api/scans/recent', async (req, res) => {
    try {
        const scans = await getRecentScans(1); // Default user ID for now
        res.json({ success: true, scans });
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch scans' });
    }
});

// NEW: API endpoint for dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const stats = await getDashboardStats(1); // Default user ID for now
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// NEW: API endpoint to get scan details
app.get('/api/scans/:id', async (req, res) => {
    try {
        const scanId = parseInt(req.params.id);
        const scan = await getScanById(scanId, 1); // Default user ID for now
        
        if (!scan) {
            return res.status(404).json({ error: 'Scan not found' });
        }
        
        res.json({ success: true, scan });
    } catch (error) {
        console.error('Error fetching scan details:', error);
        res.status(500).json({ error: 'Failed to fetch scan details' });
    }
});

// NEW: Route to display detailed scan report
app.get('/report/:id', async (req, res) => {
    try {
        const scanId = parseInt(req.params.id);
        const scan = await getScanById(scanId, 1);
        
        if (!scan) {
            return res.status(404).send('<h1>Scan not found</h1>');
        }
        
        const violations = scan.violations_data ? JSON.parse(scan.violations_data) : [];
        
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>Accessibility Report - ${scan.url}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f8f9fa;
            color: #333;
        }
        .container { max-width: 1200px; margin: 0 auto; }
        .header {
            background: white;
            padding: 30px;
            border-radius: 8px;
            margin-bottom: 20px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header h1 { margin: 0 0 10px 0; color: #1a1a1a; }
        .header .meta { color: #666; font-size: 14px; }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
        }
        .stat-number { font-size: 2rem; font-weight: bold; margin-bottom: 5px; }
        .stat-label { color: #666; font-size: 14px; }
        .violations {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .violations-header {
            background: #f8f9fa;
            padding: 20px;
            border-bottom: 1px solid #dee2e6;
        }
        .violation-item {
            padding: 20px;
            border-bottom: 1px solid #dee2e6;
        }
        .violation-item:last-child { border-bottom: none; }
        .violation-id { 
            font-weight: bold; 
            color: #dc3545; 
            margin-bottom: 10px;
            font-size: 16px;
        }
        .violation-impact {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 10px;
        }
        .impact-critical { background: #dc3545; color: white; }
        .impact-serious { background: #fd7e14; color: white; }
        .impact-moderate { background: #ffc107; color: black; }
        .impact-minor { background: #17a2b8; color: white; }
        .violation-description { margin-bottom: 10px; line-height: 1.5; }
        .violation-help { color: #666; font-size: 14px; margin-bottom: 10px; }
        .violation-elements { 
            background: #f8f9fa; 
            padding: 10px; 
            border-radius: 4px; 
            font-size: 14px;
            color: #666;
        }
        .back-btn {
            display: inline-block;
            background: #007bff;
            color: white;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 4px;
            margin-bottom: 20px;
        }
        .back-btn:hover { background: #0056b3; }
    </style>
</head>
<body>
    <div class="container">
        <a href="/" class="back-btn">← Back to Dashboard</a>
        
        <div class="header">
            <h1>Accessibility Report</h1>
            <div class="meta">
                <strong>URL:</strong> ${scan.url}<br>
                <strong>Scan Type:</strong> ${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'}<br>
                <strong>Completed:</strong> ${new Date(scan.created_at).toLocaleString()}<br>
                <strong>Scan Time:</strong> ${scan.scan_time_ms}ms
            </div>
        </div>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number" style="color: #dc3545;">${scan.total_issues}</div>
                <div class="stat-label">Total Issues</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" style="color: #28a745;">${scan.pages_scanned || 1}</div>
                <div class="stat-label">Pages Scanned</div>
            </div>
            <div class="stat-card">
                <div class="stat-number" style="color: #007bff;">${Math.round((scan.scan_time_ms || 0) / 1000)}s</div>
                <div class="stat-label">Scan Duration</div>
            </div>
        </div>
        
        <div class="violations">
            <div class="violations-header">
                <h2 style="margin: 0;">Accessibility Violations (${violations.length})</h2>
            </div>
            ${violations.length > 0 ? violations.map(violation => `
                <div class="violation-item">
                    <div class="violation-id">${violation.id}</div>
                    <span class="violation-impact impact-${violation.impact}">${violation.impact}</span>
                    <div class="violation-description"><strong>Description:</strong> ${violation.description}</div>
                    <div class="violation-help"><strong>Help:</strong> ${violation.help}</div>
                    <div class="violation-elements"><strong>Elements affected:</strong> ${violation.nodes ? violation.nodes.length : 0}</div>
                </div>
            `).join('') : '<div style="padding: 40px; text-align: center; color: #28a745;"><h3>🎉 No accessibility violations found!</h3><p>This page meets accessibility standards.</p></div>'}
        </div>
    </div>
</body>
</html>`;
        
        res.send(html);
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).send('<h1>Error generating report</h1>');
    }
});

// ENHANCED: Main dashboard with navigation routing
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html>
<head>
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
            height: 100vh;
            overflow: hidden;
        }
        
        .dashboard-container {
            display: flex;
            height: 100vh;
        }
        
        /* Sidebar */
        .sidebar {
            width: 240px;
            background: #1a1a1a;
            color: white;
            padding: 20px 0;
            flex-shrink: 0;
        }
        
        .sidebar-header {
            padding: 0 20px 30px;
            border-bottom: 1px solid #333;
        }
        
        .sidebar-header h1 {
            font-size: 1.2rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .sidebar-header p {
            font-size: 0.8rem;
            color: #888;
            margin-top: 4px;
        }
        
        .sidebar-nav {
            padding: 20px 0;
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            padding: 12px 20px;
            color: #ccc;
            text-decoration: none;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .nav-item:hover {
            background: #333;
            color: white;
        }
        
        .nav-item.active {
            background: #007bff;
            color: white;
        }
        
        .nav-item .icon {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        /* Main Content */
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .header {
            background: white;
            padding: 20px 30px;
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .header-left h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 4px;
        }
        
        .header-left p {
            color: #666;
            font-size: 0.9rem;
        }
        
        .header-right {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        
        .search-box {
            position: relative;
        }
        
        .search-box input {
            padding: 8px 12px 8px 35px;
            border: 1px solid #ddd;
            border-radius: 6px;
            width: 300px;
            font-size: 14px;
        }
        
        .search-box .search-icon {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            color: #666;
        }
        
        .notifications {
            position: relative;
            cursor: pointer;
        }
        
        .notifications .badge {
            position: absolute;
            top: -5px;
            right: -5px;
            background: #dc3545;
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            font-size: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .user-profile {
            display: flex;
            align-items: center;
            gap: 10px;
            cursor: pointer;
        }
        
        .user-avatar {
            width: 32px;
            height: 32px;
            background: #007bff;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
        }
        
        .content-area {
            flex: 1;
            padding: 30px;
            overflow-y: auto;
        }
        
        /* Dashboard Overview Styles */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #007bff;
        }
        
        .stat-card.issues { border-left-color: #dc3545; }
        .stat-card.score { border-left-color: #28a745; }
        .stat-card.week { border-left-color: #ffc107; }
        
        .stat-number {
            font-size: 2rem;
            font-weight: bold;
            margin-bottom: 8px;
        }
        
        .stat-label {
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 4px;
        }
        
        .stat-change {
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .stat-change.positive { color: #28a745; }
        .stat-change.negative { color: #dc3545; }
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .action-card {
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            text-align: center;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
        }
        
        .action-icon {
            font-size: 2rem;
            margin-bottom: 12px;
        }
        
        .action-title {
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .action-description {
            color: #666;
            font-size: 0.9rem;
        }
        
        .recent-activity {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .recent-activity-header {
            padding: 20px 24px;
            border-bottom: 1px solid #dee2e6;
        }
        
        .recent-activity-header h3 {
            margin: 0;
            font-size: 1.1rem;
        }
        
        .recent-activity-list {
            padding: 0;
        }
        
        .recent-scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            border-bottom: 1px solid #f8f9fa;
        }
        
        .recent-scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            margin: 0 0 4px 0;
            font-size: 0.9rem;
        }
        
        .scan-meta {
            color: #666;
            font-size: 0.8rem;
        }
        
        .scan-score {
            background: #28a745;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: bold;
            margin-right: 8px;
        }
        
        .view-report-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.8rem;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
        }
        
        .view-report-btn:hover {
            background: #0056b3;
        }
        
        /* Page-specific content areas */
        .page-content {
            display: none;
        }
        
        .page-content.active {
            display: block;
        }
        
        /* Scans page styles */
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
            font-weight: 500;
        }
        
        .form-group input {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .scan-options {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .scan-option {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 14px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-btn:hover {
            background: #0056b3;
        }
        
        .scan-btn:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        
        .scan-results {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 30px;
            display: none;
        }
        
        .scan-results.show {
            display: block;
        }
        
        .scan-status {
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-weight: 500;
        }
        
        .scan-status.success {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .scan-status.error {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .scan-status.loading {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        
        .violations-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        
        .violation-count {
            text-align: center;
            padding: 15px;
            border-radius: 6px;
            font-weight: bold;
        }
        
        .violation-count.critical {
            background: #f8d7da;
            color: #721c24;
        }
        
        .violation-count.serious {
            background: #fff3cd;
            color: #856404;
        }
        
        .violation-count.moderate {
            background: #cce7ff;
            color: #004085;
        }
        
        .violation-count.minor {
            background: #d1ecf1;
            color: #0c5460;
        }
        
        .violation-count .number {
            display: block;
            font-size: 1.5rem;
            margin-bottom: 4px;
        }
        
        .violation-count .label {
            font-size: 0.8rem;
            text-transform: uppercase;
        }
        
        .detailed-results-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            margin-top: 15px;
        }
        
        .detailed-results-btn:hover {
            background: #218838;
        }
        
        /* Coming soon styles */
        .coming-soon {
            text-align: center;
            padding: 60px 20px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .coming-soon h3 {
            color: #666;
            margin-bottom: 10px;
        }
        
        .coming-soon p {
            color: #999;
        }
        
        .database-status {
            background: #d4edda;
            color: #155724;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>🛡️ SentryPrime</h1>
                <p>Enterprise Dashboard</p>
            </div>
            <nav class="sidebar-nav">
                <a href="#" class="nav-item active" data-page="dashboard">
                    <span class="icon">📊</span>
                    Dashboard
                </a>
                <a href="#" class="nav-item" data-page="scans">
                    <span class="icon">🔍</span>
                    Scans
                </a>
                <a href="#" class="nav-item" data-page="analytics">
                    <span class="icon">📈</span>
                    Analytics
                </a>
                <a href="#" class="nav-item" data-page="team">
                    <span class="icon">👥</span>
                    Team
                </a>
                <a href="#" class="nav-item" data-page="integrations">
                    <span class="icon">🔗</span>
                    Integrations
                </a>
                <a href="#" class="nav-item" data-page="api">
                    <span class="icon">⚙️</span>
                    API Management
                </a>
                <a href="#" class="nav-item" data-page="billing">
                    <span class="icon">💳</span>
                    Billing
                </a>
                <a href="#" class="nav-item" data-page="settings">
                    <span class="icon">⚙️</span>
                    Settings
                </a>
            </nav>
        </div>
        
        <!-- Main Content -->
        <div class="main-content">
            <!-- Header -->
            <div class="header">
                <div class="header-left">
                    <h2 id="page-title">Dashboard Overview</h2>
                    <p id="page-subtitle">Monitor your accessibility compliance and recent activity</p>
                </div>
                <div class="header-right">
                    <div class="search-box">
                        <span class="search-icon">🔍</span>
                        <input type="text" placeholder="Search scans, reports, or settings...">
                    </div>
                    <div class="notifications">
                        <span>🔔</span>
                        <span class="badge">2</span>
                    </div>
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <div>
                            <div style="font-weight: 500; font-size: 14px;">John Doe</div>
                            <div style="color: #666; font-size: 12px;">Acme Corporation</div>
                        </div>
                        <span>▼</span>
                    </div>
                </div>
            </div>
            
            <!-- Content Area -->
            <div class="content-area">
                <!-- Dashboard Overview Page -->
                <div id="dashboard-page" class="page-content active">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number" id="total-scans">-</div>
                            <div class="stat-label">TOTAL SCANS</div>
                            <div class="stat-change positive" id="scans-change">+2 this week</div>
                        </div>
                        <div class="stat-card issues">
                            <div class="stat-number" id="total-issues">-</div>
                            <div class="stat-label">ISSUES FOUND</div>
                            <div class="stat-change negative" id="issues-change">-5 from last week</div>
                        </div>
                        <div class="stat-card score">
                            <div class="stat-number" id="average-score">-</div>
                            <div class="stat-label">AVERAGE SCORE</div>
                            <div class="stat-change positive" id="score-change">+3% improvement</div>
                        </div>
                        <div class="stat-card week">
                            <div class="stat-number" id="week-scans">-</div>
                            <div class="stat-label">THIS WEEK</div>
                            <div class="stat-change positive" id="week-change">scans completed</div>
                        </div>
                    </div>
                    
                    <div class="quick-actions">
                        <div class="action-card" onclick="switchPage('scans')">
                            <div class="action-icon">🔍</div>
                            <div class="action-title">New Scan</div>
                            <div class="action-description">Start a new accessibility scan</div>
                        </div>
                        <div class="action-card" onclick="switchPage('analytics')">
                            <div class="action-icon">📊</div>
                            <div class="action-title">View Analytics</div>
                            <div class="action-description">Analyze compliance trends</div>
                        </div>
                        <div class="action-card" onclick="switchPage('team')">
                            <div class="action-icon">👥</div>
                            <div class="action-title">Manage Team</div>
                            <div class="action-description">Add or remove team members</div>
                        </div>
                        <div class="action-card" onclick="switchPage('settings')">
                            <div class="action-icon">⚙️</div>
                            <div class="action-title">Settings</div>
                            <div class="action-description">Configure your preferences</div>
                        </div>
                    </div>
                    
                    <div class="recent-activity">
                        <div class="recent-activity-header">
                            <h3>Recent Scans</h3>
                            <p style="margin: 4px 0 0 0; color: #666; font-size: 0.9rem;">Your latest accessibility scan results</p>
                        </div>
                        <div class="recent-activity-list" id="dashboard-recent-scans">
                            <div style="padding: 20px; text-align: center; color: #666;">Loading recent scans...</div>
                        </div>
                    </div>
                </div>
                
                <!-- Scans Page -->
                <div id="scans-page" class="page-content">
                    <div class="database-status">
                        ✅ Database connected - Scans will be saved to your history
                    </div>
                    
                    <div class="scan-form">
                        <h3 style="margin-bottom: 20px;">Scan Website for Accessibility Issues</h3>
                        <div class="form-group">
                            <label for="url-input">Website URL</label>
                            <input type="url" id="url-input" placeholder="https://example.com/" value="https://example.com/">
                        </div>
                        <div class="form-group">
                            <label>Scan Options:</label>
                            <div class="scan-options">
                                <div class="scan-option">
                                    <input type="radio" id="single-page" name="scan-type" value="single" checked>
                                    <label for="single-page">Single Page (Fast - recommended)</label>
                                </div>
                                <div class="scan-option">
                                    <input type="radio" id="multi-page" name="scan-type" value="multi">
                                    <label for="multi-page">Multi-Page Crawl (Slower - up to</label>
                                    <input type="number" id="max-pages" value="5" min="1" max="10" style="width: 60px; margin: 0 5px;">
                                    <label>pages)</label>
                                </div>
                            </div>
                        </div>
                        <button class="scan-btn" onclick="startScan()">
                            🔍 Start Accessibility Scan
                        </button>
                    </div>
                    
                    <div class="scan-results" id="scan-results">
                        <div class="scan-status" id="scan-status"></div>
                        <div id="scan-details"></div>
                    </div>
                    
                    <div class="recent-activity">
                        <div class="recent-activity-header">
                            <h3>Recent Scans</h3>
                            <p style="margin: 4px 0 0 0; color: #666; font-size: 0.9rem;">Your latest accessibility scan results</p>
                        </div>
                        <div class="recent-activity-list" id="recent-scans-list">
                            <div style="padding: 20px; text-align: center; color: #666;">Loading recent scans...</div>
                        </div>
                    </div>
                </div>
                
                <!-- Other Pages (Coming Soon) -->
                <div id="analytics-page" class="page-content">
                    <div class="coming-soon">
                        <h3>📈 Analytics Dashboard</h3>
                        <p>Comprehensive analytics and reporting features coming soon!</p>
                    </div>
                </div>
                
                <div id="team-page" class="page-content">
                    <div class="coming-soon">
                        <h3>👥 Team Management</h3>
                        <p>Team collaboration and user management features coming soon!</p>
                    </div>
                </div>
                
                <div id="integrations-page" class="page-content">
                    <div class="coming-soon">
                        <h3>🔗 Integrations</h3>
                        <p>Third-party integrations and webhooks coming soon!</p>
                    </div>
                </div>
                
                <div id="api-page" class="page-content">
                    <div class="coming-soon">
                        <h3>⚙️ API Management</h3>
                        <p>API keys and developer tools coming soon!</p>
                    </div>
                </div>
                
                <div id="billing-page" class="page-content">
                    <div class="coming-soon">
                        <h3>💳 Billing & Subscription</h3>
                        <p>Billing management and subscription features coming soon!</p>
                    </div>
                </div>
                
                <div id="settings-page" class="page-content">
                    <div class="coming-soon">
                        <h3>⚙️ Settings</h3>
                        <p>User preferences and configuration options coming soon!</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Navigation functionality
        function switchPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page-content').forEach(page => {
                page.classList.remove('active');
            });
            
            // Remove active class from all nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId + '-page').classList.add('active');
            
            // Add active class to selected nav item
            document.querySelector(\`[data-page="\${pageId}"]\`).classList.add('active');
            
            // Update header
            const titles = {
                dashboard: { title: 'Dashboard Overview', subtitle: 'Monitor your accessibility compliance and recent activity' },
                scans: { title: 'Accessibility Scans', subtitle: 'Manage and review your accessibility scans' },
                analytics: { title: 'Analytics', subtitle: 'View detailed analytics and reports' },
                team: { title: 'Team Management', subtitle: 'Manage team members and permissions' },
                integrations: { title: 'Integrations', subtitle: 'Connect with third-party services' },
                api: { title: 'API Management', subtitle: 'Manage API keys and developer tools' },
                billing: { title: 'Billing', subtitle: 'Manage your subscription and billing' },
                settings: { title: 'Settings', subtitle: 'Configure your account preferences' }
            };
            
            document.getElementById('page-title').textContent = titles[pageId].title;
            document.getElementById('page-subtitle').textContent = titles[pageId].subtitle;
            
            // Load page-specific data
            if (pageId === 'scans') {
                loadRecentScans();
            }
        }
        
        // Add click handlers to nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const pageId = item.getAttribute('data-page');
                switchPage(pageId);
            });
        });
        
        // Dashboard statistics loading
        async function loadDashboardStats() {
            try {
                const response = await fetch('/api/dashboard/stats');
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('total-scans').textContent = data.stats.totalScans;
                    document.getElementById('total-issues').textContent = data.stats.totalIssues;
                    document.getElementById('average-score').textContent = data.stats.averageScore + '%';
                    document.getElementById('week-scans').textContent = data.stats.thisWeekScans;
                }
            } catch (error) {
                console.error('Error loading dashboard stats:', error);
            }
        }
        
        // Dashboard recent scans loading
        async function loadDashboardRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('dashboard-recent-scans');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.slice(0, 5).map(scan => \`
                        <div class="recent-scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${new Date(scan.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="scan-score">\${scan.score}% Score</span>
                                <a href="/report/\${scan.id}" class="view-report-btn">👁️ View Report</a>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No scans yet. Run your first scan!</div>';
                }
            } catch (error) {
                console.error('Error loading dashboard recent scans:', error);
                document.getElementById('dashboard-recent-scans').innerHTML = '<div style="padding: 20px; text-align: center; color: #dc3545;">Error loading recent scans</div>';
            }
        }
        
        // Scan functionality - PRESERVED FROM WORKING VERSION
        async function startScan() {
            const url = document.getElementById('url-input').value;
            const scanType = document.querySelector('input[name="scan-type"]:checked').value;
            const maxPages = document.getElementById('max-pages').value;
            
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            const scanBtn = document.querySelector('.scan-btn');
            const resultsDiv = document.getElementById('scan-results');
            const statusDiv = document.getElementById('scan-status');
            const detailsDiv = document.getElementById('scan-details');
            
            // Show results area and update status
            resultsDiv.classList.add('show');
            statusDiv.className = 'scan-status loading';
            statusDiv.innerHTML = '🔄 Starting accessibility scan...';
            detailsDiv.innerHTML = '';
            
            // Disable scan button
            scanBtn.disabled = true;
            scanBtn.innerHTML = '🔄 Scanning...';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        maxPages: scanType === 'multi' ? parseInt(maxPages) : 1
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    statusDiv.className = 'scan-status success';
                    statusDiv.innerHTML = '✅ Scan Complete';
                    
                    // Display scan results
                    const result = data.result;
                    detailsDiv.innerHTML = \`
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px;">
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: bold; color: #333;">\${result.url}</div>
                                <div style="color: #666; margin-top: 4px;">URL</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: bold; color: #dc3545;">\${result.totalIssues}</div>
                                <div style="color: #666; margin-top: 4px;">TOTAL ISSUES</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: bold; color: #007bff;">\${result.scanTime}ms</div>
                                <div style="color: #666; margin-top: 4px;">SCAN TIME</div>
                            </div>
                            <div style="text-align: center;">
                                <div style="font-size: 1.5rem; font-weight: bold; color: #28a745;">\${new Date(result.timestamp).toLocaleString()}</div>
                                <div style="color: #666; margin-top: 4px;">TIMESTAMP</div>
                            </div>
                        </div>
                        
                        <h4 style="margin: 20px 0 10px 0;">Violations by Impact:</h4>
                        <div class="violations-summary">
                            <div class="violation-count critical">
                                <span class="number">\${result.violationsByImpact.critical}</span>
                                <span class="label">Critical</span>
                            </div>
                            <div class="violation-count serious">
                                <span class="number">\${result.violationsByImpact.serious}</span>
                                <span class="label">Serious</span>
                            </div>
                            <div class="violation-count moderate">
                                <span class="number">\${result.violationsByImpact.moderate}</span>
                                <span class="label">Moderate</span>
                            </div>
                            <div class="violation-count minor">
                                <span class="number">\${result.violationsByImpact.minor}</span>
                                <span class="label">Minor</span>
                            </div>
                        </div>
                        
                        \${result.violations && result.violations.length > 0 ? \`
                            <button class="detailed-results-btn" onclick="showDetailedResults(\${JSON.stringify(result.violations).replace(/"/g, '&quot;')})">
                                👁️ View Detailed Results
                            </button>
                        \` : ''}
                    \`;
                    
                    // Refresh recent scans
                    loadRecentScans();
                    loadDashboardRecentScans();
                    loadDashboardStats();
                } else {
                    statusDiv.className = 'scan-status error';
                    statusDiv.innerHTML = '❌ Scan Failed: ' + (data.error || 'Unknown error');
                }
            } catch (error) {
                statusDiv.className = 'scan-status error';
                statusDiv.innerHTML = '❌ Network Error: ' + error.message;
            } finally {
                // Re-enable scan button
                scanBtn.disabled = false;
                scanBtn.innerHTML = '🔍 Start Accessibility Scan';
            }
        }
        
        function showDetailedResults(violations) {
            const newWindow = window.open('', '_blank');
            newWindow.document.write(\`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Detailed Accessibility Violations</title>
                    <style>
                        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 20px; }
                        .violation { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px; }
                        .violation-id { font-weight: bold; color: #dc3545; margin-bottom: 10px; }
                        .impact { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
                        .impact-critical { background: #dc3545; color: white; }
                        .impact-serious { background: #fd7e14; color: white; }
                        .impact-moderate { background: #ffc107; color: black; }
                        .impact-minor { background: #17a2b8; color: white; }
                    </style>
                </head>
                <body>
                    <h1>Detailed Accessibility Violations</h1>
                    \${violations.map(v => \`
                        <div class="violation">
                            <div class="violation-id">\${v.id}</div>
                            <span class="impact impact-\${v.impact}">\${v.impact}</span>
                            <p><strong>Description:</strong> \${v.description}</p>
                            <p><strong>Help:</strong> \${v.help}</p>
                            <p><strong>Elements affected:</strong> \${v.nodes ? v.nodes.length : 0}</p>
                        </div>
                    \`).join('')}
                </body>
                </html>
            \`);
        }
        
        // Recent scans loading - PRESERVED
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recent-scans-list');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => \`
                        <div class="recent-scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${new Date(scan.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="scan-score">\${scan.score}% Score</span>
                                <a href="/report/\${scan.id}" class="view-report-btn">👁️ View Report</a>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No scans yet. Run your first scan above!</p>';
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('recent-scans-list').innerHTML = '<p style="color: #dc3545; text-align: center; padding: 20px;">Error loading recent scans</p>';
            }
        }
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', () => {
            loadDashboardStats();
            loadDashboardRecentScans();
            loadRecentScans();
        });
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Helper functions for link extraction and scanning - PRESERVED FROM WORKING VERSION
async function extractLinks(page, baseUrl) {
    try {
        const links = await page.evaluate((baseUrl) => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const baseUrlObj = new URL(baseUrl);
            
            return anchors
                .map(a => {
                    try {
                        const href = a.getAttribute('href');
                        if (!href) return null;
                        
                        // Convert relative URLs to absolute
                        const url = new URL(href, baseUrl);
                        
                        // Only include URLs from the same domain
                        if (url.hostname !== baseUrlObj.hostname) return null;
                        
                        // Exclude common non-page URLs
                        if (url.pathname.match(/\.(pdf|jpg|jpeg|png|gif|css|js|xml|zip|doc|docx)$/i)) return null;
                        if (url.pathname.includes('#')) return null;
                        
                        return url.href;
                    } catch (e) {
                        return null;
                    }
                })
                .filter(url => url !== null)
                .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
                .slice(0, 20); // Limit to 20 links max
        }, baseUrl);
        
        return links;
    } catch (error) {
        console.log('Error extracting links:', error.message);
        return [];
    }
}

async function scanSinglePage(browser, url) {
    const page = await browser.newPage();
    
    try {
        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to: ' + url);
        
        // Try multiple navigation strategies
        try {
            await page.goto(url, { 
                waitUntil: 'networkidle0',
                timeout: 90000 
            });
        } catch (navError) {
            console.log('Network idle failed, trying domcontentloaded...');
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 90000 
            });
        }
        
        // Wait for page to stabilize
        console.log('Waiting for page to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Inject axe-core
        console.log('Injecting axe-core...');
        await page.addScriptTag({
            content: axeCore.source
        });
        
        // Run accessibility scan
        console.log('Running accessibility scan...');
        const results = await page.evaluate(async () => {
            return await axe.run();
        });
        
        console.log(`Scan completed. Found ${results.violations.length} violations.`);
        
        return {
            url: url,
            violations: results.violations,
            passes: results.passes,
            incomplete: results.incomplete,
            inapplicable: results.inapplicable
        };
        
    } catch (error) {
        console.log(`Error scanning ${url}:`, error.message);
        throw error;
    } finally {
        await page.close();
    }
}

// Main scan API endpoint - ENHANCED with better browser handling
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const { url, scanType = 'single', maxPages = 1 } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        console.log(`🔍 Starting ${scanType} scan for: ${url}`);
        
        // Launch browser with enhanced error handling
        browser = await launchBrowser();
        
        let allResults = [];
        let urlsToScan = [url];
        
        if (scanType === 'multi') {
            // Extract links for multi-page scan
            const page = await browser.newPage();
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const extractedLinks = await extractLinks(page, url);
                urlsToScan = [url, ...extractedLinks.slice(0, maxPages - 1)];
                console.log(`Found ${extractedLinks.length} links, scanning ${urlsToScan.length} pages`);
            } catch (error) {
                console.log('Error extracting links, falling back to single page scan');
            } finally {
                await page.close();
            }
        }
        
        // Scan each URL
        for (const scanUrl of urlsToScan) {
            try {
                const result = await scanSinglePage(browser, scanUrl);
                allResults.push(result);
            } catch (error) {
                console.log(`Failed to scan ${scanUrl}:`, error.message);
                // Continue with other URLs
            }
        }
        
        if (allResults.length === 0) {
            throw new Error('No pages could be scanned successfully');
        }
        
        // Combine results
        const combinedViolations = [];
        const violationMap = new Map();
        
        allResults.forEach(result => {
            result.violations.forEach(violation => {
                const key = violation.id;
                if (violationMap.has(key)) {
                    // Merge nodes from same violation type
                    violationMap.get(key).nodes.push(...violation.nodes);
                } else {
                    violationMap.set(key, { ...violation });
                }
            });
        });
        
        combinedViolations.push(...violationMap.values());
        
        // Calculate statistics
        const totalIssues = combinedViolations.length;
        const violationsByImpact = {
            critical: combinedViolations.filter(v => v.impact === 'critical').length,
            serious: combinedViolations.filter(v => v.impact === 'serious').length,
            moderate: combinedViolations.filter(v => v.impact === 'moderate').length,
            minor: combinedViolations.filter(v => v.impact === 'minor').length
        };
        
        const scanTime = Date.now() - startTime;
        
        // Save to database
        const scanId = await saveScan(
            1, // Default user ID
            null, // Organization ID
            url,
            scanType,
            totalIssues,
            scanTime,
            allResults.length,
            combinedViolations
        );
        
        const result = {
            url: url,
            scanType: scanType,
            totalIssues: totalIssues,
            scanTime: scanTime,
            timestamp: new Date().toISOString(),
            pagesScanned: allResults.length,
            violationsByImpact: violationsByImpact,
            violations: combinedViolations,
            scanId: scanId
        };
        
        console.log(`✅ Scan completed in ${scanTime}ms. Found ${totalIssues} issues across ${allResults.length} pages.`);
        
        res.json({
            success: true,
            result: result
        });
        
    } catch (error) {
        console.log('❌ Scan failed:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SentryPrime Enterprise Dashboard running on port ${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔍 Scanner: http://localhost:${PORT}/`);
    console.log(`🗄️ Database: ${db ? 'Connected' : 'Standalone mode'}`);
    console.log(`☁️ Environment: ${process.env.K_SERVICE ? 'Cloud Run' : 'Local'}`);
    console.log(`⏰ Server time: ${new Date().toISOString()}`);
});
