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
    
    // Test database connection
    db.connect()
        .then(client => {
            console.log('✅ Database connected successfully!');
            client.release();
        })
        .catch(err => {
            console.error('❌ Database connection failed:', err.message);
            db = null; // Disable database if connection fails
        });
} else {
    console.log('⚠️ Database environment variables not provided. Running without database.');
}

// Database helper functions - PRESERVED FROM WORKING VERSION
async function getRecentScans(userId) {
    if (!db) {
        return [];
    }
    
    try {
        const query = `
            SELECT id, url, scan_type, issues_found, scan_time_ms, pages_scanned, created_at
            FROM scans 
            WHERE user_id = $1 
            ORDER BY created_at DESC 
            LIMIT 10
        `;
        const result = await db.query(query, [userId]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        return [];
    }
}

async function getDashboardStats(userId) {
    if (!db) {
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            weeklyScans: 0
        };
    }
    
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_scans,
                COALESCE(SUM(issues_found), 0) as total_issues,
                COALESCE(AVG(CASE WHEN issues_found > 0 THEN 100 - (issues_found * 5) ELSE 100 END), 0) as avg_score,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as weekly_scans
            FROM scans 
            WHERE user_id = $1
        `;
        
        const result = await db.query(statsQuery, [userId]);
        const stats = result.rows[0];
        
        return {
            totalScans: parseInt(stats.total_scans) || 0,
            totalIssues: parseInt(stats.total_issues) || 0,
            averageScore: Math.round(parseFloat(stats.avg_score)) || 0,
            weeklyScans: parseInt(stats.weekly_scans) || 0
        };
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
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
    // Generate AI checkbox HTML if OpenAI API key is available
    const aiCheckboxHtml = process.env.OPENAI_API_KEY ? `
                            <label class="radio-option ai-option">
                                <input type="checkbox" id="enableAI" checked>
                                Enable AI Fix Suggestions
                                <span class="new-badge">NEW</span>
                            </label>` : '';

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
        
        .search-bar input {
            width: 100%;
            padding: 0.5rem 1rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            font-size: 0.875rem;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 1rem;
        }
        
        .notification-badge {
            position: relative;
            background: #f97316;
            color: white;
            width: 2rem;
            height: 2rem;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .user-profile {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem;
            border-radius: 0.375rem;
            cursor: pointer;
        }
        
        .user-avatar {
            width: 2rem;
            height: 2rem;
            background: #3b82f6;
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
        }
        
        .page-content {
            display: none;
        }
        
        .page-content.active {
            display: block;
        }
        
        .dashboard-overview h2 {
            margin-bottom: 1rem;
            color: #374151;
        }
        
        .dashboard-overview p {
            color: #6b7280;
            margin-bottom: 2rem;
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
        
        .stat-card.scans {
            border-left-color: #3b82f6;
        }
        
        .stat-card.issues {
            border-left-color: #f59e0b;
        }
        
        .stat-card.score {
            border-left-color: #10b981;
        }
        
        .stat-card.weekly {
            border-left-color: #8b5cf6;
        }
        
        .stat-number {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }
        
        .stat-label {
            color: #6b7280;
            font-size: 0.875rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .stat-change {
            font-size: 0.875rem;
            margin-top: 0.5rem;
        }
        
        .stat-change.positive {
            color: #10b981;
        }
        
        .recent-scans-section {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 2rem;
        }
        
        .section-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        
        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #374151;
        }
        
        .scanner-container {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 2rem;
            margin-bottom: 2rem;
        }
        
        .url-input {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #d1d5db;
            border-radius: 0.375rem;
            font-size: 1rem;
            margin-bottom: 1.5rem;
        }
        
        .url-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .scan-options {
            margin-bottom: 1.5rem;
        }
        
        .scan-options h4 {
            margin-bottom: 0.75rem;
            color: #374151;
        }
        
        .radio-group {
            display: flex;
            flex-direction: column;
            gap: 0.75rem;
        }
        
        .radio-option {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem;
            border: 1px solid #e5e7eb;
            border-radius: 0.375rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .radio-option:hover {
            border-color: #3b82f6;
            background-color: #f8fafc;
        }
        
        .radio-option input[type="radio"],
        .radio-option input[type="checkbox"] {
            margin: 0;
        }
        
        .ai-option {
            border-color: #8b5cf6;
            background: linear-gradient(135deg, #f3f4f6, #faf5ff);
        }
        
        .new-badge {
            background: linear-gradient(135deg, #8b5cf6, #3b82f6);
            color: white;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.7rem;
            font-weight: 600;
            margin-left: auto;
        }
        
        .multi-page-options {
            display: inline-flex;
            align-items: center;
            gap: 0.25rem;
            margin: 0 0.25rem;
        }
        
        .multi-page-options input {
            width: 60px;
            padding: 0.25rem;
            border: 1px solid #d1d5db;
            border-radius: 0.25rem;
            text-align: center;
        }
        
        .scan-btn {
            background: linear-gradient(135deg, #3b82f6, #1d4ed8);
            color: white;
            padding: 0.75rem 2rem;
            border: none;
            border-radius: 0.375rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            font-size: 1rem;
        }
        
        .scan-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
        }
        
        .scan-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .results-container {
            background: white;
            border-radius: 0.75rem;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            padding: 2rem;
            display: none;
            margin-bottom: 2rem;
        }
        
        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }
        
        .status-badge {
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .status-badge.success {
            background: #d1fae5;
            color: #065f46;
        }
        
        .status-badge.error {
            background: #fee2e2;
            color: #991b1b;
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
        
        .scan-info h4 {
            margin-bottom: 0.25rem;
            color: #374151;
        }
        
        .scan-meta {
            font-size: 0.875rem;
            color: #6b7280;
        }
        
        .scan-status {
            padding: 0.25rem 0.75rem;
            border-radius: 9999px;
            font-size: 0.875rem;
            font-weight: 600;
        }
        
        .scan-status.issues {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .loading-spinner {
            display: none;
            text-align: center;
            padding: 2rem;
        }
        
        .spinner {
            border: 4px solid #f3f4f6;
            border-top: 4px solid #3b82f6;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .database-status {
            background: #d1fae5;
            border: 1px solid #a7f3d0;
            border-radius: 0.5rem;
            padding: 1rem;
            margin-bottom: 1.5rem;
            color: #065f46;
            font-weight: 600;
        }
        
        .error {
            color: #dc3545;
            background: #f8d7da;
            padding: 1rem;
            border-radius: 0.375rem;
            border: 1px solid #f5c6cb;
        }
        
        .success {
            color: #155724;
            background: #d4edda;
            padding: 1rem;
            border-radius: 0.375rem;
            border: 1px solid #c3e6cb;
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
                <button class="nav-item active" onclick="switchToPage('dashboard')">
                    📊 Dashboard
                </button>
                <button class="nav-item" onclick="switchToPage('scans')">
                    🔍 Scans
                </button>
                <button class="nav-item" onclick="switchToPage('analytics')">
                    📈 Analytics
                </button>
                <button class="nav-item" onclick="switchToPage('team')">
                    👥 Team
                </button>
                <button class="nav-item" onclick="switchToPage('integrations')">
                    🔗 Integrations
                </button>
                <button class="nav-item" onclick="switchToPage('api')">
                    ⚙️ API Management
                </button>
                <button class="nav-item" onclick="switchToPage('billing')">
                    💳 Billing
                </button>
                <button class="nav-item" onclick="switchToPage('settings')">
                    ⚙️ Settings
                </button>
            </div>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" placeholder="Search scans, reports, or settings...">
                </div>
                <div class="user-menu">
                    <div class="notification-badge">2</div>
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <div>
                            <div style="font-weight: 600;">John Doe</div>
                            <div style="font-size: 0.75rem; color: #6b7280;">Acme Corporation</div>
                        </div>
                    </div>
                </div>
            </header>
            
            <!-- Dashboard Page -->
            <div id="dashboard" class="page-content active">
                <div class="dashboard-overview">
                    <h2>Dashboard Overview</h2>
                    <p>Monitor your accessibility compliance and recent activity</p>
                    
                    <div class="stats-grid">
                        <div class="stat-card scans">
                            <div class="stat-number" id="total-scans">-</div>
                            <div class="stat-label">TOTAL SCANS</div>
                            <div class="stat-change positive" id="scans-change">+2 this week</div>
                        </div>
                        <div class="stat-card issues">
                            <div class="stat-number" id="total-issues">-</div>
                            <div class="stat-label">ISSUES FOUND</div>
                            <div class="stat-change" id="issues-change">-5 from last week</div>
                        </div>
                        <div class="stat-card score">
                            <div class="stat-number" id="average-score">-</div>
                            <div class="stat-label">AVERAGE SCORE</div>
                            <div class="stat-change" id="score-change">+3% improvement</div>
                        </div>
                        <div class="stat-card weekly">
                            <div class="stat-number" id="weekly-scans">-</div>
                            <div class="stat-label">THIS WEEK</div>
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
                            <h4>View Reports</h4>
                            <p>Analyze your compliance trends</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('team')">
                            <div class="action-icon">👥</div>
                            <h4>Manage Team</h4>
                            <p>Invite and manage team members</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('integrations')">
                            <div class="action-icon">🔗</div>
                            <h4>Integrations</h4>
                            <p>Connect your platforms</p>
                        </div>
                    </div>
                    
                    <!-- Recent Activity -->
                    <div class="recent-scans-section">
                        <div class="section-header">
                            <h3 class="section-title">Recent Activity</h3>
                        </div>
                        <div id="recent-scans-list">
                            <p style="color: #666; text-align: center; padding: 20px;">Loading recent activity...</p>
                        </div>
                    </div>
                </div>
            </div>
            
            <!-- Scans Page -->
            <div id="scans" class="page-content">
                <h2>Accessibility Scans</h2>
                <p>Scan websites for accessibility issues and track compliance</p>
                
                ${db ? '<div class="database-status">✅ Database connected - Scans will be saved to your history</div>' : ''}
                
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
                            ${aiCheckboxHtml}
                        </div>
                    </div>
                    
                    <button id="scan-btn" class="scan-btn">
                        🔍 Start Accessibility Scan
                    </button>
                </div>
                
                <!-- Loading Spinner -->
                <div id="loading-spinner" class="loading-spinner">
                    <div class="spinner"></div>
                    <p id="loading-text">Initializing scan...</p>
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
                    <div id="recent-scans-container">
                        <p style="color: #666; text-align: center; padding: 20px;">Loading recent scans...</p>
                    </div>
                </div>
            </div>
            
            <!-- Other Pages (Placeholder) -->
            <div id="analytics" class="page-content">
                <h2>Analytics</h2>
                <p>Coming soon - Advanced analytics and reporting features</p>
            </div>
            
            <div id="team" class="page-content">
                <h2>Team Management</h2>
                <p>Coming soon - Manage team members and permissions</p>
            </div>
            
            <div id="integrations" class="page-content">
                <h2>Integrations</h2>
                <p>Coming soon - Connect with your favorite tools</p>
            </div>
            
            <div id="api" class="page-content">
                <h2>API Management</h2>
                <p>Coming soon - API keys and documentation</p>
            </div>
            
            <div id="billing" class="page-content">
                <h2>Billing</h2>
                <p>Coming soon - Subscription and usage management</p>
            </div>
            
            <div id="settings" class="page-content">
                <h2>Settings</h2>
                <p>Coming soon - Account and application settings</p>
            </div>
        </main>
    </div>

    <script>
        // Navigation
        function switchToPage(pageId) {
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
            
            // Load page-specific data
            if (pageId === 'dashboard') {
                loadDashboardStats();
                loadRecentActivity();
            } else if (pageId === 'scans') {
                loadRecentScans();
            }
        }
        
        // Load dashboard statistics
        async function loadDashboardStats() {
            try {
                const response = await fetch('/api/dashboard/stats');
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('total-scans').textContent = data.stats.totalScans;
                    document.getElementById('total-issues').textContent = data.stats.totalIssues;
                    document.getElementById('average-score').textContent = data.stats.averageScore + '%';
                    document.getElementById('weekly-scans').textContent = data.stats.weeklyScans;
                }
            } catch (error) {
                console.error('Error loading dashboard stats:', error);
            }
        }
        
        // Load recent activity for dashboard
        async function loadRecentActivity() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recent-scans-list');
                if (data.success && data.scans && data.scans.length > 0) {
                    container.innerHTML = data.scans.slice(0, 5).map(scan => \`
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${new Date(scan.created_at).toLocaleDateString()} • \${scan.scan_type} scan • \${scan.pages_scanned || 1} page(s)</div>
                            </div>
                            <div class="scan-status issues">\${scan.issues_found || 0} issues</div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No recent activity. <a href="#" onclick="switchToPage(\\'scans\\')">Start your first scan</a>!</div>';
                }
            } catch (error) {
                console.error('Error loading recent activity:', error);
                container.innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Unable to load recent activity.</div>';
            }
        }
        
        // Scan functionality
        document.addEventListener('DOMContentLoaded', function() {
            const scanBtn = document.getElementById('scan-btn');
            const urlInput = document.getElementById('url-input');
            const loadingSpinner = document.getElementById('loading-spinner');
            const resultsContainer = document.getElementById('results-container');
            const resultsContent = document.getElementById('results-content');
            const statusBadge = document.getElementById('status-badge');
            const loadingText = document.getElementById('loading-text');
            
            scanBtn.addEventListener('click', async function() {
                const url = urlInput.value.trim();
                if (!url) {
                    alert('Please enter a URL to scan');
                    return;
                }
                
                // Get scan options
                const scanType = document.querySelector('input[name="scanType"]:checked').value;
                const maxPages = document.getElementById('max-pages').value;
                const enableAI = document.getElementById('enableAI') ? document.getElementById('enableAI').checked : false;
                
                // Show loading
                loadingSpinner.style.display = 'block';
                resultsContainer.style.display = 'none';
                scanBtn.disabled = true;
                
                // Update loading text
                if (scanType === 'crawl') {
                    loadingText.textContent = \`Scanning up to \${maxPages} pages...\`;
                } else {
                    loadingText.textContent = 'Scanning single page...';
                }
                
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
                        // Show success
                        statusBadge.textContent = 'Scan Complete';
                        statusBadge.className = 'status-badge success';
                        
                        // Calculate score
                        const score = Math.max(0, 100 - (result.totalIssues * 5));
                        
                        // Display results
                        resultsContent.innerHTML = \`
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                                <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                                    <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${result.totalIssues}</div>
                                    <div style="color: #64748b; font-size: 0.875rem;">TOTAL ISSUES</div>
                                </div>
                                <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                                    <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${result.scanTime}ms</div>
                                    <div style="color: #64748b; font-size: 0.875rem;">SCAN TIME</div>
                                </div>
                                <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                                    <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${result.pagesScanned || 1}</div>
                                    <div style="color: #64748b; font-size: 0.875rem;">PAGES SCANNED</div>
                                </div>
                                <div style="text-align: center; padding: 1rem; background: #f8fafc; border-radius: 0.5rem;">
                                    <div style="font-size: 2rem; font-weight: 700; color: #1e293b;">\${score}%</div>
                                    <div style="color: #64748b; font-size: 0.875rem;">SCORE</div>
                                </div>
                            </div>
                            
                            <h4 style="color: #374151; margin-bottom: 1rem;">Violations by Impact:</h4>
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
                                <div style="text-align: center; padding: 1rem; background: #fee2e2; border-radius: 0.5rem;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #991b1b;">\${result.summary.critical || 0}</div>
                                    <div style="color: #991b1b; font-size: 0.875rem; font-weight: 600;">Critical</div>
                                </div>
                                <div style="text-align: center; padding: 1rem; background: #fef3c7; border-radius: 0.5rem;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #92400e;">\${result.summary.serious || 0}</div>
                                    <div style="color: #92400e; font-size: 0.875rem; font-weight: 600;">Serious</div>
                                </div>
                                <div style="text-align: center; padding: 1rem; background: #dbeafe; border-radius: 0.5rem;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #1d4ed8;">\${result.summary.moderate || 0}</div>
                                    <div style="color: #1d4ed8; font-size: 0.875rem; font-weight: 600;">Moderate</div>
                                </div>
                                <div style="text-align: center; padding: 1rem; background: #d1fae5; border-radius: 0.5rem;">
                                    <div style="font-size: 1.5rem; font-weight: 700; color: #065f46;">\${result.summary.minor || 0}</div>
                                    <div style="color: #065f46; font-size: 0.875rem; font-weight: 600;">Minor</div>
                                </div>
                            </div>
                            
                            <details style="margin-top: 1rem;">
                                <summary style="cursor: pointer; font-weight: 600; color: #374151;">View Detailed Results</summary>
                                <pre style="background: #f8fafc; padding: 1rem; border-radius: 0.5rem; overflow-x: auto; margin-top: 0.5rem; font-size: 0.875rem;">\${JSON.stringify(result.violations, null, 2)}</pre>
                            </details>
                        \`;
                        
                        // Show results (NO AUTO-REDIRECT)
                        resultsContainer.style.display = 'block';
                        
                        // Refresh recent scans
                        loadRecentScans();
                        
                    } else {
                        throw new Error(result.error || 'Scan failed');
                    }
                    
                } catch (error) {
                    statusBadge.textContent = 'Scan Failed';
                    statusBadge.className = 'status-badge error';
                    
                    resultsContent.innerHTML = \`
                        <div class="error">
                            <h4>Scan Failed</h4>
                            <p>\${error.message}</p>
                        </div>
                    \`;
                    
                    resultsContainer.style.display = 'block';
                    
                } finally {
                    loadingSpinner.style.display = 'none';
                    scanBtn.disabled = false;
                }
            });
            
            // Load initial data
            loadDashboardStats();
            loadRecentActivity();
        });
        
        // Load recent scans for scans page
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recent-scans-container');
                if (data.success && data.scans && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => \`
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${new Date(scan.created_at).toLocaleDateString()} • \${scan.scan_type} scan • \${scan.pages_scanned || 1} page(s)</div>
                            </div>
                            <div class="scan-status issues">\${scan.issues_found || 0} issues</div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No scans yet. Run your first scan above!</p>';
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('recent-scans-container').innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">Error loading scans.</p>';
            }
        }
    </script>
</body>
</html>
    `;
    
    res.send(html);
});

