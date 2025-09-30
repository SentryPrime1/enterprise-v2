const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');
const OpenAI = require('openai'); // ADDED: OpenAI integration

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// ADDED: OpenAI configuration
const openai = process.env.OPENAI_API_KEY ? new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
}) : null;

// Database connection - PRESERVED FROM WORKING VERSION
let db = null;

// Initialize database connection if environment variables are provided
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD && process.env.DB_NAME) {
    console.log('🔄 Initializing database connection...');
    console.log('📍 DB_HOST:', process.env.DB_HOST);
    console.log('👤 DB_USER:', process.env.DB_USER);
    console.log('🗄️ DB_NAME:', process.env.DB_NAME);
    
    // FIXED: Better Cloud Run detection and database configuration
    const isCloudRun = process.env.K_SERVICE;
    const isCloudSQL = process.env.DB_HOST && process.env.DB_HOST.includes(':');
    
    let dbConfig;
    
    if (isCloudRun && isCloudSQL) {
        // Cloud Run with Cloud SQL connection - use Unix socket
        console.log('☁️ Detected Cloud Run with Cloud SQL, using Unix socket connection');
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
        const [host, port] = process.env.DB_HOST.includes(':') ? 
            process.env.DB_HOST.split(':') : [process.env.DB_HOST, '5432'];
        
        dbConfig = {
            host: host,
            port: parseInt(port) || 5432,
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
        return [
            {
                id: 1,
                url: 'https://example.com',
                scan_type: 'single',
                total_issues: 12,
                completed_at: new Date(Date.now() - 86400000).toISOString(),
                status: 'completed'
            },
            {
                id: 2,
                url: 'https://demo.com',
                scan_type: 'crawl',
                total_issues: 8,
                completed_at: new Date(Date.now() - 172800000).toISOString(),
                status: 'completed'
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, completed_at, status 
             FROM scans 
             WHERE user_id = $1 
             ORDER BY completed_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        return result.rows;
    } catch (error) {
        console.log('❌ Database error fetching recent scans:', error.message);
        return [];
    }
}

async function getDashboardStats(userId = 1) {
    if (!db) {
        // Return mock data when no database connection
        return {
            totalScans: 3,
            totalIssues: 22,
            averageScore: 92,
            scansThisWeek: 2
        };
    }
    
    try {
        const [totalScans, totalIssues, scansThisWeek] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM scans WHERE user_id = $1', [userId]),
            db.query('SELECT SUM(total_issues) as sum FROM scans WHERE user_id = $1', [userId]),
            db.query('SELECT COUNT(*) as count FROM scans WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL \'7 days\'', [userId])
        ]);
        
        const totalScanCount = parseInt(totalScans.rows[0].count) || 0;
        const totalIssueCount = parseInt(totalIssues.rows[0].sum) || 0;
        const weeklyScans = parseInt(scansThisWeek.rows[0].count) || 0;
        
        // Calculate average score (simplified calculation)
        const averageScore = totalScanCount > 0 ? Math.max(0, 100 - (totalIssueCount / totalScanCount)) : 0;
        
        return {
            totalScans: totalScanCount,
            totalIssues: totalIssueCount,
            averageScore: Math.round(averageScore),
            scansThisWeek: weeklyScans
        };
    } catch (error) {
        console.log('❌ Database error fetching dashboard stats:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            scansThisWeek: 0
        };
    }
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local'
    });
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

// ENHANCED: AI Suggestions API endpoint with real OpenAI integration
app.post('/api/ai-fixes', async (req, res) => {
    try {
        const { violations } = req.body;
        
        if (!violations || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'Violations array is required' });
        }

        const suggestions = await Promise.all(violations.map(async (violation) => {
            // Generate AI-powered suggestions based on violation type
            const suggestion = await generateAISuggestion(violation);
            return suggestion;
        }));

        res.json(suggestions);
    } catch (error) {
        console.error('Error generating AI suggestions:', error);
        res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
});

