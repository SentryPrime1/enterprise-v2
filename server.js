const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// AI Fix Engine - Safe initialization
let aiFixEngine = null;
try {
    if (process.env.OPENAI_API_KEY) {
        const { generateAccessibilityFixes } = require('./ai-fix-engine-corrected');
        aiFixEngine = { generateAccessibilityFixes };
        console.log('🤖 AI Fix Engine initialized successfully');
    } else {
        console.log('ℹ️ AI Fix Engine disabled - no OpenAI API key provided');
    }
} catch (error) {
    console.log('⚠️ AI Fix Engine failed to initialize:', error.message);
    console.log('📊 Scanner will work normally without AI features');
}

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
        return [];
    }
    
    try {
        const result = await db.query(
            'SELECT id, url, scan_type, total_issues, pages_scanned, completed_at FROM scans WHERE user_id = $1 ORDER BY completed_at DESC LIMIT $2',
            [userId, limit]
        );
        
        console.log(`✅ Retrieved ${result.rows.length} recent scans from database`);
        return result.rows;
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

async function getDashboardStats(userId = 1) {
    if (!db) {
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0,
            aiFixesGenerated: 0
        };
    }
    
    try {
        // Get total scans and issues
        const totalQuery = `
            SELECT 
                COUNT(*) as total_scans,
                COALESCE(SUM(total_issues), 0) as total_issues,
                COUNT(CASE WHEN completed_at >= NOW() - INTERVAL '7 days' THEN 1 END) as this_week_scans
            FROM scans WHERE user_id = $1
        `;
        
        const totalResult = await db.query(totalQuery, [userId]);
        const stats = totalResult.rows[0];
        
        // Calculate average score (assuming 100 - (issues/pages ratio))
        const avgScoreQuery = `
            SELECT AVG(GREATEST(0, 100 - (total_issues * 10))) as avg_score
            FROM scans 
            WHERE user_id = $1 AND total_issues IS NOT NULL
        `;
        
        const avgResult = await db.query(avgScoreQuery, [userId]);
        const averageScore = Math.round(avgResult.rows[0].avg_score || 75);
        
        // Count AI fixes generated (if violations_data contains ai_fixes)
        const aiFixesQuery = `
            SELECT COUNT(*) as ai_fixes_count
            FROM scans 
            WHERE user_id = $1 AND violations_data::text LIKE '%ai_fixes%'
        `;
        
        const aiFixesResult = await db.query(aiFixesQuery, [userId]);
        const aiFixesGenerated = parseInt(aiFixesResult.rows[0].ai_fixes_count) || 0;
        
        return {
            totalScans: parseInt(stats.total_scans),
            totalIssues: parseInt(stats.total_issues),
            averageScore: averageScore,
            thisWeekScans: parseInt(stats.this_week_scans),
            aiFixesGenerated: aiFixesGenerated
        };
    } catch (error) {
        console.error('❌ Database error getting stats:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0,
            aiFixesGenerated: 0
        };
    }
}

// EXACT COPY OF WORKING SCANNER FUNCTION
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
                    if (err) {
                        reject(err);
                    } else {
                        resolve(results);
                    }
                });
            });
        });
        
        console.log('✅ Axe scan completed. Found ' + results.violations.length + ' violations.');
        return results;
        
    } catch (error) {
        console.log('❌ Error during scan:', error.message);
        throw error;
    } finally {
        await page.close();
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'disconnected',
        aiEngine: aiFixEngine ? 'enabled' : 'disabled'
    });
});

// Serve static files
app.use(express.static('public'));

