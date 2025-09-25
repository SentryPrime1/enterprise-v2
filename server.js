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
        button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
        button:disabled { background: #6c757d; cursor: not-allowed; }
        .results { margin-top: 30px; padding: 20px; background: white; border-radius: 8px; }
        .loading { color: #007bff; }
        .error { color: #dc3545; }
        .success { color: #28a745; }
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
            const resultsDiv = document.getElementById('results');
            const resultsContent = document.getElementById('resultsContent');
            const scanButton = document.getElementById('scanButton');
            
            // Disable button and show loading
            scanButton.disabled = true;
            scanButton.textContent = '⏳ Scanning...';
            
            resultsContent.innerHTML = '<p class="loading">🔄 Scanning in progress... This may take up to 2 minutes for complex sites.</p>';
            resultsDiv.style.display = 'block';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });
                
                const result = await response.json();
                
                if (result.success) {
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

// Scan endpoint
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const url = req.body.url;
        
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
        
        console.log('Starting accessibility scan for: ' + targetUrl);
        
        // Launch Puppeteer with extended timeouts
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
        
        const page = await browser.newPage();
        
        // Set longer timeouts for enterprise scanning
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);
        
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to: ' + targetUrl);
        
        // Try multiple navigation strategies
        try {
            await page.goto(targetUrl, { 
                waitUntil: 'networkidle0',
                timeout: 90000 
            });
        } catch (navError) {
            console.log('Network idle failed, trying domcontentloaded...');
            await page.goto(targetUrl, { 
                waitUntil: 'domcontentloaded',
                timeout: 90000 
            });
        }
        
        // Wait for page to stabilize
        await page.waitForTimeout(3000);
        
        // Inject axe-core
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
        
        const scanTime = Date.now() - startTime;
        
        console.log('Scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
        
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
