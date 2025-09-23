const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');

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
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
            .header { text-align: center; margin-bottom: 40px; }
            .scan-form { background: #f5f5f5; padding: 30px; border-radius: 8px; }
            input[type="url"] { width: 100%; padding: 12px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
            button { background: #007cba; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; }
            button:hover { background: #005a87; }
            .results { margin-top: 30px; padding: 20px; background: white; border-radius: 8px; }
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
                <input type="url" id="urlInput" placeholder="Enter website URL (e.g., https://example.com)" required>
                <button type="submit">🔍 Start Accessibility Scan</button>
            </form>
        </div>
        
        <div id="results" class="results" style="display:none;">
            <h3>Scan Results</h3>
            <div id="resultsContent"></div>
        </div>

        <script>
            document.getElementById('scanForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const url = document.getElementById('urlInput').value;
                const resultsDiv = document.getElementById('results');
                const resultsContent = document.getElementById('resultsContent');
                
                resultsContent.innerHTML = '<p>🔄 Scanning... This may take a few moments.</p>';
                resultsDiv.style.display = 'block';
                
                try {
                    const response = await fetch('/scan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        const violations = result.violations || [];
                        resultsContent.innerHTML = \`
                            <h4>✅ Scan Complete</h4>
                            <p><strong>URL:</strong> \${result.url}</p>
                            <p><strong>Issues Found:</strong> \${violations.length}</p>
                            <div style="margin-top: 20px;">
                                \${violations.length > 0 ? 
                                    violations.map(v => \`
                                        <div style="border-left: 4px solid #ff6b6b; padding: 10px; margin: 10px 0; background: #fff5f5;">
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
                } catch (error) {
                    resultsContent.innerHTML = \`<p style="color: red;">❌ Network error: \${error.message}</p>\`;
                }
            });
        </script>
    </body>
    </html>
    `);
});

// Scan endpoint
app.post('/scan', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }

    let browser;
    try {
        // Launch browser with Cloud Run optimized settings
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
        
        // Navigate to the URL
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        
        // Inject axe-core
        await page.addScriptTag({ content: axeCore.source });
        
        // Run accessibility scan
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