// Main route - Dashboard Overview
app.get('/', async (req, res) => {
    try {
        const stats = await getDashboardStats();
        const recentScans = await getRecentScans(1, 5);
        
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
            background-color: #f8fafc;
            color: #1e293b;
            line-height: 1.6;
        }
        
        .container {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 250px;
            background: linear-gradient(180deg, #1e293b 0%, #334155 100%);
            color: white;
            padding: 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }
        
        .logo {
            padding: 1.5rem;
            border-bottom: 1px solid #475569;
        }
        
        .logo h1 {
            font-size: 1.5rem;
            font-weight: 700;
            color: #f97316;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .logo-subtitle {
            font-size: 0.875rem;
            color: #94a3b8;
            margin-top: 0.25rem;
        }
        
        .nav-menu {
            padding: 1rem 0;
        }
        
        .nav-item {
            display: block;
            padding: 0.75rem 1.5rem;
            color: #cbd5e1;
            text-decoration: none;
            transition: all 0.2s;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            cursor: pointer;
            font-size: 0.875rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .nav-item:hover {
            background-color: #475569;
            color: white;
        }
        
        .nav-item.active {
            background-color: #f97316;
            color: white;
        }
        
        .nav-icon {
            width: 1.25rem;
            height: 1.25rem;
            flex-shrink: 0;
        }
        
        .main-content {
            flex: 1;
            margin-left: 250px;
            padding: 2rem;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
            background: white;
            padding: 1rem 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .search-bar {
            flex: 1;
            max-width: 400px;
            position: relative;
        }
        
        .search-input {
            width: 100%;
            padding: 0.5rem 1rem 0.5rem 2.5rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            font-size: 0.875rem;
        }
        
        .search-icon {
            position: absolute;
            left: 0.75rem;
            top: 50%;
            transform: translateY(-50%);
            color: #6b7280;
            width: 1rem;
            height: 1rem;
        }
        
        .header-actions {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .notification-badge {
            position: relative;
            padding: 0.5rem;
            color: #6b7280;
            cursor: pointer;
        }
        
        .badge {
            position: absolute;
            top: 0.25rem;
            right: 0.25rem;
            background: #ef4444;
            color: white;
            border-radius: 50%;
            width: 1rem;
            height: 1rem;
            font-size: 0.75rem;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            padding: 0.5rem;
            border-radius: 0.375rem;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .user-menu:hover {
            background-color: #f3f4f6;
        }
        
        .user-avatar {
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            background: #3b82f6;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 0.875rem;
        }
        
        .user-info h3 {
            font-size: 0.875rem;
            font-weight: 600;
            color: #1f2937;
        }
        
        .user-info p {
            font-size: 0.75rem;
            color: #6b7280;
        }
        
        .page-content {
            display: none;
        }
        
        .page-content.active {
            display: block;
        }
        
        .page-header {
            margin-bottom: 2rem;
        }
        
        .page-title {
            font-size: 2rem;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 0.5rem;
        }
        
        .page-subtitle {
            color: #64748b;
            font-size: 1rem;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .stat-card {
            background: white;
            padding: 1.5rem;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            border-left: 4px solid;
        }
        
        .stat-card.primary {
            border-left-color: #3b82f6;
        }
        
        .stat-card.success {
            border-left-color: #10b981;
        }
        
        .stat-card.warning {
            border-left-color: #f59e0b;
        }
        
        .stat-card.info {
            border-left-color: #8b5cf6;
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 0.5rem;
        }
        
        .stat-title {
            font-size: 0.875rem;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #1e293b;
            margin-bottom: 0.25rem;
        }
        
        .stat-change {
            font-size: 0.875rem;
            font-weight: 500;
        }
        
        .stat-change.positive {
            color: #10b981;
        }
        
        .stat-change.negative {
            color: #ef4444;
        }
        
        .scan-form {
            background: white;
            padding: 2rem;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            margin-bottom: 2rem;
        }
        
        .form-group {
            margin-bottom: 1.5rem;
        }
        
        .form-label {
            display: block;
            font-weight: 600;
            color: #374151;
            margin-bottom: 0.5rem;
        }
        
        .form-input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            font-size: 1rem;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .radio-group {
            display: flex;
            gap: 1rem;
            margin-top: 0.5rem;
        }
        
        .radio-item {
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .scan-button {
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            padding: 0.75rem 2rem;
            border: none;
            border-radius: 0.375rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .scan-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        
        .scan-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .scan-results {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 2rem;
            display: none;
        }
        
        .recent-scans {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 2rem;
        }
        
        .scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-url {
            font-weight: 600;
            color: #1e293b;
        }
        
        .scan-meta {
            font-size: 0.875rem;
            color: #6b7280;
        }
        
        .scan-issues {
            background: #fee2e2;
            color: #991b1b;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .coming-soon {
            text-align: center;
            padding: 4rem 2rem;
            color: #6b7280;
        }
        
        .coming-soon-icon {
            font-size: 4rem;
            margin-bottom: 1rem;
            opacity: 0.5;
        }
        
        .coming-soon h2 {
            font-size: 1.5rem;
            margin-bottom: 0.5rem;
            color: #1e293b;
        }
        
        .ai-badge {
            background: linear-gradient(135deg, #8b5cf6, #3b82f6);
            color: white;
            padding: 0.125rem 0.5rem;
            border-radius: 9999px;
            font-size: 0.75rem;
            font-weight: 600;
            margin-left: 0.5rem;
        }
        
        .checkbox-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-top: 1rem;
        }
    </style>
</head>
<body>
    <div class="container">
        <aside class="sidebar">
            <div class="logo">
                <h1>🛡️ SentryPrime</h1>
                <div class="logo-subtitle">Enterprise Dashboard</div>
            </div>
            <nav class="nav-menu">
                <button class="nav-item active" onclick="showPage('dashboard')">
                    <span class="nav-icon">📊</span>
                    Dashboard
                </button>
                <button class="nav-item" onclick="showPage('scans')">
                    <span class="nav-icon">🔍</span>
                    Scans
                </button>
                <button class="nav-item" onclick="showPage('analytics')">
                    <span class="nav-icon">📈</span>
                    Analytics
                </button>
                <button class="nav-item" onclick="showPage('team')">
                    <span class="nav-icon">👥</span>
                    Team
                </button>
                <button class="nav-item" onclick="showPage('integrations')">
                    <span class="nav-icon">🔗</span>
                    Integrations
                </button>
                <button class="nav-item" onclick="showPage('api')">
                    <span class="nav-icon">⚙️</span>
                    API Management
                </button>
                <button class="nav-item" onclick="showPage('billing')">
                    <span class="nav-icon">💳</span>
                    Billing
                </button>
                <button class="nav-item" onclick="showPage('settings')">
                    <span class="nav-icon">⚙️</span>
                    Settings
                </button>
            </nav>
        </aside>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" class="search-input" placeholder="Search scans, reports, or settings...">
                    <span class="search-icon">🔍</span>
                </div>
                <div class="header-actions">
                    <div class="notification-badge">
                        🔔
                        <span class="badge">3</span>
                    </div>
                    <div class="user-menu">
                        <div class="user-avatar">JD</div>
                        <div class="user-info">
                            <h3>John Doe</h3>
                            <p>Acme Corporation</p>
                        </div>
                        <span>▼</span>
                    </div>
                </div>
            </header>
            
            <!-- Dashboard Page -->
            <div id="dashboard" class="page-content active">
                <div class="page-header">
                    <h1 class="page-title">Dashboard Overview</h1>
                    <p class="page-subtitle">Monitor your accessibility compliance and scan performance</p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card primary">
                        <div class="stat-header">
                            <span class="stat-title">Total Scans</span>
                            <span>📊</span>
                        </div>
                        <div class="stat-value">${stats.totalScans}</div>
                        <div class="stat-change positive">+${stats.thisWeekScans} this week</div>
                    </div>
                    
                    <div class="stat-card warning">
                        <div class="stat-header">
                            <span class="stat-title">Total Issues</span>
                            <span>⚠️</span>
                        </div>
                        <div class="stat-value">${stats.totalIssues}</div>
                        <div class="stat-change">Found across all scans</div>
                    </div>
                    
                    <div class="stat-card success">
                        <div class="stat-header">
                            <span class="stat-title">Average Score</span>
                            <span>✅</span>
                        </div>
                        <div class="stat-value">${stats.averageScore}%</div>
                        <div class="stat-change positive">Accessibility compliance</div>
                    </div>
                    
                    <div class="stat-card info">
                        <div class="stat-header">
                            <span class="stat-title">AI Fixes</span>
                            <span>🤖</span>
                        </div>
                        <div class="stat-value">${stats.aiFixesGenerated}</div>
                        <div class="stat-change">Generated by AI</div>
                    </div>
                </div>
                
                <div class="recent-scans">
                    <h3 style="margin-bottom: 1.5rem; color: #1e293b;">Recent Scans</h3>
                    ${recentScans.length > 0 ? recentScans.map(scan => `
                        <div class="scan-item">
                            <div>
                                <div class="scan-url">${scan.url}</div>
                                <div class="scan-meta">${new Date(scan.completed_at).toLocaleDateString()} • ${scan.scan_type} scan • ${scan.pages_scanned} page(s)</div>
                            </div>
                            <div class="scan-issues">${scan.total_issues} issues</div>
                        </div>
                    `).join('') : `
                        <div style="text-align: center; padding: 2rem; color: #6b7280;">
                            <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📊</div>
                            <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: #1e293b;">No scans yet</h3>
                            <p>Run your first accessibility scan to see results here</p>
                        </div>
                    `}
                </div>
            </div>
            
            <!-- Scans Page -->
            <div id="scans" class="page-content">
                <div class="page-header">
                    <h1 class="page-title">Accessibility Scans</h1>
                    <p class="page-subtitle">Manage and review your accessibility scans</p>
                </div>
                
                ${db ? `
                <div style="background: #d1fae5; border: 1px solid #a7f3d0; border-radius: 0.5rem; padding: 1rem; margin-bottom: 2rem;">
                    <span style="color: #065f46; font-weight: 600;">✅ Database connected - Scans will be saved to your history</span>
                </div>
                ` : `
                <div style="background: #fef3c7; border: 1px solid #fcd34d; border-radius: 0.5rem; padding: 1rem; margin-bottom: 2rem;">
                    <span style="color: #92400e; font-weight: 600;">⚠️ Database disconnected - Scans will not be saved</span>
                </div>
                `}
                
                <div class="scan-form">
                    <h3 style="margin-bottom: 1.5rem; color: #1e293b;">Scan Website for Accessibility Issues</h3>
                    
                    <form id="scanForm">
                        <div class="form-group">
                            <label class="form-label">Website URL</label>
                            <input type="url" id="urlInput" class="form-input" placeholder="https://example.com/" required>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Scan Options:</label>
                            <div class="radio-group">
                                <div class="radio-item">
                                    <input type="radio" id="single" name="scanType" value="single" checked>
                                    <label for="single">Single Page (Fast - recommended)</label>
                                </div>
                                <div class="radio-item">
                                    <input type="radio" id="multi" name="scanType" value="multi">
                                    <label for="multi">Multi-Page Crawl (Slower - up to</label>
                                    <input type="number" id="maxPages" value="5" min="1" max="20" style="width: 60px; margin: 0 0.5rem; padding: 0.25rem; border: 1px solid #d1d5db; border-radius: 0.25rem;">
                                    <label>pages)</label>
                                </div>
                            </div>
                        </div>
                        
                        ${aiFixEngine ? `
                        <div class="form-group">
                            <div class="checkbox-group">
                                <input type="checkbox" id="enableAI" checked>
                                <label for="enableAI">Enable AI Fix Suggestions</label>
                                <span class="ai-badge">NEW</span>
                            </div>
                        </div>
                        ` : ''}
                        
                        <button type="submit" id="scanButton" class="scan-button">
                            🔍 Start Accessibility Scan
                        </button>
                    </form>
                </div>
                
                <div id="scanResults" class="scan-results">
                    <h3 style="margin-bottom: 1rem; color: #1e293b;">Scan Results</h3>
                    <div id="resultsContent"></div>
                </div>
            </div>
            
            <!-- Other Pages (Coming Soon) -->
            <div id="analytics" class="page-content">
                <div class="coming-soon">
                    <div class="coming-soon-icon">📈</div>
                    <h2>Analytics Dashboard</h2>
                    <p>Comprehensive analytics and reporting features are coming soon.</p>
                </div>
            </div>
            
            <div id="team" class="page-content">
                <div class="coming-soon">
                    <div class="coming-soon-icon">👥</div>
                    <h2>Team Management</h2>
                    <p>Team collaboration and user management features are coming soon.</p>
                </div>
            </div>
            
            <div id="integrations" class="page-content">
                <div class="coming-soon">
                    <div class="coming-soon-icon">🔗</div>
                    <h2>Integrations</h2>
                    <p>Third-party integrations and webhooks are coming soon.</p>
                </div>
            </div>
            
            <div id="api" class="page-content">
                <div class="coming-soon">
                    <div class="coming-soon-icon">⚙️</div>
                    <h2>API Management</h2>
                    <p>API keys and developer tools are coming soon.</p>
                </div>
            </div>
            
            <div id="billing" class="page-content">
                <div class="coming-soon">
                    <div class="coming-soon-icon">💳</div>
                    <h2>Billing & Subscriptions</h2>
                    <p>Billing management and subscription features are coming soon.</p>
                </div>
            </div>
            
            <div id="settings" class="page-content">
                <div class="coming-soon">
                    <div class="coming-soon-icon">⚙️</div>
                    <h2>Settings</h2>
                    <p>User preferences and configuration options are coming soon.</p>
                </div>
            </div>
        </main>
    </div>
    
    <script>
        function showPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page-content').forEach(page => {
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
        }
        
        // Scan form handling
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const url = document.getElementById('urlInput').value;
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('maxPages').value;
            const enableAI = document.getElementById('enableAI') ? document.getElementById('enableAI').checked : false;
            const scanButton = document.getElementById('scanButton');
            const resultsDiv = document.getElementById('scanResults');
            const resultsContent = document.getElementById('resultsContent');
            
            // Update button state
            scanButton.innerHTML = '⏳ Scanning...';
            scanButton.disabled = true;
            
            // Show results area
            resultsDiv.style.display = 'block';
            resultsContent.innerHTML = '<div style="text-align: center; padding: 2rem; color: #6b7280;">🔍 Scanning website for accessibility issues...</div>';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        maxPages: parseInt(maxPages),
                        enableAI: enableAI
                    }),
                });
                
                const result = await response.json();
                
                if (result.success) {
                    displayScanResults(result);
                    // Refresh recent scans
                    setTimeout(() => {
                        location.reload();
                    }, 2000);
                } else {
                    resultsContent.innerHTML = \`
                        <div style="background: #fee2e2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 1rem; color: #991b1b;">
                            <strong>❌ Scan Failed:</strong> \${result.error}
                        </div>
                    \`;
                }
            } catch (error) {
                resultsContent.innerHTML = \`
                    <div style="background: #fee2e2; border: 1px solid #fecaca; border-radius: 0.5rem; padding: 1rem; color: #991b1b;">
                        <strong>❌ Error:</strong> \${error.message}
                    </div>
                \`;
            } finally {
                // Reset button
                scanButton.innerHTML = '🔍 Start Accessibility Scan';
                scanButton.disabled = false;
            }
        });
        
        function displayScanResults(result) {
            const resultsContent = document.getElementById('resultsContent');
            const data = result;
            const score = Math.max(0, 100 - (data.totalIssues * 10));
            
            let aiFixesSection = '';
            if (data.aiFixReport && data.aiFixReport.fixes && data.aiFixReport.fixes.length > 0) {
                aiFixesSection = \`
                    <div style="background: linear-gradient(135deg, #f3f4f6, #e5e7eb); border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 1.5rem; margin-top: 1.5rem;">
                        <h4 style="color: #374151; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                            🤖 AI Fix Suggestions
                            <span style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: white; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600;">NEW</span>
                        </h4>
                        <p style="color: #6b7280; margin-bottom: 1rem;">AI has generated \${data.aiFixReport.fixes.length} specific code fixes for your accessibility issues.</p>
                        <div style="background: white; border-radius: 0.375rem; padding: 1rem;">
                            <h5 style="margin-bottom: 0.5rem;">Summary:</h5>
                            <ul style="margin-left: 1rem; color: #374151;">
                                <li>Total fixes generated: \${data.aiFixReport.fixes.length}</li>
                                <li>Fixability rate: \${data.aiFixReport.summary.fixabilityRate}%</li>
                                <li>Average confidence: \${data.aiFixReport.summary.averageConfidence}%</li>
                            </ul>
                        </div>
                    </div>
                \`;
            }
            
            resultsContent.innerHTML = \`
                <div style="background: #d1fae5; border: 1px solid #a7f3d0; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem;">
                    <span style="color: #065f46; font-weight: 600;">✅ Scan Complete</span>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${data.totalIssues}</div>
                        <div style="color: #64748b; font-size: 0.875rem;">TOTAL ISSUES</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${data.scanTime}ms</div>
                        <div style="color: #64748b; font-size: 0.875rem;">SCAN TIME</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">1</div>
                        <div style="color: #64748b; font-size: 0.875rem;">PAGES SCANNED</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${score}%</div>
                        <div style="color: #64748b; font-size: 0.875rem;">SCORE</div>
                    </div>
                </div>
                
                <h4 style="color: #374151; margin-bottom: 1rem;">Violations by Impact:</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="text-align: center; padding: 1rem; background: #fee2e2; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #991b1b;">\${data.summary.critical || 0}</div>
                        <div style="color: #991b1b; font-size: 0.875rem; font-weight: 600;">Critical</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #fef3c7; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #92400e;">\${data.summary.serious || 0}</div>
                        <div style="color: #92400e; font-size: 0.875rem; font-weight: 600;">Serious</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #dbeafe; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #1d4ed8;">\${data.summary.moderate || 0}</div>
                        <div style="color: #1d4ed8; font-size: 0.875rem; font-weight: 600;">Moderate</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #d1fae5; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #065f46;">\${data.summary.minor || 0}</div>
                        <div style="color: #065f46; font-size: 0.875rem; font-weight: 600;">Minor</div>
                    </div>
                </div>
                
                \${aiFixesSection}
            \`;
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

// API endpoint for scanning - USING WORKING SCANNER LOGIC
app.post('/api/scan', async (req, res) => {
    const { url: targetUrl, scanType = 'single', maxPages = 5, enableAI = false } = req.body;
    
    if (!targetUrl) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }
    
    const startTime = Date.now();
    let browser = null;
    
    try {
        console.log('🔍 Starting accessibility scan for: ' + targetUrl);
        
        // Launch browser with Cloud Run compatible settings - EXACT COPY FROM WORKING VERSION
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: process.env.NODE_ENV === 'production' ? '/usr/bin/google-chrome-stable' : '/usr/bin/chromium-browser',
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
            
            // Generate AI fixes if enabled and available
            let aiFixReport = null;
            if (enableAI && aiFixEngine && results.violations.length > 0) {
                try {
                    console.log('🤖 Generating AI fix suggestions...');
                    aiFixReport = await aiFixEngine.generateAccessibilityFixes(results.violations, targetUrl);
                    console.log(`✅ Generated AI fix suggestions`);
                } catch (aiError) {
                    console.error('❌ AI fix generation failed:', aiError.message);
                }
            }
            
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
                },
                aiFixReport: aiFixReport
            });
        } else {
            // Multi-page scan would go here
            res.json({ success: false, error: 'Multi-page scanning not implemented yet' });
        }
        
    } catch (error) {
        console.log('❌ Scan failed:', error.message);
        res.json({ 
            success: false, 
            error: error.message || 'Scan failed'
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// API endpoint to get recent scans
app.get('/api/scans/recent', async (req, res) => {
    try {
        const recentScans = await getRecentScans(1, 10);
        res.json({ success: true, data: recentScans });
    } catch (error) {
        console.error('Error getting recent scans:', error);
        res.status(500).json({ success: false, error: 'Failed to get recent scans' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SentryPrime Enterprise Dashboard running on port ${PORT}`);
    console.log(`📊 Scanner: http://localhost:${PORT}/`);
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);
    console.log(`🗄️ Database: ${db ? 'Connected' : 'Disconnected'}`);
    console.log(`🤖 AI Features: ${aiFixEngine ? 'Enabled' : 'Disabled'}`);
    console.log(`⏰ Server time: ${new Date().toISOString()}`);
    
    // Log environment info
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`☁️ Cloud Run: ${process.env.K_SERVICE ? 'Yes' : 'No'}`);
    console.log(`🐘 PostgreSQL version: PostgreSQL`);
});
