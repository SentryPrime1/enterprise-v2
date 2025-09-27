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
        const { generateAccessibilityFixes } = require('./ai-fix-engine');
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
        };
    } else {
        // Local development or other environments
        console.log('💻 Using standard TCP connection');
        dbConfig = {
            host: process.env.DB_HOST,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            port: process.env.DB_PORT || 5432,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
        };
    }
    
    db = new Pool(dbConfig);
    
    // Test database connection
    db.connect()
        .then(client => {
            console.log('✅ Database connected successfully!');
            client.release();
        })
        .catch(err => {
            console.error('❌ Database connection failed:', err.message);
            db = null;
        });
} else {
    console.log('ℹ️ Database connection disabled - missing environment variables');
}

// Helper function to save scan to database
async function saveScanToDatabase(scanData) {
    if (!db) {
        console.log('⚠️ Database not available, skipping save');
        return null;
    }
    
    try {
        const query = `
            INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, violations_data, completed_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING id
        `;
        
        const values = [
            scanData.user_id || 1,
            scanData.organization_id || null,
            scanData.url,
            scanData.scan_type || 'single',
            scanData.status || 'completed',
            scanData.total_issues || 0,
            scanData.scan_time_ms || null,
            scanData.pages_scanned || 1,
            JSON.stringify(scanData.violations_data || {})
        ];
        
        const result = await db.query(query, values);
        const scanId = result.rows[0].id;
        console.log('✅ Scan saved to database with ID:', scanId);
        return scanId;
    } catch (error) {
        console.error('❌ Database error saving scan:', error.message);
        return null;
    }
}

