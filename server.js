const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Main page
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>SentryPrime Enterprise Scanner</title>
        <style>
            body { font-family: Arial, sans-serif; max-width: 1000px; margin: 50px auto; padding: 20px; }
            .header { text-align: center; margin-bottom: 40px; }
            .scan-form { background: #f5f5f5; padding: 30px; border-radius: 8px; margin-bottom: 20px; }
            .scan-options { display: flex; gap: 20px; margin: 20px 0; }
            .scan-option { flex: 1; padding: 15px; border: 2px solid #ddd; border-radius: 8px; cursor: pointer; transition: all 0.3s; }
            .scan-option:hover { border-color: #007cba; }
            .scan-option.selected { border-color: #007cba; background: #e7f3ff; }
            input[type="url"] { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
            input[type="number"] { width: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; }
            button { background: #007cba; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
            button:hover { background: #005a87; }
            button:disabled { background: #ccc; cursor: not-allowed; }
            .results { margin-top: 30px; padding: 20px; background: white; border-radius: 8px; }
            .progress { background: #f0f0f0; border-radius: 10px; margin: 10px 0; }
            .progress-bar { background: #007cba; height: 20px; border-radius: 10px; transition: width 0.3s; }
            .page-result { margin: 15px 0; padding: 15px; border-left: 4px solid #007cba; background: #f9f9f9; }
            .violation { border-left: 4px solid #ff6b6b; padding: 10px; margin: 10px 0; background: #fff5f5; }
            .summary { background: #e7f3ff; padding: 20px; border-radius: 8px; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🛡️ SentryPrime Enterprise</h1>
            <p>Professional Accessibility Scanner powered by Puppeteer + axe-core</p>
        </div>
        
        <div class="scan-form">
            <h2>Scan Website for Accessibility Issues</h2>
            
            <div class="scan-options">
                <div class="scan-option selected" onclick="selectScanType('single')">
                    <h3>📄 Single Page Scan</h3>
                    <p>Scan one specific page quickly</p>
                </div>
                <div class="scan-option" onclick="selectScanType('full')">
                    <h3>🌐 Full Website Crawl</h3>
                    <p>Crawl and scan entire website</p>
                </div>
            </div>
            
            <form id="scanForm">
                <input type="url" id="urlInput" placeholder="Enter website URL (e.g., https://example.com)" required>
                
                <div id="crawlOptions" style="display:none; margin: 15px 0; padding: 15px; background: #fff; border-radius: 4px;">
                    <label>Max pages to crawl: <input type="number" id="maxPages" value="10" min="1" max="100"></label>
                    <br><br>
                    <label>Crawl depth: <input type="number" id="maxDepth" value="3" min="1" max="5"></label>
                    <br><br>
                    <label><input type="checkbox" id="sameDomain" checked> Stay within same domain</label>
                </div>
                
                <button type="submit" id="scanButton">🔍 Start Accessibility Scan</button>
            </form>
        </div>
        
        <div id="results" class="results" style="display:none;">
            <h3>Scan Results</h3>
            <div id="progressContainer" style="display:none;">
                <p id="progressText">Scanning pages...</p>
                <div class="progress">
                    <div class="progress-bar" id="progressBar" style="width: 0%"></div>
                </div>
            </div>
            <div id="resultsContent"></div>
        </div>

        <script>
            let scanType = 'single';
            
            function selectScanType(type) {
                scanType = type;
                document.querySelectorAll('.scan-option').forEach(el => el.classList.remove('selected'));
                event.target.closest('.scan-option').classList.add('selected');
                
                const crawlOptions = document.getElementById('crawlOptions');
                crawlOptions.style.display = type === 'full' ? 'block' : 'none';
            }
            
            document.getElementById('scanForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const url = document.getElementById('urlInput').value;
                const resultsDiv = document.getElementById('results');
                const resultsContent = document.getElementById('resultsContent');
                const progressContainer = document.getElementById('progressContainer');
                const scanButton = document.getElementById('scanButton');
                
                scanButton.disabled = true;
                scanButton.textContent = 'Scanning...';
                
                resultsContent.innerHTML = '';
                resultsDiv.style.display = 'block';
                
                if (scanType === 'full') {
                    progressContainer.style.display = 'block';
                    await performFullScan(url);
                } else {
                    progressContainer.style.display = 'none';
                    await performSingleScan(url);
                }
                
                scanButton.disabled = false;
                scanButton.textContent = '🔍 Start Accessibility Scan';
            });
            
            async function performSingleScan(url) {
                const resultsContent = document.getElementById('resultsContent');
                resultsContent.innerHTML = '<p>🔄 Scanning... This may take a few moments.</p>';
                
                try {
                    const response = await fetch('/scan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url })
                    });
                    
                    const result = await response.json();
                    displaySingleResult(result);
                } catch (error) {
                    resultsContent.innerHTML = \`<p style="color: red;">❌ Network error: \${error.message}</p>\`;
                }
            }
            
            async function performFullScan(url) {
                const maxPages = parseInt(document.getElementById('maxPages').value);
                const maxDepth = parseInt(document.getElementById('maxDepth').value);
                const sameDomain = document.getElementById('sameDomain').checked;
                
                try {
                    const response = await fetch('/crawl-scan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            url: url, 
                            maxPages: maxPages,
                            maxDepth: maxDepth,
                            sameDomain: sameDomain
                        })
                    });
                    
                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        const chunk = decoder.decode(value);
                        const lines = chunk.split('\\n');
                        
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                const data = JSON.parse(line.slice(6));
                                updateProgress(data);
                            }
                        }
                    }
                } catch (error) {
                    document.getElementById('resultsContent').innerHTML = \`<p style="color: red;">❌ Network error: \${error.message}</p>\`;
                }
            }
            
            function updateProgress(data) {
                const progressText = document.getElementById('progressText');
                const progressBar = document.getElementById('progressBar');
                const resultsContent = document.getElementById('resultsContent');
                
                if (data.type === 'progress') {
                    progressText.textContent = \`Scanning page \${data.current} of \${data.total}: \${data.url}\`;
                    progressBar.style.width = \`\${(data.current / data.total) * 100}%\`;
                } else if (data.type === 'result') {
                    const pageDiv = document.createElement('div');
                    pageDiv.className = 'page-result';
                    pageDiv.innerHTML = \`
                        <h4>📄 \${data.url}</h4>
                        <p><strong>Issues Found:</strong> \${data.violations.length}</p>
                        \${data.violations.length > 0 ? 
                            data.violations.map(v => \`
                                <div class="violation">
                                    <strong>\${v.impact?.toUpperCase() || 'UNKNOWN'}</strong>: \${v.description}
                                    <br><small>Rule: \${v.id}</small>
                                </div>
                            \`).join('') 
                            : '<p style="color: green;">✅ No accessibility issues found!</p>'
                        }
                    \`;
                    resultsContent.appendChild(pageDiv);
                } else if (data.type === 'summary') {
                    document.getElementById('progressContainer').style.display = 'none';
                    const summaryDiv = document.createElement('div');
                    summaryDiv.className = 'summary';
                    summaryDiv.innerHTML = \`
                        <h3>📊 Scan Summary</h3>
                        <p><strong>Pages Scanned:</strong> \${data.totalPages}</p>
                        <p><strong>Total Issues:</strong> \${data.totalIssues}</p>
                        <p><strong>Pages with Issues:</strong> \${data.pagesWithIssues}</p>
                        <p><strong>Scan Duration:</strong> \${data.duration}</p>
                    \`;
                    resultsContent.insertBefore(summaryDiv, resultsContent.firstChild);
                }
            }
            
            function displaySingleResult(result) {
                const resultsContent = document.getElementById('resultsContent');
                
                if (result.success) {
                    const violations = result.violations || [];
                    resultsContent.innerHTML = \`
                        <h4>✅ Scan Complete</h4>
                        <p><strong>URL:</strong> \${result.url}</p>
                        <p><strong>Issues Found:</strong> \${violations.length}</p>
                        <div style="margin-top: 20px;">
                            \${violations.length > 0 ? 
                                violations.map(v => \`
                                    <div class="violation">
                                        <strong>\${v.impact?.toUpperCase() || 'UNKNOWN'}</strong>: \${v.description}
                                        <br><small>Rule: \${v.id}</small>
                                    </div>
                                \`).join('') 
                                : '<p style="color: green;">🎉 No accessibility issues found!</p>'
                            }
                        </div>
                    \`;
                } else {
                    resultsContent.innerHTML = \`<p style="color: red;">❌ Error: \${result.error}</p>\`;
                }
            }
        </script>
    </body>
    </html>
    `);
});

// Single page scan endpoint
app.post('/scan', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
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
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        await page.addScriptTag({ content: axeCore.source });
        
        const results = await page.evaluate(async () => {
            return await axe.run();
        });

        await browser.close();

        res.json({
            success: true,
            url: url,
            violations: results.violations,
            timestamp: new Date().toISOString(),
            totalIssues: results.violations.length
        });

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        
        console.error('Scan error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Full website crawl and scan endpoint
app.post('/crawl-scan', async (req, res) => {
    const { url, maxPages = 10, maxDepth = 3, sameDomain = true } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    // Set up Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });

    const startTime = Date.now();
    let browser;
    
    try {
        browser = await puppeteer.launch({
            headless: 'new',
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

        const baseUrl = new URL(url);
        const visitedUrls = new Set();
        const urlsToVisit = [{ url: url, depth: 0 }];
        const results = [];
        let totalIssues = 0;
        let pagesWithIssues = 0;

        while (urlsToVisit.length > 0 && visitedUrls.size < maxPages) {
            const { url: currentUrl, depth } = urlsToVisit.shift();
            
            if (visitedUrls.has(currentUrl) || depth > maxDepth) {
                continue;
            }

            visitedUrls.add(currentUrl);

            // Send progress update
            res.write(`data: ${JSON.stringify({
                type: 'progress',
                current: visitedUrls.size,
                total: Math.min(maxPages, visitedUrls.size + urlsToVisit.length),
                url: currentUrl
            })}\\n\\n`);

            try {
                const page = await browser.newPage();
                await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                
                // Run accessibility scan
                await page.addScriptTag({ content: axeCore.source });
                const axeResults = await page.evaluate(async () => {
                    return await axe.run();
                });

                const pageResult = {
                    url: currentUrl,
                    violations: axeResults.violations,
                    issueCount: axeResults.violations.length
                };

                results.push(pageResult);
                totalIssues += pageResult.issueCount;
                if (pageResult.issueCount > 0) pagesWithIssues++;

                // Send page result
                res.write(`data: ${JSON.stringify({
                    type: 'result',
                    ...pageResult
                })}\\n\\n`);

                // Find new links to crawl
                if (depth < maxDepth) {
                    const links = await page.evaluate(() => {
                        return Array.from(document.querySelectorAll('a[href]'))
                            .map(a => a.href)
                            .filter(href => href.startsWith('http'));
                    });

                    for (const link of links) {
                        try {
                            const linkUrl = new URL(link);
                            if (!sameDomain || linkUrl.hostname === baseUrl.hostname) {
                                if (!visitedUrls.has(link) && !urlsToVisit.some(item => item.url === link)) {
                                    urlsToVisit.push({ url: link, depth: depth + 1 });
                                }
                            }
                        } catch (e) {
                            // Invalid URL, skip
                        }
                    }
                }

                await page.close();

            } catch (error) {
                console.error(`Error scanning ${currentUrl}:`, error);
                // Continue with next URL
            }
        }

        // Send final summary
        const duration = Math.round((Date.now() - startTime) / 1000);
        res.write(`data: ${JSON.stringify({
            type: 'summary',
            totalPages: results.length,
            totalIssues: totalIssues,
            pagesWithIssues: pagesWithIssues,
            duration: `${duration}s`
        })}\\n\\n`);

        await browser.close();
        res.end();

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        
        console.error('Crawl scan error:', error);
        res.write(`data: ${JSON.stringify({
            type: 'error',
            error: error.message
        })}\\n\\n`);
        res.end();
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SentryPrime Enterprise Scanner running on port ${PORT}`);
    console.log(`📊 Ready to scan websites for accessibility issues`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully');
    process.exit(0);
});
