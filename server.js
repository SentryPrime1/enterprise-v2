// SentryPrime Enterprise Scanner v2.1.0 - Database Enhanced
const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.json());

// Database connection (optional - graceful fallback)
let db = null;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize database if configured
if (process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_NAME)) {
    try {
        db = new Pool({
            connectionString: process.env.DATABASE_URL,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        console.log('📊 Database connection initialized');
        
        db.query('SELECT NOW()', (err, result) => {
            if (err) {
                console.log('⚠️ Database connection failed, running in standalone mode');
                db = null;
            } else {
                console.log('✅ Database connected successfully');
            }
        });
    } catch (error) {
        console.log('⚠️ Database setup failed, running in standalone mode:', error.message);
        db = null;
    }
} else {
    console.log('📝 No database configuration found, running in standalone mode');
}

// Database helper functions
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned = 1) {
    if (!db) return null;
    try {
        const result = await db.query(
            'INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id',
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned]
        );
        return result.rows[0].id;
    } catch (error) {
        console.log('Database error saving scan:', error.message);
        return null;
    }
}

async function getRecentScans(userId, limit = 10) {
    if (!db) {
        return [
            { id: 1, url: 'https://company.com', scan_type: 'single', total_issues: 7, created_at: '2024-09-18', score: 94 },
            { id: 2, url: 'https://company.com/products', scan_type: 'crawl', total_issues: 12, created_at: '2024-09-18', score: 87 },
            { id: 3, url: 'https://company.com/about', scan_type: 'single', total_issues: 3, created_at: '2024-09-17', score: 96 }
        ];
    }
    
    try {
        const result = await db.query(
            'SELECT id, url, scan_type, total_issues, created_at, scan_time_ms FROM scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
            [userId, limit]
         );
        return result.rows.map(scan => ({
            ...scan,
            score: Math.max(60, 100 - Math.min(40, scan.total_issues * 2))
        }));
    } catch (error) {
        console.log('Database error getting recent scans:', error.message);
        return [];
    }
}

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        if (!db) {
            req.user = { id: 1, email: 'anonymous@example.com', organization_id: 1 };
            return next();
        }
        return res.sendStatus(401);
    }
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        version: '2.1.0'
    });
});

// Get recent scans
app.get('/api/scans/recent', authenticateToken, async (req, res) => {
    try {
        const scans = await getRecentScans(req.user.id);
        res.json({ success: true, scans });
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch scans' });
    }
});

