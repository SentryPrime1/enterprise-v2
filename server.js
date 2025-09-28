const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

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
                total_issues: 7, 
                created_at: '2024-09-18',
                score: 94 
            },
            { 
                id: 2, 
                url: 'https://company.com/products', 
                scan_type: 'crawl', 
                total_issues: 12, 
                created_at: '2024-09-18',
                score: 87 
            },
            { 
                id: 3, 
                url: 'https://company.com/about', 
                scan_type: 'single', 
                total_issues: 3, 
                created_at: '2024-09-17',
                score: 96 
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, completed_at as created_at 
             FROM scans 
             WHERE user_id = $1 
             ORDER BY completed_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        
        console.log(`✅ Retrieved ${result.rows.length} scans from database`);
        
        return result.rows.map(scan => ({
            ...scan,
            score: Math.max(60, 100 - Math.min(40, scan.total_issues * 2)) // Calculate score based on issues
        }));
    } catch (error) {
        console.log('❌ Database error getting recent scans:', error.message);
        return [];
    }
}

// NEW: Dashboard statistics function
async function getDashboardStats(userId = 1) {
    if (!db) {
        return {
            totalScans: 3,
            totalIssues: 22,
            avgScore: 92,
            recentActivity: 'Mock data - database not connected'
        };
    }
    
    try {
        // Get total scans
        const totalScansResult = await db.query(
            'SELECT COUNT(*) as count FROM scans WHERE user_id = $1',
            [userId]
        );
        
        // Get total issues
        const totalIssuesResult = await db.query(
            'SELECT SUM(total_issues) as total FROM scans WHERE user_id = $1',
            [userId]
        );
        
        // Get average score (calculated from issues)
        const avgScoreResult = await db.query(
            'SELECT AVG(GREATEST(60, 100 - LEAST(40, total_issues * 2))) as avg_score FROM scans WHERE user_id = $1',
            [userId]
        );
        
        // Get scans from last 7 days
        const weeklyScansResult = await db.query(
            'SELECT COUNT(*) as count FROM scans WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL \'7 days\'',
            [userId]
        );
        
        return {
            totalScans: parseInt(totalScansResult.rows[0].count) || 0,
            totalIssues: parseInt(totalIssuesResult.rows[0].total) || 0,
            avgScore: Math.round(parseFloat(avgScoreResult.rows[0].avg_score)) || 0,
            weeklyScans: parseInt(weeklyScansResult.rows[0].count) || 0
        };
    } catch (error) {
        console.log('❌ Database error getting dashboard stats:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            avgScore: 0,
            weeklyScans: 0
        };
    }
}

// Health check - PRESERVED
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local'
    });
});

// API endpoint to get recent scans - PRESERVED
app.get('/api/scans/recent', async (req, res) => {
    try {
        const scans = await getRecentScans(1); // Default user ID for now
        res.json({ success: true, scans });
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch scans' });
    }
});

// NEW: API endpoint for dashboard statistics
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const stats = await getDashboardStats(1); // Default user ID for now
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

// NEW: AI Fix Suggestions API Endpoint
app.post('/api/ai-fixes', async (req, res) => {
    try {
        console.log('🤖 AI fix suggestions requested');
        
        if (!process.env.OPENAI_API_KEY) {
            return res.status(400).json({ error: 'OpenAI API key not configured' });
        }
        
        const { violations } = req.body;
        
        if (!violations || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'Invalid violations data' });
        }
        
        console.log('📊 Processing', violations.length, 'violations for AI analysis');
        
        const suggestions = await generateAIFixSuggestions(violations);
        
        res.json(suggestions);
        
    } catch (error) {
        console.error('❌ Error in AI fixes endpoint:', error);
        res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
});

