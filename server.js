const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;
app.use(express.json());

// Database connection
let db = null;

// Initialize database if configured
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    const dbConfig = {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    };

    db = new Pool(dbConfig);
    console.log('Database connection initialized');
    
    // Test connection
    db.query('SELECT NOW()')
        .then(() => console.log('Database connected successfully'))
        .catch(err => {
            console.log('Database connection failed, running in standalone mode:', err.message);
            db = null;
        });
} else {
    console.log('No database configuration found, running in standalone mode');
}

// Save scan to database
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned) {
    if (!db) return null;
    try {
        const result = await db.query(
            'INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING id',
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned || 1]
        );
        console.log('Scan saved to database with ID:', result.rows[0].id);
        return result.rows[0].id;
    } catch (error) {
        console.log('Database error saving scan:', error.message);
        return null;
    }
}

// Get recent scans
async function getRecentScans(userId, limit) {
    if (!db) {
        return [
            { id: 1, url: 'https://company.com', scan_type: 'single', total_issues: 7, created_at: '2024-09-18', score: 94 },
            { id: 2, url: 'https://company.com/products', scan_type: 'crawl', total_issues: 12, created_at: '2024-09-18', score: 87 },
            { id: 3, url: 'https://company.com/about', scan_type: 'single', total_issues: 3, created_at: '2024-09-17', score: 96 }
        ];
    }
    
    try {
        const result = await db.query(
            'SELECT id, url, scan_type, total_issues, created_at FROM scans WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
            [userId, limit || 10]
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

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone'
    });
});

// Get recent scans
app.get('/api/scans/recent', async (req, res) => {
    try {
        const scans = await getRecentScans(1); // Default user ID
        res.json({ success: true, scans });
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch scans' });
    }
});

// Scan single page
async function scanSinglePage(browser, url) {
    const page = await browser.newPage();
    
    try {
        await page.setViewport({ width: 1280, height: 720 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.addScriptTag({ content: axeCore.source });
        
        const results = await page.evaluate(() => {
            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Axe scan timeout')), 30000);
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

// Main scan endpoint
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const { url, scanType } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }
        
        let targetUrl = url;
        if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
            targetUrl = 'https://' + targetUrl;
        }
        
        console.log('Starting scan for:', targetUrl);
        
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/usr/bin/google-chrome-stable',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        
        const results = await scanSinglePage(browser, targetUrl);
        const scanTime = Date.now() - startTime;
        
        console.log('Scan completed. Found', results.violations.length, 'violations');
        
        // Save to database
        await saveScan(1, 1, targetUrl, scanType || 'single', results.violations.length, scanTime, 1);
        
        res.json({
            success: true,
            url: targetUrl,
            violations: results.violations,
            totalIssues: results.violations.length,
            scanTime: scanTime,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Scan error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Main page
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <title>SentryPrime Enterprise Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
        .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1 { color: #333; margin-bottom: 30px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 5px; font-weight: bold; }
        input[type="url"] { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 16px; }
        button { background: #007bff; color: white; padding: 12px 24px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }
        button:hover { background: #0056b3; }
        .results { margin-top: 30px; padding: 20px; background: #f8f9fa; border-radius: 4px; }
        .recent-scans { margin-top: 30px; }
        .scan-item { padding: 15px; border: 1px solid #ddd; margin-bottom: 10px; border-radius: 4px; background: white; }
        .loading { text-align: center; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🛡️ SentryPrime Enterprise Dashboard</h1>
        
        <div class="form-group">
            <label for="urlInput">Website URL:</label>
            <input type="url" id="urlInput" placeholder="https://example.com" />
        </div>
        
        <button onclick="startScan()">🔍 Start Accessibility Scan</button>
        
        <div id="results" class="results" style="display: none;"></div>
        
        <div class="recent-scans">
            <h2>Recent Scans</h2>
            <div id="recentScans">
                <div class="loading">Loading recent scans...</div>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', loadRecentScans);

        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recentScans');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => 
                        '<div class="scan-item">' +
                        '<strong>' + scan.url + '</strong><br>' +
                        'Issues: ' + scan.total_issues + ' | Score: ' + scan.score + '%' +
                        '</div>'
                    ).join('');
                } else {
                    container.innerHTML = '<p>No scans yet. Start your first scan above!</p>';
                }
            } catch (error) {
                document.getElementById('recentScans').innerHTML = '<p>Unable to load recent scans.</p>';
            }
        }

        async function startScan() {
            const url = document.getElementById('urlInput').value.trim();
            if (!url) {
                alert('Please enter a URL');
                return;
            }
            
            const resultsDiv = document.getElementById('results');
            resultsDiv.style.display = 'block';
            resultsDiv.innerHTML = '<div class="loading">Scanning ' + url + '...</div>';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    resultsDiv.innerHTML = 
                        '<h3>✅ Scan Complete</h3>' +
                        '<p><strong>URL:</strong> ' + result.url + '</p>' +
                        '<p><strong>Issues Found:</strong> ' + result.totalIssues + '</p>' +
                        '<p><strong>Scan Time:</strong> ' + (result.scanTime / 1000).toFixed(2) + 's</p>';
                    
                    setTimeout(loadRecentScans, 1000);
                } else {
                    resultsDiv.innerHTML = '<h3>❌ Scan Failed</h3><p>' + result.error + '</p>';
                }
            } catch (error) {
                resultsDiv.innerHTML = '<h3>❌ Error</h3><p>An unexpected error occurred.</p>';
            }
        }
    </script>
</body>
</html>`);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
