const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main page with professional dashboard UI
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>SentryPrime Enterprise Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
        }
        
        /* Sidebar */
        .sidebar {
            width: 280px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-right: 1px solid rgba(255, 255, 255, 0.2);
            padding: 30px 0;
            color: white;
        }
        
        .logo {
            padding: 0 30px 40px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            margin-bottom: 30px;
        }
        
        .logo h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 5px;
        }
        
        .logo p {
            font-size: 14px;
            opacity: 0.8;
        }
        
        .nav-item {
            padding: 15px 30px;
            cursor: pointer;
            transition: all 0.3s ease;
            border-left: 3px solid transparent;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .nav-item:hover, .nav-item.active {
            background: rgba(255, 255, 255, 0.1);
            border-left-color: #fff;
        }
        
        .nav-icon {
            width: 20px;
            height: 20px;
            opacity: 0.8;
        }
        
        /* Main Content */
        .main-content {
            flex: 1;
            padding: 40px;
            overflow-y: auto;
        }
        
        .header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 40px;
            color: white;
        }
        
        .header h1 {
            font-size: 32px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .header p {
            font-size: 16px;
            opacity: 0.9;
        }
        
        .new-scan-btn {
            background: #6366f1;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-left: auto;
        }
        
        .new-scan-btn:hover {
            background: #5855eb;
            transform: translateY(-1px);
        }
        
        /* Stats Cards */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 24px;
            margin-bottom: 40px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 24px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            transition: all 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        
        .stat-title {
            font-size: 14px;
            color: #6b7280;
            font-weight: 500;
        }
        
        .stat-icon {
            width: 24px;
            height: 24px;
            opacity: 0.6;
        }
        
        .stat-value {
            font-size: 36px;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 8px;
        }
        
        .stat-change {
            font-size: 14px;
            font-weight: 500;
        }
        
        .stat-change.positive { color: #10b981; }
        .stat-change.negative { color: #ef4444; }
        
        /* Scan Form */
        .scan-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 32px;
            margin-bottom: 32px;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .scan-section h2 {
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 24px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            color: #374151;
            margin-bottom: 8px;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 16px;
            transition: all 0.3s ease;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #6366f1;
            box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
        }
        
        .scan-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin: 20px 0;
        }
        
        .option-card {
            padding: 20px;
            border: 2px solid #e5e7eb;
            border-radius: 12px;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .option-card:hover {
            border-color: #6366f1;
        }
        
        .option-card.selected {
            border-color: #6366f1;
            background: #f0f9ff;
        }
        
        .option-title {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 4px;
        }
        
        .option-desc {
            font-size: 14px;
            color: #6b7280;
        }
        
        .page-limit {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-top: 8px;
        }
        
        .page-limit input {
            width: 60px;
            padding: 4px 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            text-align: center;
        }
        
        .scan-button {
            background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
            color: white;
            border: none;
            padding: 16px 32px;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            width: 100%;
        }
        
        .scan-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 10px 40px rgba(99, 102, 241, 0.3);
        }
        
        .scan-button:disabled {
            background: #9ca3af;
            cursor: not-allowed;
            transform: none;
        }
        
        /* Results Section */
        .results-section {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            padding: 32px;
            border: 1px solid rgba(255, 255, 255, 0.2);
            display: none;
        }
        
        .results-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
        }
        
        .results-title {
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
        }
        
        .status-badge {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .status-success {
            background: #d1fae5;
            color: #065f46;
        }
        
        .status-error {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .status-loading {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 32px;
        }
        
        .result-card {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
        }
        
        .result-value {
            font-size: 28px;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 4px;
        }
        
        .result-label {
            font-size: 14px;
            color: #6b7280;
            font-weight: 500;
        }
        
        .page-results {
            margin-top: 24px;
        }
        
        .page-result {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
        }
        
        .page-url {
            font-weight: 600;
            color: #1e40af;
            margin-bottom: 8px;
        }
        
        .page-stats {
            display: flex;
            gap: 16px;
            font-size: 14px;
            color: #6b7280;
        }
        
        @media (max-width: 768px) {
            body { flex-direction: column; }
            .sidebar { width: 100%; }
            .main-content { padding: 20px; }
            .scan-options { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <!-- Sidebar -->
    <div class="sidebar">
        <div class="logo">
            <h1>🛡️ SentryPrime</h1>
            <p>Enterprise Dashboard</p>
        </div>
        
        <div class="nav-item active">
            <span class="nav-icon">📊</span>
            <span>Dashboard</span>
        </div>
        <div class="nav-item">
            <span class="nav-icon">🔍</span>
            <span>Scans</span>
        </div>
        <div class="nav-item">
            <span class="nav-icon">📈</span>
            <span>Analytics</span>
        </div>
        <div class="nav-item">
            <span class="nav-icon">👥</span>
            <span>Team</span>
        </div>
        <div class="nav-item">
            <span class="nav-icon">⭐</span>
            <span>Integrations</span>
        </div>
        <div class="nav-item">
            <span class="nav-icon">⚙️</span>
            <span>Settings</span>
        </div>
    </div>
    
    <!-- Main Content -->
    <div class="main-content">
        <div class="header">
            <div>
                <h1>Welcome back, User!</h1>
                <p>Here's your accessibility compliance overview</p>
            </div>
            <button class="new-scan-btn" onclick="scrollToScan()">🔍 New Scan</button>
        </div>
        
        <!-- Stats Cards -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Total Scans</span>
                    <span class="stat-icon">📊</span>
                </div>
                <div class="stat-value">0</div>
                <div class="stat-change positive">Ready to start scanning</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Average Score</span>
                    <span class="stat-icon">⭐</span>
                </div>
                <div class="stat-value">--</div>
                <div class="stat-change">Run your first scan</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Critical Issues</span>
                    <span class="stat-icon">⚠️</span>
                </div>
                <div class="stat-value">--</div>
                <div class="stat-change">Awaiting scan results</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Pages Scanned</span>
                    <span class="stat-icon">👥</span>
                </div>
                <div class="stat-value">0</div>
                <div class="stat-change positive">Enterprise ready</div>
            </div>
        </div>
        
        <!-- Scan Section -->
        <div class="scan-section" id="scanSection">
            <h2>🔍 Start New Accessibility Scan</h2>
            
            <form id="scanForm">
                <div class="form-group">
                    <label class="form-label">Website URL</label>
                    <input type="url" class="form-input" id="url" placeholder="https://example.com/" required>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Scan Type</label>
                    <div class="scan-options">
                        <div class="option-card selected" onclick="selectOption('single')">
                            <div class="option-title">⚡ Single Page</div>
                            <div class="option-desc">Fast scan of one page (30 seconds)</div>
                        </div>
                        <div class="option-card" onclick="selectOption('crawl')">
                            <div class="option-title">🕷️ Multi-Page Crawl</div>
                            <div class="option-desc">Comprehensive site scan</div>
                            <div class="page-limit" style="display: none;">
                                <span>Pages:</span>
                                <input type="number" id="maxPages" value="5" min="2" max="20">
                            </div>
                        </div>
                    </div>
                </div>
                
                <button type="submit" class="scan-button" id="scanButton">
                    🚀 Start Accessibility Scan
                </button>
            </form>
        </div>
        
        <!-- Results Section -->
        <div class="results-section" id="resultsSection">
            <div class="results-header">
                <h2 class="results-title">Scan Results</h2>
                <span class="status-badge status-loading" id="statusBadge">Scanning</span>
            </div>
            
            <div id="resultsContent">
                <!-- Results will be populated here -->
            </div>
        </div>
    </div>
    
    <script>
        let selectedScanType = 'single';
        
        function selectOption(type) {
            selectedScanType = type;
            document.querySelectorAll('.option-card').forEach(card => {
                card.classList.remove('selected');
            });
            event.currentTarget.classList.add('selected');
            
            const pageLimit = document.querySelector('.page-limit');
            pageLimit.style.display = type === 'crawl' ? 'flex' : 'none';
        }
        
        function scrollToScan() {
            document.getElementById('scanSection').scrollIntoView({ behavior: 'smooth' });
        }
        
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const url = document.getElementById('url').value;
            const maxPages = document.getElementById('maxPages').value;
            const resultsSection = document.getElementById('resultsSection');
            const resultsContent = document.getElementById('resultsContent');
            const scanButton = document.getElementById('scanButton');
            const statusBadge = document.getElementById('statusBadge');
            
            // Show results section and update UI
            resultsSection.style.display = 'block';
            resultsSection.scrollIntoView({ behavior: 'smooth' });
            
            scanButton.disabled = true;
            scanButton.textContent = selectedScanType === 'single' ? '⏳ Scanning...' : '⏳ Crawling...';
            
            statusBadge.className = 'status-badge status-loading';
            statusBadge.textContent = 'Scanning';
            
            const loadingMsg = selectedScanType === 'single' 
                ? '🔄 Scanning single page... This may take up to 30 seconds.'
                : '🔄 Crawling multiple pages... This may take up to 5 minutes for ' + maxPages + ' pages.';
            
            resultsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #6b7280;">' + loadingMsg + '</div>';
            
            try {
                const requestBody = { 
                    url: url,
                    scanType: selectedScanType
                };
                
                if (selectedScanType === 'crawl') {
                    requestBody.maxPages = parseInt(maxPages);
                }
                
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody)
                });
                
                const result = await response.json();
                
                if (result.success) {
                    statusBadge.className = 'status-badge status-success';
                    statusBadge.textContent = 'Complete';
                    
                    if (selectedScanType === 'single') {
                        // Single page results
                        resultsContent.innerHTML = 
                            '<div class="results-grid">' +
                            '<div class="result-card"><div class="result-value">' + result.totalIssues + '</div><div class="result-label">Total Issues</div></div>' +
                            '<div class="result-card"><div class="result-value">' + Math.round(result.scanTime/1000) + 's</div><div class="result-label">Scan Time</div></div>' +
                            '<div class="result-card"><div class="result-value">' + result.violations.filter(function(v) { return v.impact === 'critical'; }).length + '</div><div class="result-label">Critical</div></div>' +
                            '<div class="result-card"><div class="result-value">' + result.violations.filter(function(v) { return v.impact === 'serious'; }).length + '</div><div class="result-label">Serious</div></div>' +
                            '</div>' +
                            '<div style="margin-top: 24px;"><strong>URL:</strong> ' + result.url + '</div>' +
                            '<details style="margin-top: 16px;"><summary style="cursor: pointer; font-weight: 600;">View Detailed Results</summary><pre style="background: #f3f4f6; padding: 16px; border-radius: 8px; overflow-x: auto; margin-top: 12px;">' + JSON.stringify(result.violations, null, 2) + '</pre></details>';
                    } else {
                        // Multi-page crawl results
                        let html = '<div class="results-grid">' +
                                  '<div class="result-card"><div class="result-value">' + result.pages.length + '</div><div class="result-label">Pages Scanned</div></div>' +
                                  '<div class="result-card"><div class="result-value">' + result.totalIssues + '</div><div class="result-label">Total Issues</div></div>' +
                                  '<div class="result-card"><div class="result-value">' + Math.round(result.scanTime/1000) + 's</div><div class="result-label">Total Time</div></div>' +
                                  '<div class="result-card"><div class="result-value">' + result.summary.critical + '</div><div class="result-label">Critical Issues</div></div>' +
                                  '</div>';
                        
                        // Individual page results
                        html += '<div class="page-results"><h3 style="margin-bottom: 16px; color: #1f2937;">Results by Page:</h3>';
                        result.pages.forEach(function(page) {
                            html += '<div class="page-result">' +
                                   '<div class="page-url">' + page.url + '</div>' +
                                   '<div class="page-stats">' +
                                   '<span>Issues: ' + page.violations.length + '</span>' +
                                   '<span>Time: ' + Math.round(page.scanTime/1000) + 's</span>' +
                                   '<span>Critical: ' + page.violations.filter(function(v) { return v.impact === 'critical'; }).length + '</span>' +
                                   '<span>Serious: ' + page.violations.filter(function(v) { return v.impact === 'serious'; }).length + '</span>' +
                                   '</div></div>';
                        });
                        html += '</div>';
                        
                        resultsContent.innerHTML = html;
                    }
                } else {
                    statusBadge.className = 'status-badge status-error';
                    statusBadge.textContent = 'Error';
                    resultsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">❌ Error: ' + result.error + '</div>';
                }
            } catch (error) {
                statusBadge.className = 'status-badge status-error';
                statusBadge.textContent = 'Error';
                resultsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #ef4444;">❌ Network Error: ' + error.message + '</div>';
            } finally {
                // Re-enable button
                scanButton.disabled = false;
                scanButton.textContent = '🚀 Start Accessibility Scan';
            }
        });
    </script>
</body>
</html>`;
    res.send(html);
});

// Helper function to extract links from a page
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

// Single page scan function (existing working code)
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

// Scan endpoint (UNCHANGED - preserves all working functionality)
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
        
        // Launch Puppeteer
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
            
            console.log('Single page scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
            
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
            // Multi-page crawl
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
    console.log('🚀 SentryPrime Enterprise Scanner running on port ' + PORT);
    console.log('📊 Health check: http://localhost:' + PORT + '/health');
    console.log('🔍 Scanner: http://localhost:' + PORT + '/');
});