// ENHANCED: AI suggestion generation with real OpenAI integration
async function generateAISuggestion(violation) {
    // Static suggestions for common violations (fast response)
    const staticSuggestions = {
        'color-contrast': {
            priority: 'high',
            explanation: 'Text color does not have sufficient contrast against the background color, making it difficult for users with visual impairments to read.',
            codeExample: `/* Before - Poor contrast */
.text { color: #999; background: #fff; }

/* After - Good contrast */
.text { color: #333; background: #fff; }
/* Or use a darker text color */
.text { color: #000; background: #fff; }`,
            steps: [
                'Use a color contrast checker tool to test your current colors',
                'Ensure a contrast ratio of at least 4.5:1 for normal text',
                'For large text (18pt+), ensure at least 3:1 contrast ratio',
                'Consider using darker text colors or lighter backgrounds',
                'Test with users who have visual impairments'
            ]
        },
        'image-alt': {
            priority: 'high',
            explanation: 'Images must have alternative text that describes their content for screen reader users.',
            codeExample: `<!-- Before -->
<img src="chart.png">

<!-- After -->
<img src="chart.png" alt="Sales increased 25% from Q1 to Q2 2024">`,
            steps: [
                'Identify all images missing alt attributes',
                'Write descriptive alt text that conveys the image\'s purpose',
                'For decorative images, use alt=""',
                'For complex images like charts, consider longer descriptions',
                'Test with screen readers to ensure alt text is helpful'
            ]
        },
        'link-name': {
            priority: 'medium',
            explanation: 'Links must have accessible names that clearly describe their destination or purpose.',
            codeExample: `<!-- Before -->
<a href="/contact">Click here</a>

<!-- After -->
<a href="/contact">Contact our support team</a>`,
            steps: [
                'Replace generic text like "click here" with descriptive text',
                'Include the link destination or action in the link text',
                'Ensure link purpose is clear from the text alone',
                'For icon links, add aria-label attributes',
                'Test that links make sense when read out of context'
            ]
        }
    };

    // Return static suggestion if available
    if (staticSuggestions[violation.id]) {
        return staticSuggestions[violation.id];
    }

    // Use OpenAI for dynamic suggestions if available
    if (openai) {
        try {
            const prompt = `You are an accessibility expert. Provide a specific fix suggestion for this accessibility violation:

Violation ID: ${violation.id}
Description: ${violation.description || 'No description available'}
Help: ${violation.help || 'No help text available'}

Please provide:
1. A clear explanation of the issue
2. A practical code example showing before/after
3. Step-by-step implementation instructions

Format your response as JSON with these fields:
- priority: "high", "medium", or "low"
- explanation: Brief explanation of the accessibility issue
- codeExample: Code snippet showing before and after
- steps: Array of implementation steps

Keep the response practical and actionable.`;

            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 500,
                temperature: 0.3
            });

            const aiResponse = completion.choices[0].message.content;
            
            try {
                const parsedResponse = JSON.parse(aiResponse);
                return parsedResponse;
            } catch (parseError) {
                console.log('Failed to parse OpenAI response, using fallback');
                // Fall through to default suggestion
            }
        } catch (error) {
            console.log('OpenAI API error:', error.message);
            // Fall through to default suggestion
        }
    }

    // Default suggestion for unknown violation types or when OpenAI fails
    return {
        priority: 'medium',
        explanation: `This accessibility issue (${violation.id}) needs attention to ensure your website is usable by all users, including those with disabilities.`,
        codeExample: `// Review the specific element and apply appropriate WCAG guidelines
// Refer to: https://dequeuniversity.com/rules/axe/4.10/${violation.id}`,
        steps: [
            'Review the WCAG guidelines for this specific issue',
            'Identify the problematic elements on your page',
            'Apply the recommended accessibility fixes',
            'Test the changes with accessibility tools',
            'Validate the fix with real users if possible'
        ]
    };
}

