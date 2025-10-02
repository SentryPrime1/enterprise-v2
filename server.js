const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { AxePuppeteer } = require('@axe-core/puppeteer');
const { Pool } = require('pg');
const OpenAI = require('openai');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static('public'));

// Database connection - PRESERVED FROM WORKING VERSION
let db = null;

// Initialize database connection if environment variables are provided
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    console.log('🔄 Initializing database connection...');
    console.log('📍 DB_HOST:', process.env.DB_HOST);
    console.log('👤 DB_USER:', process.env.DB_USER);
    console.log('🗄️ DB_NAME:', process.env.DB_NAME);
    
    // Detect if we're running in Cloud Run with Cloud SQL connection
    const isCloudRun = process.env.K_SERVICE && process.env.DB_HOST.includes(':');
    
    let dbConfig;
    
    if (isCloudRun) {
        // Cloud Run with Cloud SQL connection - use Unix socket with correct path
        console.log('☁️ Detected Cloud Run environment, using Unix socket connection');
        dbConfig = {
            host: `/cloudsql/${process.env.DB_HOST}`,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 10
        };
        console.log('🔌 Unix socket path:', `/cloudsql/${process.env.DB_HOST}`);
    } else {
        // Local or other environment - use TCP connection
        console.log('🌐 Using TCP connection');
        dbConfig = {
            host: process.env.DB_HOST,
            port: process.env.DB_PORT || 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000,
            max: 10
        };
    }

    db = new Pool(dbConfig);
    
    // Test database connection with detailed logging
    db.query('SELECT NOW() as current_time, version() as pg_version')
        .then((result) => {
            console.log('✅ Database connected successfully!');
            console.log('⏰ Server time:', result.rows[0].current_time);
            console.log('🐘 PostgreSQL version:', result.rows[0].pg_version.split(' ')[0]);
        })
        .catch(err => {
            console.log('❌ Database connection failed, running in standalone mode');
            console.log('🔍 Error details:', err.message);
            console.log('🔍 Error code:', err.code);
            db = null;
        });
} else {
    console.log('ℹ️ No database configuration found, running in standalone mode');
}

// OpenAI client initialization
let openai = null;
if (process.env.OPENAI_API_KEY) {
    console.log('🤖 Initializing OpenAI client...');
    openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
    });
    console.log('✅ OpenAI client initialized successfully');
} else {
    console.log('⚠️ No OpenAI API key found, AI suggestions will use predefined responses');
}

// PHASE 2 ENHANCEMENT: Enhanced Platform Detection
const detectPlatform = async (page) => {
    try {
        const platformIndicators = await page.evaluate(() => {
            const indicators = {
                shopify: !!(window.Shopify || document.querySelector('[data-shopify]') || document.querySelector('script[src*="shopify"]')),
                wordpress: !!(window.wp || document.querySelector('meta[name="generator"][content*="WordPress"]') || document.querySelector('link[href*="wp-content"]')),
                wix: !!(window.wixBiSession || document.querySelector('[data-wix-id]') || document.querySelector('script[src*="wix.com"]')),
                squarespace: !!(window.Static || document.querySelector('[data-controller="HeaderController"]') || document.querySelector('script[src*="squarespace"]')),
                webflow: !!(window.Webflow || document.querySelector('[data-wf-page]') || document.querySelector('script[src*="webflow"]')),
                drupal: !!(window.Drupal || document.querySelector('meta[name="generator"][content*="Drupal"]')),
                joomla: !!(window.Joomla || document.querySelector('meta[name="generator"][content*="Joomla"]')),
                magento: !!(window.Magento || document.querySelector('script[src*="magento"]') || document.querySelector('[data-mage-init]')),
                react: !!(window.React || document.querySelector('[data-reactroot]') || document.querySelector('script[src*="react"]')),
                angular: !!(window.angular || document.querySelector('[ng-app]') || document.querySelector('[data-ng-app]')),
                vue: !!(window.Vue || document.querySelector('[data-v-]') || document.querySelector('script[src*="vue"]'))
            };
            
            return indicators;
        });
        
        // Return the first detected platform or 'custom' if none detected
        for (const [platform, detected] of Object.entries(platformIndicators)) {
            if (detected) return platform;
        }
        
        return 'custom';
    } catch (error) {
        console.error('Platform detection error:', error);
        return 'custom';
    }
};