// AI Fix Suggestions Helper Function
async function generateAIFixSuggestions(violations) {
    console.log('🤖 Starting AI fix suggestions generation...');
    console.log('📊 Violations count:', violations.length);
    
    if (!process.env.OPENAI_API_KEY) {
        console.error('❌ OpenAI API key not configured');
        throw new Error('OpenAI API key not configured');
    }
    
    console.log('🔑 OpenAI API key found, length:', process.env.OPENAI_API_KEY.length);
    
    try {
        console.log('🤖 Attempting real OpenAI integration...');
        
        // Import OpenAI (dynamic import for compatibility)
        const { OpenAI } = await import('openai');
        
        console.log('✅ OpenAI imported successfully');
        
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        console.log('✅ OpenAI client created');
        
        // Prepare violations for AI analysis
        const violationsText = violations.map(v => 
            `Violation: ${v.id}\nImpact: ${v.impact}\nDescription: ${v.description || 'No description'}\nHelp: ${v.help || 'No help text'}\nElements affected: ${v.nodes?.length || 0}`
        ).join('\n\n');
        
        console.log('📝 Prepared violations text, length:', violationsText.length);
        
        const prompt = `You are an accessibility expert. Analyze these WCAG violations and provide specific, actionable fix suggestions.

Violations to fix:
${violationsText}

Respond with a JSON array where each object has this structure:
{
  "explanation": "Clear explanation of the issue and why it matters",
  "codeExample": "Specific HTML/CSS/JS code example showing the fix",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "priority": "high|medium|low"
}

Focus on practical, implementable solutions. Return valid JSON only.`;

        console.log('🚀 Sending request to OpenAI...');

        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert web accessibility consultant specializing in WCAG compliance. Always respond with valid JSON.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            max_tokens: 2000,
            temperature: 0.3
        });
        
        console.log('✅ Received response from OpenAI');
        
        const aiResponse = response.choices[0].message.content;
        console.log('📄 AI Response length:', aiResponse.length);
        
        // Try to parse JSON response
        try {
            // Clean the response - remove markdown code blocks if present
            let cleanResponse = aiResponse.trim();
            if (cleanResponse.startsWith('```json')) {
                cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
            } else if (cleanResponse.startsWith('```')) {
                cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
            }
            
            console.log('🧹 Cleaned AI response, length:', cleanResponse.length);
            
            const suggestions = JSON.parse(cleanResponse);
            console.log('✅ Successfully parsed AI response as JSON');
            return Array.isArray(suggestions) ? suggestions : [suggestions];
        } catch (parseError) {
            console.warn('⚠️ Failed to parse AI response as JSON, creating fallback response');
            console.log('Parse error:', parseError.message);
            console.log('Raw AI response:', aiResponse.substring(0, 300) + '...');
            
            // Create structured fallback based on AI response
            return violations.map((violation, index) => ({
                explanation: `AI Analysis: This ${violation.impact} impact violation "${violation.id}" affects user accessibility. ${violation.description || 'No description available'}`,
                codeExample: `<!-- Fix for ${violation.id} -->\n<!-- Please refer to WCAG guidelines for specific implementation -->`,
                steps: [
                    'Review the violation details carefully',
                    'Consult WCAG guidelines for best practices',
                    'Implement the recommended accessibility fixes',
                    'Test with screen readers and accessibility tools'
                ],
                priority: violation.impact === 'critical' ? 'high' : 
                         violation.impact === 'serious' ? 'high' :
                         violation.impact === 'moderate' ? 'medium' : 'low'
            }));
        }
        
    } catch (error) {
        console.error('❌ Error in AI suggestions generation:', error);
        
        // Provide fallback suggestions
        return violations.map(violation => ({
            explanation: `This ${violation.impact} impact violation needs attention. ${violation.description}`,
            codeExample: 'Please refer to WCAG guidelines for specific implementation details.',
            steps: [
                'Review the violation details carefully',
                'Consult WCAG guidelines for best practices',
                'Implement the recommended accessibility fixes',
                'Test with screen readers and accessibility tools'
            ],
            priority: violation.impact === 'critical' ? 'high' : 
                     violation.impact === 'serious' ? 'high' :
                     violation.impact === 'moderate' ? 'medium' : 'low'
        }));
    }
}

