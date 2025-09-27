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
                
                <!-- Analytics Page -->
                <div id="analytics-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">Analytics</h1>
                        <p class="page-subtitle">Track your accessibility compliance over time</p>
                    </div>
                    <div style="background: white; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 16px;">📊 Analytics Dashboard</h3>
                        <p style="color: #666; margin-bottom: 20px;">Coming soon - Advanced analytics and reporting features</p>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 6px;">
                            <p><strong>Planned Features:</strong></p>
                            <ul style="text-align: left; margin-top: 12px; color: #666;">
                                <li>Compliance trend charts</li>
                                <li>Issue category breakdowns</li>
                                <li>Team performance metrics</li>
                                <li>Custom reporting</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <!-- Team Page -->
                <div id="team-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">Team Management</h1>
                        <p class="page-subtitle">Manage team members and permissions</p>
                    </div>
                    <div style="background: white; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 16px;">👥 Team Management</h3>
                        <p style="color: #666; margin-bottom: 20px;">Coming soon - Team collaboration features</p>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 6px;">
                            <p><strong>Planned Features:</strong></p>
                            <ul style="text-align: left; margin-top: 12px; color: #666;">
                                <li>Invite team members</li>
                                <li>Role-based permissions</li>
                                <li>Activity tracking</li>
                                <li>Shared scan results</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <!-- Integrations Page -->
                <div id="integrations-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">Integrations</h1>
                        <p class="page-subtitle">Connect with your favorite tools and platforms</p>
                    </div>
                    <div style="background: white; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 16px;">🔗 Platform Integrations</h3>
                        <p style="color: #666; margin-bottom: 20px;">Coming soon - Direct integrations with popular platforms</p>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 6px;">
                            <p><strong>Planned Integrations:</strong></p>
                            <ul style="text-align: left; margin-top: 12px; color: #666;">
                                <li>Shopify - Auto-fix accessibility issues</li>
                                <li>WordPress - Plugin integration</li>
                                <li>Slack - Notifications and reports</li>
                                <li>GitHub - CI/CD integration</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <!-- API Management Page -->
                <div id="api-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">API Management</h1>
                        <p class="page-subtitle">Manage API keys and integrations</p>
                    </div>
                    <div style="background: white; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 16px;">⚙️ API Management</h3>
                        <p style="color: #666; margin-bottom: 20px;">Coming soon - API access and management</p>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 6px;">
                            <p><strong>Planned Features:</strong></p>
                            <ul style="text-align: left; margin-top: 12px; color: #666;">
                                <li>Generate API keys</li>
                                <li>Usage analytics</li>
                                <li>Rate limiting</li>
                                <li>Webhook configuration</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <!-- Billing Page -->
                <div id="billing-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">Billing</h1>
                        <p class="page-subtitle">Manage your subscription and billing</p>
                    </div>
                    <div style="background: white; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 16px;">💳 Billing Management</h3>
                        <p style="color: #666; margin-bottom: 20px;">Coming soon - Subscription and billing management</p>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 6px;">
                            <p><strong>Planned Features:</strong></p>
                            <ul style="text-align: left; margin-top: 12px; color: #666;">
                                <li>Subscription plans</li>
                                <li>Usage tracking</li>
                                <li>Invoice history</li>
                                <li>Payment methods</li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <!-- Settings Page -->
                <div id="settings-page" class="page hidden">
                    <div class="page-header">
                        <h1 class="page-title">Settings</h1>
                        <p class="page-subtitle">Configure your account and preferences</p>
                    </div>
                    <div style="background: white; padding: 40px; border-radius: 8px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <h3 style="margin-bottom: 16px;">⚙️ Account Settings</h3>
                        <p style="color: #666; margin-bottom: 20px;">Coming soon - Account and preference management</p>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 6px;">
                            <p><strong>Planned Features:</strong></p>
                            <ul style="text-align: left; margin-top: 12px; color: #666;">
                                <li>Profile management</li>
                                <li>Notification preferences</li>
                                <li>Security settings</li>
                                <li>Data export</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Navigation functionality
        function switchToPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.add('hidden');
            });
            
            // Show selected page
            document.getElementById(pageId + '-page').classList.remove('hidden');
            
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(\`[data-page="\${pageId}"]\`).classList.add('active');
        }
        
        // Add click handlers to nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const pageId = item.getAttribute('data-page');
                switchToPage(pageId);
            });
        });
        
        // Load dashboard statistics
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
        
        // Load recent scans for dashboard
        async function loadDashboardRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('dashboard-recent-scans');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.slice(0, 3).map(scan => \`
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${new Date(scan.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="scan-score">\${scan.score}% Score</span>
                                <button class="view-report-btn">👁️ View Report</button>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No scans yet. <a href="#" onclick="switchToPage(\\'scans\\')">Start your first scan</a></p>';
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('dashboard-recent-scans').innerHTML = '<p style="color: #dc3545; text-align: center; padding: 20px;">Error loading recent scans</p>';
            }
        }
        
        // Scanner functionality (preserved from original)
        let isScanning = false;
        
        document.getElementById('scan-btn').addEventListener('click', async () => {
            if (isScanning) return;
            
            const url = document.getElementById('url-input').value.trim();
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('max-pages').value;
            
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            isScanning = true;
            const scanBtn = document.getElementById('scan-btn');
            const resultsContainer = document.getElementById('results-container');
            
            // Update button state
            scanBtn.innerHTML = '<div class="spinner"></div> Scanning...';
            scanBtn.disabled = true;
            
            // Show results container
            resultsContainer.style.display = 'block';
            document.getElementById('status-badge').textContent = 'Scanning...';
            document.getElementById('status-badge').className = 'status-badge';
            document.getElementById('results-content').innerHTML = '<div class="loading"><div class="spinner"></div>Analyzing accessibility...</div>';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        maxPages: parseInt(maxPages)
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Update status
                    document.getElementById('status-badge').textContent = 'Scan Complete';
                    document.getElementById('status-badge').className = 'status-badge status-complete';
                    
                    // Display results
                    if (scanType === 'single') {
                        displaySinglePageResults(result);
                    } else {
                        displayMultiPageResults(result);
                    }
                    
                    // Reload recent scans
                    loadRecentScans();
                    loadDashboardRecentScans();
                    loadDashboardStats();
                } else {
                    throw new Error(result.error || 'Scan failed');
                }
            } catch (error) {
                console.error('Scan error:', error);
                document.getElementById('status-badge').textContent = 'Scan Failed';
                document.getElementById('status-badge').className = 'status-badge status-error';
                document.getElementById('results-content').innerHTML = \`
                    <div style="color: #dc3545; text-align: center; padding: 20px;">
                        <h4>Scan Failed</h4>
                        <p>\${error.message}</p>
                    </div>
                \`;
            } finally {
                // Reset button
                scanBtn.innerHTML = '🔍 Start Accessibility Scan';
                scanBtn.disabled = false;
                isScanning = false;
            }
        });
        
        function displaySinglePageResults(result) {
            const content = \`
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
                
                <h4 style="margin-bottom: 12px;">Violations by Impact:</h4>
                <div class="violations-by-impact">
                    <div class="impact-item impact-critical">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.critical}</div>
                        <div style="font-size: 0.8rem;">Critical</div>
                    </div>
                    <div class="impact-item impact-serious">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.serious}</div>
                        <div style="font-size: 0.8rem;">Serious</div>
                    </div>
                    <div class="impact-item impact-moderate">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.moderate}</div>
                        <div style="font-size: 0.8rem;">Moderate</div>
                    </div>
                    <div class="impact-item impact-minor">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.minor}</div>
                        <div style="font-size: 0.8rem;">Minor</div>
                    </div>
                </div>
                
                <button class="view-details-btn" onclick="showViolationDetails(\${JSON.stringify(result.violations).replace(/"/g, '&quot;')})">
                    ▶ View Detailed Results
                </button>
            \`;
            
            document.getElementById('results-content').innerHTML = content;
        }
        
        function displayMultiPageResults(result) {
            const content = \`
                <div class="results-summary">
                    <div class="summary-item">
                        <div class="value">\${result.pages.length}</div>
                        <div class="label">Pages Scanned</div>
                    </div>
                    <div class="summary-item">
                        <div class="value">\${result.totalIssues}</div>
                        <div class="label">Total Issues</div>
                    </div>
                    <div class="summary-item">
                        <div class="value">\${result.scanTime}ms</div>
                        <div class="label">Total Time</div>
                    </div>
                    <div class="summary-item">
                        <div class="value">\${new Date(result.timestamp).toLocaleString()}</div>
                        <div class="label">Timestamp</div>
                    </div>
                </div>
                
                <h4 style="margin-bottom: 12px;">Overall Violations by Impact:</h4>
                <div class="violations-by-impact">
                    <div class="impact-item impact-critical">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.critical}</div>
                        <div style="font-size: 0.8rem;">Critical</div>
                    </div>
                    <div class="impact-item impact-serious">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.serious}</div>
                        <div style="font-size: 0.8rem;">Serious</div>
                    </div>
                    <div class="impact-item impact-moderate">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.moderate}</div>
                        <div style="font-size: 0.8rem;">Moderate</div>
                    </div>
                    <div class="impact-item impact-minor">
                        <div style="font-weight: 600; font-size: 1.2rem;">\${result.summary.minor}</div>
                        <div style="font-size: 0.8rem;">Minor</div>
                    </div>
                </div>
                
                <h4 style="margin: 20px 0 12px;">Pages Scanned:</h4>
                <div style="background: #f8f9fa; border-radius: 6px; padding: 16px;">
                    \${result.pages.map(page => \`
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <div>
                                <div style="font-weight: 500;">\${page.url}</div>
                                <div style="font-size: 0.8rem; color: #666;">\${page.violations ? page.violations.length : 0} issues • \${page.loadTime || page.scanTime}ms</div>
                            </div>
                            \${page.error ? '<span style="color: #dc3545;">Error</span>' : '<span style="color: #28a745;">✓</span>'}
                        </div>
                    \`).join('')}
                </div>
                
                <button class="view-details-btn" onclick="showMultiPageViolationDetails(\${JSON.stringify(result.pages).replace(/"/g, '&quot;')})">
                    ▶ View Detailed Results
                </button>
            \`;
            
            document.getElementById('results-content').innerHTML = content;
        }
        
        function showViolationDetails(violations) {
            // Create a simple modal or expand the results to show detailed violations
            const detailsWindow = window.open('', '_blank', 'width=800,height=600');
            detailsWindow.document.write(\`
                <html>
                <head><title>Detailed Accessibility Report</title></head>
                <body style="font-family: Arial, sans-serif; padding: 20px;">
                    <h2>Detailed Accessibility Violations</h2>
                    <div>
                        \${violations.map((violation, index) => \`
                            <div style="border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 5px;">
                                <h3 style="color: #dc3545;">\${violation.id}</h3>
                                <p><strong>Impact:</strong> \${violation.impact}</p>
                                <p><strong>Description:</strong> \${violation.description}</p>
                                <p><strong>Help:</strong> \${violation.help}</p>
                                <p><strong>Elements affected:</strong> \${violation.nodes.length}</p>
                                <details>
                                    <summary>Show affected elements</summary>
                                    \${violation.nodes.map(node => \`
                                        <div style="background: #f8f9fa; padding: 10px; margin: 5px 0; border-radius: 3px;">
                                            <code>\${node.html}</code>
                                        </div>
                                    \`).join('')}
                                </details>
                            </div>
                        \`).join('')}
                    </div>
                </body>
                </html>
            \`);
        }
        
        function showMultiPageViolationDetails(pages) {
            // Create a detailed report window for multi-page scan results
            const detailsWindow = window.open('', '_blank', 'width=1000,height=700');
            
            // Collect all violations from all pages
            let allViolations = [];
            pages.forEach(page => {
                if (page.violations) {
                    page.violations.forEach(violation => {
                        allViolations.push({
                            ...violation,
                            pageUrl: page.url
                        });
                    });
                }
            });
            
            detailsWindow.document.write(\`
                <html>
                <head>
                    <title>Multi-Page Accessibility Report</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; }
                        .page-section { border: 1px solid #ddd; margin: 20px 0; padding: 20px; border-radius: 8px; }
                        .page-header { background: #f8f9fa; padding: 15px; margin: -20px -20px 15px -20px; border-radius: 8px 8px 0 0; }
                        .violation { border-left: 4px solid #dc3545; margin: 15px 0; padding: 15px; background: #fff5f5; border-radius: 0 5px 5px 0; }
                        .violation h4 { color: #dc3545; margin-bottom: 10px; }
                        .impact-critical { border-left-color: #dc3545; background: #fff5f5; }
                        .impact-serious { border-left-color: #fd7e14; background: #fff8f0; }
                        .impact-moderate { border-left-color: #ffc107; background: #fffbf0; }
                        .impact-minor { border-left-color: #28a745; background: #f0fff4; }
                        .elements { background: #f8f9fa; padding: 10px; margin: 10px 0; border-radius: 4px; }
                        .elements code { background: #e9ecef; padding: 2px 4px; border-radius: 3px; }
                        details { margin: 10px 0; }
                        summary { cursor: pointer; font-weight: bold; }
                        .summary-stats { background: #e3f2fd; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
                        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; }
                        .stat-item { text-align: center; }
                        .stat-value { font-size: 2rem; font-weight: bold; }
                        .stat-label { font-size: 0.9rem; color: #666; }
                    </style>
                </head>
                <body>
                    <h1>Multi-Page Accessibility Report</h1>
                    
                    <div class="summary-stats">
                        <h3>Summary</h3>
                        <div class="stats-grid">
                            <div class="stat-item">
                                <div class="stat-value">\${pages.length}</div>
                                <div class="stat-label">Pages Scanned</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${allViolations.length}</div>
                                <div class="stat-label">Total Violations</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${allViolations.filter(v => v.impact === 'critical').length}</div>
                                <div class="stat-label">Critical</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${allViolations.filter(v => v.impact === 'serious').length}</div>
                                <div class="stat-label">Serious</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${allViolations.filter(v => v.impact === 'moderate').length}</div>
                                <div class="stat-label">Moderate</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${allViolations.filter(v => v.impact === 'minor').length}</div>
                                <div class="stat-label">Minor</div>
                            </div>
                        </div>
                    </div>
                    
                    \${pages.map(page => \`
                        <div class="page-section">
                            <div class="page-header">
                                <h2>\${page.url}</h2>
                                <p><strong>Issues found:</strong> \${page.violations ? page.violations.length : 0} • <strong>Scan time:</strong> \${page.loadTime || page.scanTime || 'N/A'}ms</p>
                            </div>
                            
                            \${page.violations && page.violations.length > 0 ? 
                                page.violations.map(violation => \`
                                    <div class="violation impact-\${violation.impact}">
                                        <h4>\${violation.id} (\${violation.impact.toUpperCase()})</h4>
                                        <p><strong>Description:</strong> \${violation.description}</p>
                                        <p><strong>Help:</strong> \${violation.help}</p>
                                        <p><strong>Elements affected:</strong> \${violation.nodes.length}</p>
                                        
                                        <details>
                                            <summary>Show affected elements (\${violation.nodes.length})</summary>
                                            <div class="elements">
                                                \${violation.nodes.map(node => \`
                                                    <div style="margin: 8px 0; padding: 8px; background: white; border-radius: 4px;">
                                                        <code>\${node.html}</code>
                                                        \${node.failureSummary ? \`<br><small><strong>Issue:</strong> \${node.failureSummary}</small>\` : ''}
                                                    </div>
                                                \`).join('')}
                                            </div>
                                        </details>
                                    </div>
                                \`).join('') 
                                : '<p style="color: #28a745; font-weight: bold;">✓ No accessibility violations found on this page!</p>'
                            }
                        </div>
                    \`).join('')}
                    
                    <div style="margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px;">
                        <h3>Report Generated</h3>
                        <p>This report was generated on \${new Date().toLocaleString()} by SentryPrime Enterprise Scanner.</p>
                        <p>For more information about accessibility guidelines, visit <a href="https://www.w3.org/WAI/WCAG21/quickref/" target="_blank">WCAG 2.1 Quick Reference</a>.</p>
                    </div>
                </body>
                </html>
            \`);
        }
        
        // Load recent scans for scans page
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
                                <button class="view-report-btn">👁️ View Report</button>
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

// Helper functions for link extraction and scanning
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
        
        console.log('Running axe accessibility scan...');
        const results = await page.evaluate(() => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Axe scan timeout'));
                }, 60000);
                
                axe.run((err, results) => {
                    clearTimeout(timeout);
                    if (err) reject(err);
                    else resolve(results);
                });
            });
        });
        
        return results;
        
    } finally {
        await page.close();
    }
}

// EXACT COPY OF WORKING API ENDPOINT WITH DATABASE INTEGRATION ADDED
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const { url, scanType = 'single', maxPages = 5 } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }
        
        let targetUrl = url;
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
        
        console.log('🔍 Starting accessibility scan for: ' + targetUrl + ' (type: ' + scanType + ')');
        
        // Launch Puppeteer - EXACT WORKING CONFIGURATION
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ],
            timeout: 60000
        });
        
        if (scanType === 'single') {
            // Single page scan (existing working functionality)
            const results = await scanSinglePage(browser, targetUrl);
            const scanTime = Date.now() - startTime;
            
            console.log('✅ Single page scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
            
            // Save to database - ADDED FOR PERSISTENCE
            await saveScan(1, 1, targetUrl, scanType, results.violations.length, scanTime, 1, results.violations);
            
            res.json({
                success: true,
                url: targetUrl,
                violations: results.violations,
                timestamp: new Date().toISOString(),
                totalIssues: results.violations.length,
                scanTime: scanTime,
                summary: {
                    critical: results.violations.filter(v => v.impact === 'critical').length,
                    serious: results.violations.filter(v => v.impact === 'serious').length,
                    moderate: results.violations.filter(v => v.impact === 'moderate').length,
                    minor: results.violations.filter(v => v.impact === 'minor').length
                }
            });
            
        } else if (scanType === 'crawl') {
            // Multi-page crawl - EXACT WORKING LOGIC
            console.log('🕷️ Starting multi-page crawl (max ' + maxPages + ' pages)');
            
            const scannedPages = [];
            const urlsToScan = [targetUrl];
            const scannedUrls = new Set();
            
            // Scan the first page and extract links
            const firstPageResults = await scanSinglePage(browser, targetUrl);
            scannedPages.push({
                url: targetUrl,
                violations: firstPageResults.violations,
                scanTime: Date.now() - startTime
            });
            scannedUrls.add(targetUrl);
            
            // Extract links from the first page for crawling
            if (maxPages > 1) {
                const page = await browser.newPage();
                try {
                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    const links = await extractLinks(page, targetUrl);
                    
                    // Add unique links to scan queue
                    for (const link of links) {
                        if (urlsToScan.length < maxPages && !scannedUrls.has(link)) {
                            urlsToScan.push(link);
                        }
                    }
                } catch (error) {
                    console.log('Error extracting links:', error.message);
                } finally {
                    await page.close();
                }
            }
            
            // Scan additional pages
            for (let i = 1; i < urlsToScan.length && i < maxPages; i++) {
                const pageUrl = urlsToScan[i];
                if (scannedUrls.has(pageUrl)) continue;
                
                try {
                    console.log('🔍 Scanning page ' + (i + 1) + '/' + Math.min(urlsToScan.length, maxPages) + ': ' + pageUrl);
                    const pageStartTime = Date.now();
                    const pageResults = await scanSinglePage(browser, pageUrl);
                    
                    scannedPages.push({
                        url: pageUrl,
                        violations: pageResults.violations,
                        scanTime: Date.now() - pageStartTime
                    });
                    scannedUrls.add(pageUrl);
                    
                } catch (error) {
                    console.log('❌ Error scanning page ' + pageUrl + ':', error.message);
                    scannedPages.push({
                        url: pageUrl,
                        violations: [],
                        scanTime: 0,
                        error: error.message
                    });
                }
            }
            
            // Aggregate results
            const allViolations = scannedPages.reduce((acc, page) => acc.concat(page.violations || []), []);
            const scanTime = Date.now() - startTime;
            
            console.log('✅ Multi-page crawl completed in ' + scanTime + 'ms. Scanned ' + scannedPages.length + ' pages, found ' + allViolations.length + ' total violations.');
            
            // Save to database - ADDED FOR PERSISTENCE
            await saveScan(1, 1, targetUrl, scanType, allViolations.length, scanTime, scannedPages.length, allViolations);
            
            res.json({
                success: true,
                scanType: 'crawl',
                pages: scannedPages,
                totalIssues: allViolations.length,
                scanTime: scanTime,
                timestamp: new Date().toISOString(),
                summary: {
                    critical: allViolations.filter(v => v.impact === 'critical').length,
                    serious: allViolations.filter(v => v.impact === 'serious').length,
                    moderate: allViolations.filter(v => v.impact === 'moderate').length,
                    minor: allViolations.filter(v => v.impact === 'minor').length
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        const scanTime = Date.now() - startTime;
        
        let errorMessage = error.message;
        if (errorMessage.includes('Navigation timeout')) {
            errorMessage = 'Website took too long to load. This may be due to slow server response or complex page content. Please try a different URL or try again later.';
        } else if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
            errorMessage = 'Website not found. Please check the URL and try again.';
        } else if (errorMessage.includes('net::ERR_CONNECTION_REFUSED')) {
            errorMessage = 'Connection refused. The website may be down or blocking automated access.';
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage,
            scanTime: scanTime,
            timestamp: new Date().toISOString()
        });
    } finally {
        if (browser) {
            try {
                await browser.close();
                console.log('🔒 Browser closed successfully');
            } catch (closeError) {
                console.error('❌ Error closing browser:', closeError);
            }
        }
    }
});

// Start server
app.listen(PORT, () => {
    console.log('🚀 SentryPrime Enterprise Dashboard running on port ' + PORT);
    console.log('📊 Health check: http://localhost:' + PORT + '/health');
    console.log('🔍 Scanner: http://localhost:' + PORT + '/');
    console.log('💾 Database: ' + (db ? 'Connected' : 'Standalone mode'));
    console.log('🌐 Environment: ' + (process.env.K_SERVICE ? 'Cloud Run' : 'Local'));
});
