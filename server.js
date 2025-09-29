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
        const [totalScans, totalIssues, thisWeekScans] = await Promise.all([
            db.query('SELECT COUNT(*) as count FROM scans WHERE user_id = $1', [userId]),
            db.query('SELECT SUM(total_issues) as sum FROM scans WHERE user_id = $1', [userId]),
            db.query(`SELECT COUNT(*) as count FROM scans 
                     WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`, [userId])
        ]);
        
        const stats = {
            totalScans: parseInt(totalScans.rows[0].count) || 0,
            totalIssues: parseInt(totalIssues.rows[0].sum) || 0,
            thisWeekScans: parseInt(thisWeekScans.rows[0].count) || 0
        };
        
        // Calculate average score
        stats.averageScore = stats.totalScans > 0 
            ? Math.max(0, Math.min(100, 100 - ((stats.totalIssues / stats.totalScans) * 5)))
            : 100;
        
        return stats;
    } catch (error) {
        console.log('❌ Database error getting stats:', error.message);
        return { totalScans: 0, totalIssues: 0, averageScore: 100, thisWeekScans: 0 };
    }
}

// API endpoints
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone'
    });
});

app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const stats = await getDashboardStats();
        res.json(stats);
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard stats' });
    }
});

app.get('/api/scans/recent', async (req, res) => {
    try {
        const scans = await getRecentScans();
        res.json(scans);
    } catch (error) {
        console.error('Error fetching recent scans:', error);
        res.status(500).json({ error: 'Failed to fetch recent scans' });
    }
});

// NEW: AI Suggestions API endpoint
app.post('/api/ai-fixes', async (req, res) => {
    try {
        const { violations } = req.body;
        
        if (!violations || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'Violations array is required' });
        }

        const suggestions = violations.map(violation => {
            // Generate AI-powered suggestions based on violation type
            const suggestion = generateAISuggestion(violation);
            return suggestion;
        });

        res.json(suggestions);
    } catch (error) {
        console.error('Error generating AI suggestions:', error);
        res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
});