// Function to extract links from a page for multi-page scanning
async function extractLinks(page, baseUrl) {
    try {
        const links = await page.evaluate((baseUrl) => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const urls = anchors
                .map(anchor => {
                    try {
                        const url = new URL(anchor.href, baseUrl);
                        return url.href;
                    } catch {
                        return null;
                    }
                })
                .filter(url => {
                    if (!url) return false;
                    try {
                        const urlObj = new URL(url);
                        const baseUrlObj = new URL(baseUrl);
                        // Only include URLs from the same domain
                        return urlObj.hostname === baseUrlObj.hostname;
                    } catch {
                        return false;
                    }
                });
            
            // Remove duplicates and return unique URLs
            return [...new Set(urls)];
        }, baseUrl);
        
        return links;
    } catch (error) {
        console.error('Error extracting links:', error);
        return [];
    }
}

// Function to scan a single page
async function scanSinglePage(browser, url) {
    console.log(\`🔍 Starting accessibility scan for: \${url}\`);
    
    const page = await browser.newPage();
    
    try {
        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log(\`📄 Navigating to: \${url}\`);
        
        // Navigate to the page with timeout
        try {
            await page.goto(url, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });
        } catch (error) {
            console.log('Network idle failed, trying domcontentloaded...');
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 30000 
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
        
        // Run axe accessibility scan
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
        
        console.log(\`✅ Scan completed. Found \${results.violations.length} violations.\`);
        
        await page.close();
        return results;
        
    } catch (error) {
        console.error(\`❌ Error scanning \${url}:\`, error.message);
        await page.close();
        throw error;
    }
}

// Main scan API endpoint
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single', maxPages = 5, enableAI = false } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }
    
    let browser;
    const startTime = Date.now();
    
    try {
        console.log(\`🚀 Starting \${scanType} scan for: \${url}\`);
        
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
                '--disable-gpu'
            ]
        });
        
        let allViolations = [];
        let scannedPages = [];
        
        if (scanType === 'single') {
            // Single page scan
            const results = await scanSinglePage(browser, url);
            allViolations = results.violations;
            scannedPages = [url];
            
            const scanTime = Date.now() - startTime;
            
            // Save to database if available
            if (db) {
                await saveScan(1, 1, url, scanType, results.violations.length, scanTime, 1, results.violations);
            }
            
            // Prepare response
            const summary = {
                critical: allViolations.filter(v => v.impact === 'critical').length,
                serious: allViolations.filter(v => v.impact === 'serious').length,
                moderate: allViolations.filter(v => v.impact === 'moderate').length,
                minor: allViolations.filter(v => v.impact === 'minor').length
            };
            
            res.json({
                success: true,
                url: url,
                scanType: scanType,
                totalIssues: allViolations.length,
                scanTime: scanTime,
                pagesScanned: 1,
                violations: allViolations,
                summary: summary
            });
            
        } else {
            // Multi-page scan
            console.log(\`🔍 Starting multi-page scan (max \${maxPages} pages)\`);
            
            // Scan the first page and extract links
            const firstPageResults = await scanSinglePage(browser, url);
            allViolations = [...firstPageResults.violations];
            scannedPages = [url];
            
            // Extract links from the first page
            if (maxPages > 1) {
                try {
                    const page = await browser.newPage();
                    try {
                        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        const links = await extractLinks(page, url);
                        
                        console.log(\`🔗 Found \${links.length} links on the main page\`);
                        
                        // Scan additional pages (up to maxPages - 1 more)
                        const additionalPages = links
                            .filter(link => link !== url) // Exclude the main page
                            .slice(0, maxPages - 1);
                        
                        console.log(\`📄 Scanning \${additionalPages.length} additional pages\`);
                        
                        for (const pageUrl of additionalPages) {
                            try {
                                console.log(\`🔍 Scanning page: \${pageUrl}\`);
                                const pageResults = await scanSinglePage(browser, pageUrl);
                                allViolations = [...allViolations, ...pageResults.violations];
                                scannedPages.push(pageUrl);
                            } catch (error) {
                                console.error(\`❌ Failed to scan \${pageUrl}:\`, error.message);
                                // Continue with other pages even if one fails
                            }
                        }
                    } finally {
                        await page.close();
                    }
                } catch (error) {
                    console.error('❌ Error during link extraction:', error.message);
                    // Continue with just the first page results
                }
            }
            
            const scanTime = Date.now() - startTime;
            
            // Save to database if available
            if (db) {
                await saveScan(1, 1, url, scanType, allViolations.length, scanTime, scannedPages.length, allViolations);
            }
            
            // Prepare response
            const summary = {
                critical: allViolations.filter(v => v.impact === 'critical').length,
                serious: allViolations.filter(v => v.impact === 'serious').length,
                moderate: allViolations.filter(v => v.impact === 'moderate').length,
                minor: allViolations.filter(v => v.impact === 'minor').length
            };
            
            res.json({
                success: true,
                url: url,
                scanType: scanType,
                totalIssues: allViolations.length,
                scanTime: scanTime,
                pagesScanned: scannedPages.length,
                scannedUrls: scannedPages,
                violations: allViolations,
                summary: summary
            });
        }
        
    } catch (error) {
        console.error('❌ Scan failed:', error);
        
        let errorMessage = 'An unexpected error occurred during the scan.';
        
        if (error.message.includes('timeout') || error.message.includes('Navigation timeout')) {
            errorMessage = 'Website took too long to load. This may be due to slow server response or complex page content. Please try a different URL or try again later.';
        } else if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
            errorMessage = 'Website not found. Please check the URL and try again.';
        } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
            errorMessage = 'Connection refused. The website may be down or blocking automated requests.';
        }
        
        res.status(500).json({
            success: false,
            error: errorMessage,
            details: error.message
        });
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (error) {
                console.error('Error closing browser:', error);
            }
        }
    }
});

// Database function to save scan results
async function saveScan(userId, teamId, url, scanType, issuesFound, scanTime, pagesScanned, violations) {
    if (!db) {
        console.log('⚠️ Database not available, skipping scan save');
        return null;
    }
    
    try {
        const query = \`
            INSERT INTO scans (user_id, team_id, url, scan_type, issues_found, scan_time_ms, pages_scanned, violations_data, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id
        \`;
        
        const values = [
            userId,
            teamId,
            url,
            scanType,
            issuesFound,
            scanTime,
            pagesScanned,
            JSON.stringify(violations)
        ];
        
        const result = await db.query(query, values);
        const scanId = result.rows[0].id;
        
        console.log(\`✅ Scan saved to database with ID: \${scanId}\`);
        return scanId;
    } catch (error) {
        console.error('❌ Error saving scan to database:', error);
        return null;
    }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(\`🚀 SentryPrime Enterprise Dashboard running on port \${PORT}\`);
    console.log(\`📊 Scanner: http://localhost:\${PORT}/\`);
    console.log(\`🏥 Health check: http://localhost:\${PORT}/health\`);
    console.log(\`🗄️ Database: \${db ? 'Connected' : 'Disconnected'}\`);
    console.log(\`⏰ Server time: \${new Date().toISOString()}\`);
    
    // Log environment info
    console.log(\`🌍 Environment: \${process.env.NODE_ENV || 'development'}\`);
    console.log(\`☁️ Cloud Run: \${process.env.K_SERVICE ? 'Yes' : 'No'}\`);
    
    if (process.env.DB_HOST) {
        console.log(\`🐘 PostgreSQL version: PostgreSQL\`);
    }
    
    if (process.env.OPENAI_API_KEY) {
        console.log(\`🤖 AI Features: Enabled\`);
    } else {
        console.log(\`🤖 AI Features: Disabled\`);
    }
});