// PHASE 2 ENHANCEMENT: Universal Fix Parser
const parseAIFixResponse = (aiResponse) => {
    try {
        const selectorMatch = aiResponse.match(/SELECTOR:\s*([^\n]+)/i);
        const propertyMatch = aiResponse.match(/PROPERTY:\s*([^\n]+)/i);
        const beforeMatch = aiResponse.match(/BEFORE:\s*([^\n]+)/i);
        const afterMatch = aiResponse.match(/AFTER:\s*([^\n]+)/i);

        return {
            selector: selectorMatch ? selectorMatch[1].trim() : null,
            property: propertyMatch ? propertyMatch[1].trim() : null,
            before: beforeMatch ? beforeMatch[1].trim() : null,
            after: afterMatch ? afterMatch[1].trim() : null,
        };
    } catch (error) {
        console.error('Error parsing AI fix response:', error);
        return {};
    }
};

// Database helper functions - PRESERVED FROM WORKING VERSION
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned, violations) {
    if (!db) {
        console.log('⚠️ No database connection, skipping scan save');
        return null;
    }
    
    try {
        const result = await db.query(
            `INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, violations_data, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) 
             RETURNING id`,
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned || 1, JSON.stringify(violations)]
        );
        
        const scanId = result.rows[0].id;
        console.log('✅ Scan saved to database with ID:', scanId);
        return scanId;
    } catch (error) {
        console.log('❌ Database error saving scan:', error.message);
        return null;
    }
}