// ENHANCED: Main dashboard with navigation routing
app.get('/', (req, res) => {
    const aiFeatureHTML = process.env.OPENAI_API_KEY ? 
        '<div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e1e5e9;">' +
            '<label style="display: flex; align-items: center; gap: 8px;">' +
                '<input type="checkbox" id="enableAI" checked>' + 
                'Enable AI Fix Suggestions' +
                '<span style="background: linear-gradient(135deg, #8b5cf6, #3b82f6); color: white; padding: 2px 8px; border-radius: 12px; font-size: 0.7rem; font-weight: 600;">NEW</span>' +
            '</label>' +
        '</div>' : '';

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
        
        .page-header {
            margin-bottom: 24px;
        }
        
        .page-title {
            font-size: 1.8rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .page-subtitle {
            color: #666;
            font-size: 1rem;
        }
        
        /* Dashboard Overview Styles */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border-left: 4px solid #667eea;
        }
        
        .stat-card h3 {
            font-size: 0.9rem;
            color: #666;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .stat-card .stat-value {
            font-size: 2rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 4px;
        }
        
        .stat-card .stat-change {
            font-size: 0.8rem;
            color: #28a745;
        }
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 30px;
        }
        
        .action-card {
            background: white;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            text-align: center;
            cursor: pointer;
            transition: transform 0.2s ease;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .action-card .action-icon {
            font-size: 2rem;
            margin-bottom: 12px;
        }
        
        .action-card h4 {
            font-size: 1rem;
            margin-bottom: 8px;
        }
        
        .action-card p {
            font-size: 0.8rem;
            color: #666;
        }
        
        /* Scanner and Results Styles */
        .new-scan-btn {
            background: #1a1a1a;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 20px;
        }
        
        .new-scan-btn:hover {
            background: #333;
        }
        
        .scanner-section {
            background: white;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 30px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            display: none;
        }
        
        .scanner-section h2 {
            margin-bottom: 20px;
            color: #333;
        }
        
        .scanner-section form {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        
        .scanner-section input[type="url"] {
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
        }
        
        .scan-options {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 6px;
            border: 1px solid #e1e5e9;
        }
        
        .scan-options h4 {
            margin-bottom: 12px;
            color: #333;
        }
        
        .scan-options label {
            display: block;
            margin-bottom: 8px;
            cursor: pointer;
        }
        
        .scan-options input[type="number"] {
            width: 60px;
            padding: 4px 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin: 0 4px;
        }
        
        .scanner-section button[type="submit"] {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s ease;
        }
        
        .scanner-section button[type="submit"]:hover {
            background: #5a6fd8;
        }
        
        .scanner-section button[type="submit"]:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        
        /* Results Styles */
        .results {
            background: white;
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 30px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .results h2 {
            margin-bottom: 20px;
            color: #333;
        }
        
        .scan-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .summary-card {
            background: #f8f9fa;
            padding: 16px;
            border-radius: 6px;
            text-align: center;
        }
        
        .summary-card h4 {
            font-size: 0.9rem;
            color: #666;
            margin-bottom: 8px;
            text-transform: uppercase;
        }
        
        .summary-card .value {
            font-size: 1.5rem;
            font-weight: 600;
            color: #333;
        }
        
        .violations-list {
            margin-top: 20px;
        }
        
        .violation-item {
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            margin-bottom: 12px;
            overflow: hidden;
        }
        
        .violation-header {
            background: #f8f9fa;
            padding: 16px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
        }
        
        .violation-header:hover {
            background: #e9ecef;
        }
        
        .violation-title {
            font-weight: 500;
            color: #333;
        }
        
        .violation-impact {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .violation-impact.critical {
            background: #dc3545;
            color: white;
        }
        
        .violation-impact.serious {
            background: #fd7e14;
            color: white;
        }
        
        .violation-impact.moderate {
            background: #ffc107;
            color: #333;
        }
        
        .violation-impact.minor {
            background: #6c757d;
            color: white;
        }
        
        .violation-details {
            padding: 16px;
            border-top: 1px solid #e1e5e9;
            display: none;
        }
        
        .violation-details.show {
            display: block;
        }
        
        .violation-description {
            margin-bottom: 12px;
            color: #666;
        }
        
        .violation-help {
            background: #e7f3ff;
            padding: 12px;
            border-radius: 4px;
            border-left: 4px solid #0066cc;
            margin-bottom: 12px;
        }
        
        .violation-elements {
            margin-top: 12px;
        }
        
        .violation-elements h5 {
            margin-bottom: 8px;
            color: #333;
        }
        
        .element-item {
            background: #f8f9fa;
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 4px;
            font-family: monospace;
            font-size: 0.9rem;
            word-break: break-all;
        }
        
        /* Recent Scans Styles */
        .recent-scans {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .recent-scans h3 {
            margin-bottom: 20px;
            color: #333;
        }
        
        .scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px;
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            margin-bottom: 12px;
        }
        
        .scan-info h4 {
            margin-bottom: 4px;
            color: #333;
        }
        
        .scan-meta {
            font-size: 0.9rem;
            color: #666;
        }
        
        .scan-score {
            font-weight: 600;
            color: #28a745;
            margin-right: 12px;
        }
        
        .view-report-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 0.9rem;
            cursor: pointer;
        }
        
        .view-report-btn:hover {
            background: #5a6fd8;
        }
        
        /* Database Status */
        .db-status {
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 0.9rem;
        }
        
        .db-connected {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .db-standalone {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        
        /* Page Content Management */
        .page-content {
            display: none;
        }
        
        .page-content.active {
            display: block;
        }

        /* AI Suggestions Modal Styles */
        .ai-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }

        .ai-modal-content {
            background-color: white;
            margin: 5% auto;
            padding: 0;
            border-radius: 8px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow: hidden;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }

        .ai-modal-header {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .ai-modal-header h2 {
            margin: 0;
            font-size: 1.5rem;
        }

        .ai-close {
            color: white;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            background: none;
            border: none;
        }

        .ai-close:hover {
            opacity: 0.7;
        }

        .ai-modal-body {
            padding: 20px;
            max-height: 60vh;
            overflow-y: auto;
        }

        .ai-suggestion {
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
        }

        .ai-suggestion-header {
            background: #f8f9fa;
            padding: 15px;
            border-bottom: 1px solid #e1e5e9;
        }

        .ai-suggestion-content {
            padding: 15px;
        }

        .ai-explanation {
            margin-bottom: 15px;
            line-height: 1.6;
        }

        .ai-code-example {
            background: #f8f9fa;
            border: 1px solid #e1e5e9;
            border-radius: 4px;
            padding: 12px;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            margin-bottom: 15px;
            white-space: pre-wrap;
            overflow-x: auto;
        }

        .ai-steps {
            margin-bottom: 15px;
        }

        .ai-steps h5 {
            margin-bottom: 8px;
            color: #333;
        }

        .ai-steps ol {
            padding-left: 20px;
        }

        .ai-steps li {
            margin-bottom: 4px;
            line-height: 1.4;
        }

        .ai-priority {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
        }

        .ai-priority.high {
            background: #dc3545;
            color: white;
        }

        .ai-priority.medium {
            background: #ffc107;
            color: #333;
        }

        .ai-priority.low {
            background: #6c757d;
            color: white;
        }

        .ai-loading {
            text-align: center;
            padding: 40px;
            color: #666;
        }

        .ai-error {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 15px;
        }

        .ai-button {
            background: linear-gradient(135deg, #8b5cf6, #3b82f6);
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }

        .ai-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
        }

        .ai-button:disabled {
            background: #ccc;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
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
                <div class="nav-item active" data-page="dashboard">
                    <div class="nav-icon">📊</div>
                    <span>Dashboard</span>
                </div>
                <div class="nav-item" data-page="scans">
                    <div class="nav-icon">🔍</div>
                    <span>Scans</span>
                </div>
                <div class="nav-item" data-page="analytics">
                    <div class="nav-icon">📈</div>
                    <span>Analytics</span>
                </div>
                <div class="nav-item" data-page="team">
                    <div class="nav-icon">👥</div>
                    <span>Team</span>
                </div>
                <div class="nav-item" data-page="integrations">
                    <div class="nav-icon">🔗</div>
                    <span>Integrations</span>
                </div>
                <div class="nav-item" data-page="api">
                    <div class="nav-icon">⚙️</div>
                    <span>API</span>
                </div>
                <div class="nav-item" data-page="billing">
                    <div class="nav-icon">💳</div>
                    <span>Billing</span>
                </div>
                <div class="nav-item" data-page="settings">
                    <div class="nav-icon">⚙️</div>
                    <span>Settings</span>
                </div>
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
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <span>John Doe</span>
                    </div>
                </div>
            </div>
            
            <!-- Content Area -->
            <div class="content-area">
                <!-- Dashboard Overview Page -->
                <div id="dashboard-page" class="page-content active">
                    <div class="page-header">
                        <h1 class="page-title">Dashboard Overview</h1>
                        <p class="page-subtitle">Monitor your accessibility compliance at a glance</p>
                    </div>
                    
                    <!-- Statistics Grid -->
                    <div class="stats-grid">
                        <div class="stat-card">
                            <h3>Total Scans</h3>
                            <div class="stat-value" id="totalScans">0</div>
                            <div class="stat-change">+2 this week</div>
                        </div>
                        <div class="stat-card">
                            <h3>Issues Found</h3>
                            <div class="stat-value" id="totalIssues">0</div>
                            <div class="stat-change">-5 from last week</div>
                        </div>
                        <div class="stat-card">
                            <h3>Average Score</h3>
                            <div class="stat-value" id="avgScore">0%</div>
                            <div class="stat-change">+3% improvement</div>
                        </div>
                        <div class="stat-card">
                            <h3>This Week</h3>
                            <div class="stat-value" id="weeklyScans">0</div>
                            <div class="stat-change">scans completed</div>
                        </div>
                    </div>
                    
                    <!-- Quick Actions -->
                    <div class="quick-actions">
                        <div class="action-card" onclick="switchToPage('scans')">
                            <div class="action-icon">🔍</div>
                            <h4>New Scan</h4>
                            <p>Start a new accessibility scan</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('analytics')">
                            <div class="action-icon">📈</div>
                            <h4>View Reports</h4>
                            <p>Analyze your compliance trends</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('team')">
                            <div class="action-icon">👥</div>
                            <h4>Manage Team</h4>
                            <p>Invite and manage team members</p>
                        </div>
                        <div class="action-card" onclick="switchToPage('integrations')">
                            <div class="action-icon">🔗</div>
                            <h4>Integrations</h4>
                            <p>Connect your platforms</p>
                        </div>
                    </div>
                    
                    <!-- Recent Activity -->
                    <div class="recent-scans">
                        <h3>Recent Activity</h3>
                        <p style="color: #666; margin-bottom: 20px;">Your latest accessibility scans and results</p>
                        
                        <div id="dashboardRecentScans">
                            <div style="text-align: center; padding: 20px; color: #666;">
                                🔄 Loading recent activity...
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Scans Page -->
                <div id="scans-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">Accessibility Scans</h1>
                        <p class="page-subtitle">Manage and review your accessibility scans</p>
                    </div>
                    
                    <!-- Database Status Indicator -->
                    <div id="dbStatus" class="db-status">
                        <span id="dbStatusText">🔄 Checking database connection...</span>
                    </div>
                    
                    <button class="new-scan-btn" onclick="toggleScanner()">
                        <span>+</span>
                        New Scan
                    </button>
                    
                    <!-- Scanner Section -->
                    <div class="scanner-section" id="scannerSection">
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
                                
                                ${aiFeatureHTML}
                            </div>
                            
                            <button type="submit" id="scanButton">🔍 Start Accessibility Scan</button>
                        </form>
                    </div>
                    
                    <!-- Results Section -->
                    <div id="results" class="results" style="display: none;">
                        <h2>Scan Results</h2>
                        <div id="resultsContent"></div>
                    </div>
                    
                    <!-- Recent Scans -->
                    <div class="recent-scans">
                        <h3>Recent Scans</h3>
                        <p style="color: #666; margin-bottom: 20px;">Your latest accessibility scan results</p>
                        
                        <div id="recentScansContainer">
                            <div style="text-align: center; padding: 20px; color: #666;">
                                🔄 Loading recent scans...
                            </div>
                        </div>
                    </div>
                </div>
                
                <!-- Placeholder pages for other navigation items -->
                <div id="analytics-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">Analytics</h1>
                        <p class="page-subtitle">Detailed accessibility compliance reports and trends</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        📈 Analytics page coming soon...
                    </div>
                </div>
                
                <div id="team-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">Team Management</h1>
                        <p class="page-subtitle">Manage team members and permissions</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        👥 Team management coming soon...
                    </div>
                </div>
                
                <div id="integrations-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">Integrations</h1>
                        <p class="page-subtitle">Connect with your favorite platforms</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        🔗 Platform integrations coming soon...
                    </div>
                </div>
                
                <div id="api-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">API Management</h1>
                        <p class="page-subtitle">Manage API keys and access</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        ⚙️ API management coming soon...
                    </div>
                </div>
                
                <div id="billing-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">Billing</h1>
                        <p class="page-subtitle">Manage your subscription and usage</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        💳 Billing management coming soon...
                    </div>
                </div>
                
                <div id="settings-page" class="page-content">
                    <div class="page-header">
                        <h1 class="page-title">Settings</h1>
                        <p class="page-subtitle">Configure your account and preferences</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        ⚙️ Settings page coming soon...
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- AI Suggestions Modal -->
    <div id="aiModal" class="ai-modal">
        <div class="ai-modal-content">
            <div class="ai-modal-header">
                <h2>🤖 AI Fix Suggestions</h2>
                <button class="ai-close" onclick="closeAIModal()">&times;</button>
            </div>
            <div class="ai-modal-body" id="aiModalBody">
                <div class="ai-loading">
                    <div>🤖 Analyzing accessibility issues...</div>
                    <div style="margin-top: 10px; font-size: 0.9rem; color: #888;">This may take a few seconds</div>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        // Navigation function - FIXED
        function switchToPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page-content').forEach(page => {
                page.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId + '-page').classList.add('active');
            
            // Update active nav item
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector('[data-page="' + pageId + '"]').classList.add('active');
            
            // Load page-specific data
            if (pageId === 'dashboard') {
                loadDashboardData();
            } else if (pageId === 'scans') {
                checkDatabaseStatus();
                loadRecentScans();
            }
        }
        
        // Initialize navigation event listeners
        document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('.nav-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.preventDefault();
                    const pageId = item.getAttribute('data-page');
                    switchToPage(pageId);
                });
            });
            
            // Load dashboard by default
            loadDashboardData();
        });
        
        // Load dashboard statistics
        async function loadDashboardData() {
            try {
                const response = await fetch('/api/dashboard/stats');
                const data = await response.json();
                
                if (data.success) {
                    document.getElementById('totalScans').textContent = data.stats.totalScans;
                    document.getElementById('totalIssues').textContent = data.stats.totalIssues;
                    document.getElementById('avgScore').textContent = data.stats.avgScore + '%';
                    document.getElementById('weeklyScans').textContent = data.stats.weeklyScans;
                }
            } catch (error) {
                console.error('Error loading dashboard stats:', error);
            }
            
            // Also load recent scans for dashboard
            loadDashboardRecentScans();
        }
        
        // Load recent scans for dashboard
        async function loadDashboardRecentScans() {
            try {
                const response = await fetch('/api/scans/recent?limit=5');
                const data = await response.json();
                
                const container = document.getElementById('dashboardRecentScans');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => 
                        '<div class="scan-item">' +
                        '<div class="scan-info">' +
                        '<h4>' + scan.url + '</h4>' +
                        '<div class="scan-meta">' + (scan.scan_type === 'single' ? 'Single Page' : 'Multi-page') + ' • ' + new Date(scan.created_at).toLocaleDateString() + '</div>' +
                        '</div>' +
                        '<div style="display: flex; align-items: center;">' +
                        '<span class="scan-score">' + scan.score + '% Score</span>' +
                        '<button class="view-report-btn" onclick="switchToPage(\'scans\')">👁 View Details</button>' +
                        '</div>' +
                        '</div>'
                    ).join('');
                } else {
                    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No recent activity. <a href="#" onclick="switchToPage(\'scans\')">Start your first scan</a>!</div>';
                }
            } catch (error) {
                console.error('Error loading dashboard recent scans:', error);
                document.getElementById('dashboardRecentScans').innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Unable to load recent activity.</div>';
            }
        }
        


        // Database status check function
        async function checkDatabaseStatus() {
            try {
                const response = await fetch('/health');
                const data = await response.json();
                
                const statusDiv = document.getElementById('dbStatus');
                const statusText = document.getElementById('dbStatusText');
                
                if (data.database === 'connected') {
                    statusDiv.className = 'db-status db-connected';
                    statusText.textContent = '✅ Database connected - Scans will be saved to your history';
                } else {
                    statusDiv.className = 'db-status db-standalone';
                    statusText.textContent = '⚠️ Running in standalone mode - Scans will not be saved';
                }
            } catch (error) {
                console.error('Error checking database status:', error);
            }
        }

        // Load recent scans function
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const data = await response.json();
                
                const container = document.getElementById('recentScansContainer');
                
                if (data.success && data.scans.length > 0) {
                    container.innerHTML = data.scans.map(scan => 
                        '<div class="scan-item">' +
                        '<div class="scan-info">' +
                        '<h4>' + scan.url + '</h4>' +
                        '<div class="scan-meta">' + (scan.scan_type === 'single' ? 'Single Page' : 'Multi-page') + ' • ' + new Date(scan.created_at).toLocaleDateString() + '</div>' +
                        '</div>' +
                        '<div style="display: flex; align-items: center;">' +
                        '<span class="scan-score">' + scan.score + '% Score</span>' +
                        '<button class="view-report-btn">👁 View Report</button>' +
                        '</div>' +
                        '</div>'
                    ).join('');
                } else {
                    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #666;">No scans yet. Start your first scan above!</div>';
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('recentScansContainer').innerHTML = '<div style="text-align: center; padding: 20px; color: #dc3545;">Unable to load recent scans.</div>';
            }
        }
        
        // Toggle scanner visibility
        function toggleScanner() {
            const scanner = document.getElementById('scannerSection');
            scanner.style.display = scanner.style.display === 'none' ? 'block' : 'none';
        }
        
        // Scanner form submission with AI integration
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            const url = document.getElementById('url').value;
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const maxPages = document.getElementById('maxPages').value;
            const enableAI = document.getElementById('enableAI') ? document.getElementById('enableAI').checked : false;
            const resultsDiv = document.getElementById('results');
            const resultsContent = document.getElementById('resultsContent');
            const scanButton = document.getElementById('scanButton');
            
            // Show loading state
            scanButton.disabled = true;
            scanButton.textContent = '🔄 Scanning...';
            resultsDiv.style.display = 'block';
            resultsContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #666;">🔍 Scanning website for accessibility issues...</div>';
            
            try {
                const response = await fetch('/scan', {
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
                    displayResults(result, enableAI);
                    // Reload recent scans to show the new scan
                    loadRecentScans();
                } else {
                    resultsContent.innerHTML = '<div style="color: #dc3545; padding: 20px; text-align: center;">❌ ' + result.error + '</div>';
                }
            } catch (error) {
                console.error('Scan error:', error);
                resultsContent.innerHTML = '<div style="color: #dc3545; padding: 20px; text-align: center;">❌ Network error. Please try again.</div>';
            } finally {
                scanButton.disabled = false;
                scanButton.textContent = '🔍 Start Accessibility Scan';
            }
        });
        
        // Display results with AI integration
        function displayResults(result, enableAI = false) {
            const resultsContent = document.getElementById('resultsContent');
            
            if (result.scanType === 'single') {
                displaySinglePageResults(result, enableAI);
            } else {
                displayMultiPageResults(result, enableAI);
            }
        }
        
        function displaySinglePageResults(result, enableAI) {
            const violations = result.violations || [];
            const summary = result.summary || {};
            
            let content = '<div class="scan-summary">' +
                '<div class="summary-card">' +
                    '<h4>Total Issues</h4>' +
                    '<div class="value">' + violations.length + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Critical</h4>' +
                    '<div class="value" style="color: #dc3545;">' + (summary.critical || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Serious</h4>' +
                    '<div class="value" style="color: #fd7e14;">' + (summary.serious || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Moderate</h4>' +
                    '<div class="value" style="color: #ffc107;">' + (summary.moderate || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Minor</h4>' +
                    '<div class="value" style="color: #6c757d;">' + (summary.minor || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Scan Time</h4>' +
                    '<div class="value">' + result.scanTime + 'ms</div>' +
                '</div>' +
            '</div>';
            
            if (enableAI && violations.length > 0) {
                content += '<div style="margin-bottom: 20px; text-align: center;">' +
                    '<button class="ai-button" onclick="showAISuggestions(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')">' +
                        '🤖 Get AI Fix Suggestions' +
                    '</button>' +
                '</div>';
            }
            
            if (violations.length > 0) {
                content += '<div class="violations-list">';
                violations.forEach((violation, index) => {
                    content += '<div class="violation-item">' +
                        '<div class="violation-header" onclick="toggleViolation(' + index + ')">' +
                            '<div class="violation-title">' + violation.id + '</div>' +
                            '<span class="violation-impact ' + violation.impact + '">' + violation.impact + '</span>' +
                        '</div>' +
                        '<div class="violation-details" id="violation-' + index + '">' +
                            '<div class="violation-description">' + violation.description + '</div>' +
                            (violation.help ? '<div class="violation-help">' + violation.help + '</div>' : '') +
                            '<div class="violation-elements">' +
                                '<h5>Affected Elements (' + violation.nodes.length + '):</h5>' +
                                violation.nodes.slice(0, 3).map(node => '<div class="element-item">' + node.html + '</div>').join('') +
                                (violation.nodes.length > 3 ? '<div style="color: #666; font-size: 0.9rem; margin-top: 8px;">... and ' + (violation.nodes.length - 3) + ' more elements</div>' : '') +
                            '</div>' +
                        '</div>' +
                    '</div>';
                });
                content += '</div>';
            } else {
                content += '<div style="text-align: center; padding: 40px; color: #28a745;">✅ No accessibility issues found! This page appears to be fully compliant.</div>';
            }
            
            document.getElementById('resultsContent').innerHTML = content;
        }
        
        function displayMultiPageResults(result, enableAI) {
            const pages = result.pages || [];
            const allViolations = pages.reduce((acc, page) => acc.concat(page.violations || []), []);
            const summary = result.summary || {};
            
            let content = '<div class="scan-summary">' +
                '<div class="summary-card">' +
                    '<h4>Pages Scanned</h4>' +
                    '<div class="value">' + pages.length + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Total Issues</h4>' +
                    '<div class="value">' + (result.totalIssues || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Critical</h4>' +
                    '<div class="value" style="color: #dc3545;">' + (summary.critical || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Serious</h4>' +
                    '<div class="value" style="color: #fd7e14;">' + (summary.serious || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Moderate</h4>' +
                    '<div class="value" style="color: #ffc107;">' + (summary.moderate || 0) + '</div>' +
                '</div>' +
                '<div class="summary-card">' +
                    '<h4>Scan Time</h4>' +
                    '<div class="value">' + result.scanTime + 'ms</div>' +
                '</div>' +
            '</div>';
            
            if (enableAI && allViolations.length > 0) {
                content += '<div style="margin-bottom: 20px; text-align: center;">' +
                    '<button class="ai-button" onclick="showAISuggestions(' + JSON.stringify(allViolations).replace(/"/g, '&quot;') + ')">' +
                        '🤖 Get AI Fix Suggestions for All Issues' +
                    '</button>' +
                '</div>';
            }
            
            content += '<h3>Pages Scanned:</h3>' +
                '<div style="background: #f8f9fa; border-radius: 6px; padding: 16px;">' +
                    pages.map(page => 
                        '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #eee;">' +
                            '<div>' +
                                '<div style="font-weight: 500;">' + page.url + '</div>' +
                                '<div style="font-size: 0.8rem; color: #666;">' + (page.violations ? page.violations.length : 0) + ' issues • ' + (page.loadTime || page.scanTime) + 'ms</div>' +
                            '</div>' +
                            (page.error ? '<span style="color: #dc3545;">Error</span>' : '<span style="color: #28a745;">✓</span>') +
                        '</div>'
                    ).join('') +
                '</div>';
            
            document.getElementById('resultsContent').innerHTML = content;
        }
        
        // Toggle violation details
        function toggleViolation(index) {
            const details = document.getElementById('violation-' + index);
            details.classList.toggle('show');
        }

        // AI Suggestions Modal Functions
        function showAISuggestions(violations) {
            const modal = document.getElementById('aiModal');
            const modalBody = document.getElementById('aiModalBody');
            
            // Show modal with loading state
            modal.style.display = 'block';
            modalBody.innerHTML = '<div class="ai-loading">' +
                '<div>🤖 Analyzing accessibility issues...</div>' +
                '<div style="margin-top: 10px; font-size: 0.9rem; color: #888;">This may take a few seconds</div>' +
            '</div>';
            
            // Fetch AI suggestions
            fetchAISuggestions(violations);
        }

        async function fetchAISuggestions(violations) {
            const modalBody = document.getElementById('aiModalBody');
            
            try {
                const response = await fetch('/api/ai-fixes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ violations: violations })
                });
                
                const suggestions = await response.json();
                
                if (response.ok && Array.isArray(suggestions)) {
                    displayAISuggestions(suggestions);
                } else {
                    throw new Error(suggestions.error || 'Failed to get AI suggestions');
                }
            } catch (error) {
                console.error('Error fetching AI suggestions:', error);
                modalBody.innerHTML = '<div class="ai-error">' +
                    '❌ Failed to generate AI suggestions: ' + error.message +
                '</div>' +
                '<div style="text-align: center; margin-top: 20px;">' +
                    '<button class="ai-button" onclick="fetchAISuggestions(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')">' +
                        '🔄 Try Again' +
                    '</button>' +
                '</div>';
            }
        }

        function displayAISuggestions(suggestions) {
            const modalBody = document.getElementById('aiModalBody');
            
            let content = '';
            
            suggestions.forEach((suggestion, index) => {
                content += '<div class="ai-suggestion">' +
                    '<div class="ai-suggestion-header">' +
                        '<h4>Fix Suggestion #' + (index + 1) + '</h4>' +
                        '<span class="ai-priority ' + (suggestion.priority || 'medium') + '">' + (suggestion.priority || 'medium') + ' priority</span>' +
                    '</div>' +
                    '<div class="ai-suggestion-content">' +
                        '<div class="ai-explanation">' +
                            (suggestion.explanation || 'No explanation provided') +
                        '</div>' +
                        
                        (suggestion.codeExample ? 
                            '<h5>Code Example:</h5>' +
                            '<div class="ai-code-example">' + suggestion.codeExample + '</div>'
                        : '') +
                        
                        (suggestion.steps && suggestion.steps.length > 0 ? 
                            '<div class="ai-steps">' +
                                '<h5>Implementation Steps:</h5>' +
                                '<ol>' +
                                    suggestion.steps.map(step => '<li>' + step + '</li>').join('') +
                                '</ol>' +
                            '</div>'
                        : '') +
                    '</div>' +
                '</div>';
            });
            
            modalBody.innerHTML = content;
        }

        function closeAIModal() {
            document.getElementById('aiModal').style.display = 'none';
        }

        // Close modal when clicking outside
        window.onclick = function(event) {
            const modal = document.getElementById('aiModal');
            if (event.target === modal) {
                closeAIModal();
            }
        }
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
            const baseUrlObj = new URL(baseUrl);
            
            return anchors
                .map(a => {
                    try {
                        const href = a.getAttribute('href');
                        if (!href) return null;
                        
                        // Convert relative URLs to absolute
                        const url = new URL(href, baseUrl);
                        
                        // Only include URLs from the same domain
                        if (url.hostname === baseUrlObj.hostname) {
                            return url.href;
                        }
                        return null;
                    } catch (e) {
                        return null;
                    }
                })
                .filter(url => url !== null)
                .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
                .slice(0, 50); // Limit to 50 links to prevent excessive crawling
        }, baseUrl);
        
        return links;
    } catch (error) {
        console.log('Error extracting links:', error.message);
        return [];
    }
}

// Helper function to scan a single page
async function scanSinglePage(browser, url) {
    const page = await browser.newPage();
    
    try {
        console.log('🔍 Navigating to:', url);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        console.log('📄 Page loaded, injecting axe-core...');
        await page.addScriptTag({ content: axeCore.source });
        
        console.log('🔍 Running accessibility scan...');
        const results = await page.evaluate(async () => {
            return await axe.run();
        });
        
        console.log('✅ Scan completed for:', url);
        return results;
        
    } catch (error) {
        console.log('❌ Error scanning page:', url, error.message);
        throw error;
    } finally {
        await page.close();
    }
}

// Main scan endpoint - PRESERVED FUNCTIONALITY
app.post('/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const { url: targetUrl, scanType = 'single', maxPages = 5 } = req.body;
        
        if (!targetUrl) {
            return res.status(400).json({ error: 'URL is required' });
        }
        
        console.log('🚀 Starting ' + scanType + ' scan for:', targetUrl);
        
        // Launch browser with optimized settings
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        
        if (scanType === 'single') {
            // Single page scan - PRESERVED LOGIC
            console.log('🔍 Performing single page scan...');
            const results = await scanSinglePage(browser, targetUrl);
            const scanTime = Date.now() - startTime;
            
            console.log('✅ Single page scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
            
            // Save to database - ADDED FOR PERSISTENCE
            await saveScan(1, 1, targetUrl, scanType, results.violations.length, scanTime, 1, results.violations);
            
            res.json({
                success: true,
                scanType: 'single',
                url: targetUrl,
                violations: results.violations,
                scanTime: scanTime,
                timestamp: new Date().toISOString(),
                summary: {
                    critical: results.violations.filter(v => v.impact === 'critical').length,
                    serious: results.violations.filter(v => v.impact === 'serious').length,
                    moderate: results.violations.filter(v => v.impact === 'moderate').length,
                    minor: results.violations.filter(v => v.impact === 'minor').length
                }
            });
        } else {
            // Multi-page crawl - PRESERVED LOGIC
            console.log('🕷️ Performing multi-page crawl (max ' + maxPages + ' pages)...');
            
            const scannedUrls = new Set();
            const scannedPages = [];
            const urlsToScan = [targetUrl];
            
            // Scan the main page first
            console.log('🔍 Scanning main page: ' + targetUrl);
            const mainPageResults = await scanSinglePage(browser, targetUrl);
            scannedPages.push({
                url: targetUrl,
                violations: mainPageResults.violations,
                loadTime: Date.now() - startTime
            });
            scannedUrls.add(targetUrl);
            
            // Extract links from main page if we need to scan more pages
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
                    console.log('🔍 Scanning page ' + (i + 1) + '/' + Math.min(urlsToScan.length, maxPages) + ': ' + pageUrl);
                    const pageStartTime = Date.now();
                    const pageResults = await scanSinglePage(browser, pageUrl);
                    
                    scannedPages.push({
                        url: pageUrl,
                        violations: pageResults.violations,
                        loadTime: Date.now() - pageStartTime
                    });
                    scannedUrls.add(pageUrl);
                    
                } catch (error) {
                    console.log('❌ Error scanning page ' + pageUrl + ':', error.message);
                    scannedPages.push({
                        url: pageUrl,
                        violations: [],
                        loadTime: 0,
                        error: error.message
                    });
                }
            }
            
            // Aggregate results
            const allViolations = scannedPages.reduce((acc, page) => acc.concat(page.violations || []), []);
            const scanTime = Date.now() - startTime;
            
            console.log('✅ Multi-page crawl completed in ' + scanTime + 'ms. Scanned ' + scannedPages.length + ' pages, found ' + allViolations.length + ' total violations.');
            
            // Save to database - ADDED FOR PERSISTENCE
            await saveScan(1, 1, targetUrl, scanType, allViolations.length, scanTime, scannedPages.length, allViolations);
            
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
        console.error('❌ Scan error:', error);
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
                console.log('🔒 Browser closed successfully');
            } catch (closeError) {
                console.error('❌ Error closing browser:', closeError);
            }
        }
    }
});

// Start server
app.listen(PORT, () => {
    console.log('🚀 SentryPrime Enterprise Dashboard running on port ' + PORT);
    console.log('📊 Health check: http://localhost:' + PORT + '/health');
    console.log('🔍 Scanner: http://localhost:' + PORT + '/');
    console.log('💾 Database: ' + (db ? 'Connected' : 'Standalone mode'));
    console.log('🌐 Environment: ' + (process.env.K_SERVICE ? 'Cloud Run' : 'Local'));
    console.log('🤖 AI Features: ' + (process.env.OPENAI_API_KEY ? 'Enabled' : 'Disabled'));
});
