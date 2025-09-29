const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Database configuration
let db = null;

// Initialize database connection if environment variables are available
if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME) {
    db = new Pool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 5432,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    console.log('📊 Database: Connected');
} else {
    console.log('ℹ️ No database configuration found, running in standalone mode');
}

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone'
    });
});

// Database functions
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned, violations) {
    if (!db) return null;
    
    try {
        const result = await db.query(
            `INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, violations_data, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) 
             RETURNING id`,
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned || 1, JSON.stringify(violations)]
        );
        return result.rows[0].id;
    } catch (error) {
        console.error('Database save error:', error);
        return null;
    }
}

async function getRecentScans(userId = 1, limit = 10) {
    if (!db) {
        // Return mock data for standalone mode
        return [
            {
                id: 1,
                url: 'https://company.com',
                scan_type: 'single',
                total_issues: 12,
                completed_at: '2024-09-18T10:30:00Z',
                pages_scanned: 1
            },
            {
                id: 2,
                url: 'https://company.com/products',
                scan_type: 'crawl',
                total_issues: 8,
                completed_at: '2024-09-18T09:15:00Z',
                pages_scanned: 3
            },
            {
                id: 3,
                url: 'https://company.com/about',
                scan_type: 'single',
                total_issues: 3,
                completed_at: '2024-09-17T14:20:00Z',
                pages_scanned: 1
            }
        ];
    }
    
    try {
        const result = await db.query(
            `SELECT id, url, scan_type, total_issues, completed_at, pages_scanned 
             FROM scans 
             WHERE user_id = $1 
             ORDER BY completed_at DESC 
             LIMIT $2`,
            [userId, limit]
        );
        return result.rows;
    } catch (error) {
        console.error('Database query error:', error);
        return [];
    }
}

async function getDashboardStats(userId = 1) {
    if (!db) {
        // Return mock data for standalone mode
        return {
            totalScans: 3,
            totalIssues: 22,
            averageScore: 92,
            thisWeekScans: 2
        };
    }
    
    try {
        const [totalScans, totalIssues, thisWeekScans] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM scans WHERE user_id = $1', [userId]),
            db.query('SELECT SUM(total_issues) as sum FROM scans WHERE user_id = $1', [userId]),
            db.query(`SELECT COUNT(*) as count FROM scans 
                     WHERE user_id = $1 AND completed_at >= NOW() - INTERVAL '7 days'`, [userId])
        ]);
        
        const stats = {
            totalScans: parseInt(totalScans.rows[0].count) || 0,
            totalIssues: parseInt(totalIssues.rows[0].sum) || 0,
            thisWeekScans: parseInt(thisWeekScans.rows[0].count) || 0
        };
        
        // Calculate average score (simplified: 100 - (issues per scan * 5))
        stats.averageScore = stats.totalScans > 0 
            ? Math.max(0, Math.min(100, 100 - ((stats.totalIssues / stats.totalScans) * 5)))
            : 100;
        
        return stats;
    } catch (error) {
        console.error('Database stats error:', error);
        return { totalScans: 0, totalIssues: 0, averageScore: 100, thisWeekScans: 0 };
    }
}

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

// NEW: AI Suggestions API endpoint
app.post('/api/ai-fixes', async (req, res) => {
    try {
        const { violations } = req.body;
        
        if (!violations || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'Violations array is required' });
        }

        // Generate AI suggestions for each violation (now async)
        const suggestions = await Promise.all(
            violations.map(async (violation) => {
                try {
                    const suggestion = await generateAISuggestion(violation);
                    return suggestion;
                } catch (error) {
                    console.error(`Error generating suggestion for ${violation.id}:`, error);
                    // Return fallback suggestion for this specific violation
                    return {
                        priority: 'medium',
                        explanation: `This accessibility issue (${violation.id}) needs attention to improve user experience for people with disabilities.`,
                        codeExample: `// Refer to WCAG guidelines for specific implementation details
// Violation: ${violation.id}
// Impact: ${violation.impact || 'moderate'}`,
                        steps: [
                            'Review the WCAG guidelines for this specific issue',
                            'Identify all instances of this problem on your site',
                            'Implement the recommended solution',
                            'Test with accessibility tools and real users',
                            'Document the fix for future reference'
                        ]
                    };
                }
            })
        );

        res.json(suggestions);
    } catch (error) {
        console.error('Error generating AI suggestions:', error);
        res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
});

