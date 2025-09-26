const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.json());

// Database connection (Cloud SQL compatible)
let db = null;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize database if configured
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    try {
        const dbConfig = {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        };

        // Add SSL configuration for Cloud SQL
        if (process.env.NODE_ENV === 'production') {
            dbConfig.ssl = {
                rejectUnauthorized: false
            };
        }

        // Use Unix socket for Cloud Run if available
        if (process.env.DB_SOCKET_PATH) {
            dbConfig.host = process.env.DB_SOCKET_PATH;
            delete dbConfig.port;
        }

        db = new Pool(dbConfig);
        
        console.log('Database connection initialized');
        
        db.query('SELECT NOW()', (err, result) => {
            if (err) {
                console.log('Database connection failed, running in standalone mode:', err.message);
                db = null;
            } else {
                console.log('Database connected successfully');
            }
        });
    } catch (error) {
        console.log('Database setup failed, running in standalone mode:', error.message);
        db = null;
    }
} else {
    console.log('No database configuration found, running in standalone mode');
}

// Database helper functions (with graceful fallback)
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned = 1) {
    if (!db) return null;
    try {
        const result = await db.query(
            'INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id',
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned]
        );
        console.log('Scan saved to database with ID:', result.rows[0].id);
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

// Authentication middleware (graceful fallback)
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        // If no database, allow anonymous access (preserves current functionality)
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

// Health check (enhanced with database status)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        version: '2.1.0'
    });
});