// Scanner helper functions (EXACT COPIES)
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
                .slice(0, 50);
            
            return [...new Set(urls)];
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
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to: ' + url);
        
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
        
        console.log('Waiting for page to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
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

// Main scanning endpoint (EXACT COPY with database integration)
app.post('/api/scan', authenticateToken, async (req, res) => {
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
        if (!targetUrl.startsWith('http://' ) && !targetUrl.startsWith('https://' )) {
            targetUrl = 'https://' + targetUrl;
        }
        
        console.log('Starting accessibility scan for: ' + targetUrl + ' (type: ' + scanType + ' )');
        
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
            const results = await scanSinglePage(browser, targetUrl);
            const scanTime = Date.now() - startTime;
            
            console.log('Single page scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
            
            const scanId = await saveScan(req.user.id, req.user.organization_id, targetUrl, scanType, results.violations.length, scanTime, 1);
            
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
            console.log('Starting multi-page crawl (max ' + maxPages + ' pages)');
            
            const scannedPages = [];
            const urlsToScan = [targetUrl];
            const scannedUrls = new Set();
            
            const firstPageResults = await scanSinglePage(browser, targetUrl);
            scannedPages.push({
                url: targetUrl,
                violations: firstPageResults.violations,
                scanTime: Date.now() - startTime
            });
            scannedUrls.add(targetUrl);
            
            if (maxPages > 1) {
                const page = await browser.newPage();
                try {
                    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    const links = await extractLinks(page, targetUrl);
                    
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
            
            const allViolations = scannedPages.reduce((acc, page) => acc.concat(page.violations || []), []);
            const scanTime = Date.now() - startTime;
            
            console.log('Multi-page crawl completed in ' + scanTime + 'ms. Scanned ' + scannedPages.length + ' pages, found ' + allViolations.length + ' total violations.');
            
            const scanId = await saveScan(req.user.id, req.user.organization_id, targetUrl, scanType, allViolations.length, scanTime, scannedPages.length);
            
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
            errorMessage = 'Website took too long to load. Please try a different URL or try again later.';
        } else if (errorMessage.includes('net::ERR_NAME_NOT_RESOLVED')) {
            errorMessage = 'Website not found. Please check the URL and try again.';
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
// Dashboard HTML (EXACT COPY of your working version)
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
        
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
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
        
        <div class="main-content">
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
            
            <div class="content-area">
                <div class="page-header">
                    <h1 class="page-title">Accessibility Scans</h1>
                    <p class="page-subtitle">Manage and review your accessibility scans</p>
                </div>
                
                <button class="new-scan-btn" onclick="toggleScanner()">
                    <span>+</span>
                    New Scan
                </button>
                
                <div class="scanner-section" id="scannerSection">
                    <h2>Scan Website for Accessibility Issues</h2>
                    <form id="scanForm">
                        <input type="url" id="url" placeholder="https://example.com/" required>
                        
                        <div class="scan-options">
                            <h4>Scan Options:</h4>
                            <label>
                                <input type="radio" name="scanType" value="single" checked> 
                                Single Page (Fast - recommended )
                            </label>  

                            <label>
                                <input type="radio" name="scanType" value="crawl"> 
                                Multi-Page Crawl (Slower - up to 
                                <input type="number" id="maxPages" value="5" min="2" max="20"> pages)
                            </label>
                        </div>
                        
                        <button type="submit" id="scanButton">🔍 Start Accessibility Scan</button>
                    </form>
                </div>
                
                <div id="results" class="results" style="display: none;">
                    <h2>Scan Results</h2>
                    <div id="resultsContent"></div>
                </div>
                
                <div class="recent-scans">
                    <h3>Recent Scans</h3>
                    <p style="color: #666; margin-bottom: 20px;">Your latest accessibility scan results</p>
                    <div id="recentScansContainer"></div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Load recent scans on page load
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                if (data.success && data.scans.length > 0) {
                    const container = document.getElementById('recentScansContainer');
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
                    // Show demo data if no real scans
                    const container = document.getElementById('recentScansContainer');
                    container.innerHTML = 
                        '<div class="scan-item">' +
                        '<div class="scan-info">' +
                        '<h4>https://company.com</h4>' +
                        '<div class="scan-meta">Single Page • 2024-09-18</div>' +
                        '</div>' +
                        '<div style="display: flex; align-items: center;">' +
                        '<span class="scan-score">94% Score</span>' +
                        '<button class="view-report-btn">👁 View Report</button>' +
                        '</div>' +
                        '</div>' +
                        '<div class="scan-item">' +
                        '<div class="scan-info">' +
                        '<h4>https://company.com/products</h4>' +
                        '<div class="scan-meta">Multi-page • 2024-09-18</div>' +
                        '</div>' +
                        '<div style="display: flex; align-items: center;">' +
                        '<span class="scan-score">87% Score</span>' +
                        '<button class="view-report-btn">👁 View Report</button>' +
                        '</div>' +
                        '</div>';
                }
            } catch (error ) {
                console.log('Error loading recent scans:', error);
            }
        }
        
        // Load recent scans when page loads
        document.addEventListener('DOMContentLoaded', loadRecentScans);
        
        // PRESERVED SCANNER FUNCTIONALITY - IDENTICAL TO WORKING VERSION
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const url = document.getElementById('url').value;
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('maxPages').value;
            const resultsDiv = document.getElementById('results');
            const resultsContent = document.getElementById('resultsContent');
            const scanButton = document.getElementById('scanButton');
            
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
                        let html = '<h3 class="success">✅ Crawl Complete</h3>' +
                                  '<p><strong>Pages Scanned:</strong> ' + result.pages.length + '</p>' +
                                  '<p><strong>Total Issues:</strong> ' + result.totalIssues + '</p>' +
                                  '<p><strong>Total Scan Time:</strong> ' + result.scanTime + 'ms</p>' +
                                  '<p><strong>Timestamp:</strong> ' + result.timestamp + '</p>';
                        
                        html += '<h4>Overall Violations by Impact:</h4><ul>' +
                               '<li>Critical: ' + result.summary.critical + '</li>' +
                               '<li>Serious: ' + result.summary.serious + '</li>' +
                               '<li>Moderate: ' + result.summary.moderate + '</li>' +
                               '<li>Minor: ' + result.summary.minor + '</li></ul>';
                        
                        html += '<h4>Results by Page:</h4>';
                        result.pages.forEach(function(page) {
                            html += '<div class="page-result">' +
                                   '<strong>' + page.url + '</strong>  
' +
                                   'Issues: ' + page.violations.length + ' | ' +
                                   'Time: ' + page.scanTime + 'ms  
' +
                                   '<small>Critical: ' + page.violations.filter(function(v) { return v.impact === 'critical'; }).length + 
                                   ', Serious: ' + page.violations.filter(function(v) { return v.impact === 'serious'; }).length + 
                                   ', Moderate: ' + page.violations.filter(function(v) { return v.impact === 'moderate'; }).length + 
                                   ', Minor: ' + page.violations.filter(function(v) { return v.impact === 'minor'; }).length + '</small>' +
                                   '</div>';
                        });
                        
                        resultsContent.innerHTML = html;
                    }
                    
                    setTimeout(loadRecentScans, 1000);
                } else {
                    resultsContent.innerHTML = '<p class="error">❌ Error: ' + result.error + '</p>';
                }
            } catch (error) {
                resultsContent.innerHTML = '<p class="error">❌ Network Error: ' + error.message + '</p>';
            } finally {
                scanButton.disabled = false;
                scanButton.textContent = '🔍 Start Accessibility Scan';
            }
        });
        
        function toggleScanner() {
            const scanner = document.getElementById('scannerSection');
            scanner.style.display = scanner.style.display === 'none' ? 'block' : 'none';
        }
    </script>
</body>
</html>`;
    res.send(html);
});

// Start server
app.listen(PORT, () => {
    console.log('🚀 SentryPrime Enterprise Dashboard v2.1.0 running on port ' + PORT);
    console.log('📊 Health check: http://localhost:' + PORT + '/health' );
    console.log('🔍 Scanner: http://localhost:' + PORT + '/' );
    console.log('💾 Database: ' + (db ? 'Connected' : 'Standalone mode'));
});