async function generateAISuggestion(violation) {
    // First try predefined suggestions for common violations (for speed)
    const quickSuggestions = {
        'color-contrast': {
            priority: 'high',
            explanation: 'Text color does not have sufficient contrast against the background color, making it difficult for users with visual impairments to read.',
            codeExample: `/* Before */
.text { color: #999; background: #fff; }

/* After - Improved contrast */
.text { color: #333; background: #fff; }`,
            steps: [
                'Identify elements with insufficient color contrast',
                'Use a color contrast checker tool to test ratios',
                'Adjust text color or background color to meet WCAG AA standards (4.5:1 ratio)',
                'Test with users who have visual impairments',
                'Verify the new colors work across different devices and lighting conditions'
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
                'Find links with vague text like "click here" or "read more"',
                'Rewrite link text to be descriptive and specific',
                'Ensure link purpose is clear from the text alone',
                'For icon links, add aria-label attributes',
                'Test that links make sense when read out of context'
            ]
        }
    };

    // Return predefined suggestion if available
    if (quickSuggestions[violation.id]) {
        return quickSuggestions[violation.id];
    }

    // For all other violations, generate dynamic AI suggestions using OpenAI
    try {
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OpenAI API key not configured');
        }

        const prompt = `You are an accessibility expert. Generate a specific, actionable fix suggestion for this accessibility violation:

Violation ID: ${violation.id}
Description: ${violation.description || 'No description provided'}
Help: ${violation.help || 'No help text provided'}
Impact Level: ${violation.impact || 'moderate'}

Please provide:
1. A clear explanation of the issue
2. A practical code example showing before/after
3. Step-by-step implementation instructions

Format your response as JSON with these exact fields:
{
  "priority": "high|medium|low",
  "explanation": "Clear explanation of the accessibility issue",
  "codeExample": "Code example showing before and after",
  "steps": ["Step 1", "Step 2", "Step 3", "Step 4", "Step 5"]
}`;

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-3.5-turbo',
                messages: [
                    {
                        role: 'system',
                        content: 'You are an expert web accessibility consultant specializing in WCAG compliance. Provide practical, actionable solutions.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                max_tokens: 800,
                temperature: 0.3
            })
        });

        if (!response.ok) {
            throw new Error(`OpenAI API error: ${response.status}`);
        }

        const data = await response.json();
        const aiResponse = data.choices[0].message.content;
        
        // Parse the JSON response
        const suggestion = JSON.parse(aiResponse);
        
        // Validate the response has required fields
        if (!suggestion.explanation || !suggestion.codeExample || !suggestion.steps) {
            throw new Error('Invalid AI response format');
        }

        return suggestion;

    } catch (error) {
        console.error('Error generating AI suggestion:', error);
        
        // Fallback to enhanced default suggestion
        return {
            priority: 'medium',
            explanation: `This accessibility issue (${violation.id}) needs attention to improve user experience for people with disabilities. ${violation.description || ''}`,
            codeExample: `// Refer to WCAG guidelines for specific implementation details
// Violation: ${violation.id}
// Impact: ${violation.impact || 'moderate'}`,
            steps: [
                'Review the WCAG guidelines for this specific issue',
                'Identify all instances of this problem on your site',
                'Implement the recommended solution',
                'Test with accessibility tools and real users',
                'Document the fix for future reference'
            ]
        };
    }
}

