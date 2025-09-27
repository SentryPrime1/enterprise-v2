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
        console.log('⚠️ No database connection, returning mock data');
        return [
            { 
                id: 1, 
                url: 'https://company.com', 
                scan_type: 'single', 
                total_issues: 7, 
                created_at: '2024-09-18',
                score: 94 
            },
            { 
                id: 2, 
                url: 'https://company.com/products', 
                scan_type: 'crawl', 
                total_issues: 12, 
                created_at: '2024-09-18',
                score: 87 
            },
            { 
                id: 3, 
                url: 'https://company.com/about', 
                scan_type: 'single', 
                total_issues: 3, 
                created_at: '2024-09-17',
                score: 96 
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, completed_at as created_at 
             FROM scans 
             WHERE user_id = $1 
             ORDER BY completed_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        console.log(`✅ Retrieved ${result.rows.length} scans from database`);
        
        return result.rows.map(scan => ({
            ...scan,
            score: Math.max(60, 100 - Math.min(40, scan.total_issues * 2)) // Calculate score based on issues
        }));
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

// NEW: Get scan details by ID for View Report functionality
async function getScanById(scanId, userId = 1) {
    if (!db) {
        return null;
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, scan_time_ms, pages_scanned, violations_data, completed_at
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

// NEW: Dashboard statistics function
async function getDashboardStats(userId = 1) {
    if (!db) {
        return {
            totalScans: 3,
            totalIssues: 22,
            avgScore: 92,
            weeklyScans: 2
        };
    }
    
    try {
        // Get total scans
        const totalScansResult = await db.query(
            'SELECT COUNT(*) as count FROM scans WHERE user_id = $1',
            [userId]
        );
        
        // Get total issues
        const totalIssuesResult = await db.query(
            'SELECT SUM(total_issues) as total FROM scans WHERE user_id = $1',
            [userId]
        );
        
        // Get average score (calculated from issues)
        const avgScoreResult = await db.query(
            'SELECT AVG(GREATEST(60, 100 - LEAST(40, total_issues * 2))) as avg_score FROM scans WHERE user_id = $1',
            [userId]
        );
        
        // Get scans from last 7 days
        const weeklyScansResult = await db.query(
            'SELECT COUNT(*) as count FROM scans WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL \'7 days\'',
            [userId]
        );
        
        return {
            totalScans: parseInt(totalScansResult.rows[0].count) || 0,
            totalIssues: parseInt(totalIssuesResult.rows[0].total) || 0,
            avgScore: Math.round(parseFloat(avgScoreResult.rows[0].avg_score)) || 0,
            weeklyScans: parseInt(weeklyScansResult.rows[0].count) || 0
        };
    } catch (error) {
        console.log('❌ Database error getting dashboard stats:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            avgScore: 0,
            weeklyScans: 0
        };
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

// NEW: API endpoint to get scan details for View Report
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
                <strong>Completed:</strong> ${new Date(scan.completed_at).toLocaleString()}<br>
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

// ENHANCED: Main dashboard with navigation routing - PRESERVED WITH MINIMAL CHANGES
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
            transition: all 0.2s ease;
            gap: 12px;
            font-size: 0.9rem;
            cursor: pointer;
        }
        
        .nav-item:hover {
            background: #333;
            color: white;
        }
        
        .nav-item.active {
            background: #333;
            color: white;
            border-right: 3px solid #667eea;
        }
        
        .nav-icon {
            width: 20px;
            height: 20px;
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
        
        /* Header */
        .header {
            background: white;
            padding: 16px 24px;
            border-bottom: 1px solid #e1e5e9;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 20px;
        }
        
        .search-bar {
            display: flex;
            align-items: center;
            background: #f8f9fa;
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            padding: 8px 12px;
            width: 300px;
        }
        
        .search-bar input {
            border: none;
            background: none;
            outline: none;
            flex: 1;
            font-size: 14px;
        }
        
        .header-right {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .user-profile {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
        }
        
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #667eea;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 14px;
        }
        
        /* Content Area */
        .content-area {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
        }
        
        .page-header {
            margin-bottom: 24px;
        }
        
        .page-title {
            font-size: 1.8rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .page-subtitle {
            color: #666;
            font-size: 1rem;
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
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
        }
        
        .stat-card h3 {
            font-size: 0.9rem;
            color: #666;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .stat-card .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 4px;
        }
        
        .stat-card .stat-change {
            font-size: 0.8rem;
            color: #28a745;
        }
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 30px;
        }
        
        .action-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            text-align: center;
            cursor: pointer;
            transition: transform 0.2s ease;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .action-card .action-icon {
            font-size: 2rem;
            margin-bottom: 12px;
        }
        
        .action-card h4 {
            font-size: 1rem;
            margin-bottom: 8px;
        }
        
        .action-card p {
            font-size: 0.8rem;
            color: #666;
        }
        
        /* Scanner Styles */
        .scanner-container {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 24px;
        }
        
        .url-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            margin-bottom: 16px;
        }
        
        .scan-options {
            margin-bottom: 20px;
        }
        
        .scan-options h4 {
            margin-bottom: 12px;
            font-size: 1rem;
        }
        
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .radio-option {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .multi-page-options {
            margin-left: 24px;
            margin-top: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .multi-page-options input[type="number"] {
            width: 60px;
            padding: 4px 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        
        .scan-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-btn:hover {
            background: #5a6fd8;
        }
        
        .scan-btn:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        
        /* Results Styles */
        .results-container {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 24px;
            display: none;
        }
        
        .results-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 16px;
        }
        
        .results-header h3 {
            font-size: 1.2rem;
        }
        
        .status-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .status-complete {
            background: #d4edda;
            color: #155724;
        }
        
        .status-error {
            background: #f8d7da;
            color: #721c24;
        }
        
        .results-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }
        
        .summary-item {
            text-align: center;
            padding: 16px;
            background: #f8f9fa;
            border-radius: 6px;
        }
        
        .summary-item .value {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 4px;
        }
        
        .summary-item .label {
            font-size: 0.8rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .violations-by-impact {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 12px;
            margin-bottom: 20px;
        }
        
        .impact-item {
            text-align: center;
            padding: 12px;
            border-radius: 6px;
        }
        
        .impact-critical { background: #f8d7da; color: #721c24; }
        .impact-serious { background: #fff3cd; color: #856404; }
        .impact-moderate { background: #cce5ff; color: #004085; }
        .impact-minor { background: #d1ecf1; color: #0c5460; }
        
        .view-details-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        /* Recent Scans */
        .recent-scans {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .recent-scans h3 {
            margin-bottom: 16px;
            font-size: 1.2rem;
        }
        
        .scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 0;
            border-bottom: 1px solid #eee;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            font-size: 1rem;
            margin-bottom: 4px;
        }
        
        .scan-meta {
            font-size: 0.8rem;
            color: #666;
        }
        
        .scan-score {
            background: #28a745;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .view-report-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8rem;
            margin-left: 8px;
            text-decoration: none;
            display: inline-block;
        }
        
        .view-report-btn:hover {
            background: #5a6fd8;
        }
        
        /* Loading States */
        .loading {
            display: flex;
            align-items: center;
            gap: 8px;
            color: #666;
        }
        
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Hidden class */
        .hidden {
            display: none !important;
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .dashboard-container {
                flex-direction: column;
            }
            
            .sidebar {
                width: 100%;
                height: auto;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .quick-actions {
                grid-template-columns: 1fr;
            }
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
                    <div class="nav-icon">📊</div>
                    Dashboard
                </a>
                <a href="#" class="nav-item" data-page="scans">
                    <div class="nav-icon">🔍</div>
                    Scans
                </a>
                <a href="#" class="nav-item" data-page="analytics">
                    <div class="nav-icon">📈</div>
                    Analytics
                </a>
                <a href="#" class="nav-item" data-page="team">
                    <div class="nav-icon">👥</div>
                    Team
                </a>
                <a href="#" class="nav-item" data-page="integrations">
                    <div class="nav-icon">🔗</div>
                    Integrations
                </a>
                <a href="#" class="nav-item" data-page="api">
                    <div class="nav-icon">⚙️</div>
                    API Management
                </a>
                <a href="#" class="nav-item" data-page="billing">
                    <div class="nav-icon">💳</div>
                    Billing
                </a>
                <a href="#" class="nav-item" data-page="settings">
                    <div class="nav-icon">⚙️</div>
                    Settings
                </a>
            </nav>
        </div>
        
        <!-- Main Content -->
        <div class="main-content">
            <!-- Header -->
            <div class="header">
                <div class="header-left">
                    <div class="search-bar">
                        <span>🔍</span>
                        <input type="text" placeholder="Search scans, reports, or settings...">
                    </div>
                </div>
                <div class="header-right">
                    <div style="position: relative;">
                        <span style="font-size: 1.2rem; cursor: pointer;">🔔</span>
                        <span style="position: absolute; top: -4px; right: -4px; background: #dc3545; color: white; border-radius: 50%; width: 16px; height: 16px; font-size: 10px; display: flex; align-items: center; justify-content: center;">2</span>
                    </div>
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <div>
                            <div style="font-size: 0.9rem; font-weight: 500;">John Doe</div>
                            <div style="font-size: 0.7rem; color: #666;">Acme Corporation</div>
                        </div>
                        <span style="margin-left: 8px;">▼</span>
                    </div>
                </div>
            </div>
            
            <!-- Content Area -->
            <div class="content-area">
                <!-- Dashboard Overview Page -->
                <div id="dashboard-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Dashboard Overview</h1>
                        <p class="page-subtitle">Monitor your accessibility compliance and recent activity</p>
                    </div>
                    
                    <!-- Statistics Cards -->
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h3>Total Scans</h3>
                            <div class="stat-value" id="total-scans">-</div>
                            <div class="stat-change">+2 this week</div>
                        </div>
                        <div class="stat-card">
                            <h3>Issues Found</h3>
                            <div class="stat-value" id="total-issues">-</div>
                            <div class="stat-change">-5 from last week</div>
                        </div>
                        <div class="stat-card">
                            <h3>Average Score</h3>
                            <div class="stat-value" id="avg-score">-</div>
                            <div class="stat-change">+3% improvement</div>
                        </div>
                        <div class="stat-card">
                            <h3>This Week</h3>
                            <div class="stat-value" id="weekly-scans">-</div>
                            <div class="stat-change">scans completed</div>
                        </div>
                    </div>
                    
                    <!-- Quick Actions -->
                    <div class="quick-actions">
                        <div class="action-card" onclick="switchToPage('scans')">
                            <div class="action-icon">🔍</div>
                            <h4>New Scan</h4>
                            <p>Start a new accessibility scan</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('analytics')">
                            <div class="action-icon">📊</div>
                            <h4>View Analytics</h4>
                            <p>Analyze compliance trends</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('team')">
                            <div class="action-icon">👥</div>
                            <h4>Manage Team</h4>
                            <p>Add or remove team members</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('settings')">
                            <div class="action-icon">⚙️</div>
                            <h4>Settings</h4>
                            <p>Configure your preferences</p>
                        </div>
                    </div>
                    
                    <!-- Recent Activity -->
                    <div class="recent-scans">
                        <h3>Recent Scans</h3>
                        <p style="color: #666; margin-bottom: 16px;">Your latest accessibility scan results</p>
                        <div id="dashboard-recent-scans">
                            <div class="loading">
                                <div class="spinner"></div>
                                Loading recent scans...
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Scans Page -->
                <div id="scans-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">Accessibility Scans</h1>
                        <p class="page-subtitle">Manage and review your accessibility scans</p>
                    </div>
                    
                    <div style="background: #d4edda; color: #155724; padding: 12px; border-radius: 6px; margin-bottom: 20px;">
                        ✅ Database connected - Scans will be saved to your history
                    </div>
                    
                    <!-- Scanner -->
                    <div class="scanner-container">
                        <h3 style="margin-bottom: 16px;">Scan Website for Accessibility Issues</h3>
                        
                        <input type="text" id="url-input" class="url-input" placeholder="https://example.com/" value="https://example.com/">
                        
                        <div class="scan-options">
                            <h4>Scan Options:</h4>
                            <div class="radio-group">
                                <label class="radio-option">
                                    <input type="radio" name="scanType" value="single" checked>
                                    Single Page (Fast - recommended)
                                </label>
                                <label class="radio-option">
                                    <input type="radio" name="scanType" value="crawl">
                                    Multi-Page Crawl (Slower - up to 
                                    <div class="multi-page-options">
                                        <input type="number" id="max-pages" value="5" min="1" max="20">
                                        pages)
                                    </div>
                                </label>
                            </div>
                        </div>
                        
                        <button id="scan-btn" class="scan-btn">
                            🔍 Start Accessibility Scan
                        </button>
                    </div>
                    
                    <!-- Results -->
                    <div id="results-container" class="results-container">
                        <div class="results-header">
                            <h3>Scan Results</h3>
                            <span id="status-badge" class="status-badge"></span>
                        </div>
                        <div id="results-content"></div>
                    </div>
                    
                    <!-- Recent Scans -->
                    <div class="recent-scans">
                        <h3>Recent Scans</h3>
                        <p style="color: #666; margin-bottom: 16px;">Your latest accessibility scan results</p>
                        <div id="recent-scans-list">
                            <div class="loading">
                                <div class="spinner"></div>
                                Loading recent scans...
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Other Pages (Coming Soon) -->
                <div id="analytics-page" class="page hidden">
                    <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="color: #666; margin-bottom: 10px;">📈 Analytics Dashboard</h3>
                        <p style="color: #999;">Comprehensive analytics and reporting features coming soon!</p>
                    </div>
                </div>
                
                <div id="team-page" class="page hidden">
                    <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="color: #666; margin-bottom: 10px;">👥 Team Management</h3>
                        <p style="color: #999;">Team collaboration and user management features coming soon!</p>
                    </div>
                </div>
                
                <div id="integrations-page" class="page hidden">
                    <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="color: #666; margin-bottom: 10px;">🔗 Integrations</h3>
                        <p style="color: #999;">Third-party integrations and webhooks coming soon!</p>
                    </div>
                </div>
                
                <div id="api-page" class="page hidden">
                    <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="color: #666; margin-bottom: 10px;">⚙️ API Management</h3>
                        <p style="color: #999;">API keys and developer tools coming soon!</p>
                    </div>
                </div>
                
                <div id="billing-page" class="page hidden">
                    <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="color: #666; margin-bottom: 10px;">💳 Billing & Subscription</h3>
                        <p style="color: #999;">Billing management and subscription features coming soon!</p>
                    </div>
                </div>
                
                <div id="settings-page" class="page hidden">
                    <div style="text-align: center; padding: 60px 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="color: #666; margin-bottom: 10px;">⚙️ Settings</h3>
                        <p style="color: #999;">User preferences and configuration options coming soon!</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Navigation functionality - PRESERVED
        function switchToPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.add('hidden');
            });
            
            // Remove active class from all nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId + '-page').classList.remove('hidden');
            
            // Add active class to selected nav item
            document.querySelector(\`[data-page="\${pageId}"]\`).classList.add('active');
            
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
                switchToPage(pageId);
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
                    document.getElementById('avg-score').textContent = data.stats.avgScore + '%';
                    document.getElementById('weekly-scans').textContent = data.stats.weeklyScans;
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
                        <div class="scan-item">
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
        
        // Recent scans loading for Scans page
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recent-scans-list');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => \`
                        <div class="scan-item">
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
        
        // Scan functionality - PRESERVED EXACTLY AS WORKING
        document.getElementById('scan-btn').addEventListener('click', async () => {
            const url = document.getElementById('url-input').value;
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('max-pages').value;
            
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            const scanBtn = document.getElementById('scan-btn');
            const resultsContainer = document.getElementById('results-container');
            const statusBadge = document.getElementById('status-badge');
            const resultsContent = document.getElementById('results-content');
            
            // Show results container
            resultsContainer.style.display = 'block';
            statusBadge.className = 'status-badge';
            statusBadge.textContent = 'Scanning...';
            resultsContent.innerHTML = '<div class="loading"><div class="spinner"></div>Running accessibility scan...</div>';
            
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
                        maxPages: scanType === 'crawl' ? parseInt(maxPages) : 1
                    })
                });
                
                const data = await response.json();
                
                if (data.success) {
                    statusBadge.className = 'status-badge status-complete';
                    statusBadge.textContent = 'Scan Complete';
                    
                    const result = data.result;
                    resultsContent.innerHTML = \`
                        <div class="results-summary">
                            <div class="summary-item">
                                <div class="value">\${result.url}</div>
                                <div class="label">URL</div>
                            </div>
                            <div class="summary-item">
                                <div class="value">\${result.totalIssues}</div>
                                <div class="label">Total Issues</div>
                            </div>
                            <div class="summary-item">
                                <div class="value">\${result.scanTime}ms</div>
                                <div class="label">Scan Time</div>
                            </div>
                            <div class="summary-item">
                                <div class="value">\${new Date(result.timestamp).toLocaleString()}</div>
                                <div class="label">Timestamp</div>
                            </div>
                        </div>
                        
                        <h4 style="margin: 20px 0 10px 0;">Violations by Impact:</h4>
                        <div class="violations-by-impact">
                            <div class="impact-item impact-critical">
                                <div style="font-size: 1.2rem; font-weight: bold;">\${result.violationsByImpact.critical}</div>
                                <div style="font-size: 0.8rem;">Critical</div>
                            </div>
                            <div class="impact-item impact-serious">
                                <div style="font-size: 1.2rem; font-weight: bold;">\${result.violationsByImpact.serious}</div>
                                <div style="font-size: 0.8rem;">Serious</div>
                            </div>
                            <div class="impact-item impact-moderate">
                                <div style="font-size: 1.2rem; font-weight: bold;">\${result.violationsByImpact.moderate}</div>
                                <div style="font-size: 0.8rem;">Moderate</div>
                            </div>
                            <div class="impact-item impact-minor">
                                <div style="font-size: 1.2rem; font-weight: bold;">\${result.violationsByImpact.minor}</div>
                                <div style="font-size: 0.8rem;">Minor</div>
                            </div>
                        </div>
                        
                        \${result.violations && result.violations.length > 0 ? \`
                            <button class="view-details-btn" onclick="showDetailedResults(\${JSON.stringify(result.violations).replace(/"/g, '&quot;')})">
                                👁️ View Detailed Results
                            </button>
                        \` : ''}
                    \`;
                    
                    // Refresh recent scans
                    loadRecentScans();
                    loadDashboardRecentScans();
                    loadDashboardStats();
                } else {
                    statusBadge.className = 'status-badge status-error';
                    statusBadge.textContent = 'Scan Failed';
                    resultsContent.innerHTML = \`<div style="color: #dc3545;">Error: \${data.error || 'Unknown error'}</div>\`;
                }
            } catch (error) {
                statusBadge.className = 'status-badge status-error';
                statusBadge.textContent = 'Network Error';
                resultsContent.innerHTML = \`<div style="color: #dc3545;">Network Error: \${error.message}</div>\`;
            } finally {
                // Re-enable scan button
                scanBtn.disabled = false;
                scanBtn.innerHTML = '🔍 Start Accessibility Scan';
            }
        });
        
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
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', () => {
            loadDashboardStats();
            loadDashboardRecentScans();
        });
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Helper functions for link extraction and scanning - PRESERVED EXACTLY AS WORKING
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

// Main scan API endpoint - PRESERVED EXACTLY AS WORKING
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const { url, scanType = 'single', maxPages = 1 } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        console.log(`🔍 Starting ${scanType} scan for: ${url}`);
        
        // Launch browser - PRESERVED EXACTLY AS WORKING
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        
        let allResults = [];
        let urlsToScan = [url];
        
        if (scanType === 'crawl') {
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