function generateAISuggestion(violation) {
    // AI suggestion generation logic based on violation type
    const suggestions = {
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
        'heading-order': {
            priority: 'medium',
            explanation: 'Headings should follow a logical hierarchy (h1, h2, h3) to help screen reader users navigate content.',
            codeExample: `<!-- Before -->
<h1>Main Title</h1>
<h3>Subsection</h3>

<!-- After -->
<h1>Main Title</h1>
<h2>Subsection</h2>`,
            steps: [
                'Review current heading structure',
                'Ensure only one h1 per page',
                'Use headings in sequential order (don\'t skip levels)',
                'Make headings descriptive of the content that follows',
                'Test navigation with screen readers'
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

    // Default suggestion for unknown violation types
    const defaultSuggestion = {
        priority: 'medium',
        explanation: `This accessibility issue (${violation.id}) needs attention to improve user experience for people with disabilities.`,
        codeExample: '// Refer to WCAG guidelines for specific implementation details',
        steps: [
            'Review the WCAG guidelines for this specific issue',
            'Identify all instances of this problem on your site',
            'Implement the recommended solution',
            'Test with accessibility tools and real users',
            'Document the fix for future reference'
        ]
    };

    return suggestions[violation.id] || defaultSuggestion;
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
            background: #667eea;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            cursor: pointer;
        }
        
        .content {
            padding: 30px;
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
        
        /* Recent Activity */
        .recent-activity {
            background: white;
            border-radius: 8px;
            padding: 24px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin-bottom: 20px;
            color: #2d3748;
        }
        
        .activity-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 16px 0;
            border-bottom: 1px solid #f1f5f9;
        }
        
        .activity-item:last-child {
            border-bottom: none;
        }
        
        .activity-info h4 {
            font-weight: 500;
            margin-bottom: 4px;
        }
        
        .activity-meta {
            font-size: 0.875rem;
            color: #64748b;
        }
        
        .activity-score {
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.875rem;
        }
        
        .score-excellent {
            background: #dcfce7;
            color: #166534;
        }
        
        .score-good {
            background: #fef3c7;
            color: #92400e;
        }
        
        .score-needs-work {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.875rem;
            transition: background 0.2s;
        }
        
        .btn:hover {
            background: #5a67d8;
        }
        
        .btn-sm {
            padding: 6px 12px;
            font-size: 0.8rem;
        }
        
        /* Scans Page Styles */
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
        
        .scan-form {
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: #374151;
        }
        
        .form-input {
            width: 100%;
            padding: 12px;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            font-size: 16px;
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
        
        .radio-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .scan-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .scan-btn:hover {
            transform: translateY(-1px);
        }
        
        .scan-btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }
        
        .database-status {
            background: #d1fae5;
            color: #065f46;
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 20px;
            font-size: 14px;
        }
        
        .scan-results {
            background: white;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        
        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }
        
        .results-title {
            font-size: 1.25rem;
            font-weight: 600;
        }
        
        .scan-time {
            color: #666;
            font-size: 0.875rem;
        }
        
        .results-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 20px;
            margin-bottom: 24px;
        }
        
        .summary-item {
            text-align: center;
            padding: 16px;
            background: #f8fafc;
            border-radius: 6px;
        }
        
        .summary-number {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 4px;
        }
        
        .summary-label {
            font-size: 0.875rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .violations-list {
            margin-top: 20px;
        }
        
        .violation-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 16px;
            margin-bottom: 12px;
        }
        
        .violation-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        
        .violation-title {
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 4px;
        }
        
        .violation-impact {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .impact-critical {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .impact-serious {
            background: #fef3c7;
            color: #92400e;
        }
        
        .impact-moderate {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .impact-minor {
            background: #f3f4f6;
            color: #374151;
        }
        
        .violation-description {
            color: #4b5563;
            margin-bottom: 8px;
            line-height: 1.5;
        }
        
        .violation-help {
            color: #6b7280;
            font-size: 0.875rem;
            margin-bottom: 8px;
        }
        
        .violation-learn-more {
            color: #3b82f6;
            text-decoration: none;
            font-size: 0.875rem;
        }
        
        .violation-learn-more:hover {
            text-decoration: underline;
        }
        
        .violation-elements {
            color: #6b7280;
            font-size: 0.875rem;
            margin-top: 8px;
        }
        
        .results-actions {
            display: flex;
            gap: 12px;
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
        }
        
        .ai-suggestions-btn {
            background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .ai-suggestions-btn:hover {
            transform: translateY(-1px);
        }
        
        .guided-fixing-btn {
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .guided-fixing-btn:hover {
            transform: translateY(-1px);
        }
        
        .view-report-btn {
            background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        .view-report-btn:hover {
            transform: translateY(-1px);
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
            border-radius: 8px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .modal-title {
            font-size: 1.25rem;
            font-weight: 600;
            margin: 0;
        }
        
        .close {
            color: #aaa;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }
        
        .close:hover {
            color: #000;
        }
        
        .modal-body {
            padding: 24px;
        }
        
        .suggestion-item {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .suggestion-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        
        .suggestion-title {
            font-weight: 600;
            color: #1a202c;
        }
        
        .priority-badge {
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-high {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .priority-medium {
            background: #fef3c7;
            color: #92400e;
        }
        
        .priority-low {
            background: #f3f4f6;
            color: #374151;
        }
        
        .suggestion-explanation {
            color: #4b5563;
            margin-bottom: 16px;
            line-height: 1.6;
        }
        
        .code-example {
            background: #1f2937;
            color: #f9fafb;
            padding: 16px;
            border-radius: 6px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 0.875rem;
            margin-bottom: 16px;
            overflow-x: auto;
        }
        
        .implementation-steps {
            margin-bottom: 16px;
        }
        
        .steps-title {
            font-weight: 600;
            margin-bottom: 8px;
            color: #374151;
        }
        
        .steps-list {
            list-style: none;
            padding: 0;
        }
        
        .steps-list li {
            padding: 6px 0;
            padding-left: 24px;
            position: relative;
            color: #4b5563;
        }
        
        .steps-list li:before {
            content: counter(step-counter);
            counter-increment: step-counter;
            position: absolute;
            left: 0;
            top: 6px;
            background: #667eea;
            color: white;
            width: 18px;
            height: 18px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.75rem;
            font-weight: 600;
        }
        
        .steps-list {
            counter-reset: step-counter;
        }
        
        /* Guided Fixing Modal Styles */
        .guided-modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
        }
        
        .guided-modal-content {
            background-color: white;
            margin: 3% auto;
            padding: 0;
            border-radius: 8px;
            width: 95%;
            max-width: 900px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
        }
        
        .guided-modal-header {
            padding: 20px 24px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #10b981;
            color: white;
            border-radius: 8px 8px 0 0;
        }
        
        .guided-modal-header h2 {
            margin: 0;
            font-size: 1.25rem;
        }
        
        .progress-indicator {
            background: rgba(255,255,255,0.2);
            padding: 4px 12px;
            border-radius: 12px;
            font-size: 0.875rem;
        }
        
        .guided-modal-body {
            padding: 24px;
            flex: 1;
            overflow-y: auto;
        }
        
        .current-violation {
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .violation-id {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1a202c;
            margin-bottom: 8px;
        }
        
        .ai-fix-area {
            margin-top: 20px;
            padding: 20px;
            background: #f0f9ff;
            border: 1px solid #bae6fd;
            border-radius: 6px;
        }
        
        .loading {
            display: flex;
            align-items: center;
            gap: 12px;
            color: #3b82f6;
        }
        
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid #e5e7eb;
            border-top: 2px solid #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .ai-suggestion {
            background: white;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            padding: 16px;
        }
        
        .guided-modal-footer {
            padding: 20px 24px;
            border-top: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: #f9fafb;
            border-radius: 0 0 8px 8px;
        }
        
        .prev-btn, .next-btn, .finish-btn, .get-ai-fix-btn {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .prev-btn {
            background: #6b7280;
            color: white;
        }
        
        .prev-btn:hover {
            background: #4b5563;
        }
        
        .prev-btn:disabled {
            background: #d1d5db;
            cursor: not-allowed;
        }
        
        .next-btn {
            background: #3b82f6;
            color: white;
        }
        
        .next-btn:hover {
            background: #2563eb;
        }
        
        .finish-btn {
            background: #10b981;
            color: white;
        }
        
        .finish-btn:hover {
            background: #059669;
        }
        
        .get-ai-fix-btn {
            background: #8b5cf6;
            color: white;
        }
        
        .get-ai-fix-btn:hover {
            background: #7c3aed;
        }
        
        .btn-success {
            background: #10b981;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.875rem;
        }
        
        .btn-success:hover {
            background: #059669;
        }
        
        /* Loading States */
        .loading-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(255,255,255,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
        }
        
        .loading-content {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        
        .loading-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #e5e7eb;
            border-top: 4px solid #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            .sidebar {
                transform: translateX(-100%);
                transition: transform 0.3s;
            }
            
            .sidebar.open {
                transform: translateX(0);
            }
            
            .main-content {
                margin-left: 0;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .actions-grid {
                grid-template-columns: 1fr;
            }
            
            .scan-options {
                flex-direction: column;
                gap: 12px;
            }
            
            .results-summary {
                grid-template-columns: repeat(2, 1fr);
            }
            
            .modal-content {
                width: 95%;
                margin: 10% auto;
            }
            
            .guided-modal-content {
                width: 98%;
                margin: 5% auto;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <nav class="sidebar">
            <div class="sidebar-header">
                <div class="logo">🛡️ SentryPrime</div>
                <div class="logo-subtitle">Enterprise Dashboard</div>
            </div>
            <div class="nav-menu">
                <button class="nav-item active" onclick="switchToPage('dashboard')">📊 Dashboard</button>
                <button class="nav-item" onclick="switchToPage('scans')">🔍 Scans</button>
                <button class="nav-item" onclick="switchToPage('analytics')">📈 Analytics</button>
                <button class="nav-item" onclick="switchToPage('team')">👥 Team</button>
                <button class="nav-item" onclick="switchToPage('integrations')">🔗 Integrations</button>
                <button class="nav-item" onclick="switchToPage('api')">⚙️ API Management</button>
                <button class="nav-item" onclick="switchToPage('billing')">💳 Billing</button>
                <button class="nav-item" onclick="switchToPage('settings')">⚙️ Settings</button>
            </div>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" class="search-input" placeholder="Search scans, reports, or settings...">
                </div>
                <div class="user-menu">
                    <div class="notification-icon">
                        🔔
                        <span class="notification-badge">3</span>
                    </div>
                    <div class="user-avatar">JD</div>
                    <div>
                        <div style="font-weight: 500;">John Doe</div>
                        <div style="font-size: 0.875rem; color: #64748b;">Acme Corporation</div>
                    </div>
                </div>
            </header>
            
            <div class="content">
                <!-- Dashboard Page -->
                <div id="dashboard-page" class="page active">
                    <div class="dashboard-header">
                        <h1>Dashboard Overview</h1>
                        <p>Monitor your accessibility compliance and scan activity</p>
                    </div>
                    
                    <div class="stats-grid" id="stats-grid">
                        <!-- Stats will be loaded dynamically -->
                    </div>
                    
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
                        <div class="action-card success" onclick="switchToPage('team')">
                            <div class="action-icon">👥</div>
                            <div class="action-title">Manage Team</div>
                            <div class="action-description">Add or remove team members</div>
                        </div>
                        <div class="action-card" onclick="switchToPage('settings')">
                            <div class="action-icon">⚙️</div>
                            <div class="action-title">Settings</div>
                            <div class="action-description">Configure your preferences</div>
                        </div>
                    </div>
                    
                    <div class="recent-activity">
                        <h2 class="section-title">Recent Scans</h2>
                        <div id="recent-scans">
                            <!-- Recent scans will be loaded dynamically -->
                        </div>
                    </div>
                </div>
                
                <!-- Scans Page -->
                <div id="scans-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Accessibility Scans</h1>
                        <p class="page-subtitle">Manage and review your accessibility scans</p>
                    </div>
                    
                    <div class="database-status" id="database-status">
                        ✅ Database connected - Scans will be saved to your history
                    </div>
                    
                    <div class="scan-form">
                        <h2 style="margin-bottom: 20px;">Scan Website for Accessibility Issues</h2>
                        
                        <div class="form-group">
                            <label class="form-label">Website URL</label>
                            <input type="url" id="scan-url" class="form-input" placeholder="https://example.com/" required>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Scan Options:</label>
                            <div class="scan-options">
                                <div class="radio-group">
                                    <input type="radio" id="single-page" name="scan-type" value="single" checked>
                                    <label for="single-page">Single Page (Fast - recommended)</label>
                                </div>
                                <div class="radio-group">
                                    <input type="radio" id="multi-page" name="scan-type" value="crawl">
                                    <label for="multi-page">Multi-Page Crawl (Slower - up to</label>
                                    <input type="number" id="max-pages" value="5" min="1" max="20" style="width: 60px; margin: 0 5px;">
                                    <label>pages)</label>
                                </div>
                            </div>
                        </div>
                        
                        <button class="scan-btn" onclick="startScan()">🔍 Start Accessibility Scan</button>
                    </div>
                    
                    <div id="scan-results" style="display: none;"></div>
                    
                    <div class="recent-activity">
                        <h2 class="section-title">Recent Scans</h2>
                        <div id="recent-scans-list">
                            <!-- Recent scans will be loaded dynamically -->
                        </div>
                    </div>
                </div>
                
                <!-- Other Pages (Placeholder) -->
                <div id="analytics-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Analytics</h1>
                        <p class="page-subtitle">Analyze your accessibility compliance trends</p>
                    </div>
                    <p>Analytics dashboard coming soon...</p>
                </div>
                
                <div id="team-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Team Management</h1>
                        <p class="page-subtitle">Manage your team members and permissions</p>
                    </div>
                    <p>Team management coming soon...</p>
                </div>
                
                <div id="integrations-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Integrations</h1>
                        <p class="page-subtitle">Connect with your favorite tools and services</p>
                    </div>
                    <p>Integrations coming soon...</p>
                </div>
                
                <div id="api-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">API Management</h1>
                        <p class="page-subtitle">Manage your API keys and access</p>
                    </div>
                    <p>API management coming soon...</p>
                </div>
                
                <div id="billing-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Billing</h1>
                        <p class="page-subtitle">Manage your subscription and billing</p>
                    </div>
                    <p>Billing management coming soon...</p>
                </div>
                
                <div id="settings-page" class="page">
                    <div class="page-header">
                        <h1 class="page-title">Settings</h1>
                        <p class="page-subtitle">Configure your account and preferences</p>
                    </div>
                    <p>Settings coming soon...</p>
                </div>
            </div>
        </main>
    </div>

    <!-- AI Suggestions Modal -->
    <div id="ai-suggestions-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">🤖 AI Fix Suggestions</h2>
                <span class="close" onclick="closeAISuggestionsModal()">&times;</span>
            </div>
            <div class="modal-body" id="ai-suggestions-content">
                <!-- AI suggestions will be loaded here -->
            </div>
        </div>
    </div>

    <!-- NEW: Guided Fixing Modal -->
    <div id="guided-fixing-modal" class="guided-modal">
        <div class="guided-modal-content">
            <div class="guided-modal-header">
                <h2>🛠️ Guided Accessibility Fixing</h2>
                <div class="progress-indicator" id="progress-indicator">Violation 1 of 6</div>
                <span class="close" onclick="GuidedFixing.close()">&times;</span>
            </div>
            <div class="guided-modal-body" id="guided-modal-body">
                <!-- Current violation details will be loaded here -->
            </div>
            <div class="guided-modal-footer">
                <button class="prev-btn" id="prev-btn" onclick="GuidedFixing.previousViolation()">← Previous</button>
                <button class="get-ai-fix-btn" onclick="GuidedFixing.getAIFixForCurrent()">🤖 Get AI Fix</button>
                <button class="next-btn" id="next-btn" onclick="GuidedFixing.nextViolation()">Next →</button>
                <button class="finish-btn" id="finish-btn" onclick="GuidedFixing.finish()" style="display: none;">📄 Generate Report</button>
            </div>
        </div>
    </div>

    <script>
        // Global variables
        let currentViolations = [];
        let isScanning = false;

        // Navigation function
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
            document.getElementById(pageId + '-page').classList.add('active');
            
            // Add active class to clicked nav item
            event.target.classList.add('active');
            
            // Load page-specific data
            if (pageId === 'dashboard') {
                loadDashboardData();
            } else if (pageId === 'scans') {
                loadRecentScans();
                updateDatabaseStatus();
            }
        }

        // Dashboard data loading
        async function loadDashboardData() {
            try {
                // Load dashboard stats
                const statsResponse = await fetch('/api/dashboard/stats');
                const stats = await statsResponse.json();
                
                const statsGrid = document.getElementById('stats-grid');
                statsGrid.innerHTML = \`
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-title">Total Scans</div>
                        </div>
                        <div class="stat-value">\${stats.totalScans}</div>
                        <div class="stat-change positive">+\${stats.thisWeekScans} this week</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-title">Total Issues</div>
                        </div>
                        <div class="stat-value">\${stats.totalIssues}</div>
                        <div class="stat-change">Found across all scans</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-title">Average Score</div>
                        </div>
                        <div class="stat-value">\${Math.round(stats.averageScore)}%</div>
                        <div class="stat-change positive">Compliance rating</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-header">
                            <div class="stat-title">This Week</div>
                        </div>
                        <div class="stat-value">\${stats.thisWeekScans}</div>
                        <div class="stat-change">Scans completed</div>
                    </div>
                \`;
                
                // Load recent scans for dashboard
                const scansResponse = await fetch('/api/scans/recent?limit=5');
                const scans = await scansResponse.json();
                
                const recentScansDiv = document.getElementById('recent-scans');
                if (scans.length === 0) {
                    recentScansDiv.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No recent scans found</p>';
                } else {
                    recentScansDiv.innerHTML = scans.map(scan => {
                        const score = scan.score || Math.max(60, 100 - Math.min(40, scan.total_issues * 2));
                        const scoreClass = score >= 90 ? 'score-excellent' : score >= 70 ? 'score-good' : 'score-needs-work';
                        const date = new Date(scan.created_at || scan.completed_at).toLocaleDateString();
                        
                        return \`
                            <div class="activity-item">
                                <div class="activity-info">
                                    <h4>\${scan.url}</h4>
                                    <div class="activity-meta">\${scan.scan_type === 'crawl' ? 'Multi-page' : 'Single page'} • \${date}</div>
                                </div>
                                <div class="activity-score \${scoreClass}">\${score}% Score</div>
                                <button class="btn btn-sm">👁️ View Report</button>
                            </div>
                        \`;
                    }).join('');
                }
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        }

        // Recent scans loading for scans page
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const scans = await response.json();
                
                const recentScansList = document.getElementById('recent-scans-list');
                if (scans.length === 0) {
                    recentScansList.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No recent scans found</p>';
                } else {
                    recentScansList.innerHTML = scans.map(scan => {
                        const score = scan.score || Math.max(60, 100 - Math.min(40, scan.total_issues * 2));
                        const scoreClass = score >= 90 ? 'score-excellent' : score >= 70 ? 'score-good' : 'score-needs-work';
                        const date = new Date(scan.created_at || scan.completed_at).toLocaleDateString();
                        
                        return \`
                            <div class="activity-item">
                                <div class="activity-info">
                                    <h4>\${scan.url}</h4>
                                    <div class="activity-meta">\${scan.scan_type === 'crawl' ? 'Multi-page' : 'Single page'} • \${date}</div>
                                </div>
                                <div class="activity-score \${scoreClass}">\${score}% Score</div>
                                <button class="btn btn-sm">👁️ View Report</button>
                            </div>
                        \`;
                    }).join('');
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
            }
        }

        // Database status check
        async function updateDatabaseStatus() {
            try {
                const response = await fetch('/health');
                const health = await response.json();
                
                const statusDiv = document.getElementById('database-status');
                if (health.database === 'connected') {
                    statusDiv.innerHTML = '✅ Database connected - Scans will be saved to your history';
                    statusDiv.style.background = '#d1fae5';
                    statusDiv.style.color = '#065f46';
                } else {
                    statusDiv.innerHTML = '⚠️ Database not connected - Running in standalone mode';
                    statusDiv.style.background = '#fef3c7';
                    statusDiv.style.color = '#92400e';
                }
            } catch (error) {
                console.error('Error checking database status:', error);
            }
        }

        // Scan functionality
        async function startScan() {
            const url = document.getElementById('scan-url').value;
            const scanType = document.querySelector('input[name="scan-type"]:checked').value;
            const maxPages = document.getElementById('max-pages').value;
            
            if (!url) {
                alert('Please enter a URL to scan');
                return;
            }
            
            if (isScanning) {
                return;
            }
            
            isScanning = true;
            const scanBtn = document.querySelector('.scan-btn');
            const originalText = scanBtn.textContent;
            scanBtn.textContent = '🔄 Scanning...';
            scanBtn.disabled = true;
            
            // Show loading overlay
            showLoadingOverlay('Starting accessibility scan...');
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        maxPages: scanType === 'crawl' ? parseInt(maxPages) : 1
                    })
                });
                
                const result = await response.json();
                hideLoadingOverlay();
                
                if (result.success) {
                    displayScanResults(result);
                    // Reload recent scans to show the new scan
                    loadRecentScans();
                    if (document.getElementById('dashboard-page').classList.contains('active')) {
                        loadDashboardData();
                    }
                } else {
                    displayScanError(result.error);
                }
            } catch (error) {
                hideLoadingOverlay();
                console.error('Scan error:', error);
                displayScanError('Network error occurred while scanning');
            } finally {
                isScanning = false;
                scanBtn.textContent = originalText;
                scanBtn.disabled = false;
            }
        }

        function displayScanResults(result) {
            const resultsDiv = document.getElementById('scan-results');
            const violations = result.violations || [];
            
            // Store violations globally for AI suggestions
            currentViolations = violations;
            
            const totalIssues = violations.length;
            const criticalIssues = violations.filter(v => v.impact === 'critical').length;
            const seriousIssues = violations.filter(v => v.impact === 'serious').length;
            const moderateIssues = violations.filter(v => v.impact === 'moderate').length;
            const minorIssues = violations.filter(v => v.impact === 'minor').length;
            
            resultsDiv.innerHTML = \`
                <div class="scan-results">
                    <div class="results-header">
                        <h2 class="results-title">Scan Results</h2>
                        <div class="scan-time">Completed in \${result.scanTime}ms</div>
                    </div>
                    
                    <div class="results-summary">
                        <div class="summary-item">
                            <div class="summary-number">\${totalIssues}</div>
                            <div class="summary-label">Total Issues</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">\${criticalIssues}</div>
                            <div class="summary-label">Critical</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">\${seriousIssues}</div>
                            <div class="summary-label">Serious</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">\${moderateIssues}</div>
                            <div class="summary-label">Moderate</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">\${minorIssues}</div>
                            <div class="summary-label">Minor</div>
                        </div>
                    </div>
                    
                    \${violations.length > 0 ? \`
                        <div class="violations-list">
                            \${violations.map(violation => \`
                                <div class="violation-item">
                                    <div class="violation-header">
                                        <div>
                                            <div class="violation-title">\${violation.id}</div>
                                        </div>
                                        <span class="violation-impact impact-\${violation.impact || 'moderate'}">\${(violation.impact || 'moderate').toUpperCase()}</span>
                                    </div>
                                    <div class="violation-description">
                                        <strong>Description:</strong> \${violation.description || 'No description available'}
                                    </div>
                                    <div class="violation-help">
                                        <strong>Help:</strong> \${violation.help || 'No help text available'}
                                    </div>
                                    \${violation.helpUrl ? \`<a href="\${violation.helpUrl}" target="_blank" class="violation-learn-more">Learn more</a>\` : ''}
                                    <div class="violation-elements">
                                        <strong>Affected elements:</strong> \${violation.nodes ? violation.nodes.length : 1} element(s)
                                    </div>
                                </div>
                            \`).join('')}
                        </div>
                        
                        <div class="results-actions">
                            <button class="view-report-btn" onclick="generateDetailedReport()">📄 View Detailed Report</button>
                            \${violations.length > 0 ? 
                                '<button class="ai-suggestions-btn" onclick="showAISuggestions(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')">🤖 Get AI Fix Suggestions</button>' 
                                : ''
                            }
                            \${violations.length > 0 ? 
                                '<button class="guided-fixing-btn" onclick="GuidedFixing.start(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')">🛠️ Let\\'s Start Fixing</button>' 
                                : ''
                            }
                        </div>
                    \` : \`
                        <div style="text-align: center; padding: 40px; color: #10b981;">
                            <h3>🎉 Excellent! No accessibility issues found.</h3>
                            <p>Your website meets all the accessibility standards we tested.</p>
                        </div>
                    \`}
                </div>
            \`;
            
            resultsDiv.style.display = 'block';
        }

        function displayScanError(error) {
            const resultsDiv = document.getElementById('scan-results');
            resultsDiv.innerHTML = \`
                <div class="scan-results">
                    <div class="results-header">
                        <h2 class="results-title" style="color: #dc3545;">Scan Failed</h2>
                        <div style="color: #dc3545;">Error occurred</div>
                    </div>
                    <div style="text-align: center; padding: 40px; color: #dc3545;">
                        <h3>Scan Failed</h3>
                        <p>\${error}</p>
                    </div>
                </div>
            \`;
            resultsDiv.style.display = 'block';
        }

        // AI Suggestions functionality
        async function showAISuggestions(violations) {
            const modal = document.getElementById('ai-suggestions-modal');
            const content = document.getElementById('ai-suggestions-content');
            
            // Show loading state
            content.innerHTML = '<div class="loading"><div class="spinner"></div>Generating AI suggestions...</div>';
            modal.style.display = 'block';
            
            try {
                const response = await fetch('/api/ai-fixes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ violations: violations })
                });
                
                const suggestions = await response.json();
                
                content.innerHTML = suggestions.map((suggestion, index) => \`
                    <div class="suggestion-item">
                        <div class="suggestion-header">
                            <div class="suggestion-title">Violation \${index + 1}: \${violations[index].id}</div>
                            <span class="priority-badge priority-\${suggestion.priority}">\${suggestion.priority.toUpperCase()}</span>
                        </div>
                        <div class="suggestion-explanation">\${suggestion.explanation}</div>
                        <div class="code-example">\${suggestion.codeExample}</div>
                        <div class="implementation-steps">
                            <div class="steps-title">Implementation Steps:</div>
                            <ol class="steps-list">
                                \${suggestion.steps.map(step => \`<li>\${step}</li>\`).join('')}
                            </ol>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error getting AI suggestions:', error);
                content.innerHTML = '<div style="color: #dc3545; text-align: center; padding: 20px;">Failed to generate AI suggestions. Please try again.</div>';
            }
        }

        function closeAISuggestionsModal() {
            document.getElementById('ai-suggestions-modal').style.display = 'none';
        }

        // NEW: Guided Fixing functionality
        const GuidedFixing = {
            currentViolations: [],
            currentViolationIndex: 0,
            fixedViolations: [],
            
            start: function(violations) {
                this.currentViolations = violations;
                this.currentViolationIndex = 0;
                this.fixedViolations = [];
                
                document.getElementById('guided-fixing-modal').style.display = 'block';
                this.showCurrentViolation();
            },
            
            showCurrentViolation: function() {
                const violation = this.currentViolations[this.currentViolationIndex];
                const totalViolations = this.currentViolations.length;
                
                // Update progress indicator
                document.getElementById('progress-indicator').textContent = \`Violation \${this.currentViolationIndex + 1} of \${totalViolations}\`;
                
                // Update modal body
                document.getElementById('guided-modal-body').innerHTML = \`
                    <div class="current-violation">
                        <div class="violation-id">\${violation.id}</div>
                        <div class="violation-impact impact-\${violation.impact || 'moderate'}">\${(violation.impact || 'moderate').toUpperCase()}</div>
                        <div class="violation-description">
                            <strong>Description:</strong> \${violation.description || 'No description available'}
                        </div>
                        <div class="violation-help">
                            <strong>Help:</strong> \${violation.help || 'No help text available'}
                        </div>
                        \${violation.helpUrl ? \`<a href="\${violation.helpUrl}" target="_blank" class="violation-learn-more">Learn more</a>\` : ''}
                        <div class="violation-elements">
                            <strong>Affected elements:</strong> \${violation.nodes ? violation.nodes.length : 1} element(s)
                        </div>
                    </div>
                    <div class="ai-fix-area" id="ai-fix-area">
                        <p>Click "🤖 Get AI Fix" to get specific suggestions for fixing this violation.</p>
                    </div>
                \`;
                
                // Update navigation buttons
                document.getElementById('prev-btn').disabled = this.currentViolationIndex === 0;
                document.getElementById('next-btn').style.display = this.currentViolationIndex === totalViolations - 1 ? 'none' : 'inline-block';
                document.getElementById('finish-btn').style.display = this.currentViolationIndex === totalViolations - 1 ? 'inline-block' : 'none';
            },
            
            nextViolation: function() {
                if (this.currentViolationIndex < this.currentViolations.length - 1) {
                    this.currentViolationIndex++;
                    this.showCurrentViolation();
                }
            },
            
            previousViolation: function() {
                if (this.currentViolationIndex > 0) {
                    this.currentViolationIndex--;
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
                    
                    const suggestions = await response.json();
                    
                    if (suggestions && suggestions.length > 0) {
                        const suggestion = suggestions[0];
                        
                        aiFixArea.innerHTML = 
                            '<div class="ai-suggestion">' +
                                '<div class="suggestion-header">' +
                                    '<div class="suggestion-title">AI Fix Suggestion</div>' +
                                    '<span class="priority-badge priority-' + suggestion.priority + '">' + suggestion.priority.toUpperCase() + '</span>' +
                                '</div>' +
                                '<div class="suggestion-explanation">' + suggestion.explanation + '</div>' +
                                '<p><strong>Code Example:</strong></p>' +
                                '<pre style="background: #f8f9fa; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>' + suggestion.codeExample + '</code></pre>' +
                                '<p><strong>Implementation Steps:</strong></p>' +
                                '<ol>' + suggestion.steps.map(step => '<li>' + step + '</li>').join('') + '</ol>' +
                                '<div style="margin-top: 16px;">' +
                                    '<button onclick="GuidedFixing.saveFixToReport()" class="btn btn-success">💾 Save to Report</button>' +
                                '</div>' +
                            '</div>';
                    
                    // Store the suggestion for potential saving
                    this.currentViolations[this.currentViolationIndex].aiSuggestion = suggestion;
                } else {
                    throw new Error('No suggestion received');
                }
                
            } catch (error) {
                console.error('Error getting AI fix:', error);
                aiFixArea.innerHTML = '<div style="color: #dc3545; text-align: center; padding: 20px;">Failed to get AI suggestion. Please try again.</div>';
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
                const currentContent = aiFixArea.innerHTML;
                aiFixArea.innerHTML = currentContent.replace(
                    '<button onclick="GuidedFixing.saveFixToReport()" class="btn btn-success">💾 Save to Report</button>',
                    '<div style="color: #10b981; font-weight: 500;">✅ Saved to report</div>'
                );
            }
        },
        
        finish: function() {
            this.generateReport();
            this.close();
        },
        
        generateReport: function() {
            const reportContent = this.fixedViolations.map((item, index) => {
                return \`
## Fix \${index + 1}: \${item.violation.id}

**Impact:** \${item.violation.impact || 'moderate'}
**Description:** \${item.violation.description || 'No description available'}

### AI Suggestion
\${item.suggestion.explanation}

### Code Example
\\\`\\\`\\\`
\${item.suggestion.codeExample}
\\\`\\\`\\\`

### Implementation Steps
\${item.suggestion.steps.map((step, i) => \`\${i + 1}. \${step}\`).join('\\n')}

---
                \`;
            }).join('\\n');
            
            const fullReport = \`# Accessibility Fixes Report

Generated on: \${new Date().toLocaleString()}
Total violations reviewed: \${this.currentViolations.length}
Fixes saved: \${this.fixedViolations.length}

\${reportContent}

## Summary
This report contains AI-generated suggestions for fixing accessibility violations. Please review each suggestion carefully and test thoroughly before implementing in production.
            \`;
            
            // Create and download the report
            const blob = new Blob([fullReport], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`accessibility-fixes-\${new Date().toISOString().split('T')[0]}.md\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            alert(\`Report generated! \${this.fixedViolations.length} fixes saved to markdown file.\`);
        }
    };

        // Detailed report generation
        function generateDetailedReport() {
            if (currentViolations.length === 0) {
                alert('No violations to report');
                return;
            }
            
            const reportContent = currentViolations.map((violation, index) => {
                return \`
## Violation \${index + 1}: \${violation.id}

**Impact:** \${violation.impact || 'moderate'}
**Description:** \${violation.description || 'No description available'}
**Help:** \${violation.help || 'No help text available'}
\${violation.helpUrl ? \`**Learn more:** \${violation.helpUrl}\` : ''}
**Affected elements:** \${violation.nodes ? violation.nodes.length : 1}

---
                \`;
            }).join('\\n');
            
            const fullReport = \`# Accessibility Scan Report

Generated on: \${new Date().toLocaleString()}
Total violations found: \${currentViolations.length}

\${reportContent}

## Summary
This report contains all accessibility violations found during the scan. Each violation should be addressed to improve the accessibility of your website.
            \`;
            
            // Create and download the report
            const blob = new Blob([fullReport], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = \`accessibility-report-\${new Date().toISOString().split('T')[0]}.md\`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        // Loading overlay functions
        function showLoadingOverlay(message) {
            const overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.id = 'loading-overlay';
            overlay.innerHTML = \`
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <div>\${message}</div>
                </div>
            \`;
            document.body.appendChild(overlay);
        }

        function hideLoadingOverlay() {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                overlay.remove();
            }
        }

        // Modal close functionality
        window.onclick = function(event) {
            const aiModal = document.getElementById('ai-suggestions-modal');
            const guidedModal = document.getElementById('guided-fixing-modal');
            
            if (event.target === aiModal) {
                aiModal.style.display = 'none';
            }
            if (event.target === guidedModal) {
                guidedModal.style.display = 'none';
            }
        }

        // Initialize dashboard on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboardData();
        });
    </script>
</body>
</html>`;
    
    res.send(html);
});

// Scan endpoint
app.post('/api/scan', async (req, res) => {
    const { url, scanType, maxPages } = req.body;
    
    if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
    }
    
    const startTime = Date.now();
    
    try {
        console.log(\`🔍 Starting \${scanType} scan for: \${url}\`);
        
        // Launch Puppeteer
        const browser = await puppeteer.launch({
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
            console.log(\`📄 Navigating to: \${url}\`);
            await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
            
            console.log('⏳ Waiting for page to stabilize...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('🔧 Injecting axe-core...');
            await page.addScriptTag({ content: axeCore.source });
            
            console.log('🔍 Running axe accessibility scan...');
            const results = await page.evaluate(async () => {
                return await axe.run();
            });
            
            allViolations = results.violations;
            pagesScanned = 1;
            
        } else if (scanType === 'crawl') {
            // Multi-page crawl
            const urlsToScan = [url];
            const scannedUrls = new Set();
            const maxPagesToScan = Math.min(maxPages || 5, 20); // Limit to 20 pages max
            
            while (urlsToScan.length > 0 && pagesScanned < maxPagesToScan) {
                const currentUrl = urlsToScan.shift();
                
                if (scannedUrls.has(currentUrl)) continue;
                scannedUrls.add(currentUrl);
                
                try {
                    console.log(\`📄 Scanning page \${pagesScanned + 1}: \${currentUrl}\`);
                    await page.goto(currentUrl, { waitUntil: 'networkidle0', timeout: 30000 });
                    
                    // Wait for page to stabilize
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Inject axe-core
                    await page.addScriptTag({ content: axeCore.source });
                    
                    // Run accessibility scan
                    const results = await page.evaluate(async () => {
                        return await axe.run();
                    });
                    
                    allViolations.push(...results.violations);
                    pagesScanned++;
                    
                    // Extract links for further crawling (only if we haven't reached the limit)
                    if (pagesScanned < maxPagesToScan) {
                        const links = await page.evaluate((baseUrl) => {
                            const links = Array.from(document.querySelectorAll('a[href]'));
                            return links
                                .map(link => {
                                    try {
                                        const href = link.getAttribute('href');
                                        if (!href) return null;
                                        
                                        // Convert relative URLs to absolute
                                        const absoluteUrl = new URL(href, baseUrl);
                                        
                                        // Only include URLs from the same domain
                                        if (absoluteUrl.origin === new URL(baseUrl).origin) {
                                            return absoluteUrl.href;
                                        }
                                        return null;
                                    } catch (e) {
                                        return null;
                                    }
                                })
                                .filter(Boolean)
                                .slice(0, 10); // Limit links per page
                        }, currentUrl);
                        
                        // Add new URLs to scan queue
                        links.forEach(link => {
                            if (!scannedUrls.has(link) && !urlsToScan.includes(link)) {
                                urlsToScan.push(link);
                            }
                        });
                    }
                    
                } catch (pageError) {
                    console.log(\`⚠️ Error scanning \${currentUrl}:\`, pageError.message);
                    continue;
                }
            }
        }
        
        await browser.close();
        
        const scanTime = Date.now() - startTime;
        console.log(\`✅ Scan completed in \${scanTime}ms. Found \${allViolations.length} violations across \${pagesScanned} pages.\`);
        
        // Save scan to database
        const scanId = await saveScan(1, 1, url, scanType, allViolations.length, scanTime, pagesScanned, allViolations);
        
        res.json({
            success: true,
            violations: allViolations,
            scanTime: scanTime,
            pagesScanned: pagesScanned,
            scanId: scanId
        });
        
    } catch (error) {
        const scanTime = Date.now() - startTime;
        console.error('❌ Scan failed:', error);
        
        res.json({
            success: false,
            error: error.message,
            scanTime: scanTime
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(\`🚀 SentryPrime Enterprise Dashboard running on port \${PORT}\`);
    console.log(\`📊 Health check: http://localhost:\${PORT}/health\`);
    console.log(\`🔍 Scanner: http://localhost:\${PORT}/\`);
    console.log(\`💾 Database: \${db ? 'Connected' : 'Standalone mode'}\`);
    console.log(\`🌐 Environment: \${process.env.NODE_ENV || 'Local'}\`);
});