// PRESERVED: Complete HTML from working version
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
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            font-size: 0.9rem;
        }
        
        .nav-item:hover {
            background: #333;
            color: white;
        }
        
        .nav-item.active {
            background: #007bff;
            color: white;
        }
        
        .nav-item .icon {
            margin-right: 12px;
            font-size: 1.1rem;
        }
        
        /* Main Content */
        .main-content {
            flex: 1;
            padding: 30px;
            overflow-y: auto;
            background: #f8f9fa;
        }
        
        .page {
            display: none;
        }
        
        .page.active {
            display: block;
        }
        
        /* Dashboard Page */
        .dashboard-header {
            margin-bottom: 30px;
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
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
        }
        
        .stat-card h3 {
            font-size: 0.9rem;
            color: #666;
            margin-bottom: 8px;
            font-weight: 500;
        }
        
        .stat-card .value {
            font-size: 2rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 4px;
        }
        
        .stat-card .change {
            font-size: 0.8rem;
            color: #28a745;
        }
        
        .action-cards {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .action-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
        }
        
        .action-card h3 {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 12px;
            color: #333;
        }
        
        .action-card p {
            color: #666;
            margin-bottom: 16px;
            line-height: 1.5;
        }
        
        .action-card .btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            transition: background 0.2s;
        }
        
        .action-card .btn:hover {
            background: #0056b3;
        }
        
        .recent-scans {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
        }
        
        .recent-scans-header {
            padding: 24px 24px 0;
            border-bottom: 1px solid #e9ecef;
            margin-bottom: 0;
        }
        
        .recent-scans-header h3 {
            font-size: 1.1rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .recent-scans-header p {
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 20px;
        }
        
        .scan-item {
            padding: 20px 24px;
            border-bottom: 1px solid #f1f3f4;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 4px;
            color: #333;
        }
        
        .scan-info p {
            font-size: 0.8rem;
            color: #666;
        }
        
        .scan-score {
            text-align: right;
        }
        
        .scan-score .score {
            font-size: 1.1rem;
            font-weight: 700;
            color: #28a745;
            margin-bottom: 4px;
        }
        
        .scan-score .issues {
            font-size: 0.8rem;
            color: #dc3545;
        }
        
        /* Scans Page */
        .scan-form {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
            margin-bottom: 30px;
        }
        
        .scan-form h2 {
            font-size: 1.5rem;
            font-weight: 600;
            margin-bottom: 20px;
            color: #333;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-group label {
            display: block;
            font-weight: 500;
            margin-bottom: 8px;
            color: #333;
        }
        
        .form-group input,
        .form-group select {
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 1rem;
        }
        
        .form-group input:focus,
        .form-group select:focus {
            outline: none;
            border-color: #007bff;
            box-shadow: 0 0 0 3px rgba(0,123,255,0.1);
        }
        
        .scan-options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .scan-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 14px 24px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 1rem;
            font-weight: 600;
            transition: background 0.2s;
        }
        
        .scan-btn:hover {
            background: #218838;
        }
        
        .scan-btn:disabled {
            background: #6c757d;
            cursor: not-allowed;
        }
        
        .scan-status {
            margin-top: 20px;
            padding: 16px;
            border-radius: 6px;
            display: none;
        }
        
        .scan-status.scanning {
            background: #e3f2fd;
            border: 1px solid #2196f3;
            color: #1976d2;
            display: block;
        }
        
        .scan-status.success {
            background: #e8f5e8;
            border: 1px solid #28a745;
            color: #155724;
            display: block;
        }
        
        .scan-status.error {
            background: #f8d7da;
            border: 1px solid #dc3545;
            color: #721c24;
            display: block;
        }
        
        .scan-results {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border: 1px solid #e9ecef;
            margin-top: 20px;
            display: none;
        }
        
        .scan-results.show {
            display: block;
        }
        
        .scan-results h3 {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 20px;
            color: #333;
        }
        
        .results-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .summary-item {
            text-align: center;
        }
        
        .summary-item .value {
            font-size: 1.8rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 4px;
        }
        
        .summary-item .label {
            font-size: 0.9rem;
            color: #666;
        }
        
        .violations-list {
            margin-top: 20px;
        }
        
        .violation-item {
            padding: 20px;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            margin-bottom: 16px;
            background: #fff;
        }
        
        .violation-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        
        .violation-title {
            font-size: 1rem;
            font-weight: 600;
            color: #333;
            margin-bottom: 4px;
        }
        
        .violation-severity {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .violation-severity.serious {
            background: #fff3cd;
            color: #856404;
        }
        
        .violation-severity.moderate {
            background: #d1ecf1;
            color: #0c5460;
        }
        
        .violation-severity.minor {
            background: #d4edda;
            color: #155724;
        }
        
        .violation-description {
            color: #666;
            line-height: 1.5;
            margin-bottom: 12px;
        }
        
        .violation-help {
            font-size: 0.9rem;
            color: #666;
            margin-bottom: 12px;
        }
        
        .violation-elements {
            font-size: 0.8rem;
            color: #666;
        }
        
        .db-status {
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 0.9rem;
        }
        
        .db-status.connected {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        
        .db-status.standalone {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            color: #856404;
        }
        
        /* Guided Fixing Modal */
        .guided-modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
        }
        
        .guided-modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .guided-modal-content {
            background: white;
            border-radius: 12px;
            width: 90%;
            max-width: 800px;
            max-height: 90vh;
            overflow-y: auto;
            position: relative;
        }
        
        .guided-modal-header {
            background: #28a745;
            color: white;
            padding: 20px 30px;
            border-radius: 12px 12px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .guided-modal-header h2 {
            font-size: 1.3rem;
            font-weight: 600;
            margin: 0;
        }
        
        .violation-counter {
            background: rgba(255, 255, 255, 0.2);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
        }
        
        .close-modal {
            background: none;
            border: none;
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 0;
            width: 30px;
            height: 30px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .guided-modal-body {
            padding: 30px;
        }
        
        .current-violation {
            margin-bottom: 30px;
        }
        
        .violation-info {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .violation-info h3 {
            font-size: 1.2rem;
            font-weight: 600;
            margin-bottom: 12px;
            color: #333;
        }
        
        .violation-info .severity-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
            margin-bottom: 12px;
        }
        
        .violation-info p {
            margin-bottom: 8px;
            line-height: 1.5;
        }
        
        .violation-info strong {
            color: #333;
        }
        
        .ai-suggestion {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .ai-suggestion h4 {
            color: #007bff;
            font-size: 1rem;
            font-weight: 600;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .ai-suggestion .priority-badge {
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.7rem;
            text-transform: uppercase;
            font-weight: 500;
        }
        
        .ai-suggestion .priority-badge.high {
            background: #dc3545;
            color: white;
        }
        
        .ai-suggestion .priority-badge.medium {
            background: #ffc107;
            color: #212529;
        }
        
        .ai-suggestion .priority-badge.low {
            background: #28a745;
            color: white;
        }
        
        .ai-suggestion .explanation {
            margin-bottom: 16px;
            line-height: 1.5;
            color: #333;
        }
        
        .ai-suggestion .code-example {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            border-radius: 4px;
            padding: 12px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.85rem;
            margin-bottom: 16px;
            white-space: pre-wrap;
            overflow-x: auto;
        }
        
        .ai-suggestion .steps {
            margin-bottom: 16px;
        }
        
        .ai-suggestion .steps h5 {
            font-size: 0.9rem;
            font-weight: 600;
            margin-bottom: 8px;
            color: #333;
        }
        
        .ai-suggestion .steps ol {
            padding-left: 20px;
        }
        
        .ai-suggestion .steps li {
            margin-bottom: 4px;
            line-height: 1.4;
            color: #555;
        }
        
        .fix-actions {
            display: flex;
            gap: 12px;
            margin-bottom: 20px;
        }
        
        .fix-btn {
            padding: 8px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            transition: all 0.2s;
        }
        
        .fix-btn.primary {
            background: #28a745;
            color: white;
        }
        
        .fix-btn.primary:hover {
            background: #218838;
        }
        
        .fix-btn.secondary {
            background: #6c757d;
            color: white;
        }
        
        .fix-btn.secondary:hover {
            background: #545b62;
        }
        
        .guided-modal-footer {
            padding: 20px 30px;
            border-top: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .nav-btn {
            padding: 10px 20px;
            border: 1px solid #ddd;
            border-radius: 6px;
            background: white;
            cursor: pointer;
            font-size: 0.9rem;
            transition: all 0.2s;
        }
        
        .nav-btn:hover {
            background: #f8f9fa;
        }
        
        .nav-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .nav-btn.primary {
            background: #007bff;
            color: white;
            border-color: #007bff;
        }
        
        .nav-btn.primary:hover {
            background: #0056b3;
        }
        
        .progress-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.9rem;
            color: #666;
        }
        
        .action-buttons {
            display: flex;
            gap: 12px;
            margin-top: 20px;
        }
        
        .btn {
            padding: 10px 16px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            transition: all 0.2s;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn.primary {
            background: #007bff;
            color: white;
        }
        
        .btn.primary:hover {
            background: #0056b3;
        }
        
        .btn.success {
            background: #28a745;
            color: white;
        }
        
        .btn.success:hover {
            background: #218838;
        }
        
        .btn.secondary {
            background: #6c757d;
            color: white;
        }
        
        .btn.secondary:hover {
            background: #545b62;
        }
        
        /* Loading states */
        .loading {
            opacity: 0.6;
            pointer-events: none;
        }
        
        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #007bff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-right: 8px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        /* Responsive design */
        @media (max-width: 768px) {
            .dashboard-container {
                flex-direction: column;
                height: auto;
                min-height: 100vh;
            }
            
            .sidebar {
                width: 100%;
                padding: 15px 0;
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
            
            .main-content {
                padding: 20px;
            }
            
            .stats-grid,
            .action-cards {
                grid-template-columns: 1fr;
            }
            
            .scan-options {
                grid-template-columns: 1fr;
            }
            
            .guided-modal-content {
                width: 95%;
                margin: 20px;
            }
            
            .guided-modal-body {
                padding: 20px;
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
                <p>Enterprise Dashboard</p>
            </div>
            <nav class="sidebar-nav">
                <button class="nav-item active" onclick="switchToPage('dashboard')">
                    <span class="icon">📊</span>
                    Dashboard
                </button>
                <button class="nav-item" onclick="switchToPage('scans')">
                    <span class="icon">🔍</span>
                    Scans
                </button>
                <button class="nav-item" onclick="switchToPage('reports')">
                    <span class="icon">📄</span>
                    Reports
                </button>
                <button class="nav-item" onclick="switchToPage('settings')">
                    <span class="icon">⚙️</span>
                    Settings
                </button>
            </nav>
        </div>

        <!-- Main Content -->
        <div class="main-content">
            <!-- Dashboard Page -->
            <div id="dashboard" class="page active">
                <div class="dashboard-header">
                    <h1>Welcome back!</h1>
                    <p>Here's your accessibility compliance overview</p>
                </div>

                <div class="stats-grid">
                    <div class="stat-card">
                        <h3>Total Scans</h3>
                        <div class="value" id="total-scans">-</div>
                        <div class="change">+2 this week</div>
                    </div>
                    <div class="stat-card">
                        <h3>Issues Found</h3>
                        <div class="value" id="total-issues">-</div>
                        <div class="change">-15% from last week</div>
                    </div>
                    <div class="stat-card">
                        <h3>Average Score</h3>
                        <div class="value" id="average-score">-</div>
                        <div class="change">+5% improvement</div>
                    </div>
                    <div class="stat-card">
                        <h3>This Week</h3>
                        <div class="value" id="scans-this-week">-</div>
                        <div class="change">Scans completed</div>
                    </div>
                </div>

                <div class="action-cards">
                    <div class="action-card">
                        <h3>🚀 Quick Scan</h3>
                        <p>Run a fast accessibility scan on any webpage to identify immediate issues.</p>
                        <button class="btn" onclick="switchToPage('scans')">Start Scan</button>
                    </div>
                    <div class="action-card">
                        <h3>📊 View Reports</h3>
                        <p>Access detailed accessibility reports and track your compliance progress.</p>
                        <button class="btn" onclick="switchToPage('reports')">View Reports</button>
                    </div>
                    <div class="action-card">
                        <h3>🎯 Guided Fixing</h3>
                        <p>Get step-by-step guidance to fix accessibility issues with AI assistance.</p>
                        <button class="btn" onclick="switchToPage('scans')">Get Started</button>
                    </div>
                </div>

                <div class="recent-scans">
                    <div class="recent-scans-header">
                        <h3>Recent Scans</h3>
                        <p>Your latest accessibility scan results</p>
                    </div>
                    <div id="recent-scans-list">
                        <!-- Recent scans will be loaded here -->
                    </div>
                </div>
            </div>

            <!-- Scans Page -->
            <div id="scans" class="page">
                <div class="scan-form">
                    <h2>🔍 Accessibility Scanner</h2>
                    
                    <div id="db-status" class="db-status">
                        <span id="db-status-text">Checking database connection...</span>
                    </div>
                    
                    <form id="scan-form">
                        <div class="form-group">
                            <label for="url">Website URL</label>
                            <input type="url" id="url" name="url" placeholder="https://example.com" required>
                        </div>
                        
                        <div class="scan-options">
                            <div class="form-group">
                                <label for="scan-type">Scan Type</label>
                                <select id="scan-type" name="scan-type">
                                    <option value="single">Single Page</option>
                                    <option value="crawl">Full Site Crawl</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label for="max-pages">Max Pages (for crawl)</label>
                                <select id="max-pages" name="max-pages">
                                    <option value="5">5 pages</option>
                                    <option value="10">10 pages</option>
                                    <option value="25">25 pages</option>
                                    <option value="50">50 pages</option>
                                </select>
                            </div>
                        </div>
                        
                        <button type="submit" class="scan-btn" id="scan-btn">
                            🚀 Start Accessibility Scan
                        </button>
                    </form>
                    
                    <div id="scan-status" class="scan-status">
                        <span id="scan-status-text"></span>
                    </div>
                </div>

                <div id="scan-results" class="scan-results">
                    <!-- Scan results will be displayed here -->
                </div>

                <div class="recent-scans">
                    <div class="recent-scans-header">
                        <h3>Recent Scans</h3>
                        <p>Your scan history and results</p>
                    </div>
                    <div id="scans-recent-list">
                        <!-- Recent scans will be loaded here -->
                    </div>
                </div>
            </div>

            <!-- Reports Page -->
            <div id="reports" class="page">
                <div class="dashboard-header">
                    <h1>📄 Accessibility Reports</h1>
                    <p>Detailed compliance reports and analytics</p>
                </div>
                <div style="padding: 40px; text-align: center; color: #666;">
                    <h3>Reports Coming Soon</h3>
                    <p>Advanced reporting features are in development.</p>
                </div>
            </div>

            <!-- Settings Page -->
            <div id="settings" class="page">
                <div class="dashboard-header">
                    <h1>⚙️ Settings</h1>
                    <p>Configure your accessibility scanning preferences</p>
                </div>
                <div style="padding: 40px; text-align: center; color: #666;">
                    <h3>Settings Coming Soon</h3>
                    <p>Configuration options are in development.</p>
                </div>
            </div>
        </div>
    </div>

    <!-- Guided Fixing Modal -->
    <div id="guided-modal" class="guided-modal">
        <div class="guided-modal-content">
            <div class="guided-modal-header">
                <h2>🛠️ Guided Accessibility Fixing</h2>
                <div class="violation-counter" id="violation-counter">
                    Violation 1 of 1
                </div>
                <button class="close-modal" onclick="GuidedFixing.closeModal()">×</button>
            </div>
            
            <div class="guided-modal-body">
                <div class="current-violation" id="current-violation">
                    <!-- Current violation details will be displayed here -->
                </div>
                
                <div class="ai-suggestion" id="ai-suggestion" style="display: none;">
                    <!-- AI suggestion will be displayed here -->
                </div>
            </div>
            
            <div class="guided-modal-footer">
                <button class="nav-btn" id="prev-btn" onclick="GuidedFixing.previousViolation()" disabled>
                    ← Previous
                </button>
                
                <div class="progress-indicator">
                    <span id="progress-text">Step 1 of 1</span>
                </div>
                
                <button class="nav-btn primary" id="next-btn" onclick="GuidedFixing.nextViolation()">
                    Next →
                </button>
            </div>
        </div>
    </div>

    <script>
        // Global variables
        let currentViolations = [];
        let currentScanResults = null;
        
        // Page navigation
        function switchToPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            
            // Remove active class from all nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId).classList.add('active');
            
            // Add active class to clicked nav item
            event.target.classList.add('active');
            
            // Load page-specific data
            if (pageId === 'dashboard') {
                loadDashboardData();
            } else if (pageId === 'scans') {
                loadScansData();
            }
        }
        
        // Load dashboard data
        async function loadDashboardData() {
            try {
                // Load dashboard stats
                const statsResponse = await fetch('/api/dashboard/stats');
                const stats = await statsResponse.json();
                
                document.getElementById('total-scans').textContent = stats.totalScans;
                document.getElementById('total-issues').textContent = stats.totalIssues;
                document.getElementById('average-score').textContent = stats.averageScore + '%';
                document.getElementById('scans-this-week').textContent = stats.scansThisWeek;
                
                // Load recent scans
                const scansResponse = await fetch('/api/scans/recent');
                const scans = await scansResponse.json();
                
                const recentScansList = document.getElementById('recent-scans-list');
                
                if (scans.length === 0) {
                    recentScansList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No recent scans found. <a href="#" onclick="switchToPage(\'scans\')">Run your first scan!</a></div>';
                } else {
                    recentScansList.innerHTML = scans.map(scan => `
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>${scan.url}</h4>
                                <p>${new Date(scan.completed_at).toLocaleDateString()} • ${scan.scan_type}</p>
                            </div>
                            <div class="scan-score">
                                <div class="score">${Math.max(0, 100 - scan.total_issues)}%</div>
                                <div class="issues">${scan.total_issues} issues</div>
                            </div>
                        </div>
                    `).join('');
                }
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        }
        
        // Load scans page data
        async function loadScansData() {
            try {
                // Check database status
                const healthResponse = await fetch('/health');
                const health = await healthResponse.json();
                
                const dbStatus = document.getElementById('db-status');
                const dbStatusText = document.getElementById('db-status-text');
                
                if (health.database === 'connected') {
                    dbStatus.className = 'db-status connected';
                    dbStatusText.textContent = '✅ Database connected - Scans will be saved to your history';
                } else {
                    dbStatus.className = 'db-status standalone';
                    dbStatusText.textContent = '⚠️ Running in standalone mode - Scans will not be saved';
                }
                
                // Load recent scans for scans page
                const scansResponse = await fetch('/api/scans/recent');
                const scans = await scansResponse.json();
                
                const scansRecentList = document.getElementById('scans-recent-list');
                
                if (scans.length === 0) {
                    scansRecentList.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No scans yet. Run your first scan above!</div>';
                } else {
                    scansRecentList.innerHTML = scans.map(scan => `
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>${scan.url}</h4>
                                <p>${new Date(scan.completed_at).toLocaleDateString()} • ${scan.scan_type} • ${scan.total_issues} issues</p>
                            </div>
                            <div class="scan-score">
                                <button class="btn secondary" onclick="viewScanReport(${scan.id})">View Report</button>
                            </div>
                        </div>
                    `).join('');
                }
            } catch (error) {
                console.error('Error loading scans data:', error);
            }
        }
        
        // Scan form submission
        document.getElementById('scan-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const url = document.getElementById('url').value;
            const scanType = document.getElementById('scan-type').value;
            const maxPages = document.getElementById('max-pages').value;
            
            const scanBtn = document.getElementById('scan-btn');
            const scanStatus = document.getElementById('scan-status');
            const scanStatusText = document.getElementById('scan-status-text');
            const scanResults = document.getElementById('scan-results');
            
            // Update UI for scanning state
            scanBtn.disabled = true;
            scanBtn.innerHTML = '<span class="spinner"></span>Scanning...';
            scanStatus.className = 'scan-status scanning';
            scanStatusText.textContent = 'Starting accessibility scan...';
            scanResults.classList.remove('show');
            
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
                
                if (response.ok) {
                    // Success
                    scanStatus.className = 'scan-status success';
                    scanStatusText.textContent = `✅ Scan completed! Found ${result.violations.length} violations in ${result.scanTimeMs}ms`;
                    
                    // Store results globally
                    currentScanResults = result;
                    currentViolations = result.violations;
                    
                    // Display results
                    displayScanResults(result);
                    
                    // Refresh recent scans
                    loadScansData();
                } else {
                    // Error
                    scanStatus.className = 'scan-status error';
                    scanStatusText.textContent = `❌ Scan failed: ${result.error}`;
                }
            } catch (error) {
                scanStatus.className = 'scan-status error';
                scanStatusText.textContent = `❌ Scan failed: ${error.message}`;
            } finally {
                // Reset button
                scanBtn.disabled = false;
                scanBtn.innerHTML = '🚀 Start Accessibility Scan';
            }
        });
        
        // Display scan results
        function displayScanResults(results) {
            const scanResults = document.getElementById('scan-results');
            
            const violationsHtml = results.violations.map(violation => `
                <div class="violation-item">
                    <div class="violation-header">
                        <div>
                            <div class="violation-title">${violation.id}</div>
                            <div class="violation-severity ${violation.impact}">${violation.impact.toUpperCase()}</div>
                        </div>
                    </div>
                    <div class="violation-description">
                        <strong>Description:</strong> ${violation.description}
                    </div>
                    <div class="violation-help">
                        <strong>Help:</strong> ${violation.help}
                    </div>
                    <div class="violation-elements">
                        <strong>Affected elements:</strong> ${violation.nodes.length} element(s)
                    </div>
                </div>
            `).join('');
            
            const actionButtons = results.violations.length > 0 ? `
                <div class="action-buttons">
                    <button class="btn primary" onclick="generateDetailedReport()">📄 View Detailed Report</button>
                    <button class="btn success" onclick="GuidedFixing.openModal(currentViolations)">🛠️ Let's Start Fixing</button>
                </div>
            ` : '';
            
            scanResults.innerHTML = `
                <h3>📊 Scan Results</h3>
                <div class="results-summary">
                    <div class="summary-item">
                        <div class="value">${results.violations.length}</div>
                        <div class="label">Violations</div>
                    </div>
                    <div class="summary-item">
                        <div class="value">${results.scanTimeMs}ms</div>
                        <div class="label">Scan Time</div>
                    </div>
                    <div class="summary-item">
                        <div class="value">${results.pagesScanned || 1}</div>
                        <div class="label">Pages</div>
                    </div>
                    <div class="summary-item">
                        <div class="value">${Math.max(0, 100 - results.violations.length)}%</div>
                        <div class="label">Score</div>
                    </div>
                </div>
                
                ${actionButtons}
                
                <div class="violations-list">
                    ${violationsHtml}
                </div>
            `;
            
            scanResults.classList.add('show');
        }
        
        // Generate detailed report
        function generateDetailedReport() {
            if (!currentScanResults) {
                alert('No scan results available');
                return;
            }
            
            const report = generateMarkdownReport(currentScanResults);
            downloadReport(report, `accessibility-report-${new Date().toISOString().split('T')[0]}.md`);
        }
        
        // Generate markdown report
        function generateMarkdownReport(results) {
            const date = new Date().toLocaleDateString();
            const score = Math.max(0, 100 - results.violations.length);
            
            let report = `# Accessibility Scan Report\n\n`;
            report += `**Date:** ${date}\n`;
            report += `**URL:** ${results.url}\n`;
            report += `**Scan Type:** ${results.scanType}\n`;
            report += `**Score:** ${score}%\n`;
            report += `**Total Violations:** ${results.violations.length}\n`;
            report += `**Scan Time:** ${results.scanTimeMs}ms\n\n`;
            
            if (results.violations.length === 0) {
                report += `## ✅ Congratulations!\n\nNo accessibility violations were found. Your website meets the tested accessibility standards.\n`;
            } else {
                report += `## 🔍 Violations Found\n\n`;
                
                results.violations.forEach((violation, index) => {
                    report += `### ${index + 1}. ${violation.id}\n\n`;
                    report += `**Severity:** ${violation.impact.toUpperCase()}\n\n`;
                    report += `**Description:** ${violation.description}\n\n`;
                    report += `**Help:** ${violation.help}\n\n`;
                    report += `**Affected Elements:** ${violation.nodes.length}\n\n`;
                    
                    if (violation.helpUrl) {
                        report += `**Learn More:** [${violation.helpUrl}](${violation.helpUrl})\n\n`;
                    }
                    
                    report += `---\n\n`;
                });
            }
            
            report += `## 📋 Summary\n\n`;
            report += `This report was generated by SentryPrime Enterprise Accessibility Scanner.\n`;
            report += `For more information about accessibility compliance, visit [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/).\n`;
            
            return report;
        }
        
        // Download report
        function downloadReport(content, filename) {
            const blob = new Blob([content], { type: 'text/markdown' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        }
        
        // View scan report
        function viewScanReport(scanId) {
            alert(`Viewing report for scan ID: ${scanId} (Feature coming soon)`);
        }
        
        // Guided Fixing functionality
        const GuidedFixing = {
            violations: [],
            currentIndex: 0,
            fixedViolations: [],
            
            openModal: function(violations) {
                this.violations = violations || [];
                this.currentIndex = 0;
                this.fixedViolations = [];
                
                if (this.violations.length === 0) {
                    alert('No violations to fix!');
                    return;
                }
                
                document.getElementById('guided-modal').classList.add('show');
                this.updateModal();
            },
            
            closeModal: function() {
                document.getElementById('guided-modal').classList.remove('show');
                
                // Show summary if any violations were marked as fixed
                if (this.fixedViolations.length > 0) {
                    this.showFixingSummary();
                }
            },
            
            updateModal: function() {
                const violation = this.violations[this.currentIndex];
                const counter = document.getElementById('violation-counter');
                const currentViolation = document.getElementById('current-violation');
                const prevBtn = document.getElementById('prev-btn');
                const nextBtn = document.getElementById('next-btn');
                const progressText = document.getElementById('progress-text');
                
                // Update counter
                counter.textContent = `Violation ${this.currentIndex + 1} of ${this.violations.length}`;
                
                // Update progress
                progressText.textContent = `Step ${this.currentIndex + 1} of ${this.violations.length}`;
                
                // Update navigation buttons
                prevBtn.disabled = this.currentIndex === 0;
                nextBtn.textContent = this.currentIndex === this.violations.length - 1 ? 'Finish' : 'Next →';
                
                // Display current violation
                currentViolation.innerHTML = `
                    <div class="violation-info">
                        <h3>${violation.id}</h3>
                        <div class="severity-badge ${violation.impact}">${violation.impact.toUpperCase()}</div>
                        <p><strong>Description:</strong> ${violation.description}</p>
                        <p><strong>Help:</strong> ${violation.help}</p>
                        <p><strong>Learn more:</strong> <a href="${violation.helpUrl}" target="_blank">${violation.helpUrl}</a></p>
                    </div>
                    
                    <div class="fix-actions">
                        <button class="fix-btn primary" onclick="GuidedFixing.getAISuggestion()">
                            🤖 Get AI Fix Suggestions
                        </button>
                        <button class="fix-btn secondary" onclick="GuidedFixing.markAsFixed()">
                            ✅ Mark as Fixed
                        </button>
                    </div>
                `;
                
                // Hide AI suggestion initially
                document.getElementById('ai-suggestion').style.display = 'none';
            },
            
            getAISuggestion: async function() {
                const aiSuggestion = document.getElementById('ai-suggestion');
                const violation = this.violations[this.currentIndex];
                
                // Show loading state
                aiSuggestion.style.display = 'block';
                aiSuggestion.innerHTML = `
                    <h4>🤖 AI Fix Suggestion <span class="spinner"></span></h4>
                    <p>Generating personalized fix suggestion...</p>
                `;
                
                try {
                    const response = await fetch('/api/ai-fixes', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            violations: [violation]
                        })
                    });
                    
                    const suggestions = await response.json();
                    const suggestion = suggestions[0];
                    
                    if (suggestion) {
                        aiSuggestion.innerHTML = `
                            <h4>🤖 AI Fix Suggestion <span class="priority-badge ${suggestion.priority}">${suggestion.priority}</span></h4>
                            
                            <div class="explanation">
                                <strong>Issue:</strong> ${suggestion.explanation}
                            </div>
                            
                            <div class="code-example">
                                <strong>Code Example:</strong>
${suggestion.codeExample}
                            </div>
                            
                            <div class="steps">
                                <h5>Implementation Steps:</h5>
                                <ol>
                                    ${suggestion.steps.map(step => `<li>${step}</li>`).join('')}
                                </ol>
                            </div>
                            
                            <div class="fix-actions">
                                <button class="fix-btn primary" onclick="GuidedFixing.markAsFixed()">
                                    ✅ Mark as Fixed
                                </button>
                            </div>
                        `;
                    } else {
                        throw new Error('No suggestion received');
                    }
                } catch (error) {
                    aiSuggestion.innerHTML = `
                        <h4>🤖 AI Fix Suggestion</h4>
                        <p style="color: #dc3545;">Sorry, we couldn't generate a suggestion right now. Please try again or refer to the WCAG guidelines.</p>
                        <div class="fix-actions">
                            <button class="fix-btn primary" onclick="GuidedFixing.getAISuggestion()">Try Again</button>
                            <button class="fix-btn secondary" onclick="GuidedFixing.markAsFixed()">Mark as Fixed</button>
                        </div>
                    `;
                }
            },
            
            markAsFixed: function() {
                const violation = this.violations[this.currentIndex];
                this.fixedViolations.push(violation);
                
                // Show confirmation
                const currentViolation = document.getElementById('current-violation');
                currentViolation.innerHTML += `
                    <div style="background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 12px; border-radius: 6px; margin-top: 16px;">
                        ✅ Marked as fixed! This violation has been added to your fix report.
                    </div>
                `;
                
                // Auto-advance after a short delay
                setTimeout(() => {
                    this.nextViolation();
                }, 1500);
            },
            
            previousViolation: function() {
                if (this.currentIndex > 0) {
                    this.currentIndex--;
                    this.updateModal();
                }
            },
            
            nextViolation: function() {
                if (this.currentIndex < this.violations.length - 1) {
                    this.currentIndex++;
                    this.updateModal();
                } else {
                    // Finished all violations
                    this.closeModal();
                }
            },
            
            showFixingSummary: function() {
                const fixedCount = this.fixedViolations.length;
                const totalCount = this.violations.length;
                
                if (fixedCount > 0) {
                    const report = this.generateFixingReport();
                    this.downloadFixingReport(report);
                    
                    alert(`Great job! You've addressed ${fixedCount} out of ${totalCount} violations. A detailed fix report has been downloaded.`);
                }
            },
            
            generateFixingReport: function() {
                const date = new Date().toLocaleDateString();
                let report = `# Accessibility Fixing Report\n\n`;
                report += `**Date:** ${date}\n`;
                report += `**Fixed Violations:** ${this.fixedViolations.length}\n`;
                report += `**Total Violations:** ${this.violations.length}\n\n`;
                
                report += `## ✅ Fixed Violations\n\n`;
                
                this.fixedViolations.forEach((violation, index) => {
                    report += `### ${index + 1}. ${violation.id}\n\n`;
                    report += `**Severity:** ${violation.impact.toUpperCase()}\n\n`;
                    report += `**Description:** ${violation.description}\n\n`;
                    report += `**Status:** ✅ FIXED\n\n`;
                    report += `---\n\n`;
                });
                
                const remainingCount = this.violations.length - this.fixedViolations.length;
                if (remainingCount > 0) {
                    report += `## ⏳ Remaining Violations\n\n`;
                    report += `${remainingCount} violations still need attention.\n\n`;
                }
                
                report += `## 📋 Next Steps\n\n`;
                report += `1. Test your fixes with real users\n`;
                report += `2. Run another accessibility scan to verify improvements\n`;
                report += `3. Continue addressing remaining violations\n`;
                report += `4. Consider implementing automated accessibility testing\n\n`;
                
                report += `Generated by SentryPrime Enterprise Accessibility Scanner\n`;
                
                return report;
            },
            
            downloadFixingReport: function(content) {
                const filename = `accessibility-fixes-${new Date().toISOString().split('T')[0]}.md`;
                const blob = new Blob([content], { type: 'text/markdown' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }
        };
        
        // Initialize dashboard on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboardData();
        });
    </script>
</body>
</html>`;
    
    res.send(html);
});

// PRESERVED: Complete scan endpoint from working version
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single', maxPages = 5 } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    const startTime = Date.now();
    let browser = null;
    
    try {
        console.log(`🔍 Starting ${scanType} scan for: ${url}`);
        
        // Launch browser with optimized settings for Cloud Run
        browser = await puppeteer.launch({
            headless: true,
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
        
        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        let allViolations = [];
        let pagesScanned = 0;
        
        if (scanType === 'single') {
            // Single page scan
            console.log(`📄 Scanning single page: ${url}`);
            
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            
            // Wait for page to stabilize
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Inject axe-core
            await page.addScriptTag({ content: axeCore.source });
            
            // Run accessibility scan
            const results = await page.evaluate(() => {
                return new Promise((resolve) => {
                    axe.run((err, results) => {
                        if (err) throw err;
                        resolve(results);
                    });
                });
            });
            
            allViolations = results.violations;
            pagesScanned = 1;
            
        } else if (scanType === 'crawl') {
            // Multi-page crawl
            console.log(`🕷️ Starting crawl scan for: ${url} (max ${maxPages} pages)`);
            
            const visitedUrls = new Set();
            const urlsToVisit = [url];
            const baseUrl = new URL(url).origin;
            
            while (urlsToVisit.length > 0 && pagesScanned < maxPages) {
                const currentUrl = urlsToVisit.shift();
                
                if (visitedUrls.has(currentUrl)) continue;
                visitedUrls.add(currentUrl);
                
                try {
                    console.log(`📄 Scanning page ${pagesScanned + 1}: ${currentUrl}`);
                    
                    await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                    
                    // Wait for page to stabilize
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Inject axe-core
                    await page.addScriptTag({ content: axeCore.source });
                    
                    // Run accessibility scan
                    const results = await page.evaluate(() => {
                        return new Promise((resolve) => {
                            axe.run((err, results) => {
                                if (err) throw err;
                                resolve(results);
                            });
                        });
                    });
                    
                    // Add violations with page context
                    results.violations.forEach(violation => {
                        violation.pageUrl = currentUrl;
                        allViolations.push(violation);
                    });
                    
                    pagesScanned++;
                    
                    // Find more URLs to scan (only if we haven't reached the limit)
                    if (pagesScanned < maxPages) {
                        const links = await page.evaluate((baseUrl) => {
                            const links = Array.from(document.querySelectorAll('a[href]'));
                            return links
                                .map(link => {
                                    try {
                                        const href = link.getAttribute('href');
                                        if (!href) return null;
                                        
                                        // Convert relative URLs to absolute
                                        const url = new URL(href, window.location.href);
                                        
                                        // Only include URLs from the same domain
                                        if (url.origin === baseUrl) {
                                            return url.href;
                                        }
                                        return null;
                                    } catch (e) {
                                        return null;
                                    }
                                })
                                .filter(url => url !== null);
                        }, baseUrl);
                        
                        // Add new URLs to visit
                        links.forEach(link => {
                            if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
                                urlsToVisit.push(link);
                            }
                        });
                    }
                    
                } catch (pageError) {
                    console.log(`⚠️ Error scanning page ${currentUrl}:`, pageError.message);
                    // Continue with next page
                }
            }
        }
        
        const scanTimeMs = Date.now() - startTime;
        
        console.log(`✅ Scan completed: ${allViolations.length} violations found in ${scanTimeMs}ms`);
        
        // Save scan to database
        const scanId = await saveScan(
            1, // userId - hardcoded for now
            1, // organizationId - hardcoded for now
            url,
            scanType,
            allViolations.length,
            scanTimeMs,
            pagesScanned,
            allViolations
        );
        
        const response = {
            url,
            scanType,
            violations: allViolations,
            scanTimeMs,
            pagesScanned,
            scanId
        };
        
        res.json(response);
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        res.status(500).json({ 
            error: error.message,
            details: 'Scan failed. Please check the URL and try again.'
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 SentryPrime Enterprise Dashboard running on port ${PORT}`);
    console.log(`📍 Environment: ${process.env.K_SERVICE ? 'Cloud Run' : 'Local'}`);
    console.log(`💾 Database: ${db ? 'Connected' : 'Standalone mode'}`);
    console.log(`🤖 OpenAI: ${openai ? 'Enabled' : 'Disabled'}`);
});
