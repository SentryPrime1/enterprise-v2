const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main page with professional dashboard UI
app.get('/', (req, res) => {
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
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
        }
        
        .sidebar {
            width: 250px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            padding: 20px;
            color: white;
        }
        
        .logo {
            display: flex;
            align-items: center;
            margin-bottom: 30px;
            font-size: 18px;
            font-weight: 600;
        }
        
        .logo::before {
            content: '🔍';
            margin-right: 10px;
            font-size: 24px;
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            margin: 5px 0;
            border-radius: 8px;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .nav-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .nav-item.active {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .nav-item::before {
            margin-right: 12px;
            font-size: 16px;
        }
        
        .nav-dashboard::before { content: '📊'; }
        .nav-scans::before { content: '🔍'; }
        .nav-analytics::before { content: '📈'; }
        .nav-team::before { content: '👥'; }
        .nav-integrations::before { content: '⭐'; }
        .nav-settings::before { content: '⚙️'; }
        
        .main-content {
            flex: 1;
            padding: 30px;
            overflow-y: auto;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
        }
        
        .welcome {
            color: white;
        }
        
        .welcome h1 {
            font-size: 32px;
            margin-bottom: 8px;
        }
        
        .welcome p {
            opacity: 0.8;
            font-size: 16px;
        }
        
        .new-scan-btn {
            background: #4f46e5;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            transition: background 0.2s;
        }
        
        .new-scan-btn:hover {
            background: #4338ca;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: rgba(255, 255, 255, 0.95);
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        
        .stat-title {
            color: #6b7280;
            font-size: 14px;
            font-weight: 500;
        }
        
        .stat-icon {
            font-size: 20px;
        }
        
        .stat-value {
            font-size: 32px;
            font-weight: 700;
            color: #111827;
            margin-bottom: 8px;
        }
        
        .stat-change {
            font-size: 14px;
            font-weight: 500;
        }
        
        .stat-change.positive {
            color: #10b981;
        }
        
        .stat-change.negative {
            color: #ef4444;
        }
        
        .scan-section {
            background: rgba(255, 255, 255, 0.95);
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            margin-bottom: 30px;
        }
        
        .section-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 20px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #374151;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.2s;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #4f46e5;
        }
        
        .scan-options {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 20px;
        }
        
        .scan-option {
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            padding: 20px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .scan-option:hover {
            border-color: #4f46e5;
        }
        
        .scan-option.selected {
            border-color: #4f46e5;
            background: #f0f9ff;
        }
        
        .option-header {
            display: flex;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .option-icon {
            margin-right: 8px;
            font-size: 18px;
        }
        
        .option-title {
            font-weight: 600;
            color: #111827;
        }
        
        .option-description {
            color: #6b7280;
            font-size: 14px;
            margin-bottom: 12px;
        }
        
        .pages-input {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .pages-input input {
            width: 60px;
            padding: 6px 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            text-align: center;
        }
        
        .scan-button {
            width: 100%;
            background: linear-gradient(135deg, #4f46e5, #7c3aed);
            color: white;
            border: none;
            padding: 16px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .scan-button:hover {
            transform: translateY(-1px);
        }
        
        .scan-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .results-section {
            background: rgba(255, 255, 255, 0.95);
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        }
        
        .results-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 20px;
        }
        
        .status-badge {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .status-success {
            background: #dcfce7;
            color: #166534;
        }
        
        .status-error {
            background: #fef2f2;
            color: #dc2626;
        }
        
        .results-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }
        
        .result-card {
            background: #f9fafb;
            padding: 16px;
            border-radius: 8px;
            border-left: 4px solid #4f46e5;
        }
        
        .result-label {
            color: #6b7280;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        
        .result-value {
            font-size: 18px;
            font-weight: 600;
            color: #111827;
        }
        
        .violations-summary {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin: 20px 0;
        }
        
        .violation-item {
            text-align: center;
            padding: 12px;
            border-radius: 8px;
            background: #f9fafb;
        }
        
        .violation-count {
            font-size: 20px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        
        .violation-label {
            font-size: 12px;
            color: #6b7280;
            text-transform: uppercase;
        }
        
        .critical { color: #dc2626; }
        .serious { color: #ea580c; }
        .moderate { color: #d97706; }
        .minor { color: #65a30d; }
        
        .page-results {
            margin-top: 20px;
        }
        
        .page-item {
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 12px;
        }
        
        .page-url {
            font-weight: 600;
            color: #4f46e5;
            margin-bottom: 8px;
        }
        
        .page-stats {
            display: flex;
            gap: 16px;
            font-size: 14px;
            color: #6b7280;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #6b7280;
        }
        
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f4f6;
            border-radius: 50%;
            border-top-color: #4f46e5;
            animation: spin 1s ease-in-out infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .error-message {
            background: #fef2f2;
            border: 1px solid #fecaca;
            color: #dc2626;
            padding: 16px;
            border-radius: 8px;
            margin: 16px 0;
        }
        
        @media (max-width: 768px) {
            body {
                flex-direction: column;
            }
            
            .sidebar {
                width: 100%;
                padding: 15px;
            }
            
            .main-content {
                padding: 20px;
            }
            
            .scan-options {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="sidebar">
        <div class="logo">
            SentryPrime<br>
            <small style="font-weight: 400; opacity: 0.8;">Enterprise Dashboard</small>
        </div>
        
        <div class="nav-item nav-dashboard active">Dashboard</div>
        <div class="nav-item nav-scans">Scans</div>
        <div class="nav-item nav-analytics">Analytics</div>
        <div class="nav-item nav-team">Team</div>
        <div class="nav-item nav-integrations">Integrations</div>
        <div class="nav-item nav-settings">Settings</div>
    </div>
    
    <div class="main-content">
        <div class="header">
            <div class="welcome">
                <h1>Welcome back, John!</h1>
                <p>Here's your accessibility compliance overview for Acme Corporation</p>
            </div>
            <button class="new-scan-btn" onclick="scrollToScan()">
                🔍 New Scan
            </button>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Total Scans</span>
                    <span class="stat-icon">📊</span>
                </div>
                <div class="stat-value">1,247</div>
                <div class="stat-change positive">↗ +12% from last month</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Average Score</span>
                    <span class="stat-icon">⭐</span>
                </div>
                <div class="stat-value">91.2%</div>
                <div class="stat-change positive">↗ +3.2% from last month</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-header">
                    <span class="stat-title">Critical Issues</span>
                    <span class="stat-icon">⚠️</span>
                </div>
                <div class="stat-value">23</div>
                <div class="stat-change negative">↘ -8 from last week</div>
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
        
        <div class="scan-section" id="scan-section">
            <h2 class="section-title">🔍 Start New Accessibility Scan</h2>
            
            <div class="form-group">
                <label class="form-label">Website URL</label>
                <input type="url" id="urlInput" class="form-input" placeholder="https://example.com" value="https://v3electric.com/">
            </div>
            
            <div class="form-group">
                <label class="form-label">Scan Type</label>
                <div class="scan-options">
                    <div class="scan-option" id="singlePageOption" onclick="selectScanType('single')">
                        <div class="option-header">
                            <span class="option-icon">⚡</span>
                            <span class="option-title">Single Page</span>
                        </div>
                        <div class="option-description">Fast scan of one page (30 seconds)</div>
                    </div>
                    
                    <div class="scan-option selected" id="multiPageOption" onclick="selectScanType('multi')">
                        <div class="option-header">
                            <span class="option-icon">🕷️</span>
                            <span class="option-title">Multi-Page Crawl</span>
                        </div>
                        <div class="option-description">Comprehensive site scan</div>
                        <div class="pages-input">
                            <span>Pages:</span>
                            <input type="number" id="pageCount" value="5" min="2" max="20">
                        </div>
                    </div>
                </div>
            </div>
            
            <button class="scan-button" id="scanButton" onclick="startScan()">
                🚀 Start Accessibility Scan
            </button>
        </div>
        
        <div class="results-section">
            <div class="results-header">
                <h2 class="section-title">Scan Results</h2>
                <span class="status-badge" id="statusBadge" style="display: none;"></span>
            </div>
            <div id="resultsContent">
                <p style="color: #6b7280; text-align: center; padding: 40px;">
                    No scans performed yet. Start a scan above to see results.
                </p>
            </div>
        </div>
    </div>

    <script>
        let currentScanType = 'multi';
        
        function scrollToScan() {
            document.getElementById('scan-section').scrollIntoView({ behavior: 'smooth' });
        }
        
        function selectScanType(type) {
            currentScanType = type;
            
            document.getElementById('singlePageOption').classList.remove('selected');
            document.getElementById('multiPageOption').classList.remove('selected');
            
            if (type === 'single') {
                document.getElementById('singlePageOption').classList.add('selected');
            } else {
                document.getElementById('multiPageOption').classList.add('selected');
            }
        }
        
        async function startScan() {
            const url = document.getElementById('urlInput').value.trim();
            const pageCount = parseInt(document.getElementById('pageCount').value) || 5;
            
            if (!url) {
                alert('Please enter a website URL');
                return;
            }
            
            // Update UI for scanning state
            const scanButton = document.getElementById('scanButton');
            const statusBadge = document.getElementById('statusBadge');
            const resultsContent = document.getElementById('resultsContent');
            
            scanButton.disabled = true;
            scanButton.innerHTML = '<span class="spinner"></span> Scanning...';
            
            statusBadge.style.display = 'inline-block';
            statusBadge.className = 'status-badge';
            statusBadge.textContent = 'SCANNING';
            statusBadge.style.background = '#fef3c7';
            statusBadge.style.color = '#92400e';
            
            resultsContent.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Scanning in progress... This may take up to 2 minutes for complex sites.</p>
                </div>
            `;
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: currentScanType,
                        pageCount: pageCount
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Network response was not ok');
                }
                
                const result = await response.json();
                displayResults(result);
                
            } catch (error) {
                console.error('Scan error:', error);
                displayError(error.message);
            } finally {
                scanButton.disabled = false;
                scanButton.innerHTML = '🚀 Start Accessibility Scan';
            }
        }
        
        function displayResults(result) {
            const statusBadge = document.getElementById('statusBadge');
            const resultsContent = document.getElementById('resultsContent');
            
            if (result.success) {
                statusBadge.className = 'status-badge status-success';
                statusBadge.textContent = result.scanType === 'single' ? 'SCAN COMPLETE' : 'CRAWL COMPLETE';
                
                let html = `
                    <div class="results-grid">
                        <div class="result-card">
                            <div class="result-label">URL</div>
                            <div class="result-value">${result.url}</div>
                        </div>
                        <div class="result-card">
                            <div class="result-label">${result.scanType === 'single' ? 'Total Issues' : 'Pages Scanned'}</div>
                            <div class="result-value">${result.scanType === 'single' ? result.totalIssues : result.pagesScanned}</div>
                        </div>
                        <div class="result-card">
                            <div class="result-label">${result.scanType === 'single' ? 'Scan Time' : 'Total Issues'}</div>
                            <div class="result-value">${result.scanType === 'single' ? result.scanTime + 'ms' : result.totalIssues}</div>
                        </div>
                        <div class="result-card">
                            <div class="result-label">${result.scanType === 'single' ? 'Timestamp' : 'Total Scan Time'}</div>
                            <div class="result-value">${result.scanType === 'single' ? new Date(result.timestamp).toLocaleTimeString() : result.totalScanTime + 'ms'}</div>
                        </div>
                    </div>
                `;
                
                if (result.violations) {
                    html += `
                        <h3 style="margin: 20px 0 12px 0;">Overall Violations by Impact:</h3>
                        <div class="violations-summary">
                            <div class="violation-item">
                                <div class="violation-count critical">${result.violations.critical || 0}</div>
                                <div class="violation-label">Critical</div>
                            </div>
                            <div class="violation-item">
                                <div class="violation-count serious">${result.violations.serious || 0}</div>
                                <div class="violation-label">Serious</div>
                            </div>
                            <div class="violation-item">
                                <div class="violation-count moderate">${result.violations.moderate || 0}</div>
                                <div class="violation-label">Moderate</div>
                            </div>
                            <div class="violation-item">
                                <div class="violation-count minor">${result.violations.minor || 0}</div>
                                <div class="violation-label">Minor</div>
                            </div>
                        </div>
                    `;
                }
                
                if (result.pageResults && result.pageResults.length > 0) {
                    html += `
                        <h3 style="margin: 20px 0 12px 0;">Results by Page:</h3>
                        <div class="page-results">
                    `;
                    
                    result.pageResults.forEach(page => {
                        html += `
                            <div class="page-item">
                                <div class="page-url">${page.url}</div>
                                <div class="page-stats">
                                    <span>Issues: ${page.issues}</span>
                                    <span>Time: ${page.scanTime}ms</span>
                                    <span>Critical: ${page.violations?.critical || 0}, Serious: ${page.violations?.serious || 0}, Moderate: ${page.violations?.moderate || 0}, Minor: ${page.violations?.minor || 0}</span>
                                </div>
                            </div>
                        `;
                    });
                    
                    html += '</div>';
                }
                
                resultsContent.innerHTML = html;
            } else {
                displayError(result.error || 'Scan failed');
            }
        }
        
        function displayError(errorMessage) {
            const statusBadge = document.getElementById('statusBadge');
            const resultsContent = document.getElementById('resultsContent');
            
            statusBadge.className = 'status-badge status-error';
            statusBadge.textContent = 'ERROR';
            
            resultsContent.innerHTML = `
                <div class="error-message">
                    ❌ Network Error: ${errorMessage}
                </div>
            `;
        }
    </script>
</body>
</html>
    `);
});

// Single page scan function (preserved from working version)
async function scanSinglePage(targetUrl) {
    let browser = null;
    
    try {
        console.log('Starting accessibility scan for: ' + targetUrl);
        
        // Launch browser with Cloud Run optimized settings
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
                '--disable-features=VizDisplayCompositor'
            ],
            timeout: 60000
        });
        
        console.log('Navigating to: ' + targetUrl);
        const page = await browser.newPage();
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.goto(targetUrl, { 
            waitUntil: 'networkidle0', 
            timeout: 90000 
        });
        
        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Inject axe-core
        await page.addScriptTag({
            content: axeCore.source
        });
        
        // Run accessibility scan
        console.log('Running axe-core accessibility scan...');
        const results = await page.evaluate(async () => {
            return await axe.run();
        });
        
        console.log('Scan completed. Found ' + results.violations.length + ' violations');
        
        // Process results
        const violationsByImpact = {
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0
        };
        
        results.violations.forEach(violation => {
            if (violationsByImpact.hasOwnProperty(violation.impact)) {
                violationsByImpact[violation.impact]++;
            }
        });
        
        return {
            success: true,
            url: targetUrl,
            totalIssues: results.violations.length,
            violations: violationsByImpact,
            scanTime: Date.now() - Date.now(),
            timestamp: new Date().toISOString(),
            scanType: 'single',
            detailedResults: results.violations
        };
        
    } catch (error) {
        console.error('Scan error:', error);
        return {
            success: false,
            error: error.message,
            url: targetUrl,
            scanType: 'single'
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Multi-page crawl function (preserved from working version)
async function crawlAndScan(targetUrl, maxPages = 5) {
    let browser = null;
    const startTime = Date.now();
    
    try {
        console.log('Starting multi-page crawl for: ' + targetUrl);
        
        // Launch browser
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
                '--disable-features=VizDisplayCompositor'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 720 });
        
        // Scan the main page first
        console.log('Scanning main page: ' + targetUrl);
        const mainPageResult = await scanPageWithBrowser(page, targetUrl);
        
        const pageResults = [mainPageResult];
        const scannedUrls = new Set([targetUrl]);
        
        // Extract links from main page
        console.log('Extracting links from main page...');
        const links = await page.evaluate((baseUrl) => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            const baseUrlObj = new URL(baseUrl);
            
            return links
                .map(link => {
                    try {
                        const href = link.getAttribute('href');
                        if (!href) return null;
                        
                        // Convert relative URLs to absolute
                        const url = new URL(href, baseUrl);
                        
                        // Only include same-domain links
                        if (url.hostname === baseUrlObj.hostname) {
                            return url.href;
                        }
                        return null;
                    } catch (e) {
                        return null;
                    }
                })
                .filter(url => url && !url.includes('#') && !url.includes('?') && !url.includes('.pdf') && !url.includes('.jpg') && !url.includes('.png'))
                .slice(0, maxPages - 1); // Reserve one slot for main page
        }, targetUrl);
        
        console.log('Found ' + links.length + ' internal links');
        
        // Scan additional pages
        for (const link of links) {
            if (pageResults.length >= maxPages) break;
            if (scannedUrls.has(link)) continue;
            
            console.log('Scanning page: ' + link);
            const pageResult = await scanPageWithBrowser(page, link);
            pageResults.push(pageResult);
            scannedUrls.add(link);
        }
        
        // Aggregate results
        const totalIssues = pageResults.reduce((sum, result) => sum + (result.issues || 0), 0);
        const totalViolations = {
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0
        };
        
        pageResults.forEach(result => {
            if (result.violations) {
                Object.keys(totalViolations).forEach(key => {
                    totalViolations[key] += result.violations[key] || 0;
                });
            }
        });
        
        const totalScanTime = Date.now() - startTime;
        
        return {
            success: true,
            url: targetUrl,
            scanType: 'multi',
            pagesScanned: pageResults.length,
            totalIssues: totalIssues,
            totalScanTime: totalScanTime,
            violations: totalViolations,
            pageResults: pageResults,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('Crawl error:', error);
        return {
            success: false,
            error: error.message,
            url: targetUrl,
            scanType: 'multi'
        };
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Helper function to scan a single page with existing browser
async function scanPageWithBrowser(page, url) {
    const pageStartTime = Date.now();
    
    try {
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 60000 
        });
        
        // Wait for page to stabilize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Inject axe-core
        await page.addScriptTag({
            content: axeCore.source
        });
        
        // Run accessibility scan
        const results = await page.evaluate(async () => {
            return await axe.run();
        });
        
        // Process results
        const violationsByImpact = {
            critical: 0,
            serious: 0,
            moderate: 0,
            minor: 0
        };
        
        results.violations.forEach(violation => {
            if (violationsByImpact.hasOwnProperty(violation.impact)) {
                violationsByImpact[violation.impact]++;
            }
        });
        
        return {
            url: url,
            issues: results.violations.length,
            violations: violationsByImpact,
            scanTime: Date.now() - pageStartTime
        };
        
    } catch (error) {
        console.error('Page scan error for ' + url + ':', error);
        return {
            url: url,
            issues: 0,
            violations: { critical: 0, serious: 0, moderate: 0, minor: 0 },
            scanTime: Date.now() - pageStartTime,
            error: error.message
        };
    }
}

// Scan endpoint (preserved functionality with proper JSON responses)
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { url, scanType = 'single', pageCount = 5 } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL is required'
            });
        }
        
        console.log('Scan request received:', { url, scanType, pageCount });
        
        let result;
        
        if (scanType === 'single') {
            result = await scanSinglePage(url);
        } else {
            result = await crawlAndScan(url, pageCount);
        }
        
        // Ensure we always return JSON
        res.setHeader('Content-Type', 'application/json');
        res.json(result);
        
    } catch (error) {
        console.error('API error:', error);
        res.setHeader('Content-Type', 'application/json');
        res.status(500).json({
            success: false,
            error: error.message || 'Internal server error'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log('SentryPrime Enterprise Scanner running on port ' + PORT);
    console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
});