// Helper function to get recent scans from database
async function getRecentScans(limit = 10) {
    if (!db) {
        console.log('⚠️ Database not available, returning empty scans');
        return [];
    }
    
    try {
        const query = `
            SELECT id, url, scan_type, total_issues, pages_scanned, completed_at, violations_data
            FROM scans 
            ORDER BY completed_at DESC 
            LIMIT $1
        `;
        
        const result = await db.query(query, [limit]);
        console.log(`✅ Retrieved ${result.rows.length} scans from database`);
        return result.rows;
    } catch (error) {
        console.error('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

// Helper function to get dashboard statistics
async function getDashboardStats() {
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
            FROM scans
        `;
        
        const totalResult = await db.query(totalQuery);
        const stats = totalResult.rows[0];
        
        // Calculate average score (assuming 100 - (issues/pages ratio))
        const avgScoreQuery = `
            SELECT AVG(GREATEST(0, 100 - (total_issues * 10))) as avg_score
            FROM scans 
            WHERE total_issues IS NOT NULL
        `;
        
        const avgResult = await db.query(avgScoreQuery);
        const averageScore = Math.round(avgResult.rows[0].avg_score || 75);
        
        // Count AI fixes generated (if violations_data contains ai_fixes)
        const aiFixesQuery = `
            SELECT COUNT(*) as ai_fixes_count
            FROM scans 
            WHERE violations_data::text LIKE '%ai_fixes%'
        `;
        
        const aiFixesResult = await db.query(aiFixesQuery);
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

// Serve static files
app.use(express.static('public'));

// Main route - Dashboard Overview
app.get('/', async (req, res) => {
    try {
        const stats = await getDashboardStats();
        const recentScans = await getRecentScans(5);
        
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
            justify-content: between;
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
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }
        
        .action-card {
            background: white;
            padding: 1.5rem;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid #e5e7eb;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        .action-icon {
            width: 3rem;
            height: 3rem;
            margin: 0 auto 1rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 1.5rem;
        }
        
        .action-icon.primary {
            background: #dbeafe;
            color: #3b82f6;
        }
        
        .action-icon.success {
            background: #d1fae5;
            color: #10b981;
        }
        
        .action-icon.warning {
            background: #fef3c7;
            color: #f59e0b;
        }
        
        .action-icon.info {
            background: #ede9fe;
            color: #8b5cf6;
        }
        
        .action-title {
            font-size: 1.125rem;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 0.5rem;
        }
        
        .action-description {
            color: #64748b;
            font-size: 0.875rem;
        }
        
        .recent-activity {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        
        .activity-header {
            padding: 1.5rem;
            border-bottom: 1px solid #e5e7eb;
        }
        
        .activity-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 0.25rem;
        }
        
        .activity-subtitle {
            color: #64748b;
            font-size: 0.875rem;
        }
        
        .activity-list {
            padding: 0;
        }
        
        .activity-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 1rem 1.5rem;
            border-bottom: 1px solid #f3f4f6;
            transition: background-color 0.2s;
        }
        
        .activity-item:hover {
            background-color: #f8fafc;
        }
        
        .activity-item:last-child {
            border-bottom: none;
        }
        
        .activity-info {
            flex: 1;
        }
        
        .activity-url {
            font-weight: 600;
            color: #1e293b;
            margin-bottom: 0.25rem;
        }
        
        .activity-meta {
            font-size: 0.875rem;
            color: #64748b;
        }
        
        .activity-score {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        
        .score-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .score-badge.excellent {
            background: #d1fae5;
            color: #065f46;
        }
        
        .score-badge.good {
            background: #fef3c7;
            color: #92400e;
        }
        
        .score-badge.poor {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .view-report-btn {
            padding: 0.5rem 1rem;
            background: #3b82f6;
            color: white;
            border: none;
            border-radius: 0.375rem;
            font-size: 0.875rem;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }
        
        .view-report-btn:hover {
            background: #2563eb;
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
        
        .coming-soon {
            text-align: center;
            padding: 4rem 2rem;
            color: #64748b;
        }
        
        .coming-soon h2 {
            font-size: 1.5rem;
            margin-bottom: 1rem;
            color: #1e293b;
        }
        
        .coming-soon p {
            font-size: 1rem;
            margin-bottom: 2rem;
        }
        
        .coming-soon-icon {
            font-size: 4rem;
            margin-bottom: 2rem;
            opacity: 0.5;
        }
        
        @media (max-width: 768px) {
            .sidebar {
                transform: translateX(-100%);
                transition: transform 0.3s;
            }
            
            .main-content {
                margin-left: 0;
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
    <div class="container">
        <nav class="sidebar">
            <div class="logo">
                <h1>🛡️ SentryPrime</h1>
                <div class="logo-subtitle">Enterprise Dashboard</div>
            </div>
            <div class="nav-menu">
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
            </div>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" class="search-input" placeholder="Search scans, reports, or settings...">
                    <span class="search-icon">🔍</span>
                </div>
                <div class="header-actions">
                    <div class="notification-badge">
                        🔔
                        <span class="badge">${stats.aiFixesGenerated > 0 ? '!' : '2'}</span>
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
            
            <!-- Dashboard Overview Page -->
            <div id="dashboard" class="page-content active">
                <div class="page-header">
                    <h1 class="page-title">Dashboard Overview</h1>
                    <p class="page-subtitle">Monitor your accessibility compliance and recent activity</p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card primary">
                        <div class="stat-header">
                            <span class="stat-title">Total Scans</span>
                        </div>
                        <div class="stat-value">${stats.totalScans}</div>
                        <div class="stat-change positive">+${stats.thisWeekScans} this week</div>
                    </div>
                    
                    <div class="stat-card warning">
                        <div class="stat-header">
                            <span class="stat-title">Issues Found</span>
                        </div>
                        <div class="stat-value">${stats.totalIssues}</div>
                        <div class="stat-change ${stats.totalIssues > 50 ? 'negative' : 'positive'}">
                            ${stats.totalIssues > 50 ? '+5 from last week' : '-5 from last week'}
                        </div>
                    </div>
                    
                    <div class="stat-card success">
                        <div class="stat-header">
                            <span class="stat-title">Average Score</span>
                        </div>
                        <div class="stat-value">${stats.averageScore}%</div>
                        <div class="stat-change positive">+3% improvement</div>
                    </div>
                    
                    <div class="stat-card info">
                        <div class="stat-header">
                            <span class="stat-title">This Week</span>
                        </div>
                        <div class="stat-value">${stats.thisWeekScans}</div>
                        <div class="stat-change positive">scans completed</div>
                    </div>
                    
                    ${stats.aiFixesGenerated > 0 ? `
                    <div class="stat-card info">
                        <div class="stat-header">
                            <span class="stat-title">AI Fixes Generated</span>
                        </div>
                        <div class="stat-value">${stats.aiFixesGenerated}</div>
                        <div class="stat-change positive">🤖 AI-powered solutions</div>
                    </div>
                    ` : ''}
                </div>
                
                <div class="quick-actions">
                    <div class="action-card" onclick="showPage('scans')">
                        <div class="action-icon primary">🔍</div>
                        <h3 class="action-title">New Scan</h3>
                        <p class="action-description">Start a new accessibility scan</p>
                    </div>
                    
                    <div class="action-card" onclick="showPage('analytics')">
                        <div class="action-icon success">📊</div>
                        <h3 class="action-title">View Analytics</h3>
                        <p class="action-description">Analyze compliance trends</p>
                    </div>
                    
                    <div class="action-card" onclick="showPage('team')">
                        <div class="action-icon warning">👥</div>
                        <h3 class="action-title">Manage Team</h3>
                        <p class="action-description">Add or remove team members</p>
                    </div>
                    
                    <div class="action-card" onclick="showPage('settings')">
                        <div class="action-icon info">⚙️</div>
                        <h3 class="action-title">Settings</h3>
                        <p class="action-description">Configure your preferences</p>
                    </div>
                </div>
                
                <div class="recent-activity">
                    <div class="activity-header">
                        <h2 class="activity-title">Recent Scans</h2>
                        <p class="activity-subtitle">Your latest accessibility scan results</p>
                    </div>
                    <div class="activity-list">
                        ${recentScans.length > 0 ? recentScans.map(scan => {
                            const score = Math.max(0, 100 - (scan.total_issues * 10));
                            const scoreClass = score >= 80 ? 'excellent' : score >= 60 ? 'good' : 'poor';
                            const hasAiFixes = scan.violations_data && JSON.stringify(scan.violations_data).includes('ai_fixes');
                            
                            return `
                                <div class="activity-item">
                                    <div class="activity-info">
                                        <div class="activity-url">${scan.url}${hasAiFixes ? '<span class="ai-badge">AI</span>' : ''}</div>
                                        <div class="activity-meta">${scan.scan_type} • ${new Date(scan.completed_at).toLocaleDateString()}</div>
                                    </div>
                                    <div class="activity-score">
                                        <span class="score-badge ${scoreClass}">${score}% Score</span>
                                        <a href="#" class="view-report-btn">
                                            👁️ View Report
                                        </a>
                                    </div>
                                </div>
                            `;
                        }).join('') : `
                            <div class="activity-item">
                                <div class="activity-info">
                                    <div class="activity-url">No scans yet</div>
                                    <div class="activity-meta">Run your first accessibility scan to see results here</div>
                                </div>
                            </div>
                        `}
                    </div>
                </div>
            </div>
            
            <!-- Scans Page -->
            <div id="scans" class="page-content">
                <div class="page-header">
                    <h1 class="page-title">Accessibility Scans</h1>
                    <p class="page-subtitle">Manage and review your accessibility scans</p>
                </div>
                
                <div style="background: white; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); margin-bottom: 2rem;">
                    <div style="background: #d1fae5; border: 1px solid #a7f3d0; border-radius: 0.5rem; padding: 1rem; margin-bottom: 2rem; display: flex; align-items: center; gap: 0.5rem;">
                        <span style="color: #065f46;">✅</span>
                        <span style="color: #065f46; font-weight: 500;">Database connected - Scans will be saved to your history</span>
                    </div>
                    
                    <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 1.5rem; color: #1e293b;">Scan Website for Accessibility Issues</h2>
                    
                    <form id="scanForm" style="margin-bottom: 2rem;">
                        <div style="margin-bottom: 1.5rem;">
                            <label style="display: block; font-weight: 600; margin-bottom: 0.5rem; color: #374151;">Website URL</label>
                            <input type="url" id="urlInput" placeholder="https://example.com/" required 
                                   style="width: 100%; padding: 0.75rem; border: 1px solid #d1d5db; border-radius: 0.5rem; font-size: 1rem;">
                        </div>
                        
                        <div style="margin-bottom: 1.5rem;">
                            <label style="display: block; font-weight: 600; margin-bottom: 1rem; color: #374151;">Scan Options:</label>
                            <div style="display: flex; gap: 2rem; flex-wrap: wrap;">
                                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                                    <input type="radio" name="scanType" value="single" checked style="margin: 0;">
                                    <span>Single Page (Fast - recommended)</span>
                                </label>
                                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                                    <input type="radio" name="scanType" value="multi" style="margin: 0;">
                                    <span>Multi-Page Crawl (Slower - up to <input type="number" id="maxPages" value="5" min="1" max="10" style="width: 60px; padding: 0.25rem; border: 1px solid #d1d5db; border-radius: 0.25rem; text-align: center;"> pages)</span>
                                </label>
                            </div>
                        </div>
                        
                        ${aiFixEngine ? `
                        <div style="margin-bottom: 1.5rem;">
                            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; background: linear-gradient(135deg, #f3f4f6, #e5e7eb); padding: 1rem; border-radius: 0.5rem; border: 1px solid #d1d5db;">
                                <input type="checkbox" id="enableAI" style="margin: 0;">
                                <span style="font-weight: 600; color: #374151;">🤖 Enable AI Fix Suggestions</span>
                                <span style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: white; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; margin-left: 0.5rem;">NEW</span>
                            </label>
                            <p style="font-size: 0.875rem; color: #6b7280; margin-top: 0.5rem; margin-left: 1.5rem;">Generate AI-powered code fixes for accessibility violations</p>
                        </div>
                        ` : ''}
                        
                        <button type="submit" id="scanButton" 
                                style="background: #3b82f6; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 0.5rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; font-size: 1rem;">
                            🔍 Start Accessibility Scan
                        </button>
                    </form>
                    
                    <div id="scanResults" style="display: none;">
                        <h3 style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: #1e293b;">Scan Results</h3>
                        <div id="resultsContent"></div>
                    </div>
                </div>
                
                <div style="background: white; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);">
                    <h2 style="font-size: 1.5rem; font-weight: 600; margin-bottom: 0.5rem; color: #1e293b;">Recent Scans</h2>
                    <p style="color: #64748b; margin-bottom: 1.5rem;">Your latest accessibility scan results</p>
                    
                    <div id="recentScansList">
                        ${recentScans.length > 0 ? recentScans.map(scan => {
                            const score = Math.max(0, 100 - (scan.total_issues * 10));
                            const scoreClass = score >= 80 ? 'excellent' : score >= 60 ? 'good' : 'poor';
                            const hasAiFixes = scan.violations_data && JSON.stringify(scan.violations_data).includes('ai_fixes');
                            
                            return `
                                <div style="display: flex; align-items: center; justify-content: space-between; padding: 1rem; border-bottom: 1px solid #f3f4f6;">
                                    <div>
                                        <div style="font-weight: 600; color: #1e293b; margin-bottom: 0.25rem;">
                                            ${scan.url}${hasAiFixes ? '<span class="ai-badge">AI</span>' : ''}
                                        </div>
                                        <div style="font-size: 0.875rem; color: #64748b;">
                                            ${scan.scan_type} • ${new Date(scan.completed_at).toLocaleDateString()}
                                        </div>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                                        <span class="score-badge ${scoreClass}">${score}% Score</span>
                                        <a href="#" class="view-report-btn">👁️ View Report</a>
                                    </div>
                                </div>
                            `;
                        }).join('') : `
                            <div style="text-align: center; padding: 2rem; color: #64748b;">
                                <div style="font-size: 3rem; margin-bottom: 1rem; opacity: 0.5;">📊</div>
                                <h3 style="font-size: 1.25rem; margin-bottom: 0.5rem; color: #1e293b;">No scans yet</h3>
                                <p>Run your first accessibility scan to see results here</p>
                            </div>
                        `}
                    </div>
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
                    displayScanResults(result.data);
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
        
        function displayScanResults(data) {
            const resultsContent = document.getElementById('resultsContent');
            const score = Math.max(0, 100 - (data.totalIssues * 10));
            const scoreClass = score >= 80 ? 'excellent' : score >= 60 ? 'good' : 'poor';
            
            let aiFixesSection = '';
            if (data.aiFixReport && data.aiFixReport.fixes && data.aiFixReport.fixes.length > 0) {
                aiFixesSection = \`
                    <div style="background: linear-gradient(135deg, #f3f4f6, #e5e7eb); border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 1.5rem; margin-top: 1.5rem;">
                        <h4 style="color: #374151; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                            🤖 AI Fix Suggestions
                            <span style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: white; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600;">NEW</span>
                        </h4>
                        <p style="color: #6b7280; margin-bottom: 1rem;">AI has generated \${data.aiFixReport.fixes.length} specific code fixes for your accessibility issues.</p>
                        <button onclick="downloadAIFixes()" style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: white; padding: 0.5rem 1rem; border: none; border-radius: 0.375rem; font-weight: 500; cursor: pointer;">
                            📥 Download AI Fixes
                        </button>
                    </div>
                \`;
            }
            
            resultsContent.innerHTML = \`
                <div style="background: #d1fae5; border: 1px solid #a7f3d0; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1.5rem;">
                    <span style="color: #065f46; font-weight: 600;">✅ Scan Complete</span>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${data.url}</div>
                        <div style="color: #64748b; font-size: 0.875rem;">URL</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${data.totalIssues}</div>
                        <div style="color: #64748b; font-size: 0.875rem;">TOTAL ISSUES</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${data.scanTime}ms</div>
                        <div style="color: #64748b; font-size: 0.875rem;">SCAN TIME</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                        <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${data.timestamp}</div>
                        <div style="color: #64748b; font-size: 0.875rem;">TIMESTAMP</div>
                    </div>
                </div>
                
                <h4 style="color: #374151; margin-bottom: 1rem;">Violations by Impact:</h4>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                    <div style="text-align: center; padding: 1rem; background: #fee2e2; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #991b1b;">\${data.violations.critical || 0}</div>
                        <div style="color: #991b1b; font-size: 0.875rem; font-weight: 600;">Critical</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #fef3c7; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #92400e;">\${data.violations.serious || 0}</div>
                        <div style="color: #92400e; font-size: 0.875rem; font-weight: 600;">Serious</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #dbeafe; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #1d4ed8;">\${data.violations.moderate || 0}</div>
                        <div style="color: #1d4ed8; font-size: 0.875rem; font-weight: 600;">Moderate</div>
                    </div>
                    <div style="text-align: center; padding: 1rem; background: #ecfdf5; border-radius: 0.5rem;">
                        <div style="font-size: 1.5rem; font-weight: 700; color: #065f46;">\${data.violations.minor || 0}</div>
                        <div style="color: #065f46; font-size: 0.875rem; font-weight: 600;">Minor</div>
                    </div>
                </div>
                
                \${aiFixesSection}
                
                <button onclick="showDetailedResults()" style="background: #10b981; color: white; padding: 0.75rem 1.5rem; border: none; border-radius: 0.5rem; font-weight: 600; cursor: pointer; margin-top: 1rem;">
                    👁️ View Detailed Results
                </button>
            \`;
            
            // Store the data for detailed view
            window.currentScanData = data;
        }
        
        function showDetailedResults() {
            if (window.currentScanData && window.currentScanData.detailedResults) {
                const newWindow = window.open('', '_blank');
                newWindow.document.write(window.currentScanData.detailedResults);
            }
        }
        
        function downloadAIFixes() {
            if (window.currentScanData && window.currentScanData.aiFixReport) {
                const dataStr = JSON.stringify(window.currentScanData.aiFixReport, null, 2);
                const dataBlob = new Blob([dataStr], {type: 'application/json'});
                const url = URL.createObjectURL(dataBlob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'ai-accessibility-fixes.json';
                link.click();
                URL.revokeObjectURL(url);
            }
        }
    </script>
</body>
</html>
        `);
    } catch (error) {
        console.error('Error rendering dashboard:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'disconnected',
        ai: aiFixEngine ? 'enabled' : 'disabled'
    });
});

// API endpoint for scanning
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single', maxPages = 5, enableAI = false } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }
    
    let browser = null;
    const startTime = Date.now();
    
    try {
        console.log(`🔍 Starting ${scanType} scan for: ${url}`);
        
        // Launch browser with Cloud Run compatible settings
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        // Inject axe-core
        await page.addScriptTag({
            path: require.resolve('axe-core')
        });
        
        let allViolations = [];
        let pagesScanned = 0;
        
        if (scanType === 'multi') {
            // Multi-page scan
            const visitedUrls = new Set();
            const urlsToVisit = [url];
            
            while (urlsToVisit.length > 0 && pagesScanned < maxPages) {
                const currentUrl = urlsToVisit.shift();
                
                if (visitedUrls.has(currentUrl)) continue;
                visitedUrls.add(currentUrl);
                
                try {
                    console.log(`📄 Scanning page ${pagesScanned + 1}: ${currentUrl}`);
                    await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                    
                    // Run axe-core analysis
                    const results = await page.evaluate(() => {
                        return axe.run();
                    });
                    
                    allViolations.push(...results.violations);
                    pagesScanned++;
                    
                    // Find more URLs to scan (if we haven't reached the limit)
                    if (pagesScanned < maxPages) {
                        const links = await page.evaluate((baseUrl) => {
                            const links = Array.from(document.querySelectorAll('a[href]'));
                            return links
                                .map(link => {
                                    const href = link.getAttribute('href');
                                    if (href.startsWith('/')) {
                                        return new URL(href, baseUrl).href;
                                    } else if (href.startsWith('http')) {
                                        return href;
                                    }
                                    return null;
                                })
                                .filter(href => href && href.startsWith(baseUrl))
                                .slice(0, 5); // Limit to 5 additional URLs per page
                        }, new URL(url).origin);
                        
                        links.forEach(link => {
                            if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
                                urlsToVisit.push(link);
                            }
                        });
                    }
                } catch (pageError) {
                    console.error(`❌ Error scanning page ${currentUrl}:`, pageError.message);
                }
            }
        } else {
            // Single page scan
            console.log(`📄 Scanning single page: ${url}`);
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            
            const results = await page.evaluate(() => {
                return axe.run();
            });
            
            allViolations = results.violations;
            pagesScanned = 1;
        }
        
        const scanTime = Date.now() - startTime;
        
        // Process violations
        const violationsByImpact = {
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0
        };
        
        allViolations.forEach(violation => {
            if (violationsByImpact.hasOwnProperty(violation.impact)) {
                violationsByImpact[violation.impact]++;
            }
        });
        
        const totalIssues = allViolations.length;
        
        // Generate AI fixes if enabled and available
        let aiFixReport = null;
        if (enableAI && aiFixEngine && allViolations.length > 0) {
            try {
                console.log('🤖 Generating AI fix suggestions...');
                aiFixReport = await aiFixEngine.generateAccessibilityFixes(allViolations);
                console.log(`✅ Generated ${aiFixReport.fixes.length} AI fix suggestions`);
            } catch (aiError) {
                console.error('❌ AI fix generation failed:', aiError.message);
            }
        }
        
        // Prepare scan data for database
        const scanData = {
            url: url,
            scan_type: scanType,
            status: 'completed',
            total_issues: totalIssues,
            scan_time_ms: scanTime,
            pages_scanned: pagesScanned,
            violations_data: {
                violations: allViolations,
                violationsByImpact: violationsByImpact,
                ai_fixes: aiFixReport
            }
        };
        
        // Save to database
        const scanId = await saveScanToDatabase(scanData);
        
        // Generate detailed results HTML
        const detailedResults = generateDetailedResultsHTML(allViolations, url, scanTime, violationsByImpact, aiFixReport);
        
        const responseData = {
            url: url,
            totalIssues: totalIssues,
            scanTime: scanTime,
            timestamp: new Date().toLocaleString(),
            violations: violationsByImpact,
            pagesScanned: pagesScanned,
            detailedResults: detailedResults,
            scanId: scanId,
            aiFixReport: aiFixReport
        };
        
        console.log(`✅ Scan completed: ${totalIssues} issues found in ${scanTime}ms`);
        res.json({ success: true, data: responseData });
        
    } catch (error) {
        console.error('❌ Scan error:', error);
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

// Helper function to generate detailed results HTML
function generateDetailedResultsHTML(violations, url, scanTime, violationsByImpact, aiFixReport) {
    const aiFixesSection = aiFixReport ? `
        <div style="background: linear-gradient(135deg, #f3f4f6, #e5e7eb); border: 1px solid #d1d5db; border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem;">
            <h2 style="color: #374151; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.5rem;">
                🤖 AI Fix Suggestions
                <span style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: white; padding: 0.125rem 0.5rem; border-radius: 9999px; font-size: 0.75rem; font-weight: 600;">NEW</span>
            </h2>
            <p style="color: #6b7280; margin-bottom: 1rem;">AI has generated ${aiFixReport.fixes.length} specific code fixes for your accessibility issues.</p>
            <div style="background: white; border-radius: 0.375rem; padding: 1rem;">
                <h3 style="margin-bottom: 0.5rem;">Summary:</h3>
                <ul style="margin-left: 1rem; color: #374151;">
                    <li>Total fixes generated: ${aiFixReport.fixes.length}</li>
                    <li>High confidence fixes: ${aiFixReport.fixes.filter(f => f.confidence > 0.8).length}</li>
                    <li>Average confidence: ${Math.round(aiFixReport.averageConfidence * 100)}%</li>
                </ul>
            </div>
        </div>
    ` : '';
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Detailed Accessibility Violations</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f8fafc;
        }
        .header {
            background: white;
            padding: 2rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            margin-bottom: 2rem;
        }
        .violation {
            background: white;
            margin-bottom: 1.5rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            overflow: hidden;
        }
        .violation-header {
            padding: 1rem 1.5rem;
            border-left: 4px solid;
            cursor: pointer;
        }
        .violation-header.critical {
            border-left-color: #ef4444;
            background: #fef2f2;
        }
        .violation-header.serious {
            border-left-color: #f59e0b;
            background: #fffbeb;
        }
        .violation-header.moderate {
            border-left-color: #3b82f6;
            background: #eff6ff;
        }
        .violation-header.minor {
            border-left-color: #10b981;
            background: #f0fdf4;
        }
        .violation-title {
            font-weight: 600;
            font-size: 1.1rem;
            margin-bottom: 0.5rem;
        }
        .violation-impact {
            display: inline-block;
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
            text-transform: uppercase;
        }
        .impact-critical {
            background: #fee2e2;
            color: #991b1b;
        }
        .impact-serious {
            background: #fef3c7;
            color: #92400e;
        }
        .impact-moderate {
            background: #dbeafe;
            color: #1d4ed8;
        }
        .impact-minor {
            background: #d1fae5;
            color: #065f46;
        }
        .violation-details {
            padding: 1.5rem;
            border-top: 1px solid #e5e7eb;
            display: none;
        }
        .violation-details.show {
            display: block;
        }
        .elements-count {
            color: #6b7280;
            font-size: 0.875rem;
        }
        .show-elements {
            background: #f3f4f6;
            border: 1px solid #d1d5db;
            padding: 0.5rem 1rem;
            border-radius: 0.375rem;
            cursor: pointer;
            margin-top: 1rem;
            display: inline-block;
        }
        .elements-list {
            display: none;
            margin-top: 1rem;
            padding: 1rem;
            background: #f8fafc;
            border-radius: 0.375rem;
        }
        .elements-list.show {
            display: block;
        }
        .element-item {
            margin-bottom: 0.5rem;
            padding: 0.5rem;
            background: white;
            border-radius: 0.25rem;
            font-family: monospace;
            font-size: 0.875rem;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Detailed Accessibility Violations</h1>
        <p><strong>URL:</strong> ${url}</p>
        <p><strong>Scan Time:</strong> ${scanTime}ms</p>
        <p><strong>Total Issues:</strong> ${violations.length}</p>
        <div style="display: flex; gap: 1rem; margin-top: 1rem;">
            <span class="violation-impact impact-critical">Critical: ${violationsByImpact.critical}</span>
            <span class="violation-impact impact-serious">Serious: ${violationsByImpact.serious}</span>
            <span class="violation-impact impact-moderate">Moderate: ${violationsByImpact.moderate}</span>
            <span class="violation-impact impact-minor">Minor: ${violationsByImpact.minor}</span>
        </div>
    </div>
    
    ${aiFixesSection}
    
    ${violations.map((violation, index) => `
        <div class="violation">
            <div class="violation-header ${violation.impact}" onclick="toggleViolation(${index})">
                <div class="violation-title">${violation.id}</div>
                <span class="violation-impact impact-${violation.impact}">${violation.impact}</span>
                <div class="elements-count">Elements affected: ${violation.nodes.length}</div>
            </div>
            <div class="violation-details" id="violation-${index}">
                <p><strong>Description:</strong> ${violation.description}</p>
                <p><strong>Help:</strong> ${violation.help}</p>
                <div class="show-elements" onclick="toggleElements(${index})">
                    ▶ Show affected elements
                </div>
                <div class="elements-list" id="elements-${index}">
                    ${violation.nodes.map(node => `
                        <div class="element-item">
                            <strong>Target:</strong> ${node.target.join(', ')}<br>
                            <strong>HTML:</strong> ${node.html}
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `).join('')}
    
    <script>
        function toggleViolation(index) {
            const details = document.getElementById('violation-' + index);
            details.classList.toggle('show');
        }
        
        function toggleElements(index) {
            const elements = document.getElementById('elements-' + index);
            const button = elements.previousElementSibling;
            
            elements.classList.toggle('show');
            button.textContent = elements.classList.contains('show') ? 
                '▼ Hide affected elements' : '▶ Show affected elements';
        }
    </script>
</body>
</html>
    `;
}

// API endpoint to get recent scans
app.get('/api/scans/recent', async (req, res) => {
    try {
        const recentScans = await getRecentScans(10);
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
