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
