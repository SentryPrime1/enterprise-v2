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

// Main page
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>SentryPrime Enterprise Scanner</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
        .header { text-align: center; margin-bottom: 40px; }
        .scan-form { background: #f5f5f5; padding: 30px; border-radius: 8px; }
        input[type="url"] { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
        input[type="number"] { width: 100px; padding: 8px; margin: 5px; border: 1px solid #ddd; border-radius: 4px; }
        button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; margin: 5px; }
        button:hover { background: #0056b3; }
        button:disabled { background: #6c757d; cursor: not-allowed; }
        .scan-options { margin: 15px 0; padding: 15px; background: #e9ecef; border-radius: 4px; }
        .results { margin-top: 30px; padding: 20px; background: white; border-radius: 8px; }
        .loading { color: #007bff; }
        .error { color: #dc3545; }
        .success { color: #28a745; }
        .page-result { margin: 10px 0; padding: 10px; border-left: 3px solid #007bff; background: #f8f9fa; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🛡️ SentryPrime Enterprise</h1>
        <p>Professional Accessibility Scanner powered by Puppeteer + axe-core</p>
    </div>
    
    <div class="scan-form">
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
    
    <div id="results" class="results" style="display: none;">
        <h2>Scan Results</h2>
        <div id="resultsContent"></div>
    </div>
    
    <script>
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
                        // Single page results
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
                        // Multi-page crawl results
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

// Scan endpoint
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