// Get user's recent scans
app.get('/api/scans/recent', authenticateToken, async (req, res) => {
    try {
        const scans = await getRecentScans(req.user.id);
        res.json({ success: true, scans });
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch scans' });
    }
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
                .slice(0, 50);
            
            return [...new Set(urls)];
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

// EXACT COPY OF WORKING API ENDPOINT WITH DATABASE INTEGRATION
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
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
        
        console.log('Starting accessibility scan for: ' + targetUrl + ' (type: ' + scanType + ')');
        
        // EXACT WORKING PUPPETEER CONFIGURATION
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
            
            // Save to database if available
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
            
            // Save to database if available
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
        
        .sidebar-header .subtitle {
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
            transition: all 0.2s;
            border-left: 3px solid transparent;
            position: relative;
        }
        
        .nav-item:hover {
            background: #2a2a2a;
            color: white;
        }
        
        .nav-item.active {
            background: #2a2a2a;
            color: white;
            border-left-color: #007bff;
        }
        
        .nav-item .badge {
            background: #dc3545;
            color: white;
            font-size: 0.7rem;
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: auto;
        }
        
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        .top-bar {
            background: white;
            padding: 16px 24px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .search-bar {
            flex: 1;
            max-width: 400px;
            margin-right: 20px;
        }
        
        .search-bar input {
            width: 100%;
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .notification-badge {
            background: #dc3545;
            color: white;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
        }
        
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #007bff;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
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
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .page-subtitle {
            color: #666;
            font-size: 0.9rem;
        }
        
        .action-bar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
        }
        
        .btn {
            padding: 10px 16px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background: #007bff;
            color: white;
        }
        
        .btn-primary:hover {
            background: #0056b3;
        }
        
        .scan-form {
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 24px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #333;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
        }
        
        .radio-group {
            display: flex;
            gap: 20px;
            margin-top: 12px;
        }
        
        .radio-option {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .radio-option input[type="radio"] {
            margin: 0;
        }
        
        .inline-input {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .inline-input input[type="number"] {
            width: 80px;
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        
        .results-section {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 24px;
        }
        
        .results-header {
            padding: 20px 24px;
            border-bottom: 1px solid #e9ecef;
        }
        
        .results-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 4px;
        }
        
        .results-subtitle {
            color: #666;
            font-size: 0.9rem;
        }
        
        .results-content {
            padding: 24px;
        }
        
        .scan-result {
            padding: 20px;
            border: 1px solid #e9ecef;
            border-radius: 6px;
            margin-bottom: 16px;
        }
        
        .scan-result.success {
            border-color: #28a745;
            background: #f8fff9;
        }
        
        .scan-result.error {
            border-color: #dc3545;
            background: #fff8f8;
        }
        
        .scan-result h3 {
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-result h3.success {
            color: #28a745;
        }
        
        .scan-result h3.error {
            color: #dc3545;
        }
        
        .scan-meta {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 16px;
        }
        
        .scan-meta-item {
            display: flex;
            justify-content: space-between;
        }
        
        .scan-meta-label {
            font-weight: 500;
            color: #666;
        }
        
        .violations-list {
            margin-top: 16px;
        }
        
        .violations-list h4 {
            margin-bottom: 12px;
            color: #333;
        }
        
        .violations-list ul {
            list-style: none;
            padding: 0;
        }
        
        .violations-list li {
            padding: 8px 0;
            border-bottom: 1px solid #f0f0f0;
        }
        
        .violations-list li:last-child {
            border-bottom: none;
        }
        
        .violation-impact {
            font-weight: 600;
            text-transform: uppercase;
            font-size: 0.8rem;
        }
        
        .violation-impact.critical {
            color: #dc3545;
        }
        
        .violation-impact.serious {
            color: #fd7e14;
        }
        
        .violation-impact.moderate {
            color: #ffc107;
        }
        
        .violation-impact.minor {
            color: #6c757d;
        }
        
        .page-result {
            margin-bottom: 24px;
            padding: 16px;
            border: 1px solid #e9ecef;
            border-radius: 6px;
        }
        
        .page-result h4 {
            margin-bottom: 12px;
            color: #333;
        }
        
        .recent-scans {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .recent-scans-header {
            padding: 20px 24px;
            border-bottom: 1px solid #e9ecef;
        }
        
        .recent-scans-content {
            padding: 0;
        }
        
        .scan-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 24px;
            border-bottom: 1px solid #f8f9fa;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-item:hover {
            background: #f8f9fa;
        }
        
        .scan-info {
            flex: 1;
        }
        
        .scan-url {
            font-weight: 500;
            color: #333;
            margin-bottom: 4px;
        }
        
        .scan-meta-info {
            font-size: 0.85rem;
            color: #666;
        }
        
        .scan-score {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .score-badge {
            background: #28a745;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 600;
        }
        
        .score-badge.warning {
            background: #ffc107;
            color: #000;
        }
        
        .score-badge.danger {
            background: #dc3545;
        }
        
        .view-report-btn {
            background: #6f42c1;
            color: white;
            padding: 6px 12px;
            border-radius: 4px;
            text-decoration: none;
            font-size: 0.8rem;
            font-weight: 500;
        }
        
        .view-report-btn:hover {
            background: #5a2d91;
            color: white;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #007bff;
            border-radius: 50%;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .empty-state {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        
        .empty-state h3 {
            margin-bottom: 8px;
            color: #333;
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>🛡️ SentryPrime</h1>
                <div class="subtitle">Enterprise Dashboard</div>
            </div>
            <nav class="sidebar-nav">
                <a href="#" class="nav-item active">📊 Dashboard</a>
                <a href="#" class="nav-item">🔍 Scans <span class="badge">2</span></a>
                <a href="#" class="nav-item">📈 Analytics <span class="badge">3</span></a>
                <a href="#" class="nav-item">👥 Team <span class="badge">4</span></a>
                <a href="#" class="nav-item">🔗 Integrations <span class="badge">5</span></a>
                <a href="#" class="nav-item">⚙️ API Management <span class="badge">6</span></a>
                <a href="#" class="nav-item">💳 Billing <span class="badge">7</span></a>
                <a href="#" class="nav-item">⚙️ Settings <span class="badge">8</span></a>
            </nav>
        </div>
        
        <div class="main-content">
            <div class="top-bar">
                <div class="search-bar">
                    <input type="text" placeholder="Search scans, reports, or settings...">
                </div>
                <div class="user-menu">
                    <div class="notification-badge">2</div>
                    <div class="user-avatar">JD</div>
                    <span>John Doe</span>
                    <small style="color: #666;">Acme Corporation</small>
                </div>
            </div>
            
            <div class="content-area">
                <div class="page-header">
                    <h1 class="page-title">Accessibility Scans</h1>
                    <p class="page-subtitle">Manage and review your accessibility scans</p>
                </div>
                
                <div class="action-bar">
                    <button class="btn btn-primary" onclick="showNewScanForm()">+ New Scan</button>
                </div>
                
                <div class="scan-form">
                    <h2 style="margin-bottom: 20px;">Scan Website for Accessibility Issues</h2>
                    
                    <div class="form-group">
                        <input type="url" class="form-input" id="urlInput" placeholder="https://example.com/" required>
                    </div>
                    
                    <div class="form-group">
                        <label class="form-label">Scan Options:</label>
                        <div class="radio-group">
                            <div class="radio-option">
                                <input type="radio" id="singlePage" name="scanType" value="single" checked>
                                <label for="singlePage">Single Page (Fast - recommended)</label>
                            </div>
                            <div class="radio-option">
                                <input type="radio" id="multiPage" name="scanType" value="crawl">
                                <label for="multiPage">Multi-Page Crawl (Slower - up to</label>
                                <input type="number" id="maxPages" value="5" min="1" max="20" style="width: 60px; margin: 0 8px;">
                                <label>pages)</label>
                            </div>
                        </div>
                    </div>
                    
                    <button class="btn btn-primary" onclick="startScan()">🔍 Start Accessibility Scan</button>
                </div>
                
                <div class="results-section" id="resultsSection" style="display: none;">
                    <div class="results-header">
                        <h2 class="results-title">Scan Results</h2>
                    </div>
                    <div class="results-content" id="resultsContent">
                        <!-- Results will be populated here -->
                    </div>
                </div>
                
                <div class="recent-scans">
                    <div class="recent-scans-header">
                        <h2 class="results-title">Recent Scans</h2>
                        <p class="results-subtitle">Your latest accessibility scan results</p>
                    </div>
                    <div class="recent-scans-content" id="recentScansContent">
                        <div class="loading">
                            <div class="spinner"></div>
                            Loading recent scans...
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Load recent scans on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadRecentScans();
        });

        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recentScansContent');
                
                if (data.success && data.scans && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => {
                        const scoreClass = scan.score >= 90 ? '' : scan.score >= 70 ? 'warning' : 'danger';
                        const date = new Date(scan.created_at).toLocaleDateString();
                        const scanTypeLabel = scan.scan_type === 'crawl' ? 'Multi-page' : 'Single Page';
                        
                        return `
                            <div class="scan-item">
                                <div class="scan-info">
                                    <div class="scan-url">${scan.url}</div>
                                    <div class="scan-meta-info">${scanTypeLabel} • ${date}</div>
                                </div>
                                <div class="scan-score">
                                    <div class="score-badge ${scoreClass}">${scan.score}% Score</div>
                                    <a href="#" class="view-report-btn">👁 View Report</a>
                                </div>
                            </div>
                        `;
                    }).join('');
                } else {
                    container.innerHTML = `
                        <div class="empty-state">
                            <h3>No scans yet</h3>
                            <p>Start your first accessibility scan to see results here.</p>
                        </div>
                    `;
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('recentScansContent').innerHTML = `
                    <div class="empty-state">
                        <h3>Unable to load scans</h3>
                        <p>Please try refreshing the page.</p>
                    </div>
                `;
            }
        }

        async function startScan() {
            const url = document.getElementById('urlInput').value.trim();
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('maxPages').value;
            
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            const resultsSection = document.getElementById('resultsSection');
            const resultsContent = document.getElementById('resultsContent');
            
            resultsSection.style.display = 'block';
            resultsContent.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    Scanning ${url}... This may take a few moments.
                </div>
            `;
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        maxPages: parseInt(maxPages)
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    if (scanType === 'single') {
                        resultsContent.innerHTML = 
                            '<div class="scan-result success">' +
                            '<h3 class="success">✅ Scan Complete</h3>' +
                            '<div class="scan-meta">' +
                            '<div class="scan-meta-item"><span class="scan-meta-label">URL:</span> <span>' + result.url + '</span></div>' +
                            '<div class="scan-meta-item"><span class="scan-meta-label">Total Issues:</span> <span>' + result.totalIssues + '</span></div>' +
                            '<div class="scan-meta-item"><span class="scan-meta-label">Scan Time:</span> <span>' + (result.scanTime / 1000).toFixed(2) + 's</span></div>' +
                            '</div>' +
                            '<div class="violations-list">' +
                            '<h4>Violations:</h4>' +
                            '<ul>' + result.violations.map(v => '<li><span class="violation-impact ' + v.impact + '">' + v.impact + ':</span> ' + v.help + '</li>').join('') + '</ul>' +
                            '</div>' +
                            '</div>';
                    } else {
                        let pagesHtml = '';
                        for (const page of result.pages) {
                            pagesHtml += 
                                '<div class="page-result">' +
                                '<h4>' + page.url + ' (' + page.violations.length + ' issues)</h4>' +
                                '<ul>' + page.violations.map(v => '<li><span class="violation-impact ' + v.impact + '">' + v.impact + ':</span> ' + v.help + '</li>').join('') + '</ul>' +
                                '</div>';
                        }
                        
                        resultsContent.innerHTML = 
                            '<div class="scan-result success">' +
                            '<h3 class="success">✅ Crawl Complete</h3>' +
                            '<div class="scan-meta">' +
                            '<div class="scan-meta-item"><span class="scan-meta-label">Pages Scanned:</span> <span>' + result.pages.length + '</span></div>' +
                            '<div class="scan-meta-item"><span class="scan-meta-label">Total Issues:</span> <span>' + result.totalIssues + '</span></div>' +
                            '<div class="scan-meta-item"><span class="scan-meta-label">Scan Time:</span> <span>' + (result.scanTime / 1000).toFixed(2) + 's</span></div>' +
                            '</div>' +
                            '<div class="violations-list">' +
                            '<h4>Pages:</h4>' +
                            pagesHtml +
                            '</div>' +
                            '</div>';
                    }
                    
                    // Reload recent scans to show the new scan
                    setTimeout(loadRecentScans, 1000);
                } else {
                    resultsContent.innerHTML = 
                        '<div class="scan-result error">' +
                        '<h3 class="error">❌ Scan Failed</h3>' +
                        '<p>' + result.error + '</p>' +
                        '</div>';
                }
            } catch (error) {
                console.error('Scan error:', error);
                resultsContent.innerHTML = 
                    '<div class="scan-result error">' +
                    '<h3 class="error">❌ An unexpected error occurred. Please try again.</h3>' +
                    '</div>';
            }
        }

        function showNewScanForm() {
            document.getElementById('urlInput').focus();
        }
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
