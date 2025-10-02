const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { AxePuppeteer } = require('@axe-core/puppeteer');
const { Pool } = require('pg');
const OpenAI = require('openai');

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

// Database helper functions - PRESERVED FROM WORKING VERSION
async function saveScan(userId, organizationId, url, scanType, totalIssues, scanTimeMs, pagesScanned, violations, platform = 'unknown') {
    if (!db) {
        console.log('⚠️ No database connection, skipping scan save');
        return null;
    }
    
    try {
        const result = await db.query(
            `INSERT INTO scans (user_id, organization_id, url, scan_type, status, total_issues, scan_time_ms, pages_scanned, violations_data, platform, completed_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) 
             RETURNING id`,
            [userId, organizationId, url, scanType, 'completed', totalIssues, scanTimeMs, pagesScanned || 1, JSON.stringify(violations), platform]
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local'
    });
});

// Detailed report endpoint
app.post('/api/detailed-report', (req, res) => {
    const { violations } = req.body;
    
    if (!violations || violations.length === 0) {
        return res.status(400).send('<html><body><h1>No violations data provided</h1></body></html>');
    }
    
    const reportHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Accessibility Scan Report</title>
            <style>
                body { 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    margin: 0; 
                    padding: 20px; 
                    background: #f8f9fa; 
                    color: #333;
                }
                .report-header {
                    background: white;
                    padding: 30px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                    gap: 20px;
                    margin: 20px 0;
                }
                .stat-card {
                    background: white;
                    padding: 20px;
                    border-radius: 8px;
                    text-align: center;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .stat-number {
                    font-size: 2em;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                .violation-item {
                    background: white;
                    margin: 15px 0;
                    padding: 20px;
                    border-radius: 8px;
                    border-left: 4px solid #dc3545;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }
                .violation-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .violation-title {
                    font-size: 1.2em;
                    font-weight: bold;
                    color: #333;
                }
                .impact-badge {
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 0.8em;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                .impact-critical { background: #dc3545; color: white; }
                .impact-serious { background: #fd7e14; color: white; }
                .impact-moderate { background: #ffc107; color: black; }
                .impact-minor { background: #6c757d; color: white; }
                .violation-description {
                    color: #666;
                    margin: 10px 0;
                    line-height: 1.5;
                }
                @media print {
                    body { background: white; }
                    .violation-item { break-inside: avoid; }
                }
            </style>
        </head>
        <body>
            <div class="report-header">
                <h1>🔍 Accessibility Scan Report</h1>
                <p>Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}</p>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">${violations.length}</div>
                        <div>Total Issues</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${violations.filter(v => v.impact === 'critical').length}</div>
                        <div>Critical</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${violations.filter(v => v.impact === 'serious').length}</div>
                        <div>Serious</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${violations.filter(v => v.impact === 'moderate').length}</div>
                        <div>Moderate</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">${violations.filter(v => v.impact === 'minor').length}</div>
                        <div>Minor</div>
                    </div>
                </div>
            </div>
            
            <div class="violations-list">
                ${violations.map((violation, index) => `
                    <div class="violation-item">
                        <div class="violation-header">
                            <div class="violation-title">${index + 1}. ${violation.id}</div>
                            <span class="impact-badge impact-${violation.impact}">${violation.impact}</span>
                        </div>
                        <div class="violation-description">
                            <strong>Description:</strong> ${violation.description || 'No description available'}
                        </div>
                        ${violation.help ? `<div class="violation-description"><strong>Help:</strong> ${violation.help}</div>` : ''}
                        ${violation.helpUrl ? `<div class="violation-description"><strong>Learn more:</strong> <a href="${violation.helpUrl}" target="_blank">${violation.helpUrl}</a></div>` : ''}
                    </div>
                `).join('')}
            </div>
        </body>
        </html>
    `;
    
    res.send(reportHtml);
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

// NEW: AI Suggestions API endpoint
app.post('/api/ai-fixes', async (req, res) => {
    try {
        const { violations, platformInfo } = req.body;
        
        if (!violations || !Array.isArray(violations)) {
            return res.status(400).json({ error: 'Violations array is required' });
        }

        const suggestions = await Promise.all(violations.map(async (violation) => {
            // PHASE 1 ENHANCEMENT: Generate AI-powered suggestions with platform context
            const suggestion = await generateAISuggestion(violation, platformInfo);
            return suggestion;
        }));

        res.json(suggestions);
    } catch (error) {
        console.error('Error generating AI suggestions:', error);
        res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
});

// PHASE 2 ENHANCEMENT: Auto-Fix Implementation Endpoints
app.post('/api/implement-fix', async (req, res) => {
    try {
        const { violation, platformInfo, fixMethod } = req.body;
        
        if (!violation || !platformInfo) {
            return res.status(400).json({ error: 'Violation and platform info are required' });
        }

        const result = await implementAutoFix(violation, platformInfo, fixMethod);
        res.json(result);
    } catch (error) {
        console.error('Error implementing auto-fix:', error);
        res.status(500).json({ error: 'Failed to implement auto-fix' });
    }
});

app.post('/api/preview-fix', async (req, res) => {
    try {
        const { violation, platformInfo, fixMethod } = req.body;
        
        if (!violation || !platformInfo) {
            return res.status(400).json({ error: 'Violation and platform info are required' });
        }

        const preview = await generateFixPreview(violation, platformInfo, fixMethod);
        res.json(preview);
    } catch (error) {
        console.error('Error generating fix preview:', error);
        res.status(500).json({ error: 'Failed to generate fix preview' });
    }
});

// API endpoint to apply a fix (Legacy endpoint for backward compatibility)
app.post('/api/apply-fix', async (req, res) => {
    const { platform, fix, context } = req.body;

    if (!platform || !fix || !context) {
        return res.status(400).json({ error: 'Platform, fix, and context are required' });
    }

    try {
        let result;
        if (platform === 'shopify') {
            result = await applyShopifyFix(fix, context);
        } else if (platform === 'wordpress') {
            result = await applyWordPressFix(fix, context);
        } else if (platform === 'wix') {
            result = await applyWixFix(fix, context);
        } else if (platform === 'squarespace') {
            result = await applySquarespaceFix(fix, context);
        } else {
            return res.status(400).json({ error: `Platform '${platform}' not supported for auto-fixing yet` });
        }

        res.json(result);
    } catch (error) {
        console.error('Error applying fix:', error);
        res.status(500).json({ error: 'Failed to apply fix' });
    }
});

// Parse AI text response into structured format
function parseAITextResponse(aiResponse, violationId) {
    try {
        // Extract sections using regex patterns
        const priorityMatch = aiResponse.match(/PRIORITY:\s*([^\n]+)/i);
        const explanationMatch = aiResponse.match(/EXPLANATION:\s*([\s\S]*?)(?=CODE EXAMPLE:|IMPLEMENTATION STEPS:|$)/i);
        const codeMatch = aiResponse.match(/CODE EXAMPLE:\s*([\s\S]*?)(?=IMPLEMENTATION STEPS:|PLATFORM-SPECIFIC|$)/i);
        const stepsMatch = aiResponse.match(/IMPLEMENTATION STEPS:\s*([\s\S]*?)(?=PLATFORM-SPECIFIC|SPECIFIC ELEMENT:|$)/i);
        
        // Extract priority
        const priority = priorityMatch ? priorityMatch[1].trim().toLowerCase() : 'medium';
        
        // Extract explanation
        const explanation = explanationMatch ? explanationMatch[1].trim() : 
            `Accessibility issue (${violationId}) needs attention to improve user experience.`;
        
        // Extract code example
        const codeExample = codeMatch ? codeMatch[1].trim() : 
            '// Refer to the implementation steps for specific code changes';
        
        // Extract and parse steps
        let steps = [];
        if (stepsMatch) {
            const stepsText = stepsMatch[1].trim();
            steps = stepsText.split(/\d+\./).filter(step => step.trim().length > 0)
                .map(step => step.trim()).slice(0, 10); // Limit to 10 steps
        }
        
        if (steps.length === 0) {
            steps = [
                'Review the WCAG guidelines for this specific issue',
                'Identify all instances of this problem on your site',
                'Implement the recommended solution',
                'Test with accessibility tools and real users',
                'Document the fix for future reference'
            ];
        }
        
        return {
            priority: priority,
            explanation: explanation,
            codeExample: codeExample,
            steps: steps
        };
    } catch (error) {
        console.error('Error parsing AI response:', error);
        return {
            priority: 'medium',
            explanation: `Accessibility issue (${violationId}) needs attention to improve user experience.`,
            codeExample: '// Refer to the implementation steps for specific code changes',
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

// Generate AI-powered accessibility suggestions
async function generateAISuggestion(violation, platformInfo = null) {
    console.log(`🤖 Generating AI suggestion for violation: ${violation.id}`);
    
    if (!openai) {
        console.log('⚠️ No OpenAI client available, using predefined response');
        return {
            priority: 'medium',
            explanation: `This accessibility issue (${violation.id}) needs attention to improve user experience for people with disabilities.`,
            codeExample: '// Refer to the implementation steps for specific code changes',
            steps: [
                'Review the WCAG guidelines for this specific issue',
                'Identify all instances of this problem on your site',
                'Implement the recommended solution',
                'Test with accessibility tools and real users',
                'Document the fix for future reference'
            ]
        };
    }
    
    try {
        console.log(`🤖 Forcing OpenAI call for ${violation.id} to get specific suggestions`);
        
        const platformContext = platformInfo ? 
            `The website is built on ${platformInfo.name} platform with the following capabilities: ${JSON.stringify(platformInfo.capabilities)}.` : 
            'The platform is unknown.';
        
        const prompt = `You are an accessibility expert specializing in ${platformInfo?.name || 'web'} websites. Provide a detailed, SPECIFIC fix suggestion for this accessibility violation:

Violation ID: ${violation.id}
Description: ${violation.description || 'No description provided'}
Help Text: ${violation.help || 'No help text provided'}
Impact Level: ${violation.impact || 'unknown'}
Platform Context: ${platformContext}

Please provide a SPECIFIC fix suggestion with these sections:

PRIORITY: [high/medium/low]

EXPLANATION: [Brief explanation of why this is important and what it affects]

CODE EXAMPLE: [Specific code snippet that fixes this issue]

IMPLEMENTATION STEPS:
1. [First step]
2. [Second step]
3. [Third step]
4. [Fourth step]
5. [Fifth step]

- Method: How to implement this fix on ${platformInfo.name}
- Testing: How to verify the fix works
- Impact: What this improves for users

Focus on practical, actionable advice that can be implemented immediately.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content: "You are an expert web accessibility consultant specializing in WCAG compliance. Provide practical, actionable advice for fixing accessibility issues."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 1000,
            temperature: 0.3
        });

        const aiResponse = response.choices[0].message.content;
        return parseAITextResponse(aiResponse, violation.id);
        
    } catch (error) {
        console.error(`❌ Error generating AI suggestion for ${violation.id}:`, error.message);
        
        // Fallback to predefined response
        return {
            priority: 'medium',
            explanation: `This accessibility issue (${violation.id}) needs attention to improve user experience for people with disabilities.`,
            codeExample: '// Refer to the implementation steps for specific code changes',
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

// Main route - serve the dashboard
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>SentryPrime Enterprise Dashboard</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    color: #333;
                }
                
                .sidebar {
                    position: fixed;
                    left: 0;
                    top: 0;
                    width: 250px;
                    height: 100vh;
                    background: #2c3e50;
                    color: white;
                    padding: 20px 0;
                    overflow-y: auto;
                }
                
                .logo {
                    padding: 0 20px 30px;
                    border-bottom: 1px solid #34495e;
                    margin-bottom: 20px;
                }
                
                .logo h2 {
                    color: #3498db;
                    font-size: 1.2em;
                }
                
                .logo p {
                    color: #bdc3c7;
                    font-size: 0.9em;
                    margin-top: 5px;
                }
                
                .nav-item {
                    display: block;
                    padding: 15px 20px;
                    color: #ecf0f1;
                    text-decoration: none;
                    border-left: 3px solid transparent;
                    transition: all 0.3s ease;
                    position: relative;
                }
                
                .nav-item:hover, .nav-item.active {
                    background: #34495e;
                    border-left-color: #3498db;
                    color: white;
                }
                
                .nav-item .badge {
                    position: absolute;
                    right: 20px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: #e74c3c;
                    color: white;
                    border-radius: 10px;
                    padding: 2px 8px;
                    font-size: 0.8em;
                    min-width: 20px;
                    text-align: center;
                }
                
                .main-content {
                    margin-left: 250px;
                    padding: 20px;
                    min-height: 100vh;
                }
                
                .header {
                    background: white;
                    padding: 20px 30px;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    margin-bottom: 30px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .search-bar {
                    flex: 1;
                    max-width: 400px;
                    margin: 0 20px;
                    position: relative;
                }
                
                .search-bar input {
                    width: 100%;
                    padding: 12px 20px;
                    border: 2px solid #e0e6ed;
                    border-radius: 25px;
                    font-size: 14px;
                    outline: none;
                    transition: border-color 0.3s ease;
                }
                
                .search-bar input:focus {
                    border-color: #3498db;
                }
                
                .user-info {
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }
                
                .user-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: #3498db;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                }
                
                .dashboard-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                
                .dashboard-card {
                    background: white;
                    border-radius: 10px;
                    padding: 25px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease, box-shadow 0.3s ease;
                }
                
                .dashboard-card:hover {
                    transform: translateY(-5px);
                    box-shadow: 0 5px 20px rgba(0,0,0,0.15);
                }
                
                .card-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                
                .card-title {
                    font-size: 1.1em;
                    font-weight: 600;
                    color: #2c3e50;
                }
                
                .card-icon {
                    font-size: 1.5em;
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 20px;
                    margin-bottom: 30px;
                }
                
                .stat-card {
                    background: white;
                    padding: 25px;
                    border-radius: 10px;
                    text-align: center;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease;
                }
                
                .stat-card:hover {
                    transform: translateY(-3px);
                }
                
                .stat-number {
                    font-size: 2.5em;
                    font-weight: bold;
                    color: #2c3e50;
                    margin-bottom: 10px;
                }
                
                .stat-label {
                    color: #7f8c8d;
                    font-size: 0.9em;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                
                .stat-change {
                    font-size: 0.8em;
                    margin-top: 5px;
                }
                
                .stat-change.positive {
                    color: #27ae60;
                }
                
                .stat-change.negative {
                    color: #e74c3c;
                }
                
                .quick-actions {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                
                .action-card {
                    background: white;
                    padding: 30px;
                    border-radius: 10px;
                    text-align: center;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    transition: all 0.3s ease;
                    cursor: pointer;
                    border: 2px solid transparent;
                }
                
                .action-card:hover {
                    transform: translateY(-5px);
                    box-shadow: 0 8px 25px rgba(0,0,0,0.15);
                    border-color: #3498db;
                }
                
                .action-icon {
                    font-size: 3em;
                    margin-bottom: 15px;
                    display: block;
                }
                
                .action-title {
                    font-size: 1.1em;
                    font-weight: 600;
                    color: #2c3e50;
                    margin-bottom: 10px;
                }
                
                .action-description {
                    color: #7f8c8d;
                    font-size: 0.9em;
                    line-height: 1.4;
                }
                
                .recent-scans {
                    background: white;
                    border-radius: 10px;
                    padding: 25px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                
                .scan-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px 0;
                    border-bottom: 1px solid #ecf0f1;
                }
                
                .scan-item:last-child {
                    border-bottom: none;
                }
                
                .scan-info h4 {
                    color: #2c3e50;
                    margin-bottom: 5px;
                }
                
                .scan-meta {
                    color: #7f8c8d;
                    font-size: 0.9em;
                }
                
                .scan-score {
                    text-align: right;
                }
                
                .score-badge {
                    display: inline-block;
                    padding: 5px 12px;
                    border-radius: 20px;
                    font-weight: bold;
                    font-size: 0.9em;
                    margin-bottom: 5px;
                }
                
                .score-excellent {
                    background: #d4edda;
                    color: #155724;
                }
                
                .score-good {
                    background: #d1ecf1;
                    color: #0c5460;
                }
                
                .score-fair {
                    background: #fff3cd;
                    color: #856404;
                }
                
                .score-poor {
                    background: #f8d7da;
                    color: #721c24;
                }
                
                .view-report-btn {
                    background: #3498db;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 0.8em;
                    transition: background 0.3s ease;
                }
                
                .view-report-btn:hover {
                    background: #2980b9;
                }
                
                .scan-form {
                    background: white;
                    padding: 30px;
                    border-radius: 10px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    margin-bottom: 30px;
                }
                
                .form-group {
                    margin-bottom: 20px;
                }
                
                .form-group label {
                    display: block;
                    margin-bottom: 8px;
                    font-weight: 600;
                    color: #2c3e50;
                }
                
                .form-group input[type="url"] {
                    width: 100%;
                    padding: 12px 15px;
                    border: 2px solid #e0e6ed;
                    border-radius: 8px;
                    font-size: 16px;
                    transition: border-color 0.3s ease;
                }
                
                .form-group input[type="url"]:focus {
                    outline: none;
                    border-color: #3498db;
                }
                
                .scan-options {
                    display: flex;
                    gap: 20px;
                    margin-bottom: 20px;
                }
                
                .option-group {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .option-group input[type="radio"] {
                    margin: 0;
                }
                
                .crawl-pages {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .crawl-pages input[type="number"] {
                    width: 80px;
                    padding: 8px;
                    border: 2px solid #e0e6ed;
                    border-radius: 5px;
                    text-align: center;
                }
                
                .scan-btn {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    padding: 15px 30px;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                
                .scan-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                }
                
                .scan-btn:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                    transform: none;
                }
                
                .loading {
                    display: none;
                    text-align: center;
                    padding: 20px;
                    color: #7f8c8d;
                }
                
                .spinner {
                    border: 3px solid #f3f3f3;
                    border-top: 3px solid #3498db;
                    border-radius: 50%;
                    width: 30px;
                    height: 30px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 10px;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .results {
                    background: white;
                    border-radius: 10px;
                    padding: 25px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    margin-top: 20px;
                    display: none;
                }
                
                .results-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #ecf0f1;
                }
                
                .results-stats {
                    display: grid;
                    grid-template-columns: repeat(5, 1fr);
                    gap: 15px;
                    margin-bottom: 20px;
                    text-align: center;
                }
                
                .results-stat {
                    padding: 15px;
                    border-radius: 8px;
                    background: #f8f9fa;
                }
                
                .results-stat-number {
                    font-size: 1.8em;
                    font-weight: bold;
                    margin-bottom: 5px;
                }
                
                .results-stat-label {
                    font-size: 0.9em;
                    color: #6c757d;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                }
                
                .results-actions {
                    display: flex;
                    gap: 10px;
                    justify-content: center;
                    margin-top: 20px;
                }
                
                .btn {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 600;
                    transition: all 0.3s ease;
                    text-decoration: none;
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .btn-primary {
                    background: #007bff;
                    color: white;
                }
                
                .btn-primary:hover {
                    background: #0056b3;
                    transform: translateY(-1px);
                }
                
                .btn-success {
                    background: #28a745;
                    color: white;
                }
                
                .btn-success:hover {
                    background: #1e7e34;
                    transform: translateY(-1px);
                }
                
                .btn-info {
                    background: #17a2b8;
                    color: white;
                }
                
                .btn-info:hover {
                    background: #117a8b;
                    transform: translateY(-1px);
                }
                
                .ai-suggestions-modal {
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
                    border-radius: 10px;
                    width: 90%;
                    max-width: 800px;
                    max-height: 80vh;
                    overflow-y: auto;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                }
                
                .modal-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 20px 30px;
                    border-radius: 10px 10px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .modal-header h2 {
                    margin: 0;
                    font-size: 1.5em;
                }
                
                .close {
                    color: white;
                    font-size: 28px;
                    font-weight: bold;
                    cursor: pointer;
                    border: none;
                    background: none;
                    padding: 0;
                    line-height: 1;
                }
                
                .close:hover {
                    opacity: 0.7;
                }
                
                .modal-body {
                    padding: 30px;
                }
                
                .ai-suggestion {
                    margin-bottom: 30px;
                    padding: 20px;
                    border: 1px solid #e9ecef;
                    border-radius: 8px;
                    background: #f8f9fa;
                }
                
                .ai-suggestion-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 15px;
                }
                
                .ai-suggestion-content h4 {
                    color: #2c3e50;
                    margin-bottom: 10px;
                }
                
                .ai-suggestion-content p {
                    margin-bottom: 15px;
                    line-height: 1.6;
                }
                
                .ai-suggestion-content pre {
                    background: #2c3e50;
                    color: #ecf0f1;
                    padding: 15px;
                    border-radius: 5px;
                    overflow-x: auto;
                    margin: 15px 0;
                }
                
                .ai-suggestion-content ol {
                    padding-left: 20px;
                }
                
                .ai-suggestion-content li {
                    margin-bottom: 8px;
                    line-height: 1.5;
                }
                
                .priority-badge {
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 0.8em;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                
                .priority-high {
                    background: #dc3545;
                    color: white;
                }
                
                .priority-medium {
                    background: #ffc107;
                    color: #212529;
                }
                
                .priority-low {
                    background: #6c757d;
                    color: white;
                }
                
                .database-status {
                    background: #d4edda;
                    color: #155724;
                    padding: 10px 15px;
                    border-radius: 5px;
                    margin-bottom: 20px;
                    font-size: 0.9em;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .guided-fixing-btn {
                    background: #28a745;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 6px;
                    margin: 0 10px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.3s ease;
                }
                
                .guided-fixing-btn:hover {
                    background: #1e7e34;
                    transform: translateY(-1px);
                }
                
                /* NEW: Guided Fixing Modal Styles */
                .guided-fixing-modal {
                    display: none;
                    position: fixed;
                    z-index: 1001;
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
                    border-radius: 10px;
                    width: 95%;
                    max-width: 900px;
                    max-height: 90vh;
                    overflow-y: auto;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.3);
                }
                
                .guided-modal-header {
                    background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
                    color: white;
                    padding: 20px 30px;
                    border-radius: 10px 10px 0 0;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .guided-modal-body {
                    padding: 30px;
                }
                
                .guided-modal-footer {
                    padding: 20px 30px;
                    border-top: 1px solid #e9ecef;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                
                .violation-details {
                    background: #f8f9fa;
                    padding: 20px;
                    border-radius: 8px;
                    margin-bottom: 20px;
                }
                
                .violation-title {
                    font-size: 1.3em;
                    font-weight: bold;
                    color: #2c3e50;
                    margin-bottom: 10px;
                }
                
                .violation-impact {
                    display: inline-block;
                    padding: 4px 12px;
                    border-radius: 20px;
                    font-size: 0.8em;
                    font-weight: bold;
                    text-transform: uppercase;
                    margin-bottom: 15px;
                }
                
                .impact-critical {
                    background: #dc3545;
                    color: white;
                }
                
                .impact-serious {
                    background: #fd7e14;
                    color: white;
                }
                
                .impact-moderate {
                    background: #ffc107;
                    color: #212529;
                }
                
                .impact-minor {
                    background: #6c757d;
                    color: white;
                }
                
                .get-ai-fix-btn {
                    background: #6f42c1;
                    color: white;
                    border: none;
                    padding: 12px 24px;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    transition: all 0.3s ease;
                }
                
                .get-ai-fix-btn:hover {
                    background: #5a32a3;
                    transform: translateY(-1px);
                }
                
                @media (max-width: 768px) {
                    .sidebar {
                        transform: translateX(-100%);
                        transition: transform 0.3s ease;
                    }
                    
                    .main-content {
                        margin-left: 0;
                    }
                    
                    .stats-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                    
                    .dashboard-grid {
                        grid-template-columns: 1fr;
                    }
                    
                    .quick-actions {
                        grid-template-columns: repeat(2, 1fr);
                    }
                    
                    .scan-options {
                        flex-direction: column;
                        gap: 10px;
                    }
                    
                    .results-stats {
                        grid-template-columns: repeat(3, 1fr);
                    }
                    
                    .results-actions {
                        flex-direction: column;
                    }
                }
            </style>
        </head>
        <body>
            <!-- Sidebar -->
            <div class="sidebar">
                <div class="logo">
                    <h2>🛡️ SentryPrime</h2>
                    <p>Enterprise Dashboard</p>
                </div>
                <a href="#" class="nav-item active">📊 Dashboard</a>
                <a href="#" class="nav-item">🔍 Scans <span class="badge">2</span></a>
                <a href="#" class="nav-item">📈 Analytics <span class="badge">8</span></a>
                <a href="#" class="nav-item">👥 Team <span class="badge">4</span></a>
                <a href="#" class="nav-item">🔗 Integrations <span class="badge">5</span></a>
                <a href="#" class="nav-item">⚙️ API Management <span class="badge">10</span></a>
                <a href="#" class="nav-item">💳 Billing <span class="badge">7</span></a>
                <a href="#" class="nav-item">⚙️ Settings <span class="badge">8</span></a>
            </div>
            
            <!-- Main Content -->
            <div class="main-content">
                <!-- Header -->
                <div class="header">
                    <h1>Dashboard Overview</h1>
                    <div class="search-bar">
                        <input type="text" placeholder="Search scans, reports, or settings...">
                    </div>
                    <div class="user-info">
                        <span>🔔</span>
                        <div class="user-avatar">JD</div>
                        <div>
                            <div style="font-weight: 600;">John Doe</div>
                            <div style="font-size: 0.8em; color: #7f8c8d;">Acme Corporation</div>
                        </div>
                    </div>
                </div>
                
                <p style="color: #666; margin-bottom: 30px;">Monitor your accessibility compliance and recent activity</p>
                
                <!-- Database Status -->
                <div class="database-status">
                    ✅ Database connected - Scans will be saved to your history
                </div>
                
                <!-- Stats Grid -->
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number" id="total-scans">3</div>
                        <div class="stat-label">Total Scans</div>
                        <div class="stat-change positive">+2 this week</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="total-issues">22</div>
                        <div class="stat-label">Issues Found</div>
                        <div class="stat-change negative">-5 from last week</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="average-score">92%</div>
                        <div class="stat-label">Average Score</div>
                        <div class="stat-change positive">+3% improvement</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number" id="this-week-scans">2</div>
                        <div class="stat-label">This Week</div>
                        <div class="stat-change">scans completed</div>
                    </div>
                </div>
                
                <!-- Quick Actions -->
                <div class="quick-actions">
                    <div class="action-card" onclick="showScanForm()">
                        <span class="action-icon">🔍</span>
                        <div class="action-title">New Scan</div>
                        <div class="action-description">Start a new accessibility scan</div>
                    </div>
                    <div class="action-card" onclick="showAnalytics()">
                        <span class="action-icon">📊</span>
                        <div class="action-title">View Analytics</div>
                        <div class="action-description">Analyze compliance trends</div>
                    </div>
                    <div class="action-card" onclick="showTeam()">
                        <span class="action-icon">👥</span>
                        <div class="action-title">Manage Team</div>
                        <div class="action-description">Add or remove team members</div>
                    </div>
                    <div class="action-card" onclick="showSettings()">
                        <span class="action-icon">⚙️</span>
                        <div class="action-title">Settings</div>
                        <div class="action-description">Configure your preferences</div>
                    </div>
                </div>
                
                <!-- Scan Form -->
                <div class="scan-form" id="scan-form" style="display: none;">
                    <h2>Scan Website for Accessibility Issues</h2>
                    <form id="accessibility-form">
                        <div class="form-group">
                            <label for="website-url">Website URL</label>
                            <input type="url" id="website-url" name="url" placeholder="https://example.com/" required>
                        </div>
                        
                        <div class="form-group">
                            <label>Scan Options:</label>
                            <div class="scan-options">
                                <div class="option-group">
                                    <input type="radio" id="single-page" name="scanType" value="single" checked>
                                    <label for="single-page">Single Page (Fast - recommended)</label>
                                </div>
                                <div class="option-group">
                                    <input type="radio" id="multi-page" name="scanType" value="crawl">
                                    <label for="multi-page">Multi-Page Crawl (Slower - up to</label>
                                    <div class="crawl-pages">
                                        <input type="number" id="max-pages" name="maxPages" value="5" min="1" max="20">
                                        <span>pages)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        <button type="submit" class="scan-btn" id="scan-button">
                            🔍 Start Accessibility Scan
                        </button>
                    </form>
                    
                    <div class="loading" id="loading">
                        <div class="spinner"></div>
                        <p>Scanning website for accessibility issues...</p>
                    </div>
                    
                    <div class="results" id="results">
                        <div class="results-header">
                            <h3>Scan Results</h3>
                            <span id="scan-time"></span>
                        </div>
                        
                        <div class="results-stats">
                            <div class="results-stat">
                                <div class="results-stat-number" id="total-issues-found">0</div>
                                <div class="results-stat-label">Total Issues</div>
                            </div>
                            <div class="results-stat">
                                <div class="results-stat-number" id="critical-issues">0</div>
                                <div class="results-stat-label">Critical</div>
                            </div>
                            <div class="results-stat">
                                <div class="results-stat-number" id="serious-issues">0</div>
                                <div class="results-stat-label">Serious</div>
                            </div>
                            <div class="results-stat">
                                <div class="results-stat-number" id="moderate-issues">0</div>
                                <div class="results-stat-label">Moderate</div>
                            </div>
                            <div class="results-stat">
                                <div class="results-stat-number" id="minor-issues">0</div>
                                <div class="results-stat-label">Minor</div>
                            </div>
                        </div>
                        
                        <div id="violations-summary"></div>
                        
                        <div class="results-actions" id="results-actions">
                            <!-- Action buttons will be inserted here -->
                        </div>
                    </div>
                </div>
                
                <!-- Recent Scans -->
                <div class="recent-scans">
                    <div class="card-header">
                        <h3 class="card-title">Recent Scans</h3>
                        <span class="card-icon">📋</span>
                    </div>
                    <p style="color: #666; margin-bottom: 20px;">Your latest accessibility scan results</p>
                    
                    <div id="recent-scans-list">
                        <!-- Recent scans will be loaded here -->
                    </div>
                </div>
            </div>
            
            <!-- AI Suggestions Modal -->
            <div id="ai-suggestions-modal" class="ai-suggestions-modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>🤖 AI Fix Suggestions</h2>
                        <span class="close" onclick="closeAISuggestions()">&times;</span>
                    </div>
                    <div class="modal-body" id="ai-suggestions-content">
                        <!-- AI suggestions will be loaded here -->
                    </div>
                </div>
            </div>
            
            <!-- Guided Fixing Modal -->
            <div id="guided-fixing-modal" class="guided-fixing-modal">
                <div class="guided-modal-content">
                    <div class="guided-modal-header">
                        <h2>🛠️ Guided Accessibility Fixing</h2>
                        <div id="progress-indicator">Violation 1 of 3</div>
                        <span class="close" onclick="GuidedFixing.close()">&times;</span>
                    </div>
                    <div class="guided-modal-body" id="guided-modal-body">
                        <!-- Violation details and AI suggestions will be loaded here -->
                    </div>
                    <div class="guided-modal-footer">
                        <button id="prev-btn" onclick="GuidedFixing.previousViolation()">← Previous</button>
                        <button id="get-ai-fix-btn" onclick="GuidedFixing.getAIFixForCurrent()">🤖 Get AI Fix</button>
                        <button id="next-btn" onclick="GuidedFixing.nextViolation()">Next →</button>
                        <button id="finish-btn" onclick="GuidedFixing.close()" style="display: none;">✅ Finish</button>
                    </div>
                </div>
            </div>
            
            <script>
                let currentViolations = [];
                let currentPlatformInfo = null;
                
                // Load dashboard data on page load
                document.addEventListener('DOMContentLoaded', function() {
                    loadDashboardStats();
                    loadRecentScans();
                    updateDatabaseStatus();
                });
                
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
                
                async function loadRecentScans() {
                    try {
                        const response = await fetch('/api/scans/recent');
                        const scans = await response.json();
                        
                        const scansList = document.getElementById('recent-scans-list');
                        
                        if (scans.length === 0) {
                            scansList.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No scans found. Start your first scan above!</p>';
                            return;
                        }
                        
                        scansList.innerHTML = scans.map(scan => {
                            const scoreClass = scan.score >= 95 ? 'excellent' : 
                                             scan.score >= 85 ? 'good' : 
                                             scan.score >= 70 ? 'fair' : 'poor';
                            
                            return \`
                                <div class="scan-item">
                                    <div class="scan-info">
                                        <h4>\${scan.url}</h4>
                                        <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${new Date(scan.created_at).toLocaleDateString()}</div>
                                    </div>
                                    <div class="scan-score">
                                        <div class="score-badge score-\${scoreClass}">\${scan.score}% Score</div>
                                        <button class="view-report-btn" onclick="viewScanReport(\${scan.id})">👁️ View Report</button>
                                    </div>
                                </div>
                            \`;
                        }).join('');
                    } catch (error) {
                        console.error('Error loading recent scans:', error);
                        document.getElementById('recent-scans-list').innerHTML = '<p style="text-align: center; color: #e74c3c; padding: 20px;">Error loading recent scans</p>';
                    }
                }
                
                function updateDatabaseStatus() {
                    // This would be updated based on actual database connection status
                    // For now, we'll show a generic message
                }
                
                function showScanForm() {
                    document.getElementById('scan-form').style.display = 'block';
                    document.getElementById('scan-form').scrollIntoView({ behavior: 'smooth' });
                }
                
                function showAnalytics() {
                    alert('Analytics feature coming soon!');
                }
                
                function showTeam() {
                    alert('Team management feature coming soon!');
                }
                
                function showSettings() {
                    alert('Settings feature coming soon!');
                }
                
                function viewScanReport(scanId) {
                    alert(\`Viewing detailed report for scan \${scanId} - Feature coming soon!\`);
                }
                
                // Handle form submission
                document.getElementById('accessibility-form').addEventListener('submit', async function(e) {
                    e.preventDefault();
                    
                    const formData = new FormData(e.target);
                    const url = formData.get('url');
                    const scanType = formData.get('scanType');
                    const maxPages = formData.get('maxPages') || 5;
                    
                    // Show loading state
                    document.getElementById('scan-button').disabled = true;
                    document.getElementById('loading').style.display = 'block';
                    document.getElementById('results').style.display = 'none';
                    
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
                        
                        if (!response.ok) {
                            throw new Error('Scan failed');
                        }
                        
                        const result = await response.json();
                        displayResults(result);
                        
                    } catch (error) {
                        console.error('Scan error:', error);
                        alert('Scan failed. Please try again.');
                    } finally {
                        document.getElementById('scan-button').disabled = false;
                        document.getElementById('loading').style.display = 'none';
                    }
                });
                
                function displayResults(result) {
                    currentViolations = result.violations || [];
                    currentPlatformInfo = result.platformInfo || null;
                    
                    // Update stats
                    document.getElementById('total-issues-found').textContent = result.totalIssues || 0;
                    document.getElementById('critical-issues').textContent = result.violations?.filter(v => v.impact === 'critical').length || 0;
                    document.getElementById('serious-issues').textContent = result.violations?.filter(v => v.impact === 'serious').length || 0;
                    document.getElementById('moderate-issues').textContent = result.violations?.filter(v => v.impact === 'moderate').length || 0;
                    document.getElementById('minor-issues').textContent = result.violations?.filter(v => v.impact === 'minor').length || 0;
                    document.getElementById('scan-time').textContent = \`Completed in \${result.scanTimeMs}ms\`;
                    
                    // Show summary
                    const summaryDiv = document.getElementById('violations-summary');
                    if (result.totalIssues > 0) {
                        summaryDiv.innerHTML = 
                            '<div style="text-align: center; color: #666; padding: 20px; background: #f8f9fa; border-radius: 8px; margin: 20px 0;"><p>📋 <strong>' + result.totalIssues + ' accessibility issues found</strong></p><p>Use the buttons below to view details or start fixing issues.</p></div>';
                    } else {
                        summaryDiv.innerHTML = 
                            '<div style="text-align: center; color: #28a745; padding: 20px; background: #d4edda; border-radius: 8px; margin: 20px 0;"><p>🎉 <strong>No accessibility issues found!</strong></p><p>Your website meets the basic accessibility standards.</p></div>';
                    }
                    
                    // Show action buttons
                    const actionsDiv = document.getElementById('results-actions');
                    if (result.totalIssues > 0) {
                        actionsDiv.innerHTML = 
                            '<button class="btn btn-primary" onclick="showDetailedReport()">📄 View Detailed Report</button>' +
                            '<button class="ai-suggestions-btn" onclick="showAISuggestions(' + JSON.stringify(currentViolations).replace(/"/g, '&quot;') + ', ' + JSON.stringify(currentPlatformInfo || {}).replace(/"/g, '&quot;') + ')" style="background: #6f42c1; color: white; border: none; padding: 12px 24px; border-radius: 6px; margin: 0 10px; cursor: pointer; font-size: 14px;">🤖 Get AI Fix Suggestions</button>' +
                            '<button class="btn btn-success" onclick="startGuidedFixing()">🛠️ Let\\'s Start Fixing</button>';
                    } else {
                        actionsDiv.innerHTML = 
                            '<button class="btn btn-primary" onclick="showDetailedReport()">📄 View Detailed Report</button>';
                    }
                    
                    // Show results
                    document.getElementById('results').style.display = 'block';
                    document.getElementById('results').scrollIntoView({ behavior: 'smooth' });
                    
                    // Refresh recent scans
                    loadRecentScans();
                }
                
                function showDetailedReport() {
                    if (currentViolations.length === 0) {
                        alert('No violations to show in detailed report.');
                        return;
                    }
                    
                    // Open detailed report in new window
                    const reportWindow = window.open('', '_blank');
                    reportWindow.document.write('<html><body><h1>Loading detailed report...</h1></body></html>');
                    
                    fetch('/api/detailed-report', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ violations: currentViolations })
                    })
                    .then(response => response.text())
                    .then(html => {
                        reportWindow.document.open();
                        reportWindow.document.write(html);
                        reportWindow.document.close();
                    })
                    .catch(error => {
                        console.error('Error generating report:', error);
                        reportWindow.document.write('<html><body><h1>Error generating report</h1></body></html>');
                        reportWindow.document.close();
                    });
                }
                
                async function showAISuggestions(violations, platformInfo) {
                    const modal = document.getElementById('ai-suggestions-modal');
                    const content = document.getElementById('ai-suggestions-content');
                    
                    modal.style.display = 'block';
                    content.innerHTML = '<div class="loading"><div class="spinner"></div>Getting AI suggestions...</div>';
                    
                    try {
                        const response = await fetch('/api/ai-fixes', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ violations, platformInfo })
                        });
                        
                        if (!response.ok) {
                            throw new Error('Failed to get AI suggestions');
                        }
                        
                        const suggestions = await response.json();
                        
                        content.innerHTML = suggestions.map((suggestion, index) => \`
                            <div class="ai-suggestion priority-\${suggestion.priority}">
                                <div class="ai-suggestion-header">
                                    <strong>🤖 AI Fix Suggestion</strong>
                                    <span class="priority-badge priority-\${suggestion.priority}">\${suggestion.priority.toUpperCase()}</span>
                                </div>
                                <div class="ai-suggestion-content">
                                    <p><strong>Issue:</strong> \${suggestion.explanation}</p>
                                    <p><strong>Code Example:</strong></p>
                                    <pre style="background: #f8f9fa; padding: 12px; border-radius: 4px; overflow-x: auto;"><code>\${suggestion.codeExample}</code></pre>
                                    <p><strong>Implementation Steps:</strong></p>
                                    <ol>\${suggestion.steps.map(step => '<li>' + step + '</li>').join('')}</ol>
                                </div>
                            </div>
                        \`).join('');
                        
                    } catch (error) {
                        console.error('Error getting AI suggestions:', error);
                        content.innerHTML = '<div style="text-align: center; color: #e74c3c; padding: 20px;">Error loading AI suggestions. Please try again.</div>';
                    }
                }
                
                function closeAISuggestions() {
                    document.getElementById('ai-suggestions-modal').style.display = 'none';
                }
                
                function startGuidedFixing() {
                    if (currentViolations.length === 0) {
                        alert('No violations to fix.');
                        return;
                    }
                    
                    GuidedFixing.start(currentViolations);
                }
                
                // NEW: Guided Fixing Workflow - Properly Namespaced
                const GuidedFixing = {
                    currentViolations: [],
                    currentViolationIndex: 0,
                    fixedViolations: [],
                    
                    start: function(violations) {
                        // Sort violations by priority (critical > serious > moderate > minor)
                        const priorityOrder = { 'critical': 0, 'serious': 1, 'moderate': 2, 'minor': 3 };
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
                                body: JSON.stringify({ violations: [violation], platformInfo: window.currentPlatformInfo || null })
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
                                '<div style="text-align: center; color: #e74c3c; padding: 20px; background: #f8d7da; border-radius: 8px;">' +
                                    '<p><strong>Error getting AI suggestion</strong></p>' +
                                    '<p>Please try again or refer to the violation details above.</p>' +
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
                            
                            alert('Fix suggestion saved to your report!');
                        }
                    }
                };
                
                // Close modals when clicking outside
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
            </script>
        </body>
        </html>
    `);
});

// Main scanning endpoint
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single', maxPages = 5 } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    console.log(`🔍 Starting accessibility scan for: ${url} (type: ${scanType})`);
    
    const startTime = Date.now();
    let browser = null;
    let platformInfo = null;
    
    try {
        const targetUrl = url.startsWith('http') ? url : `https://${url}`;
        
        // Launch Puppeteer - EXACT WORKING CONFIGURATION
        browser = await puppeteer.launch({
            headless: 'new',
            executablePath: '/usr/bin/chromium-browser',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--window-size=1280,720'
            ]
        });
        
        let allViolations = [];
        let pagesScanned = 0;
        
        if (scanType === 'single') {
            // Single page scan
            const results = await scanSinglePage(browser, targetUrl);
            allViolations = results.violations;
            pagesScanned = 1;
            
            // Detect platform for single page
            platformInfo = await detectPlatform(browser, targetUrl);
        } else {
            // Multi-page crawl scan
            console.log(`🕷️ Starting crawl scan (max ${maxPages} pages)`);
            
            const visitedUrls = new Set();
            const urlsToVisit = [targetUrl];
            
            // Scan first page and get platform info
            const firstPageResults = await scanSinglePage(browser, targetUrl);
            allViolations.push(...firstPageResults.violations);
            visitedUrls.add(targetUrl);
            pagesScanned++;
            
            // Detect platform from first page
            platformInfo = await detectPlatform(browser, targetUrl);
            
            // Extract links from first page for crawling
            try {
                const page = await browser.newPage();
                await page.goto(targetUrl, { 
                    waitUntil: 'networkidle0',
                    timeout: 30000 
                });
                
                const links = await page.evaluate((baseUrl) => {
                    const anchors = Array.from(document.querySelectorAll('a[href]'));
                    const baseUrlObj = new URL(baseUrl);
                    
                    return anchors
                        .map(a => a.href)
                        .filter(href => {
                            try {
                                const url = new URL(href);
                                return url.hostname === baseUrlObj.hostname && 
                                       !href.includes('#') && 
                                       !href.includes('mailto:') && 
                                       !href.includes('tel:');
                            } catch {
                                return false;
                            }
                        })
                        .slice(0, maxPages - 1); // Reserve one slot for the main page
                }, targetUrl);
                
                urlsToVisit.push(...links);
                await page.close();
                
            } catch (error) {
                console.log('⚠️ Error extracting links for crawl:', error.message);
            }
            
            // Scan additional pages
            for (const pageUrl of urlsToVisit.slice(1)) {
                if (pagesScanned >= maxPages) break;
                if (visitedUrls.has(pageUrl)) continue;
                
                try {
                    console.log(`🔍 Scanning page ${pagesScanned + 1}: ${pageUrl}`);
                    const pageResults = await scanSinglePage(browser, pageUrl);
                    allViolations.push(...pageResults.violations);
                    visitedUrls.add(pageUrl);
                    pagesScanned++;
                } catch (error) {
                    console.log(`⚠️ Error scanning ${pageUrl}:`, error.message);
                }
            }
        }
        
        const scanTimeMs = Date.now() - startTime;
        const totalIssues = allViolations.length;
        
        console.log(`✅ ${scanType === 'single' ? 'Single page' : 'Multi-page'} scan completed in ${scanTimeMs}ms. Found ${totalIssues} violations.`);
        
        // Save scan to database with platform information
        const scanId = await saveScan(
            1, // userId
            1, // organizationId  
            targetUrl,
            scanType,
            totalIssues,
            scanTimeMs,
            pagesScanned,
            allViolations,
            platformInfo?.type || 'unknown'
        );
        
        // Log platform detection results
        console.log('🔍 Platform detected:', JSON.stringify(platformInfo, null, 2));
        
        res.json({
            success: true,
            url: targetUrl,
            scanType,
            totalIssues,
            scanTimeMs,
            pagesScanned,
            violations: allViolations,
            platformInfo,
            scanId
        });
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        res.status(500).json({ 
            error: 'Scan failed', 
            details: error.message,
            url: url
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

async function scanSinglePage(browser, url) {
    const page = await browser.newPage();
    
    try {
        console.log('Navigating to:', url);
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        console.log('Waiting for page to stabilize...');
        await page.waitForTimeout(2000);
        
        console.log('Injecting axe-core...');
        await page.addScriptTag({
            path: require.resolve('axe-core/axe.min.js')
        });
        
        console.log('Running axe accessibility scan...');
        const results = await page.evaluate(async () => {
            return await axe.run();
        });
        
        return {
            url: url,
            violations: results.violations || [],
            passes: results.passes || [],
            incomplete: results.incomplete || [],
            inapplicable: results.inapplicable || []
        };
        
    } catch (error) {
        console.error(`Error scanning ${url}:`, error);
        throw error;
    } finally {
        await page.close();
    }
}

async function detectPlatform(browser, url) {
    const page = await browser.newPage();
    
    try {
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        const platformInfo = await page.evaluate(() => {
            const platform = {
                type: 'custom',
                name: 'Unknown',
                version: null,
                confidence: 0,
                indicators: [],
                capabilities: {
                    cssInjection: false,
                    themeEditor: false,
                    pluginSystem: false,
                    apiAccess: false
                }
            };
            
            // WordPress Detection (More Specific) - Only if not Shopify
            if ((document.querySelector('meta[name="generator"][content*="WordPress"]') ||
                (document.querySelector('link[href*="wp-content"]') && document.querySelector('script[src*="wp-content"]')) ||
                (window.wp && document.querySelector('link[href*="wp-content"]')) ||
                document.body.className.includes('wp-')) &&
                !document.querySelector('script[src*="shopify"]')) { // Exclude if Shopify detected
                platform.type = 'wordpress';
                platform.name = 'WordPress';
                platform.confidence = 0.9;
                platform.indicators.push('wp-content detected', 'WordPress meta tag or scripts');
                platform.capabilities = {
                    cssInjection: true,
                    themeEditor: true,
                    pluginSystem: true,
                    apiAccess: true
                };
                
                // Try to detect version
                const generator = document.querySelector('meta[name="generator"]');
                if (generator && generator.content.includes('WordPress')) {
                    const versionMatch = generator.content.match(/WordPress\\s+([\\d.]+)/);
                    if (versionMatch) platform.version = versionMatch[1];
                }
            }
            
            // Shopify Detection (Enhanced and More Aggressive)
            if (document.querySelector('script[src*="shopify"]') ||
                document.querySelector('link[href*="shopify"]') ||
                document.querySelector('script[src*="shopifycdn"]') ||
                document.querySelector('meta[name="shopify-checkout-api-token"]') ||
                document.querySelector('script[src*="monorail-edge.shopifysvc.com"]') ||
                document.querySelector('[id*="shopify"]') ||
                document.querySelector('[class*="shopify"]') ||
                document.querySelector('div[id*="shopify-section"]') ||
                document.querySelector('script[src*="cdn.shopify.com"]') ||
                window.Shopify || 
                document.querySelector('[data-shopify]') ||
                Array.from(document.querySelectorAll('script')).some(script => 
                    script.textContent && (
                        script.textContent.includes('Shopify') ||
                        script.textContent.includes('shop_money_format') ||
                        script.textContent.includes('shopify-section')
                    )
                )) {
                platform.type = 'shopify';
                platform.name = 'Shopify';
                platform.confidence = 0.9;
                platform.indicators.push('Shopify scripts detected', 'Shopify data attributes');
                platform.capabilities = {
                    cssInjection: false,
                    themeEditor: true,
                    pluginSystem: false,
                    apiAccess: true
                };
            }
            
            // Wix Detection
            else if (document.querySelector('meta[name="generator"][content*="Wix"]') ||
                     document.querySelector('script[src*="wix.com"]') ||
                     window.wixDevelopersAnalytics) {
                platform.type = 'wix';
                platform.name = 'Wix';
                platform.confidence = 0.8;
                platform.indicators.push('Wix generator meta tag', 'Wix scripts');
                platform.capabilities = {
                    cssInjection: false,
                    themeEditor: false,
                    pluginSystem: false,
                    apiAccess: false
                };
            }
            
            // Squarespace Detection
            else if (document.querySelector('script[src*="squarespace"]') ||
                     document.querySelector('link[href*="squarespace"]') ||
                     document.body.id === 'collection' ||
                     document.querySelector('.sqs-')) {
                platform.type = 'squarespace';
                platform.name = 'Squarespace';
                platform.confidence = 0.8;
                platform.indicators.push('Squarespace scripts', 'SQS class names');
                platform.capabilities = {
                    cssInjection: true,
                    themeEditor: false,
                    pluginSystem: false,
                    apiAccess: false
                };
            }
            
            return platform;
        });
        
        return platformInfo;
        
    } catch (error) {
        console.error('Error detecting platform:', error);
        return {
            type: 'unknown',
            name: 'Unknown',
            version: null,
            confidence: 0,
            indicators: ['Detection failed'],
            capabilities: {
                cssInjection: false,
                themeEditor: false,
                pluginSystem: false,
                apiAccess: false
            }
        };
    } finally {
        await page.close();
    }
}

// PHASE 2 ENHANCEMENT: Auto-Fix Implementation Functions
async function implementAutoFix(violation, platformInfo, fixMethod = 'auto') {
    try {
        console.log(`🔧 Implementing auto-fix for ${violation.id} on ${platformInfo.name}`);
        
        // Generate platform-specific fix code
        const fixCode = await generatePlatformSpecificFix(violation, platformInfo);
        
        // Determine implementation method based on platform capabilities
        let implementationResult;
        
        switch (platformInfo.type) {
            case 'wordpress':
                implementationResult = await implementWordPressFix(violation, fixCode, platformInfo);
                break;
            case 'shopify':
                implementationResult = await implementShopifyFix(violation, fixCode, platformInfo);
                break;
            case 'wix':
                implementationResult = await implementWixFix(violation, fixCode, platformInfo);
                break;
            case 'squarespace':
                implementationResult = await implementSquarespaceFix(violation, fixCode, platformInfo);
                break;
            default:
                implementationResult = await implementGenericFix(violation, fixCode, platformInfo);
        }
        
        return {
            success: true,
            violation: violation.id,
            platform: platformInfo.name,
            method: fixMethod,
            implementation: implementationResult,
            timestamp: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('❌ Auto-fix implementation error:', error);
        return {
            success: false,
            error: error.message,
            violation: violation.id,
            platform: platformInfo.name
        };
    }
}

async function generatePlatformSpecificFix(violation, platformInfo) {
    try {
        const prompt = `Generate specific ${platformInfo.name} code to fix this accessibility violation:

Violation: ${violation.id}
Description: ${violation.description}
Platform: ${platformInfo.name}
Platform Capabilities: ${JSON.stringify(platformInfo.capabilities)}

Provide the exact code needed to fix this issue on ${platformInfo.name}, considering:
1. Platform-specific syntax and methods
2. Available customization options
3. Best practices for ${platformInfo.name}
4. WCAG compliance requirements

Return only the code without explanations.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4.1-mini",
            messages: [
                {
                    role: "system",
                    content: `You are an expert ${platformInfo.name} developer specializing in accessibility fixes. Generate precise, platform-specific code.`
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 1000,
            temperature: 0.3
        });

        return response.choices[0].message.content.trim();
    } catch (error) {
        console.error('❌ Error generating platform-specific fix:', error);
        throw error;
    }
}

async function implementWordPressFix(violation, fixCode, platformInfo) {
    return {
        method: 'WordPress Theme/Plugin Modification',
        code: fixCode,
        instructions: [
            'Access WordPress admin dashboard',
            'Navigate to Appearance > Theme Editor or Plugins',
            'Apply the generated code to the appropriate file',
            'Test the changes on the frontend',
            'Verify accessibility improvement'
        ],
        files: ['functions.php', 'style.css', 'custom-accessibility.js'],
        apiEndpoint: '/wp-admin/admin-ajax.php',
        capabilities: platformInfo.capabilities
    };
}

async function implementShopifyFix(violation, fixCode, platformInfo) {
    return {
        method: 'Shopify Theme Liquid/Asset Modification',
        code: fixCode,
        instructions: [
            'Access Shopify admin panel',
            'Navigate to Online Store > Themes',
            'Click "Actions" > "Edit code"',
            'Apply changes to appropriate template files',
            'Preview and publish changes'
        ],
        files: ['theme.liquid', 'assets/theme.css', 'assets/accessibility.js'],
        apiEndpoint: '/admin/api/themes',
        capabilities: platformInfo.capabilities
    };
}

async function implementWixFix(violation, fixCode, platformInfo) {
    return {
        method: 'Wix Editor Custom Code',
        code: fixCode,
        instructions: [
            'Open Wix Editor',
            'Navigate to Settings > Custom Code',
            'Add code to Head or Body section',
            'Use Wix Code (Velo) if dynamic functionality needed',
            'Publish site to apply changes'
        ],
        files: ['Custom Code Head', 'Custom Code Body', 'Velo Code Files'],
        apiEndpoint: 'Wix Editor Interface',
        capabilities: platformInfo.capabilities,
        limitations: 'Limited direct DOM access, use Wix APIs when possible'
    };
}

async function implementSquarespaceFix(violation, fixCode, platformInfo) {
    return {
        method: 'Squarespace Code Injection',
        code: fixCode,
        instructions: [
            'Access Squarespace admin',
            'Navigate to Settings > Advanced > Code Injection',
            'Add CSS to Header or Footer',
            'Use Custom CSS panel for styling fixes',
            'Save and preview changes'
        ],
        files: ['Header Code Injection', 'Footer Code Injection', 'Custom CSS'],
        apiEndpoint: 'Squarespace Admin Interface',
        capabilities: platformInfo.capabilities
    };
}

async function implementGenericFix(violation, fixCode, platformInfo) {
    return {
        method: 'Generic Web Implementation',
        code: fixCode,
        instructions: [
            'Access your website\'s source code',
            'Locate the relevant HTML/CSS/JS files',
            'Apply the generated code changes',
            'Test across different browsers',
            'Validate accessibility improvements'
        ],
        files: ['index.html', 'styles.css', 'scripts.js'],
        apiEndpoint: 'Direct file modification',
        capabilities: {
            cssInjection: true,
            themeEditor: true,
            pluginSystem: false,
            apiAccess: false
        }
    };
}

async function generateFixPreview(violation, platformInfo, fixMethod) {
    try {
        const fixCode = await generatePlatformSpecificFix(violation, platformInfo);
        
        return {
            violation: violation.id,
            platform: platformInfo.name,
            preview: {
                before: `Current state: ${violation.description}`,
                after: 'Accessibility issue will be resolved',
                code: fixCode,
                impact: `Fixes ${violation.impact} level accessibility violation`,
                wcagCriteria: violation.tags || []
            },
            estimatedTime: '5-15 minutes',
            difficulty: getDifficultyLevel(violation, platformInfo),
            requirements: getPlatformRequirements(platformInfo)
        };
    } catch (error) {
        console.error('❌ Error generating fix preview:', error);
        throw error;
    }
}

function getDifficultyLevel(violation, platformInfo) {
    const complexViolations = ['color-contrast', 'keyboard-navigation', 'focus-management'];
    const isComplex = complexViolations.some(complex => violation.id.includes(complex));
    
    if (isComplex) return 'Advanced';
    if (platformInfo.capabilities.cssInjection) return 'Beginner';
    return 'Intermediate';
}

function getPlatformRequirements(platformInfo) {
    const requirements = ['Admin access to ' + platformInfo.name];
    
    if (platformInfo.capabilities.themeEditor) {
        requirements.push('Theme editing permissions');
    }
    if (platformInfo.capabilities.pluginSystem) {
        requirements.push('Plugin installation rights');
    }
    if (!platformInfo.capabilities.cssInjection) {
        requirements.push('Custom code injection capability');
    }
    
    return requirements;
}

// Legacy platform-specific fix functions (for backward compatibility)
async function applyShopifyFix(fix, context) {
    console.log('Applying Shopify fix:', { fix, context });

    // TODO: Implement Shopify API calls here

    return {
        success: true,
        message: 'Shopify fix applied successfully (mocked).',
        platform: 'shopify'
    };
}

async function applyWordPressFix(fix, context) {
    console.log('Applying WordPress fix:', { fix, context });

    // TODO: Implement WordPress API calls here

    return {
        success: true,
        message: 'WordPress fix applied successfully (mocked).',
        platform: 'wordpress'
    };
}

async function applyWixFix(fix, context) {
    console.log('Applying Wix fix:', { fix, context });

    // TODO: Implement Wix API calls here

    return {
        success: true,
        message: 'Wix fix applied successfully (mocked).',
        platform: 'wix'
    };
}

async function applySquarespaceFix(fix, context) {
    console.log('Applying Squarespace fix:', { fix, context });

    // TODO: Implement Squarespace API calls here

    return {
        success: true,
        message: 'Squarespace fix applied successfully (mocked).',
        platform: 'squarespace'
    };
}

// Start server - MUST BE AT THE END
app.listen(PORT, () => {
    console.log('🚀 SentryPrime Enterprise Dashboard running on port ' + PORT);
    console.log('📊 Health check: http://localhost:' + PORT + '/health');
    console.log('🔍 Scanner: http://localhost:' + PORT + '/');
    console.log('💾 Database: ' + (db ? 'Connected' : 'Standalone mode'));
    console.log('🌐 Environment: ' + (process.env.K_SERVICE ? 'Cloud Run' : 'Local'));
});
