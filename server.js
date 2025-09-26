const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Database connection - ADDED FOR PERSISTENCE
let db = null;

// Initialize database connection if environment variables are provided
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    console.log('Initializing database connection...');
    
    const dbConfig = {
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

    db = new Pool(dbConfig);
    
    // Test database connection
    db.query('SELECT NOW()')
        .then(() => {
            console.log('✅ Database connected successfully');
        })
        .catch(err => {
            console.log('❌ Database connection failed, running in standalone mode:', err.message);
            db = null;
        });
} else {
    console.log('ℹ️ No database configuration found, running in standalone mode');
}

// Database helper functions - ADDED FOR PERSISTENCE
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned, violations) {
    if (!db) {
        console.log('No database connection, skipping scan save');
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
        
        return result.rows.map(scan => ({
            ...scan,
            score: Math.max(60, 100 - Math.min(40, scan.total_issues * 2)) // Calculate score based on issues
        }));
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone'
    });
});

// API endpoint to get recent scans - ADDED FOR DYNAMIC LOADING
app.get('/api/scans/recent', async (req, res) => {
    try {
        const scans = await getRecentScans(1); // Default user ID for now
        res.json({ success: true, scans });
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch scans' });
    }
});

// Main dashboard page with PRESERVED SCANNER FUNCTIONALITY
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
        
        .new-scan-btn {
            background: #1a1a1a;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 24px;
            transition: background 0.2s ease;
        }
        
        .new-scan-btn:hover {
            background: #333;
        }
        
        /* Scanner Form - PRESERVED EXACTLY */
        .scanner-section {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 24px;
        }
        
        .scanner-section h3 {
            margin-bottom: 20px;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        input[type="url"] { 
            width: 100%; 
            padding: 12px; 
            margin: 10px 0; 
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            font-size: 14px;
        }
        
        input[type="url"]:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        input[type="number"] { 
            width: 100px; 
            padding: 8px; 
            margin: 5px; 
            border: 1px solid #e1e5e9;
            border-radius: 4px;
            text-align: center;
        }
        
        .scan-options { 
            margin: 15px 0; 
            padding: 15px; 
            background: #f8f9fa;
            border-radius: 6px;
        }
        
        .scan-options h4 {
            margin-bottom: 12px;
            font-size: 1rem;
            font-weight: 600;
        }
        
        .scan-options label {
            display: block;
            margin: 8px 0;
            font-weight: 500;
            cursor: pointer;
        }
        
        button { 
            background: #007bff;
            color: white; 
            padding: 12px 24px; 
            border: none; 
            border-radius: 4px; 
            cursor: pointer; 
            margin: 5px;
            font-size: 14px;
            font-weight: 500;
        }
        
        button:hover { 
            background: #0056b3;
        }
        
        button:disabled { 
            background: #6c757d; 
            cursor: not-allowed;
        }
        
        /* Results Section - PRESERVED EXACTLY */
        .results { 
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-top: 30px;
        }
        
        .results h2 {
            margin-bottom: 16px;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .loading { color: #007bff; }
        .error { color: #dc3545; }
        .success { color: #28a745; }
        
        .page-result { 
            margin: 10px 0; 
            padding: 10px; 
            border-left: 3px solid #007bff;
            background: #f8f9fa;
        }
        
        .recent-scans {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .recent-scans h3 {
            margin-bottom: 16px;
            font-size: 1.2rem;
            font-weight: 600;
        }
        
        .scan-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            font-size: 1rem;
            font-weight: 500;
            margin-bottom: 4px;
        }
        
        .scan-meta {
            font-size: 0.85rem;
            color: #666;
        }
        
        .scan-score {
            background: #1a1a1a;
            color: white;
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .view-report-btn {
            background: none;
            border: 1px solid #e1e5e9;
            color: #666;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.8rem;
            margin-left: 12px;
        }
        
        .view-report-btn:hover {
            background: #f8f9fa;
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
                <a href="#" class="nav-item">
                    <span class="nav-icon">📊</span>
                    Dashboard
                </a>
                <a href="#" class="nav-item active">
                    <span class="nav-icon">🔍</span>
                    Scans
                </a>
                <a href="#" class="nav-item">
                    <span class="nav-icon">📈</span>
                    Analytics
                </a>
                <a href="#" class="nav-item">
                    <span class="nav-icon">👥</span>
                    Team
                </a>
                <a href="#" class="nav-item">
                    <span class="nav-icon">🔗</span>
                    Integrations
                </a>
                <a href="#" class="nav-item">
                    <span class="nav-icon">⚙️</span>
                    API Management
                </a>
                <a href="#" class="nav-item">
                    <span class="nav-icon">💳</span>
                    Billing
                </a>
                <a href="#" class="nav-item">
                    <span class="nav-icon">⚙️</span>
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
                    <span style="color: #dc3545; font-weight: 600;">2</span>
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <div>
                            <div style="font-weight: 500; font-size: 0.9rem;">John Doe</div>
                            <div style="font-size: 0.8rem; color: #666;">Acme Corporation</div>
                        </div>
                        <span>▼</span>
                    </div>
                </div>
            </div>
            
            <!-- Content Area -->
            <div class="content-area">
                <div class="page-header">
                    <h1 class="page-title">Accessibility Scans</h1>
                    <p class="page-subtitle">Manage and review your accessibility scans</p>
                </div>
                
                <button class="new-scan-btn" onclick="toggleScanner()">
                    <span>+</span>
                    New Scan
                </button>
                
                <!-- Scanner Section - PRESERVED FUNCTIONALITY -->
                <div class="scanner-section" id="scannerSection">
                    <h2>Scan Website for Accessibility Issues</h2>
                    <form id="scanForm">
                        <input type="url" id="url" placeholder="https://example.com/" required>
                        
                        <div class="scan-options">
                            <h4>Scan Options:</h4>
                            <label>
                                <input type="radio" name="scanType" value="single" checked> 
                                Single Page (Fast - recommended)
                            </label><br>
                            <label>
                                <input type="radio" name="scanType" value="crawl"> 
                                Multi-Page Crawl (Slower - up to 
                                <input type="number" id="maxPages" value="5" min="2" max="20"> pages)
                            </label>
                        </div>
                        
                        <button type="submit" id="scanButton">🔍 Start Accessibility Scan</button>
                    </form>
                </div>
                
                <!-- Results Section - PRESERVED FUNCTIONALITY -->
                <div id="results" class="results" style="display: none;">
                    <h2>Scan Results</h2>
                    <div id="resultsContent"></div>
                </div>
                
                <!-- Recent Scans - ENHANCED WITH DYNAMIC LOADING -->
                <div class="recent-scans">
                    <h3>Recent Scans</h3>
                    <p style="color: #666; margin-bottom: 20px;">Your latest accessibility scan results</p>
                    
                    <div id="recentScansContainer">
                        <div style="text-align: center; padding: 20px; color: #666;">
                            Loading recent scans...
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Load recent scans on page load - ADDED FOR DYNAMIC LOADING
        document.addEventListener('DOMContentLoaded', function() {
            loadRecentScans();
        });

        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recentScansContainer');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => 
                        '<div class="scan-item">' +
                        '<div class="scan-info">' +
                        '<h4>' + scan.url + '</h4>' +
                        '<div class="scan-meta">' + (scan.scan_type === 'single' ? 'Single Page' : 'Multi-page') + ' • ' + new Date(scan.created_at).toLocaleDateString() + '</div>' +
                        '</div>' +
                        '<div style="display: flex; align-items: center;">' +
                        '<span class="scan-score">' + scan.score + '% Score</span>' +
                        '<button class="view-report-btn">👁 View Report</button>' +
                        '</div>' +
                        '</div>'
                    ).join('');
                } else {
                    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No scans yet. Start your first scan above!</div>';
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('recentScansContainer').innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Unable to load recent scans.</div>';
            }
        }
        
        // PRESERVED SCANNER FUNCTIONALITY - IDENTICAL TO WORKING VERSION
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const url = document.getElementById('url').value;
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('maxPages').value;
            const resultsDiv = document.getElementById('results');
            const resultsContent = document.getElementById('resultsContent');
            const scanButton = document.getElementById('scanButton');
            
            // Disable button and show loading
            scanButton.disabled = true;
            scanButton.textContent = scanType === 'single' ? '⏳ Scanning...' : '⏳ Crawling...';
            
            const loadingMsg = scanType === 'single' 
                ? '🔄 Scanning single page... This may take up to 30 seconds.'
                : '🔄 Crawling multiple pages... This may take up to 5 minutes for ' + maxPages + ' pages.';
            
            resultsContent.innerHTML = '<p class="loading">' + loadingMsg + '</p>';
            resultsDiv.style.display = 'block';
            
            try {
                const requestBody = { 
                    url: url,
                    scanType: scanType
                };
                
                if (scanType === 'crawl') {
                    requestBody.maxPages = parseInt(maxPages);
                }
                
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    if (scanType === 'single') {
                        // Single page results - EXACT FORMAT FROM WORKING VERSION
                        resultsContent.innerHTML = 
                            '<h3 class="success">✅ Scan Complete</h3>' +
                            '<p><strong>URL:</strong> ' + result.url + '</p>' +
                            '<p><strong>Total Issues:</strong> ' + result.totalIssues + '</p>' +
                            '<p><strong>Scan Time:</strong> ' + result.scanTime + 'ms</p>' +
                            '<p><strong>Timestamp:</strong> ' + result.timestamp + '</p>' +
                            '<h4>Violations by Impact:</h4>' +
                            '<ul>' +
                            '<li>Critical: ' + result.violations.filter(function(v) { return v.impact === 'critical'; }).length + '</li>' +
                            '<li>Serious: ' + result.violations.filter(function(v) { return v.impact === 'serious'; }).length + '</li>' +
                            '<li>Moderate: ' + result.violations.filter(function(v) { return v.impact === 'moderate'; }).length + '</li>' +
                            '<li>Minor: ' + result.violations.filter(function(v) { return v.impact === 'minor'; }).length + '</li>' +
                            '</ul>' +
                            '<details><summary>View Detailed Results</summary><pre>' + JSON.stringify(result.violations, null, 2) + '</pre></details>';
                    } else {
                        // Multi-page crawl results - EXACT FORMAT FROM WORKING VERSION
                        let html = '<h3 class="success">✅ Crawl Complete</h3>' +
                                  '<p><strong>Pages Scanned:</strong> ' + result.pages.length + '</p>' +
                                  '<p><strong>Total Issues:</strong> ' + result.totalIssues + '</p>' +
                                  '<p><strong>Total Scan Time:</strong> ' + result.scanTime + 'ms</p>' +
                                  '<p><strong>Timestamp:</strong> ' + result.timestamp + '</p>';
                        
                        // Summary by impact
                        html += '<h4>Overall Violations by Impact:</h4><ul>' +
                               '<li>Critical: ' + result.summary.critical + '</li>' +
                               '<li>Serious: ' + result.summary.serious + '</li>' +
                               '<li>Moderate: ' + result.summary.moderate + '</li>' +
                               '<li>Minor: ' + result.summary.minor + '</li></ul>';
                        
                        // Individual page results
                        html += '<h4>Results by Page:</h4>';
                        result.pages.forEach(function(page) {
                            html += '<div class="page-result">' +
                                   '<strong>' + page.url + '</strong><br>' +
                                   'Issues: ' + page.violations.length + ' | ' +
                                   'Time: ' + page.scanTime + 'ms<br>' +
                                   '<small>Critical: ' + page.violations.filter(function(v) { return v.impact === 'critical'; }).length + 
                                   ', Serious: ' + page.violations.filter(function(v) { return v.impact === 'serious'; }).length + 
                                   ', Moderate: ' + page.violations.filter(function(v) { return v.impact === 'moderate'; }).length + 
                                   ', Minor: ' + page.violations.filter(function(v) { return v.impact === 'minor'; }).length + '</small>' +
                                   '</div>';
                        });
                        
                        resultsContent.innerHTML = html;
                    }
                    
                    // Reload recent scans after successful scan - ADDED FOR DYNAMIC UPDATE
                    setTimeout(loadRecentScans, 1000);
                    
                } else {
                    resultsContent.innerHTML = '<p class="error">❌ Error: ' + result.error + '</p>';
                }
            } catch (error) {
                resultsContent.innerHTML = '<p class="error">❌ Network Error: ' + error.message + '</p>';
            } finally {
                // Re-enable button
                scanButton.disabled = false;
                scanButton.textContent = '🔍 Start Accessibility Scan';
            }
        });
        
        // Dashboard functionality
        function toggleScanner() {
            const scanner = document.getElementById('scannerSection');
            scanner.style.display = scanner.style.display === 'none' ? 'block' : 'none';
        }
    </script>
</body>
</html>`;
    res.send(html);
});

// EXACT COPY OF WORKING HELPER FUNCTION
async function extractLinks(page, baseUrl) {
    try {
        const links = await page.evaluate((baseUrl) => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            const urls = anchors
                .map(a => a.href)
                .filter(href => {
                    try {
                        const url = new URL(href);
                        const base = new URL(baseUrl);
                        return url.hostname === base.hostname && 
                               !href.includes('#') && 
                               !href.includes('mailto:') && 
                               !href.includes('tel:') &&
                               !href.includes('.pdf') &&
                               !href.includes('.jpg') &&
                               !href.includes('.png');
                    } catch (e) {
                        return false;
                    }
                })
                .slice(0, 50); // Limit to first 50 links found
            
            return [...new Set(urls)]; // Remove duplicates
        }, baseUrl);
        
        return links;
    } catch (error) {
        console.log('Error extracting links:', error.message);
        return [];
    }
}

// EXACT COPY OF WORKING SCAN FUNCTION
async function scanSinglePage(browser, url) {
    const page = await browser.newPage();
    
    try {
        // Set timeouts
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);
        
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
        
        console.log('Starting accessibility scan for: ' + targetUrl + ' (type: ' + scanType + ')');
        
        // Launch Puppeteer - EXACT WORKING CONFIGURATION
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/usr/bin/google-chrome-stable',  // CORRECTED PATH
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',  // ADDED
                '--disable-gpu',
                '--disable-web-security',  // ADDED
                '--disable-features=VizDisplayCompositor',  // ADDED
                '--disable-background-timer-throttling',  // ADDED
                '--disable-backgrounding-occluded-windows',  // ADDED
                '--disable-renderer-backgrounding'  // ADDED
            ],
            timeout: 60000
        });
        
        if (scanType === 'single') {
            // Single page scan (existing working functionality)
            const results = await scanSinglePage(browser, targetUrl);
            const scanTime = Date.now() - startTime;
            
            console.log('Single page scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
            
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
            console.log('Starting multi-page crawl (max ' + maxPages + ' pages)');
            
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
                    console.log('Scanning page ' + (i + 1) + '/' + Math.min(urlsToScan.length, maxPages) + ': ' + pageUrl);
                    const pageStartTime = Date.now();
                    const pageResults = await scanSinglePage(browser, pageUrl);
                    
                    scannedPages.push({
                        url: pageUrl,
                        violations: pageResults.violations,
                        scanTime: Date.now() - pageStartTime
                    });
                    scannedUrls.add(pageUrl);
                    
                } catch (error) {
                    console.log('Error scanning page ' + pageUrl + ':', error.message);
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
            
            console.log('Multi-page crawl completed in ' + scanTime + 'ms. Scanned ' + scannedPages.length + ' pages, found ' + allViolations.length + ' total violations.');
            
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
        console.error('Scan error:', error);
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
                console.log('Browser closed successfully');
            } catch (closeError) {
                console.error('Error closing browser:', closeError);
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
});