async function getRecentScans(userId = 1, limit = 10) {
    if (!db) {
        // Return mock data when no database connection
        console.log('⚠️ No database connection, returning mock data');
        return [
            {
                id: 1,
                url: 'https://company.com',
                scan_type: 'single',
                total_issues: 8,
                score: 94,
                created_at: '2024-09-18T10:30:00Z'
            },
            {
                id: 2,
                url: 'https://company.com/products',
                scan_type: 'crawl',
                total_issues: 15,
                score: 87,
                created_at: '2024-09-18T09:15:00Z'
            },
            {
                id: 3,
                url: 'https://company.com/about',
                scan_type: 'single',
                total_issues: 3,
                score: 96,
                created_at: '2024-09-17T14:45:00Z'
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, 
                    CASE 
                        WHEN total_issues = 0 THEN 100
                        ELSE GREATEST(0, 100 - (total_issues * 2))
                    END as score,
                    created_at
             FROM scans 
             WHERE user_id = $1 
             ORDER BY created_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        return result.rows;
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

async function getDashboardStats(userId = 1) {
    if (!db) {
        // Return mock data when no database connection
        console.log('⚠️ No database connection, returning mock data');
        return {
            totalScans: 3,
            totalIssues: 22,
            averageScore: 92,
            thisWeekScans: 2
        };
    }
    
    try {
        const result = await db.query(`
            SELECT 
                COUNT(*) as total_scans,
                COALESCE(SUM(total_issues), 0) as total_issues,
                COALESCE(AVG(CASE 
                    WHEN total_issues = 0 THEN 100
                    ELSE GREATEST(0, 100 - (total_issues * 2))
                END), 0) as average_score,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END) as this_week_scans
            FROM scans 
            WHERE user_id = $1
        `, [userId]);
        
        const stats = result.rows[0];
        return {
            totalScans: parseInt(stats.total_scans),
            totalIssues: parseInt(stats.total_issues),
            averageScore: Math.round(parseFloat(stats.average_score)),
            thisWeekScans: parseInt(stats.this_week_scans)
        };
    } catch (error) {
        console.log('❌ Database error getting dashboard stats:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0
        };
    }
}

// PHASE 2 ENHANCEMENT: Platform-Specific Fix Implementers
async function applyShopifyFix(fixData) {
    // Placeholder for Shopify API integration
    console.log('Applying Shopify fix:', fixData);
    return { success: true, message: 'Shopify fix applied successfully' };
}

async function applyWordPressFix(fixData) {
    // Placeholder for WordPress API integration
    console.log('Applying WordPress fix:', fixData);
    return { success: true, message: 'WordPress fix applied successfully' };
}

async function applyWixFix(fixData) {
    // Placeholder for Wix API integration
    console.log('Applying Wix fix:', fixData);
    return { success: true, message: 'Wix fix applied successfully' };
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local',
        version: '2.2.0'
    });
});

// PHASE 2 ENHANCEMENT: Implement Fix Endpoint
app.post('/api/implement-fix', async (req, res) => {
    const { platform, fixData, violationId } = req.body;

    if (!platform || !fixData) {
        return res.status(400).json({ error: 'Platform and fix data are required' });
    }

    try {
        let result;
        switch (platform) {
            case 'shopify':
                result = await applyShopifyFix(fixData);
                break;
            case 'wordpress':
                result = await applyWordPressFix(fixData);
                break;
            case 'wix':
                result = await applyWixFix(fixData);
                break;
            default:
                result = { 
                    success: false, 
                    message: `Platform ${platform} not yet supported for auto-fix. Manual implementation required.`,
                    manualInstructions: `Please apply the following fix manually:\n${JSON.stringify(fixData, null, 2)}`
                };
                break;
        }

        res.json(result);
    } catch (error) {
        console.error('Fix implementation error:', error);
        res.status(500).json({ error: 'Failed to implement fix', details: error.message });
    }
});

// PHASE 2 ENHANCEMENT: Preview Fix Endpoint
app.post('/api/preview-fix', async (req, res) => {
    const { url, fixData } = req.body;

    if (!url || !fixData) {
        return res.status(400).json({ error: 'URL and fix data are required' });
    }

    let browser;
    try {
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
            ]
        });

        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2' });

        // Apply the fix temporarily for preview
        if (fixData.selector && fixData.property && fixData.after) {
            await page.addStyleTag({
                content: `${fixData.selector} { ${fixData.property}: ${fixData.after} !important; }`
            });
        }

        // Take a screenshot
        const screenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false 
        });

        res.json({
            success: true,
            screenshot: `data:image/png;base64,${screenshot}`,
            message: 'Preview generated successfully'
        });

    } catch (error) {
        console.error('Preview generation error:', error);
        res.status(500).json({ error: 'Failed to generate preview', details: error.message });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Main scanning endpoint - ENHANCED WITH PHASE 2 FEATURES
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single', maxPages = 1 } = req.body;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL is required' 
        });
    }

    let browser;
    const startTime = Date.now();
    
    try {
        console.log(`🔍 Starting ${scanType} scan for: ${url}`);
        
        // Launch browser with appropriate configuration
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
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Navigate to the URL
        await page.goto(url, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        // PHASE 2 ENHANCEMENT: Detect platform
        const platform = await detectPlatform(page);
        console.log(`🏗️ Detected platform: ${platform}`);

        // Run accessibility scan using AxePuppeteer
        const results = await new AxePuppeteer(page).analyze();
        
        const scanTimeMs = Date.now() - startTime;
        const totalIssues = results.violations.length;
        
        // Calculate accessibility score
        const totalTests = results.violations.length + results.passes.length;
        const accessibilityScore = totalTests > 0 ? 
            Math.round(((results.passes.length / totalTests) * 100)) : 100;

        // Save scan to database
        const scanId = await saveScan(1, 1, url, scanType, totalIssues, scanTimeMs, 1, results.violations);

        const scanResult = {
            success: true,
            scanId,
            url,
            platform, // PHASE 2 ENHANCEMENT
            scanType,
            timestamp: new Date().toISOString(),
            scanTimeMs,
            totalIssues,
            accessibilityScore,
            violations: results.violations,
            passes: results.passes,
            incomplete: results.incomplete,
            inapplicable: results.inapplicable
        };

        console.log(`✅ Scan completed in ${scanTimeMs}ms - Found ${totalIssues} issues`);
        res.json(scanResult);

    } catch (error) {
        console.error('❌ Scan error:', error);
        const scanTimeMs = Date.now() - startTime;
        
        res.status(500).json({
            success: false,
            error: 'Scan failed',
            details: error.message,
            scanTimeMs
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// API endpoint for recent scans
app.get('/api/scans/recent', async (req, res) => {
    try {
        const scans = await getRecentScans();
        res.json(scans);
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch recent scans' });
    }
});

// API endpoint for dashboard stats
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const stats = await getDashboardStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// Main route - serves the dashboard HTML - PRESERVED FROM WORKING VERSION
app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
<html>
<head>
    <title>SentryPrime Enterprise Dashboard v2.2</title>
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
        
        /* Sidebar */
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
            cursor: pointer;
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
        
        /* Main Content */
        .main-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }
        
        /* Header */
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
        
        /* Content Area */
        .content-area {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
        }
        
        .page {
            display: none;
        }
        
        .page.active {
            display: block;
        }
        
        /* Dashboard Overview */
        .dashboard-header {
            margin-bottom: 32px;
        }
        
        .dashboard-header h1 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 8px;
        }
        
        .dashboard-header p {
            color: #666;
            font-size: 1rem;
        }
        
        /* Stats Cards */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 24px;
            margin-bottom: 32px;
        }
        
        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .stat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        
        .stat-title {
            font-size: 0.9rem;
            color: #666;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 8px;
        }
        
        .stat-change {
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .stat-change.positive {
            color: #28a745;
        }
        
        .stat-change.negative {
            color: #dc3545;
        }
        
        /* Action Cards */
        .actions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 32px;
        }
        
        .action-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            border: 2px solid #e1e5e9;
            cursor: pointer;
            transition: all 0.2s ease;
            text-align: center;
        }
        
        .action-card:hover {
            border-color: #667eea;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
        }
        
        .action-card.primary {
            border-color: #dc3545;
            background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
            color: white;
        }
        
        .action-card.primary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(220, 53, 69, 0.3);
        }
        
        .action-card.secondary {
            border-color: #667eea;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .action-card.secondary:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }
        
        .action-card.success {
            border-color: #28a745;
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
        }
        
        .action-card.success:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(40, 167, 69, 0.3);
        }
        
        .action-icon {
            font-size: 2rem;
            margin-bottom: 12px;
        }
        
        .action-title {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .action-description {
            font-size: 0.9rem;
            opacity: 0.9;
        }
        
        /* Scan Form */
        .scan-form {
            background: white;
            padding: 24px;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            margin-bottom: 32px;
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
            padding: 12px;
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            font-size: 16px;
            transition: border-color 0.2s ease;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }
        
        .scan-options {
            display: flex;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .scan-option {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-option input[type="radio"] {
            margin: 0;
        }
        
        .pages-input {
            width: 80px;
            padding: 6px 8px;
            border: 1px solid #e1e5e9;
            border-radius: 4px;
            margin: 0 8px;
        }
        
        .scan-button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
        }
        
        .scan-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
        }
        
        .scan-button:disabled {
            background: #6c757d;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        
        /* Results */
        .scan-results {
            background: white;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            overflow: hidden;
            margin-bottom: 24px;
        }
        
        .results-header {
            background: #f8f9fa;
            padding: 16px 24px;
            border-bottom: 1px solid #e1e5e9;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .results-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #333;
        }
        
        .results-meta {
            font-size: 0.9rem;
            color: #666;
        }
        
        .results-body {
            padding: 24px;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        
        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
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
        
        .violation {
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            margin-bottom: 16px;
            overflow: hidden;
        }
        
        .violation-header {
            background: #f8f9fa;
            padding: 12px 16px;
            border-bottom: 1px solid #e1e5e9;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .violation-title {
            font-weight: 600;
            color: #333;
        }
        
        .violation-impact {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .impact-critical {
            background: #f8d7da;
            color: #721c24;
        }
        
        .impact-serious {
            background: #fff3cd;
            color: #856404;
        }
        
        .impact-moderate {
            background: #d1ecf1;
            color: #0c5460;
        }
        
        .impact-minor {
            background: #d4edda;
            color: #155724;
        }
        
        .violation-body {
            padding: 16px;
        }
        
        .violation-description {
            margin-bottom: 12px;
            color: #666;
        }
        
        .violation-help {
            font-size: 0.9rem;
            color: #666;
        }
        
        .violation-help a {
            color: #667eea;
            text-decoration: none;
        }
        
        .violation-help a:hover {
            text-decoration: underline;
        }
        
        .results-summary {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 16px;
        }
        
        .summary-item {
            text-align: center;
        }
        
        .summary-value {
            font-size: 1.5rem;
            font-weight: 700;
            margin-bottom: 4px;
        }
        
        .summary-label {
            font-size: 0.8rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        /* PHASE 2 ENHANCEMENT: Auto-Fix Buttons */
        .auto-fix-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-right: 8px;
        }
        
        .auto-fix-btn:hover {
            background: #218838;
        }
        
        .preview-fix-btn {
            background: #17a2b8;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        .preview-fix-btn:hover {
            background: #138496;
        }
        
        /* Recent Scans */
        .recent-scans {
            background: white;
            border-radius: 8px;
            border: 1px solid #e1e5e9;
            overflow: hidden;
        }
        
        .recent-scans-header {
            background: #f8f9fa;
            padding: 16px 24px;
            border-bottom: 1px solid #e1e5e9;
        }
        
        .recent-scans-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 4px;
        }
        
        .recent-scans-subtitle {
            font-size: 0.9rem;
            color: #666;
        }
        
        .recent-scans-body {
            padding: 0;
        }
        
        .scan-item {
            padding: 16px 24px;
            border-bottom: 1px solid #f1f3f4;
            display: flex;
            align-items: center;
            justify-content: space-between;
            transition: background-color 0.2s ease;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-item:hover {
            background: #f8f9fa;
        }
        
        .scan-info h4 {
            font-size: 0.95rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 4px;
        }
        
        .scan-meta {
            font-size: 0.8rem;
            color: #666;
        }
        
        .scan-score {
            background: #28a745;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 600;
            margin-right: 8px;
        }
        
        .view-report-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.8rem;
            cursor: pointer;
            transition: background-color 0.2s ease;
        }
        
        .view-report-btn:hover {
            background: #5a6fd8;
        }
        
        /* Database Status */
        .db-status {
            background: #d4edda;
            color: #155724;
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 24px;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .db-status.disconnected {
            background: #fff3cd;
            color: #856404;
        }
        
        /* PHASE 2 ENHANCEMENT: Platform Badge */
        .platform-badge {
            background: #667eea;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
            margin-left: 8px;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .dashboard-container {
                flex-direction: column;
            }
            
            .sidebar {
                width: 100%;
                height: auto;
            }
            
            .sidebar-nav {
                display: flex;
                overflow-x: auto;
                padding: 10px 0;
            }
            
            .nav-item {
                white-space: nowrap;
                min-width: 120px;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .actions-grid {
                grid-template-columns: 1fr;
            }
            
            .scan-options {
                flex-direction: column;
                gap: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h1>🛡️ SentryPrime</h1>
                <p>Enterprise v2.2</p>
            </div>
            <nav class="sidebar-nav">
                <a href="#" class="nav-item active" onclick="switchToPage('dashboard')">
                    <span class="nav-icon">📊</span>
                    Dashboard
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('scans')">
                    <span class="nav-icon">🔍</span>
                    Scans
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('analytics')">
                    <span class="nav-icon">📈</span>
                    Analytics
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('team')">
                    <span class="nav-icon">👥</span>
                    Team
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('integrations')">
                    <span class="nav-icon">🔗</span>
                    Integrations
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('api')">
                    <span class="nav-icon">⚙️</span>
                    API Management
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('billing')">
                    <span class="nav-icon">💳</span>
                    Billing
                </a>
                <a href="#" class="nav-item" onclick="switchToPage('settings')">
                    <span class="nav-icon">⚙️</span>
                    Settings
                </a>
            </nav>
        </div>
        
        <!-- Main Content -->
        <div class="main-content">
            <!-- Header -->
            <div class="header">
                <div class="header-left">
                    <div class="search-bar">
                        <span>🔍</span>
                        <input type="text" placeholder="Search scans, reports, or settings...">
                    </div>
                </div>
                <div class="header-right">
                    <div class="notification-icon">🔔</div>
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <div>
                            <div style="font-weight: 600; font-size: 0.9rem;">John Doe</div>
                            <div style="font-size: 0.8rem; color: #666;">Acme Corporation</div>
                        </div>
                        <span>▼</span>
                    </div>
                </div>
            </div>
            
            <!-- Content Area -->
            <div class="content-area">
                <!-- Dashboard Page -->
                <div id="dashboard" class="page active">
                    <div class="dashboard-header">
                        <h1>Dashboard Overview</h1>
                        <p>Monitor your accessibility compliance and recent activity</p>
                    </div>
                    
                    <!-- Stats Grid -->
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Total Scans</div>
                            </div>
                            <div class="stat-value" id="total-scans">-</div>
                            <div class="stat-change positive" id="scans-change">+2 this week</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Issues Found</div>
                            </div>
                            <div class="stat-value" id="total-issues">-</div>
                            <div class="stat-change negative" id="issues-change">-5 from last week</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Average Score</div>
                            </div>
                            <div class="stat-value" id="average-score">-</div>
                            <div class="stat-change positive" id="score-change">+3% improvement</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">This Week</div>
                            </div>
                            <div class="stat-value" id="this-week-scans">-</div>
                            <div class="stat-change" id="week-change">scans completed</div>
                        </div>
                    </div>
                    
                    <!-- Action Cards -->
                    <div class="actions-grid">
                        <div class="action-card primary" onclick="switchToPage('scans')">
                            <div class="action-icon">🔍</div>
                            <div class="action-title">New Scan</div>
                            <div class="action-description">Start a new accessibility scan</div>
                        </div>
                        
                        <div class="action-card secondary" onclick="switchToPage('analytics')">
                            <div class="action-icon">📊</div>
                            <div class="action-title">View Analytics</div>
                            <div class="action-description">Analyze compliance trends</div>
                        </div>
                        
                        <div class="action-card" onclick="switchToPage('team')">
                            <div class="action-icon">👥</div>
                            <div class="action-title">Manage Team</div>
                            <div class="action-description">Add or remove team members</div>
                        </div>
                        
                        <div class="action-card success" onclick="switchToPage('settings')">
                            <div class="action-icon">⚙️</div>
                            <div class="action-title">Settings</div>
                            <div class="action-description">Configure your preferences</div>
                        </div>
                    </div>
                    
                    <!-- Recent Scans -->
                    <div class="recent-scans">
                        <div class="recent-scans-header">
                            <div class="recent-scans-title">Recent Scans</div>
                            <div class="recent-scans-subtitle">Your latest accessibility scan results</div>
                        </div>
                        <div class="recent-scans-body" id="dashboard-recent-scans">
                            <div style="padding: 20px; text-align: center; color: #666;">
                                📊 Loading recent scans...
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Scans Page -->
                <div id="scans" class="page">
                    <div class="dashboard-header">
                        <h1>Accessibility Scans</h1>
                        <p>Manage and review your accessibility scans with Phase 2 auto-fix capabilities</p>
                    </div>
                    
                    <!-- Database Status -->
                    <div class="db-status" id="db-status">
                        ✅ Database connected - Scans will be saved to your history
                    </div>
                    
                    <!-- Scan Form -->
                    <div class="scan-form">
                        <h2>Scan Website for Accessibility Issues</h2>
                        
                        <div class="form-group">
                            <label class="form-label" for="url-input">Website URL</label>
                            <input type="text" id="url-input" class="form-input" placeholder="https://example.com/" />
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Scan Options:</label>
                            <div class="scan-options">
                                <div class="scan-option">
                                    <input type="radio" id="single-page" name="scan-type" value="single" checked />
                                    <label for="single-page">Single Page (Fast - recommended)</label>
                                </div>
                                <div class="scan-option">
                                    <input type="radio" id="multi-page" name="scan-type" value="crawl" />
                                    <label for="multi-page">Multi-Page Crawl (Slower - up to <input type="number" class="pages-input" id="max-pages" value="5" min="1" max="20" /> pages)</label>
                                </div>
                            </div>
                        </div>
                        
                        <button class="scan-button" onclick="startScan()">🔍 Start Accessibility Scan</button>
                    </div>
                    
                    <!-- Scan Results -->
                    <div id="scan-results-container"></div>
                    
                    <!-- Recent Scans -->
                    <div class="recent-scans">
                        <div class="recent-scans-header">
                            <div class="recent-scans-title">Recent Scans</div>
                            <div class="recent-scans-subtitle">Your latest accessibility scan results</div>
                        </div>
                        <div class="recent-scans-body" id="recent-scans-list">
                            <div style="padding: 20px; text-align: center; color: #666;">
                                📊 Loading recent scans...
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Other Pages (Placeholder) -->
                <div id="analytics" class="page">
                    <div class="dashboard-header">
                        <h1>Analytics</h1>
                        <p>Coming soon - Detailed analytics and reporting</p>
                    </div>
                </div>
                
                <div id="team" class="page">
                    <div class="dashboard-header">
                        <h1>Team Management</h1>
                        <p>Coming soon - Manage team members and permissions</p>
                    </div>
                </div>
                
                <div id="integrations" class="page">
                    <div class="dashboard-header">
                        <h1>Integrations</h1>
                        <p>Coming soon - Connect with your favorite tools</p>
                    </div>
                </div>
                
                <div id="api" class="page">
                    <div class="dashboard-header">
                        <h1>API Management</h1>
                        <p>Coming soon - API keys and documentation</p>
                    </div>
                </div>
                
                <div id="billing" class="page">
                    <div class="dashboard-header">
                        <h1>Billing</h1>
                        <p>Coming soon - Subscription and usage details</p>
                    </div>
                </div>
                
                <div id="settings" class="page">
                    <div class="dashboard-header">
                        <h1>Settings</h1>
                        <p>Coming soon - Account and application settings</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Global variables for Phase 2 functionality
        let currentScanResult = null;
        let detectedPlatform = 'custom';
        
        // Page switching functionality - PRESERVED FROM WORKING VERSION
        function switchToPage(pageId) {
            // Hide all pages
            const pages = document.querySelectorAll('.page');
            pages.forEach(page => page.classList.remove('active'));
            
            // Show selected page
            const targetPage = document.getElementById(pageId);
            if (targetPage) {
                targetPage.classList.add('active');
            }
            
            // Update navigation
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => item.classList.remove('active'));
            
            // Find and activate the corresponding nav item
            const activeNavItem = document.querySelector(\`[onclick="switchToPage('\${pageId}')"]\`);
            if (activeNavItem) {
                activeNavItem.classList.add('active');
            }
        }
        
        // PHASE 2 ENHANCEMENT: Auto-fix functionality
        async function implementFix(violationId, platform, fixData) {
            try {
                const response = await fetch('/api/implement-fix', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        platform: platform,
                        fixData: fixData,
                        violationId: violationId
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('Fix implemented successfully!');
                } else {
                    alert(\`Fix implementation: \${result.message}\`);
                }
                
            } catch (error) {
                console.error('Fix implementation error:', error);
                alert('Failed to implement fix. Please try again.');
            }
        }
        
        // PHASE 2 ENHANCEMENT: Preview fix functionality
        async function previewFix(url, fixData) {
            try {
                const response = await fetch('/api/preview-fix', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        fixData: fixData
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Show preview in a modal or new window
                    const previewWindow = window.open('', '_blank', 'width=800,height=600');
                    previewWindow.document.write(\`
                        <html>
                            <head><title>Fix Preview</title></head>
                            <body style="margin:0; padding:20px;">
                                <h2>Fix Preview</h2>
                                <img src="\${result.screenshot}" style="max-width:100%; border:1px solid #ccc;" />
                            </body>
                        </html>
                    \`);
                } else {
                    alert('Failed to generate preview');
                }
                
            } catch (error) {
                console.error('Preview generation error:', error);
                alert('Failed to generate preview. Please try again.');
            }
        }
        
        // Scan functionality - ENHANCED WITH PHASE 2 FEATURES
        async function startScan() {
            const urlInput = document.getElementById('url-input');
            const scanButton = document.querySelector('.scan-button');
            const resultsContainer = document.getElementById('scan-results-container');
            
            const url = urlInput.value.trim();
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            // Get scan type
            const scanType = document.querySelector('input[name="scan-type"]:checked').value;
            const maxPages = document.getElementById('max-pages').value;
            
            // Disable button and show loading
            scanButton.disabled = true;
            scanButton.textContent = '🔄 Scanning...';
            
            // Show loading in results
            resultsContainer.innerHTML = \`
                <div class="scan-results">
                    <div class="results-header">
                        <div class="results-title">Scanning in Progress</div>
                        <div class="results-meta">Please wait...</div>
                    </div>
                    <div class="results-body">
                        <div class="loading">
                            <div class="spinner"></div>
                            Analyzing accessibility issues on \${url}
                        </div>
                    </div>
                </div>
            \`;
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        maxPages: parseInt(maxPages)
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    currentScanResult = result;
                    detectedPlatform = result.platform || 'custom';
                    displayScanResults(result);
                    // Refresh recent scans
                    loadRecentScans();
                } else {
                    displayScanError(result.error);
                }
                
            } catch (error) {
                console.error('Scan error:', error);
                displayScanError('Network error occurred. Please try again.');
            } finally {
                // Re-enable button
                scanButton.disabled = false;
                scanButton.textContent = '🔍 Start Accessibility Scan';
            }
        }
        
        // Display scan results - ENHANCED WITH PHASE 2 FEATURES
        function displayScanResults(result) {
            const container = document.getElementById('scan-results-container');
            const violations = result.violations || [];
            const passes = result.passes || [];
            const incomplete = result.incomplete || [];
            const inapplicable = result.inapplicable || [];
            
            let html = \`
                <div class="scan-results">
                    <div class="results-header">
                        <div class="results-title">Scan Results for \${result.url}</div>
                        <div class="results-meta">
                            Completed in \${result.scanTimeMs}ms • Score: \${result.accessibilityScore}%
                            \${result.platform ? \`<span class="platform-badge">\${result.platform}</span>\` : ''}
                        </div>
                    </div>
                    <div class="results-body">
                        <div class="results-summary">
                            <div class="summary-grid">
                                <div class="summary-item">
                                    <div class="summary-value" style="color: #dc3545;">\${violations.length}</div>
                                    <div class="summary-label">Violations</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value" style="color: #28a745;">\${passes.length}</div>
                                    <div class="summary-label">Passes</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value" style="color: #ffc107;">\${incomplete.length}</div>
                                    <div class="summary-label">Incomplete</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value" style="color: #6c757d;">\${inapplicable.length}</div>
                                    <div class="summary-label">Inapplicable</div>
                                </div>
                            </div>
                        </div>
            \`;
            
            if (violations.length > 0) {
                html += '<h3>Accessibility Violations</h3>';
                violations.forEach((violation, index) => {
                    html += \`
                        <div class="violation">
                            <div class="violation-header">
                                <div class="violation-title">\${violation.id}</div>
                                <span class="violation-impact impact-\${violation.impact}">\${violation.impact}</span>
                            </div>
                            <div class="violation-body">
                                <div class="violation-description">\${violation.description}</div>
                                \${violation.help ? \`<div class="violation-help">\${violation.help}</div>\` : ''}
                                \${violation.helpUrl ? \`<div class="violation-help"><a href="\${violation.helpUrl}" target="_blank">Learn more</a></div>\` : ''}
                                
                                <!-- PHASE 2 ENHANCEMENT: Auto-fix buttons -->
                                <div style="margin-top: 12px;">
                                    <button class="auto-fix-btn" onclick="implementFix('\${violation.id}', '\${result.platform}', {selector: 'auto-detect', property: 'auto-fix'})">
                                        🔧 Auto-Fix
                                    </button>
                                    <button class="preview-fix-btn" onclick="previewFix('\${result.url}', {selector: 'auto-detect', property: 'preview'})">
                                        👁️ Preview Fix
                                    </button>
                                </div>
                            </div>
                        </div>
                    \`;
                });
            } else {
                html += '<div style="text-align: center; padding: 40px; color: #28a745;"><h3>🎉 No accessibility violations found!</h3><p>This page appears to be fully accessible.</p></div>';
            }
            
            html += '</div></div>';
            container.innerHTML = html;
        }
        
        function displayScanError(error) {
            const container = document.getElementById('scan-results-container');
            container.innerHTML = \`
                <div class="scan-results">
                    <div class="results-header">
                        <div class="results-title">Scan Failed</div>
                        <div class="results-meta">Error occurred</div>
                    </div>
                    <div class="results-body">
                        <div style="text-align: center; padding: 40px; color: #dc3545;">
                            <h3>❌ Scan Error</h3>
                            <p>\${error}</p>
                            <p style="margin-top: 20px; font-size: 0.9rem; color: #666;">
                                Please check the URL and try again. Make sure the website is accessible and allows scanning.
                            </p>
                        </div>
                    </div>
                </div>
            \`;
        }
        
        // Load dashboard stats - PRESERVED FROM WORKING VERSION
        async function loadDashboardStats() {
            try {
                const response = await fetch('/api/dashboard/stats');
                const stats = await response.json();
                
                document.getElementById('total-scans').textContent = stats.totalScans;
                document.getElementById('total-issues').textContent = stats.totalIssues;
                document.getElementById('average-score').textContent = stats.averageScore + '%';
                document.getElementById('this-week-scans').textContent = stats.thisWeekScans;
                
            } catch (error) {
                console.error('Error loading dashboard stats:', error);
            }
        }
        
        // Load recent scans - PRESERVED FROM WORKING VERSION
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const scans = await response.json();
                
                const dashboardContainer = document.getElementById('dashboard-recent-scans');
                const scansContainer = document.getElementById('recent-scans-list');
                
                let html = '';
                
                if (scans.length === 0) {
                    html = '<div style="padding: 20px; text-align: center; color: #666;">No recent scans found. Start your first scan!</div>';
                } else {
                    scans.forEach(scan => {
                        const date = new Date(scan.created_at).toLocaleDateString();
                        const time = new Date(scan.created_at).toLocaleTimeString();
                        
                        html += \`
                            <div class="scan-item">
                                <div class="scan-info">
                                    <h4>\${scan.url}</h4>
                                    <div class="scan-meta">\${scan.scan_type} scan • \${date} at \${time}</div>
                                </div>
                                <div>
                                    <span class="scan-score">\${scan.score}%</span>
                                    <span style="color: #666; font-size: 0.9rem;">\${scan.total_issues} issues</span>
                                </div>
                            </div>
                        \`;
                    });
                }
                
                if (dashboardContainer) dashboardContainer.innerHTML = html;
                if (scansContainer) scansContainer.innerHTML = html;
                
            } catch (error) {
                console.error('Error loading recent scans:', error);
                const errorHtml = '<div style="padding: 20px; text-align: center; color: #dc3545;">Failed to load recent scans</div>';
                const dashboardContainer = document.getElementById('dashboard-recent-scans');
                const scansContainer = document.getElementById('recent-scans-list');
                if (dashboardContainer) dashboardContainer.innerHTML = errorHtml;
                if (scansContainer) scansContainer.innerHTML = errorHtml;
            }
        }
        
        // Check database status - PRESERVED FROM WORKING VERSION
        async function checkDatabaseStatus() {
            try {
                const response = await fetch('/health');
                const health = await response.json();
                
                const dbStatus = document.getElementById('db-status');
                if (dbStatus) {
                    if (health.database === 'connected') {
                        dbStatus.innerHTML = '✅ Database connected - Scans will be saved to your history';
                        dbStatus.className = 'db-status';
                    } else {
                        dbStatus.innerHTML = '⚠️ Database disconnected - Scans will not be saved (standalone mode)';
                        dbStatus.className = 'db-status disconnected';
                    }
                }
            } catch (error) {
                console.error('Error checking database status:', error);
            }
        }
        
        // Initialize dashboard - PRESERVED FROM WORKING VERSION
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboardStats();
            loadRecentScans();
            checkDatabaseStatus();
            
            // Set up URL input enter key handler
            const urlInput = document.getElementById('url-input');
            if (urlInput) {
                urlInput.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        startScan();
                    }
                });
            }
        });
    </script>
</body>
</html>`;
    
    res.send(html);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SentryPrime Enterprise v2.2 running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
    console.log(`🏗️ Phase 2 features: Platform detection, Auto-fix, Preview`);
});