// Main route - serves the dashboard HTML
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
            background: #f8fafc;
            color: #1a202c;
            line-height: 1.6;
        }
        
        .container {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 250px;
            background: #2d3748;
            color: white;
            padding: 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }
        
        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid #4a5568;
        }
        
        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #63b3ed;
        }
        
        .logo-subtitle {
            font-size: 0.875rem;
            color: #a0aec0;
            margin-top: 4px;
        }
        
        .nav-menu {
            padding: 20px 0;
        }
        
        .nav-item {
            display: block;
            padding: 12px 20px;
            color: #e2e8f0;
            text-decoration: none;
            transition: all 0.2s;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            cursor: pointer;
        }
        
        .nav-item:hover {
            background: #4a5568;
            color: #63b3ed;
        }
        
        .nav-item.active {
            background: #3182ce;
            color: white;
            border-right: 3px solid #63b3ed;
        }
        
        .main-content {
            flex: 1;
            margin-left: 250px;
            padding: 0;
        }
        
        .header {
            background: white;
            padding: 20px 30px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .search-bar {
            flex: 1;
            max-width: 400px;
            margin: 0 20px;
        }
        
        .search-input {
            width: 100%;
            padding: 10px 15px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            font-size: 14px;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .notification-icon {
            position: relative;
            padding: 8px;
            border-radius: 50%;
            background: #f7fafc;
            cursor: pointer;
        }
        
        .notification-badge {
            position: absolute;
            top: 0;
            right: 0;
            background: #e53e3e;
            color: white;
            border-radius: 50%;
            width: 18px;
            height: 18px;
            font-size: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: #3182ce;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
        }
        
        .user-info {
            display: flex;
            flex-direction: column;
        }
        
        .user-name {
            font-weight: 600;
            font-size: 14px;
        }
        
        .user-role {
            font-size: 12px;
            color: #718096;
        }
        
        .page {
            display: none;
            padding: 30px;
        }
        
        .page.active {
            display: block;
        }
        
        .dashboard-header {
            margin-bottom: 30px;
        }
        
        .dashboard-header h1 {
            font-size: 2rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 8px;
        }
        
        .dashboard-header p {
            color: #718096;
            font-size: 1.1rem;
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
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
        }
        
        .stat-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
        }
        
        .stat-title {
            font-size: 0.875rem;
            font-weight: 500;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .stat-value {
            font-size: 2.5rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 8px;
        }
        
        .stat-change {
            font-size: 0.875rem;
            color: #38a169;
        }
        
        .actions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .action-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
            cursor: pointer;
            transition: all 0.2s;
            text-align: center;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .action-card.primary {
            border-color: #3182ce;
            background: linear-gradient(135deg, #3182ce 0%, #2c5aa0 100%);
            color: white;
        }
        
        .action-card.secondary {
            border-color: #805ad5;
            background: linear-gradient(135deg, #805ad5 0%, #6b46c1 100%);
            color: white;
        }
        
        .action-card.success {
            border-color: #38a169;
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
            color: white;
        }
        
        .action-icon {
            font-size: 2.5rem;
            margin-bottom: 12px;
        }
        
        .action-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 8px;
        }
        
        .action-description {
            font-size: 0.875rem;
            opacity: 0.9;
        }
        
        .recent-scans {
            background: white;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
        }
        
        .recent-scans-header {
            padding: 24px 24px 0 24px;
            border-bottom: 1px solid #e2e8f0;
            margin-bottom: 0;
            padding-bottom: 16px;
        }
        
        .recent-scans-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .recent-scans-subtitle {
            color: #718096;
            font-size: 0.875rem;
        }
        
        .recent-scans-body {
            padding: 0;
        }
        
        .scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 24px;
            border-bottom: 1px solid #f7fafc;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info {
            flex: 1;
        }
        
        .scan-url {
            font-weight: 500;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .scan-meta {
            font-size: 0.875rem;
            color: #718096;
        }
        
        .scan-score {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.875rem;
            font-weight: 500;
            margin-right: 12px;
        }
        
        .score-excellent {
            background: #c6f6d5;
            color: #22543d;
        }
        
        .score-good {
            background: #fef5e7;
            color: #744210;
        }
        
        .score-needs-work {
            background: #fed7d7;
            color: #742a2a;
        }
        
        .view-report-btn {
            padding: 8px 16px;
            background: #3182ce;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 0.875rem;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .view-report-btn:hover {
            background: #2c5aa0;
        }
        
        /* Scan Form Styles */
        .scan-form {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
            margin-bottom: 30px;
        }
        
        .scan-form h2 {
            font-size: 1.5rem;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 20px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            font-weight: 500;
            color: #374151;
            margin-bottom: 8px;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.2s;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #3182ce;
            box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.1);
        }
        
        .scan-options {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .scan-option {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-option input[type="radio"] {
            margin-right: 8px;
        }
        
        .pages-input {
            width: 60px;
            padding: 4px 8px;
            border: 1px solid #d1d5db;
            border-radius: 4px;
            margin: 0 4px;
        }
        
        .scan-button {
            background: linear-gradient(135deg, #3182ce 0%, #2c5aa0 100%);
            color: white;
            border: none;
            padding: 14px 28px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .scan-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(49, 130, 206, 0.3);
        }
        
        .scan-button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        /* Database Status */
        .db-status {
            background: #c6f6d5;
            color: #22543d;
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 20px;
            font-size: 0.875rem;
            border: 1px solid #9ae6b4;
        }
        
        /* Scan Results Styles */
        .scan-results {
            background: white;
            border-radius: 12px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            border: 1px solid #e2e8f0;
            margin-bottom: 30px;
        }
        
        .results-header {
            padding: 24px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .results-title {
            font-size: 1.5rem;
            font-weight: 600;
            color: #1a202c;
        }
        
        .results-meta {
            color: #718096;
            font-size: 0.875rem;
        }
        
        .results-body {
            padding: 24px;
        }
        
        .results-summary {
            margin-bottom: 30px;
        }
        
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .summary-item {
            text-align: center;
            padding: 16px;
            background: #f7fafc;
            border-radius: 8px;
        }
        
        .summary-value {
            font-size: 2rem;
            font-weight: 700;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .summary-label {
            font-size: 0.875rem;
            color: #718096;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        
        .violation {
            background: #f7fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .violation-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        
        .violation-title {
            font-weight: 600;
            color: #1a202c;
            font-size: 1.1rem;
        }
        
        .violation-impact {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .impact-critical {
            background: #fed7d7;
            color: #742a2a;
        }
        
        .impact-serious {
            background: #fef5e7;
            color: #744210;
        }
        
        .impact-moderate {
            background: #e6fffa;
            color: #234e52;
        }
        
        .impact-minor {
            background: #ebf8ff;
            color: #2a4365;
        }
        
        .violation-body {
            color: #4a5568;
            line-height: 1.6;
        }
        
        .violation-description {
            margin-bottom: 8px;
        }
        
        .violation-help {
            font-size: 0.875rem;
        }
        
        .violation-help a {
            color: #3182ce;
            text-decoration: none;
        }
        
        .violation-help a:hover {
            text-decoration: underline;
        }
        
        .violation-elements {
            margin-top: 8px;
            font-size: 0.875rem;
            color: #718096;
        }
        
        .ai-suggestions-btn, .guided-fixing-btn {
            background: linear-gradient(135deg, #805ad5 0%, #6b46c1 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            margin-right: 12px;
        }
        
        .guided-fixing-btn {
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
        }
        
        .ai-suggestions-btn:hover, .guided-fixing-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(128, 90, 213, 0.3);
        }
        
        .guided-fixing-btn:hover {
            box-shadow: 0 4px 12px rgba(56, 161, 105, 0.3);
        }
        
        /* Modal Styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        
        .modal-content {
            background-color: white;
            margin: 5% auto;
            padding: 0;
            border-radius: 12px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
        }
        
        .modal-header {
            background: linear-gradient(135deg, #38a169 0%, #2f855a 100%);
            color: white;
            padding: 20px 24px;
            border-radius: 12px 12px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .modal-title {
            font-size: 1.25rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .progress-indicator {
            background: rgba(255,255,255,0.2);
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.875rem;
        }
        
        .close-btn {
            background: none;
            border: none;
            color: white;
            font-size: 1.5rem;
            cursor: pointer;
            padding: 4px;
            border-radius: 4px;
            transition: background 0.2s;
        }
        
        .close-btn:hover {
            background: rgba(255,255,255,0.1);
        }
        
        .modal-body {
            padding: 24px;
        }
        
        .modal-footer {
            padding: 20px 24px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .btn-secondary {
            background: #e2e8f0;
            color: #4a5568;
        }
        
        .btn-secondary:hover {
            background: #cbd5e0;
        }
        
        .btn-primary {
            background: #3182ce;
            color: white;
        }
        
        .btn-primary:hover {
            background: #2c5aa0;
        }
        
        .btn-success {
            background: #38a169;
            color: white;
        }
        
        .btn-success:hover {
            background: #2f855a;
        }
        
        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        
        /* Guided Fixing Specific Styles */
        .violation-details {
            background: #f7fafc;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        
        .violation-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 8px;
        }
        
        .violation-impact {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
            margin-bottom: 16px;
        }
        
        .ai-suggestion {
            background: white;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 20px;
            margin-top: 20px;
        }
        
        .ai-suggestion-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid #e2e8f0;
        }
        
        .priority-badge {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-high {
            background: #fed7d7;
            color: #742a2a;
        }
        
        .priority-medium {
            background: #fef5e7;
            color: #744210;
        }
        
        .priority-low {
            background: #e6fffa;
            color: #234e52;
        }
        
        .ai-suggestion-content {
            line-height: 1.6;
        }
        
        .ai-suggestion-content pre {
            background: #f8f9fa;
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 12px 0;
        }
        
        .ai-suggestion-content ol {
            padding-left: 20px;
            margin: 12px 0;
        }
        
        .ai-suggestion-content li {
            margin-bottom: 8px;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #718096;
        }
        
        .spinner {
            border: 3px solid #e2e8f0;
            border-top: 3px solid #3182ce;
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
    </style>
</head>
<body>
    <div class="container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <div class="logo">🛡️ SentryPrime</div>
                <div class="logo-subtitle">Enterprise Dashboard</div>
            </div>
            <nav class="nav-menu">
                <a href="#" class="nav-item active" onclick="switchToPage('dashboard')">📊 Dashboard</a>
                <a href="#" class="nav-item" onclick="switchToPage('scans')">🔍 Scans</a>
                <a href="#" class="nav-item" onclick="switchToPage('analytics')">📈 Analytics</a>
                <a href="#" class="nav-item" onclick="switchToPage('team')">👥 Team</a>
                <a href="#" class="nav-item" onclick="switchToPage('integrations')">🔗 Integrations</a>
                <a href="#" class="nav-item" onclick="switchToPage('api')">⚙️ API Management</a>
                <a href="#" class="nav-item" onclick="switchToPage('billing')">💳 Billing</a>
                <a href="#" class="nav-item" onclick="switchToPage('settings')">⚙️ Settings</a>
            </nav>
        </div>
        
        <!-- Main Content -->
        <div class="main-content">
            <!-- Header -->
            <div class="header">
                <div class="search-bar">
                    <input type="text" class="search-input" placeholder="Search scans, reports, or settings...">
                </div>
                <div class="user-menu">
                    <div class="notification-icon">
                        🔔
                        <div class="notification-badge">3</div>
                    </div>
                    <div class="user-avatar">JD</div>
                    <div class="user-info">
                        <div class="user-name">John Doe</div>
                        <div class="user-role">Acme Corporation</div>
                    </div>
                </div>
            </div>
            
            <!-- Pages -->
            <div class="pages">
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
                            <div class="stat-change" id="scans-change">+2 this week</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Issues Found</div>
                            </div>
                            <div class="stat-value" id="total-issues">-</div>
                            <div class="stat-change" id="issues-change">-5 from last week</div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Average Score</div>
                            </div>
                            <div class="stat-value" id="average-score">-</div>
                            <div class="stat-change" id="score-change">+3% improvement</div>
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
                        <p>Manage and review your accessibility scans</p>
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
                        <p>Detailed analytics and reporting</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        📈 Analytics dashboard coming soon...
                    </div>
                </div>
                
                <div id="team" class="page">
                    <div class="dashboard-header">
                        <h1>Team Management</h1>
                        <p>Manage your team members and permissions</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        👥 Team management coming soon...
                    </div>
                </div>
                
                <div id="integrations" class="page">
                    <div class="dashboard-header">
                        <h1>Integrations</h1>
                        <p>Connect with your favorite tools and services</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        🔗 Integrations coming soon...
                    </div>
                </div>
                
                <div id="api" class="page">
                    <div class="dashboard-header">
                        <h1>API Management</h1>
                        <p>Manage your API keys and access</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        ⚙️ API management coming soon...
                    </div>
                </div>
                
                <div id="billing" class="page">
                    <div class="dashboard-header">
                        <h1>Billing</h1>
                        <p>Manage your subscription and billing</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        💳 Billing management coming soon...
                    </div>
                </div>
                
                <div id="settings" class="page">
                    <div class="dashboard-header">
                        <h1>Settings</h1>
                        <p>Configure your account and preferences</p>
                    </div>
                    <div style="text-align: center; padding: 60px; color: #666;">
                        ⚙️ Settings coming soon...
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- AI Suggestions Modal -->
    <div id="ai-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <div class="modal-title">🤖 AI Fix Suggestions</div>
                <button class="close-btn" onclick="closeAIModal()">&times;</button>
            </div>
            <div class="modal-body" id="ai-modal-body">
                <!-- AI suggestions will be populated here -->
            </div>
        </div>
    </div>
    
    <!-- Guided Fixing Modal -->
    <div id="guided-fixing-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <div class="modal-title">🛠️ Guided Accessibility Fixing</div>
                <div class="progress-indicator" id="progress-indicator">Violation 1 of X</div>
                <button class="close-btn" onclick="GuidedFixing.close()">&times;</button>
            </div>
            <div class="modal-body" id="guided-modal-body">
                <!-- Guided fixing content will be populated here -->
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="prev-btn" onclick="GuidedFixing.previousViolation()">← Previous</button>
                <div>
                    <button class="btn btn-primary" id="next-btn" onclick="GuidedFixing.nextViolation()">Next →</button>
                    <button class="btn btn-success" id="finish-btn" onclick="GuidedFixing.finish()" style="display: none;">🎉 Finish & Generate Report</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        // Page navigation
        function switchToPage(pageId) {
            // Hide all pages
            const pages = document.querySelectorAll('.page');
            pages.forEach(page => page.classList.remove('active'));
            
            // Show selected page
            document.getElementById(pageId).classList.add('active');
            
            // Update navigation
            const navItems = document.querySelectorAll('.nav-item');
            navItems.forEach(item => item.classList.remove('active'));
            event.target.classList.add('active');
        }
        
        // Load dashboard data
        async function loadDashboardData() {
            try {
                const [statsResponse, scansResponse] = await Promise.all([
                    fetch('/api/dashboard/stats'),
                    fetch('/api/scans/recent')
                ]);
                
                if (statsResponse.ok) {
                    const stats = await statsResponse.json();
                    document.getElementById('total-scans').textContent = stats.totalScans;
                    document.getElementById('total-issues').textContent = stats.totalIssues;
                    document.getElementById('average-score').textContent = Math.round(stats.averageScore) + '%';
                    document.getElementById('this-week-scans').textContent = stats.thisWeekScans;
                }
                
                if (scansResponse.ok) {
                    const scans = await scansResponse.json();
                    displayRecentScans(scans, 'dashboard-recent-scans');
                    displayRecentScans(scans, 'recent-scans-list');
                }
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        }
        
        function displayRecentScans(scans, containerId) {
            const container = document.getElementById(containerId);
            
            if (scans.length === 0) {
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: #666;">No recent scans found</div>';
                return;
            }
            
            container.innerHTML = scans.map(scan => {
                const date = new Date(scan.completed_at).toLocaleDateString();
                const score = Math.max(0, 100 - (scan.total_issues * 5));
                const scoreClass = score >= 90 ? 'score-excellent' : score >= 70 ? 'score-good' : 'score-needs-work';
                
                return \`
                    <div class="scan-item">
                        <div class="scan-info">
                            <div class="scan-url">\${scan.url}</div>
                            <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${date}</div>
                        </div>
                        <div class="scan-score \${scoreClass}">\${score}% Score</div>
                        <button class="view-report-btn">👁️ View Report</button>
                    </div>
                \`;
            }).join('');
        }
        
        // Scan functionality
        async function startScan() {
            const urlInput = document.getElementById('url-input');
            const scanButton = document.querySelector('.scan-button');
            const scanType = document.querySelector('input[name="scan-type"]:checked').value;
            const maxPages = document.getElementById('max-pages').value;
            
            const url = urlInput.value.trim();
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            // Disable button and show loading
            scanButton.disabled = true;
            scanButton.textContent = '🔄 Scanning...';
            
            // Clear previous results
            document.getElementById('scan-results-container').innerHTML = '';
            
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
                    displayScanResults(result);
                    // Reload recent scans
                    loadDashboardData();
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
        
        function displayScanResults(result) {
            const resultsContainer = document.getElementById('scan-results-container');
            
            const violations = result.violations || result.pages?.reduce((acc, page) => acc.concat(page.violations || []), []) || [];
            
            resultsContainer.innerHTML = \`
                <div class="scan-results">
                    <div class="results-header">
                        <div class="results-title">Scan Results</div>
                        <div class="results-meta">Completed in \${result.scanTime}ms</div>
                    </div>
                    <div class="results-body">
                        <div class="results-summary">
                            <div class="summary-grid">
                                <div class="summary-item">
                                    <div class="summary-value">\${violations.length}</div>
                                    <div class="summary-label">Total Issues</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value">\${result.summary?.critical || 0}</div>
                                    <div class="summary-label">Critical</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value">\${result.summary?.serious || 0}</div>
                                    <div class="summary-label">Serious</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value">\${result.summary?.moderate || 0}</div>
                                    <div class="summary-label">Moderate</div>
                                </div>
                                <div class="summary-item">
                                    <div class="summary-value">\${result.summary?.minor || 0}</div>
                                    <div class="summary-label">Minor</div>
                                </div>
                            </div>
                        </div>
                        
                        \${violations.length > 0 ? 
                            violations.map(violation => {
                                // Clean up violation data for better display
                                const cleanDescription = violation.description || 'No description available';
                                const cleanHelp = violation.help || 'Refer to WCAG guidelines for more information';
                                const cleanId = violation.id || 'unknown-violation';
                                const cleanImpact = violation.impact || 'moderate';
                                
                                return \`
                                <div class="violation">
                                    <div class="violation-header">
                                        <div class="violation-title">\${cleanId}</div>
                                        <div class="violation-impact impact-\${cleanImpact}">\${cleanImpact.toUpperCase()}</div>
                                    </div>
                                    <div class="violation-body">
                                        <div class="violation-description">
                                            <strong>Description:</strong> \${cleanDescription}
                                        </div>
                                        <div class="violation-help">
                                            <strong>Help:</strong> \${cleanHelp}
                                            \${violation.helpUrl ? \`<br><strong>Learn more:</strong> <a href="\${violation.helpUrl}" target="_blank">\${violation.helpUrl}</a>\` : ''}
                                        </div>
                                        \${violation.nodes && violation.nodes.length > 0 ? \`
                                            <div class="violation-elements">
                                                <strong>Affected elements:</strong> \${violation.nodes.length} element(s)
                                            </div>
                                        \` : ''}
                                    </div>
                                </div>
                                \`;
                            }).join('') 
                            : '<p style="text-align: center; color: #28a745; font-size: 1.2rem; padding: 40px;">🎉 No accessibility issues found!</p>'
                        }
                        
                        <div style="margin-top: 20px; text-align: center;">
                            \${violations.length > 0 ? 
                                '<button class="ai-suggestions-btn" onclick="showAISuggestions(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')">🤖 Get AI Fix Suggestions</button>' 
                                : ''
                            }
                            \${violations.length > 0 ? 
                                '<button class="guided-fixing-btn" onclick="GuidedFixing.start(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')">🛠️ Let\\'s Start Fixing</button>' 
                                : ''
                            }
                        </div>
                    </div>
                </div>
            \`;
        }
        
        function displayScanError(error) {
            const resultsContainer = document.getElementById('scan-results-container');
            resultsContainer.innerHTML = \`
                <div class="scan-results">
                    <div class="results-header">
                        <div class="results-title">Scan Failed</div>
                        <div class="results-meta" style="color: #dc3545;">Error occurred</div>
                    </div>
                    <div class="results-body">
                        <div style="text-align: center; color: #dc3545; padding: 40px;">
                            <h3>Scan Failed</h3>
                            <p>\${error}</p>
                        </div>
                    </div>
                </div>
            \`;
        }
        
        // AI Suggestions functionality
        async function showAISuggestions(violations) {
            const modal = document.getElementById('ai-modal');
            const modalBody = document.getElementById('ai-modal-body');
            
            modal.style.display = 'block';
            modalBody.innerHTML = '<div class="loading"><div class="spinner"></div>Generating AI suggestions...</div>';
            
            try {
                const response = await fetch('/api/ai-fixes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ violations: violations })
                });
                
                if (!response.ok) {
                    throw new Error('Failed to get AI suggestions');
                }
                
                const suggestions = await response.json();
                
                modalBody.innerHTML = suggestions.map((suggestion, index) => \`
                    <div class="ai-suggestion priority-\${suggestion.priority}">
                        <div class="ai-suggestion-header">
                            <strong>Fix for: \${violations[index].id}</strong>
                            <span class="priority-badge priority-\${suggestion.priority}">\${suggestion.priority.toUpperCase()}</span>
                        </div>
                        <div class="ai-suggestion-content">
                            <p><strong>Issue:</strong> \${suggestion.explanation}</p>
                            <p><strong>Code Example:</strong></p>
                            <pre><code>\${suggestion.codeExample}</code></pre>
                            <p><strong>Implementation Steps:</strong></p>
                            <ol>\${suggestion.steps.map(step => '<li>' + step + '</li>').join('')}</ol>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error getting AI suggestions:', error);
                modalBody.innerHTML = '<div style="color: #dc3545; text-align: center; padding: 40px;"><h4>Unable to Generate AI Suggestions</h4><p>Please try again later.</p></div>';
            }
        }
        
        function closeAIModal() {
            document.getElementById('ai-modal').style.display = 'none';
        }
        
        // Guided Fixing functionality
        const GuidedFixing = {
            currentViolations: [],
            currentViolationIndex: 0,
            fixedViolations: [],
            
            start: function(violations) {
                // Sort violations by priority (Critical > Serious > Moderate > Minor)
                const priorityOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
                this.currentViolations = violations.sort((a, b) => {
                    return priorityOrder[a.impact] - priorityOrder[b.impact];
                });
                
                this.currentViolationIndex = 0;
                this.fixedViolations = [];
                
                // Show the modal
                const modal = document.getElementById('guided-fixing-modal');
                modal.style.display = 'block';
                
                // Display the first violation
                this.showCurrentViolation();
            },
            
            showCurrentViolation: function() {
                const violation = this.currentViolations[this.currentViolationIndex];
                const totalViolations = this.currentViolations.length;
                
                // Update progress indicator
                document.getElementById('progress-indicator').textContent = 
                    'Violation ' + (this.currentViolationIndex + 1) + ' of ' + totalViolations;
                
                // Update modal body with violation details
                const modalBody = document.getElementById('guided-modal-body');
                modalBody.innerHTML = 
                    '<div class="violation-details">' +
                        '<div class="violation-title">' + violation.id + '</div>' +
                        '<div class="violation-impact impact-' + violation.impact + '">' + violation.impact + '</div>' +
                        '<p><strong>Description:</strong> ' + (violation.description || 'No description available') + '</p>' +
                        '<p><strong>Help:</strong> ' + (violation.help || 'Refer to WCAG guidelines for more information') + '</p>' +
                        (violation.helpUrl ? '<p><strong>Learn more:</strong> <a href="' + violation.helpUrl + '" target="_blank">' + violation.helpUrl + '</a></p>' : '') +
                    '</div>' +
                    '<div id="ai-fix-area" style="margin-top: 20px;">' +
                        '<!-- AI fix suggestions will appear here -->' +
                    '</div>';
                
                // Update navigation buttons
                this.updateNavigationButtons();
            },
            
            updateNavigationButtons: function() {
                const prevBtn = document.getElementById('prev-btn');
                const nextBtn = document.getElementById('next-btn');
                const finishBtn = document.getElementById('finish-btn');
                
                // Previous button
                prevBtn.disabled = this.currentViolationIndex === 0;
                
                // Next button and finish button
                if (this.currentViolationIndex === this.currentViolations.length - 1) {
                    nextBtn.style.display = 'none';
                    finishBtn.style.display = 'inline-block';
                } else {
                    nextBtn.style.display = 'inline-block';
                    finishBtn.style.display = 'none';
                }
            },
            
            previousViolation: function() {
                if (this.currentViolationIndex > 0) {
                    this.currentViolationIndex--;
                    this.showCurrentViolation();
                }
            },
            
            nextViolation: function() {
                if (this.currentViolationIndex < this.currentViolations.length - 1) {
                    this.currentViolationIndex++;
                    this.showCurrentViolation();
                }
            },
            
            close: function() {
                document.getElementById('guided-fixing-modal').style.display = 'none';
            },
            
            getAIFixForCurrent: async function() {
                const violation = this.currentViolations[this.currentViolationIndex];
                const aiFixArea = document.getElementById('ai-fix-area');
                
                // Show loading state
                aiFixArea.innerHTML = '<div class="loading"><div class="spinner"></div>Getting AI fix suggestion...</div>';
                
                try {
                    const response = await fetch('/api/ai-fixes', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ violations: [violation] })
                    });
                    
                    if (!response.ok) {
                        throw new Error('Failed to get AI suggestion');
                    }
                    
                    const suggestions = await response.json();
                    const suggestion = suggestions[0];
                    
                    if (suggestion) {
                        aiFixArea.innerHTML = 
                            '<div class="ai-suggestion priority-' + suggestion.priority + '">' +
                                '<div class="ai-suggestion-header">' +
                                    '<strong>🤖 AI Fix Suggestion</strong>' +
                                    '<span class="priority-badge priority-' + suggestion.priority + '">' + suggestion.priority.toUpperCase() + '</span>' +
                                '</div>' +
                                '<div class="ai-suggestion-content">' +
                                    '<p><strong>Issue:</strong> ' + suggestion.explanation + '</p>' +
                                    '<p><strong>Code Example:</strong></p>' +
                                    '<pre style="background: #f8f9fa; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>' + suggestion.codeExample + '</code></pre>' +
                                    '<p><strong>Implementation Steps:</strong></p>' +
                                    '<ol>' + suggestion.steps.map(step => '<li>' + step + '</li>').join('') + '</ol>' +
                                    '<div style="margin-top: 16px;">' +
                                        '<button onclick="GuidedFixing.saveFixToReport()" class="btn btn-success">💾 Save to Report</button>' +
                                    '</div>' +
                                '</div>' +
                            '</div>';
                        
                        // Store the suggestion for potential saving
                        this.currentViolations[this.currentViolationIndex].aiSuggestion = suggestion;
                    } else {
                        throw new Error('No suggestion received');
                    }
                    
                } catch (error) {
                    console.error('Error getting AI suggestion:', error);
                    aiFixArea.innerHTML = 
                        '<div style="color: #dc3545; text-align: center; padding: 20px;">' +
                            '<h4>Unable to Generate AI Suggestion</h4>' +
                            '<p>Please try again or proceed to the next violation.</p>' +
                        '</div>';
                }
            },
            
            saveFixToReport: function() {
                const violation = this.currentViolations[this.currentViolationIndex];
                if (violation.aiSuggestion) {
                    this.fixedViolations.push({
                        violation: violation,
                        suggestion: violation.aiSuggestion,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Show confirmation
                    const aiFixArea = document.getElementById('ai-fix-area');
                    const saveButton = aiFixArea.querySelector('button');
                    if (saveButton) {
                        saveButton.textContent = '✅ Saved to Report';
                        saveButton.disabled = true;
                        saveButton.style.background = '#28a745';
                    }
                }
            },
            
            finish: function() {
                if (this.fixedViolations.length === 0) {
                    alert('No fixes have been saved to the report yet. Please get AI suggestions and save them before generating a report.');
                    return;
                }
                
                // Generate and download report
                this.generateReport();
                
                // Close modal
                this.close();
            },
            
            generateReport: function() {
                const reportContent = 
                    '# Accessibility Fix Report\\n' +
                    'Generated on: ' + new Date().toLocaleString() + '\\n\\n' +
                    '## Summary\\n' +
                    '- Total violations processed: ' + this.currentViolations.length + '\\n' +
                    '- Fixes saved to report: ' + this.fixedViolations.length + '\\n\\n' +
                    '## Fix Details\\n\\n' +
                    this.fixedViolations.map((fix, index) => 
                        '### ' + (index + 1) + '. ' + fix.violation.id + '\\n' +
                        '**Impact:** ' + fix.violation.impact + '\\n' +
                        '**Description:** ' + fix.violation.description + '\\n\\n' +
                        '**AI Suggestion:**\\n' +
                        fix.suggestion.explanation + '\\n\\n' +
                        '**Code Example:**\\n' +
                        fix.suggestion.codeExample + '\\n\\n' +
                        '**Implementation Steps:**\\n' +
                        fix.suggestion.steps.map((step, i) => (i + 1) + '. ' + step).join('\\n') + '\\n\\n' +
                        '---\\n'
                    ).join('') +
                    '\\n## Next Steps\\n' +
                    '1. Review each fix suggestion carefully\\n' +
                    '2. Test implementations in a development environment\\n' +
                    '3. Validate fixes with accessibility tools\\n' +
                    '4. Deploy to production after thorough testing';
                
                // Create and download the report
                const blob = new Blob([reportContent], { type: 'text/markdown' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'accessibility-fix-report-' + new Date().toISOString().split('T')[0] + '.md';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                alert('Report downloaded successfully! Check your downloads folder.');
            }
        };
        
        // Add click handler for Get AI Fix button in guided fixing
        document.addEventListener('click', function(e) {
            if (e.target && e.target.textContent === '🤖 Get AI Fix') {
                GuidedFixing.getAIFixForCurrent();
            }
        });
        
        // Close modals when clicking outside
        window.onclick = function(event) {
            const aiModal = document.getElementById('ai-modal');
            const guidedModal = document.getElementById('guided-fixing-modal');
            
            if (event.target === aiModal) {
                aiModal.style.display = 'none';
            }
            if (event.target === guidedModal) {
                guidedModal.style.display = 'none';
            }
        }
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboardData();
        });
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Puppeteer scanning functions
async function scanSinglePage(browser, url) {
    const page = await browser.newPage();
    
    try {
        console.log('📄 Navigating to: ' + url);
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        console.log('⏳ Waiting for page to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('💉 Injecting axe-core...');
        await page.addScriptTag({
            content: axeCore.source
        });
        
        console.log('🔍 Running axe accessibility scan...');
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

// EXACT COPY OF WORKING API ENDPOINT WITH DATABASE INTEGRATION ADDED
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
        
        console.log('🔍 Starting accessibility scan for: ' + targetUrl + ' (type: ' + scanType + ')');
        
        // Launch Puppeteer - EXACT WORKING CONFIGURATION
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
            
            console.log('✅ Single page scan completed in ' + scanTime + 'ms. Found ' + results.violations.length + ' violations.');
            
            // Save to database - ADDED FOR PERSISTENCE
            await saveScan(1, 1, targetUrl, scanType, results.violations.length, scanTime, 1, results.violations);
            
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
            // Multi-page crawl - EXACT WORKING LOGIC
            console.log('🕷️ Starting multi-page crawl (max ' + maxPages + ' pages)');
            
            const scannedPages = [];
            const urlsToScan = [targetUrl];
            const scannedUrls = new Set();
            
            while (urlsToScan.length > 0 && scannedPages.length < maxPages) {
                const pageUrl = urlsToScan.shift();
                
                if (scannedUrls.has(pageUrl)) {
                    continue;
                }
                
                scannedUrls.add(pageUrl);
                
                try {
                    console.log('📄 Scanning page ' + (scannedPages.length + 1) + ': ' + pageUrl);
                    const pageResults = await scanSinglePage(browser, pageUrl);
                    const pageTime = Date.now() - startTime;
                    
                    scannedPages.push({
                        url: pageUrl,
                        violations: pageResults.violations,
                        scanTime: pageTime,
                        timestamp: new Date().toISOString()
                    });
                    
                    // Extract additional URLs for crawling (simplified)
                    if (scannedPages.length < maxPages) {
                        const page = await browser.newPage();
                        try {
                            await page.goto(pageUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                            const links = await page.evaluate(() => {
                                const anchors = Array.from(document.querySelectorAll('a[href]'));
                                return anchors
                                    .map(a => a.href)
                                    .filter(href => href.startsWith(window.location.origin))
                                    .slice(0, 10); // Limit to 10 links per page
                            });
                            
                            links.forEach(link => {
                                if (!scannedUrls.has(link) && urlsToScan.length < maxPages) {
                                    urlsToScan.push(link);
                                }
                            });
                        } finally {
                            await page.close();
                        }
                    }
                    
                } catch (error) {
                    console.error('❌ Error scanning page ' + pageUrl + ':', error.message);
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
});
