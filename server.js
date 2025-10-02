const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
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
                        
                        <!-- PHASE 2A: Auto-Fix Buttons -->
                        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #eee;">
                            <button onclick="autoFixViolation('${violation.id}', ${index})" 
                                    style="background: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; margin-right: 10px; cursor: pointer; font-size: 14px;">
                                🔧 Auto-Fix
                            </button>
                            <button onclick="previewFix('${violation.id}', ${index})" 
                                    style="background: #17a2b8; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px;">
                                👁️ Preview Fix
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <!-- PHASE 2A: Auto-Fix JavaScript Functions -->
            <script>
                async function autoFixViolation(violationId, index) {
                    const button = event.target;
                    const originalText = button.textContent;
                    
                    try {
                        button.textContent = '🔄 Applying Fix...';
                        button.disabled = true;
                        
                        const response = await fetch('/api/implement-fix', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                violationId: violationId,
                                fixType: 'auto',
                                platformInfo: window.platformInfo || { type: 'custom' }
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            button.textContent = '✅ Fix Generated';
                            button.style.background = '#28a745';
                            
                            // Show download options
                            const fixContainer = button.parentElement;
                            fixContainer.innerHTML += \`
                                <div style="margin-top: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px;">
                                    <strong>✅ Fix Generated Successfully!</strong><br>
                                    <small>Download the fix files and follow the implementation instructions.</small><br>
                                    <button onclick="downloadFix('\${violationId}', 'css')" 
                                            style="background: #007bff; color: white; border: none; padding: 6px 12px; border-radius: 3px; margin: 5px 5px 0 0; cursor: pointer; font-size: 12px;">
                                        📄 Download CSS
                                    </button>
                                    <button onclick="downloadFix('\${violationId}', 'instructions')" 
                                            style="background: #6f42c1; color: white; border: none; padding: 6px 12px; border-radius: 3px; margin: 5px 0 0 0; cursor: pointer; font-size: 12px;">
                                        📋 Download Instructions
                                    </button>
                                </div>
                            \`;
                        } else {
                            throw new Error(result.error || 'Fix generation failed');
                        }
                        
                    } catch (error) {
                        console.error('Auto-fix error:', error);
                        button.textContent = '❌ Fix Failed';
                        button.style.background = '#dc3545';
                        setTimeout(() => {
                            button.textContent = originalText;
                            button.style.background = '#28a745';
                            button.disabled = false;
                        }, 3000);
                    }
                }
                
                async function previewFix(violationId, index) {
                    const button = event.target;
                    const originalText = button.textContent;
                    
                    try {
                        button.textContent = '🔄 Generating Preview...';
                        button.disabled = true;
                        
                        const response = await fetch('/api/preview-fix', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                violationId: violationId,
                                elementSelector: \`violation-\${index}\`,
                                platformInfo: window.platformInfo || { type: 'custom' }
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            // Create preview modal
                            const modal = document.createElement('div');
                            modal.style.cssText = \`
                                position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                                background: rgba(0,0,0,0.8); z-index: 1000; display: flex; 
                                align-items: center; justify-content: center;
                            \`;
                            
                            modal.innerHTML = \`
                                <div style="background: white; padding: 30px; border-radius: 8px; max-width: 800px; max-height: 80vh; overflow-y: auto;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                        <h3>👁️ Fix Preview: \${violationId}</h3>
                                        <button onclick="this.closest('div').parentElement.remove()" 
                                                style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">
                                            ✕ Close
                                        </button>
                                    </div>
                                    
                                    <div style="margin-bottom: 20px;">
                                        <h4>📋 What this fix will do:</h4>
                                        <p>\${result.preview.impact}</p>
                                    </div>
                                    
                                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                                        <div>
                                            <h4>❌ Before (Current):</h4>
                                            <pre style="background: #f8f9fa; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 12px;">\${result.preview.before.code}</pre>
                                        </div>
                                        <div>
                                            <h4>✅ After (Fixed):</h4>
                                            <pre style="background: #d4edda; padding: 15px; border-radius: 4px; overflow-x: auto; font-size: 12px;">\${result.preview.after.code}</pre>
                                        </div>
                                    </div>
                                    
                                    <div>
                                        <h4>🛠️ Implementation Steps:</h4>
                                        <ol>
                                            \${result.preview.instructions.map(step => \`<li>\${step}</li>\`).join('')}
                                        </ol>
                                    </div>
                                    
                                    <div style="text-align: center; margin-top: 20px;">
                                        <button onclick="autoFixViolation('\${violationId}', \${index}); this.closest('div').parentElement.remove();" 
                                                style="background: #28a745; color: white; border: none; padding: 12px 24px; border-radius: 4px; cursor: pointer; font-size: 14px;">
                                            🔧 Apply This Fix
                                        </button>
                                    </div>
                                </div>
                            \`;
                            
                            document.body.appendChild(modal);
                        } else {
                            throw new Error(result.error || 'Preview generation failed');
                        }
                        
                    } catch (error) {
                        console.error('Preview error:', error);
                        alert('Failed to generate preview: ' + error.message);
                    } finally {
                        button.textContent = originalText;
                        button.disabled = false;
                    }
                }
                
                function downloadFix(violationId, type) {
                    // This would trigger the download of the generated fix files
                    const url = \`/api/download-fix/\${type}?violationId=\${violationId}&platform=\${window.platformInfo?.type || 'custom'}\`;
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = \`\${violationId}-fix.\${type === 'css' ? 'css' : 'md'}\`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            </script>
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
            steps = ['Review the accessibility violation details', 'Apply the suggested code changes', 'Test with screen readers'];
        }
        
        return {
            priority: ['high', 'medium', 'low'].includes(priority) ? priority : 'medium',
            explanation: explanation,
            codeExample: codeExample,
            steps: steps
        };
        
    } catch (error) {
        console.log(`⚠️ Error parsing AI response for ${violationId}:`, error.message);
        return {
            priority: 'medium',
            explanation: aiResponse.substring(0, 500) + '...',
            codeExample: '// Full AI response available in logs',
            steps: ['Review the AI suggestion', 'Apply recommended changes', 'Test accessibility improvements']
        };
    }
}

async function generateAISuggestion(violation, platformInfo = null) {
    console.log(`🤖 Forcing OpenAI call for ${violation.id} to get specific suggestions`);
    
    // Extract element details from the first node if available
    const firstNode = violation.nodes?.[0];
    const elementDetails = firstNode ? {
        html: firstNode.html || 'Not available',
        target: firstNode.target?.[0] || 'Not available',
        failureSummary: firstNode.failureSummary || 'Not available'
    } : null;

    // Try to get AI-generated suggestion if OpenAI is available
    if (openai) {
        try {
            console.log(`🤖 Generating AI suggestion for violation: ${violation.id}`);
            
            const prompt = `You are an accessibility expert specializing in ${platformInfo?.name || 'web'} websites. Provide a detailed, SPECIFIC fix suggestion for this accessibility violation:

VIOLATION DETAILS:
- ID: ${violation.id}
- Description: ${violation.description || 'No description provided'}
- Impact: ${violation.impact || 'Unknown'}
- Help URL: ${violation.helpUrl || 'N/A'}

${elementDetails ? `
SPECIFIC ELEMENT DETAILS:
- HTML: ${elementDetails.html}
- CSS Selector: ${elementDetails.target}
- Issue: ${elementDetails.failureSummary}
` : ''}

${platformInfo ? `
PLATFORM INFORMATION:
- Platform: ${platformInfo.name} (${platformInfo.type})
- Confidence: ${Math.round(platformInfo.confidence * 100)}%
- Capabilities: CSS Injection: ${platformInfo.capabilities?.cssInjection}, Theme Editor: ${platformInfo.capabilities?.themeEditor}
` : ''}

Please provide a SPECIFIC fix suggestion with these sections:

PRIORITY: (high/medium/low)

EXPLANATION: 
Provide a specific explanation for this exact element and platform.

CODE EXAMPLE:
Show the EXACT before and after code for this specific element.

IMPLEMENTATION STEPS:
1. First specific step for ${platformInfo?.name || 'this platform'}
2. Second specific step
3. Continue with detailed steps...

${platformInfo ? `PLATFORM-SPECIFIC INSTRUCTIONS:
- Method: How to implement this fix on ${platformInfo.name}
- Location: Where to make the change (theme editor, CSS file, etc.)
- Code: ${platformInfo.name}-specific code or instructions
` : ''}

SPECIFIC ELEMENT: ${elementDetails?.target || 'Not available'}
CURRENT HTML: ${elementDetails?.html || 'Not available'}`;

            const completion = await openai.chat.completions.create({
                model: "gpt-3.5-turbo",
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
                max_tokens: 2500,
                temperature: 0.7
            });

            const aiResponse = completion.choices[0].message.content;
            console.log(`📝 AI response length: ${aiResponse.length} characters for ${violation.id}`);
            console.log(`📄 AI response preview: ${aiResponse.substring(0, 200)}...`);
            
            // Parse the structured text response
            const suggestion = parseAITextResponse(aiResponse, violation.id);
            console.log(`✅ Successfully parsed AI response for ${violation.id}`);
            
            console.log(`✅ AI suggestion generated for ${violation.id}`);
            return suggestion;
            
        } catch (error) {
            console.log(`❌ Error generating AI suggestion for ${violation.id}:`, error.message);
            // Fall through to default suggestion
        }
    }

    // Default suggestion for unknown violation types or when AI fails
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

    return defaultSuggestion;
}

// PHASE 2A ENHANCEMENT: Auto-Fix Code Generation Function
function generateFixCode(violation, platformInfo) {
    const { id, impact, description, help, nodes } = violation;
    const platform = platformInfo?.type || 'custom';
    
    let fixCode = {
        css: '',
        html: '',
        javascript: '',
        instructions: [],
        filename: `fix-${id}-${Date.now()}`
    };

    switch (id) {
        case 'color-contrast':
            if (platform === 'shopify') {
                fixCode.css = `/* Fix for color contrast issue in Shopify theme */
.elementor-button, .btn, .button, a[href] {
    color: #000000 !important;
    background-color: #ffffff !important;
    border: 2px solid #000000 !important;
}

/* Ensure sufficient contrast for text elements */
.text-content, p, span, div {
    color: #000000 !important;
    background-color: transparent !important;
}`;
                fixCode.instructions = [
                    'Log in to your Shopify admin dashboard',
                    'Navigate to Online Store > Themes',
                    'Click "Actions" > "Edit code" on your active theme',
                    'Find the assets/theme.css file or create a new CSS file',
                    'Add the provided CSS code to fix color contrast issues',
                    'Save the changes and preview your store'
                ];
            } else if (platform === 'wordpress') {
                fixCode.css = `/* WordPress color contrast fix */
.wp-block-button__link, .button, .btn {
    color: #000000 !important;
    background-color: #ffffff !important;
    border: 2px solid #000000 !important;
}`;
                fixCode.instructions = [
                    'Log in to your WordPress admin dashboard',
                    'Go to Appearance > Customize',
                    'Click on "Additional CSS"',
                    'Paste the provided CSS code',
                    'Click "Publish" to save changes'
                ];
            } else {
                fixCode.css = `/* Universal color contrast fix */
.low-contrast-element {
    color: #000000 !important;
    background-color: #ffffff !important;
    border: 2px solid #000000 !important;
}`;
                fixCode.instructions = [
                    'Add the provided CSS to your main stylesheet',
                    'Apply the .low-contrast-element class to problematic elements',
                    'Test the contrast ratio using browser developer tools'
                ];
            }
            break;

        case 'link-name':
            fixCode.html = `<!-- Before: Problematic link -->
<a href="/learn-more">Learn More</a>

<!-- After: Accessible link with descriptive text -->
<a href="/learn-more" aria-label="Learn more about our accessibility features">Learn More</a>

<!-- Alternative: Add descriptive text -->
<a href="/learn-more">Learn More About Our Accessibility Features</a>`;
            
            fixCode.instructions = [
                'Locate the problematic link in your HTML',
                'Add descriptive text or aria-label attribute',
                'Ensure the link purpose is clear from the text alone',
                'Test with screen readers to verify accessibility'
            ];
            break;

        case 'image-alt':
            fixCode.html = `<!-- Before: Image without alt text -->
<img src="product-image.jpg">

<!-- After: Image with descriptive alt text -->
<img src="product-image.jpg" alt="Blue cotton t-shirt with round neck, size medium">

<!-- For decorative images -->
<img src="decorative-border.jpg" alt="" role="presentation">`;
            
            fixCode.instructions = [
                'Add meaningful alt text that describes the image content',
                'For decorative images, use alt="" and role="presentation"',
                'Keep alt text concise but descriptive',
                'Avoid phrases like "image of" or "picture of"'
            ];
            break;

        case 'heading-order':
            fixCode.html = `<!-- Before: Incorrect heading hierarchy -->
<h1>Main Title</h1>
<h3>Subsection</h3>
<h2>Section Title</h2>

<!-- After: Correct heading hierarchy -->
<h1>Main Title</h1>
<h2>Section Title</h2>
<h3>Subsection</h3>`;
            
            fixCode.instructions = [
                'Review your heading structure (h1, h2, h3, etc.)',
                'Ensure headings follow a logical hierarchy',
                'Use only one h1 per page',
                'Don\'t skip heading levels (h1 to h3 without h2)'
            ];
            break;

        default:
            fixCode.css = `/* Generic accessibility fix for ${id} */
.accessibility-fix {
    /* Add appropriate styles based on the specific issue */
}`;
            fixCode.instructions = [
                'Review the specific accessibility violation',
                'Apply the recommended fixes from WCAG guidelines',
                'Test the changes with accessibility tools',
                'Verify the fix doesn\'t break existing functionality'
            ];
    }

    return fixCode;
}

// PHASE 2A ENHANCEMENT: Generate downloadable fix files
function createFixFiles(violations, platformInfo) {
    const fixes = violations.map(violation => generateFixCode(violation, platformInfo));
    
    // Combine all CSS fixes
    const combinedCSS = fixes.map(fix => fix.css).filter(css => css.trim()).join('\n\n');
    
    // Combine all HTML examples
    const combinedHTML = fixes.map(fix => fix.html).filter(html => html.trim()).join('\n\n');
    
    // Create comprehensive instructions
    const allInstructions = fixes.flatMap(fix => fix.instructions);
    const uniqueInstructions = [...new Set(allInstructions)];
    
    const instructionsText = `# Accessibility Fix Instructions

## Platform: ${platformInfo?.name || 'Custom'}
## Generated: ${new Date().toLocaleString()}

## Implementation Steps:
${uniqueInstructions.map((instruction, index) => `${index + 1}. ${instruction}`).join('\n')}

## CSS Fixes:
\`\`\`css
${combinedCSS}
\`\`\`

## HTML Examples:
\`\`\`html
${combinedHTML}
\`\`\`

## Testing:
1. Apply the fixes to your website
2. Re-run the accessibility scan to verify improvements
3. Test with screen readers and keyboard navigation
4. Validate color contrast ratios meet WCAG standards
`;

    return {
        css: combinedCSS,
        html: combinedHTML,
        instructions: instructionsText,
        platform: platformInfo?.type || 'custom'
    };
}

// PHASE 2A ENHANCEMENT: New endpoint for implementing auto-fixes
app.post('/api/implement-fix', async (req, res) => {
    try {
        const { violationId, fixType, platformInfo } = req.body;
        
        console.log('🔧 Implementing auto-fix for violation:', violationId);
        
        // Generate the specific fix
        const mockViolation = { id: violationId, impact: 'serious' };
        const fixCode = generateFixCode(mockViolation, platformInfo);
        
        // In a real implementation, this would:
        // 1. Connect to the platform's API (Shopify, WordPress, etc.)
        // 2. Apply the fix directly to the website
        // 3. Verify the fix was applied successfully
        
        // For now, we'll return the generated code and instructions
        res.json({
            success: true,
            message: `Auto-fix generated for ${violationId}`,
            fixApplied: false, // Set to true when actually implemented
            fixCode: fixCode,
            nextSteps: [
                'Download the generated fix files',
                'Follow the platform-specific instructions',
                'Apply the fixes to your website',
                'Re-run the accessibility scan to verify improvements'
            ]
        });
        
    } catch (error) {
        console.error('Error implementing fix:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to implement fix' 
        });
    }
});

// PHASE 2A ENHANCEMENT: Preview fix endpoint
app.post('/api/preview-fix', async (req, res) => {
    try {
        const { violationId, elementSelector, platformInfo } = req.body;
        
        console.log('👁️ Generating fix preview for:', violationId);
        
        const mockViolation = { id: violationId, impact: 'serious' };
        const fixCode = generateFixCode(mockViolation, platformInfo);
        
        // Generate a preview of what the fix will look like
        const preview = {
            before: {
                description: `Current state with ${violationId} violation`,
                code: `/* Current problematic code */\n${elementSelector} {\n  /* Accessibility issue present */\n}`
            },
            after: {
                description: `Fixed state with accessibility improvements`,
                code: fixCode.css || fixCode.html || 'Fix applied'
            },
            impact: `This fix will resolve the ${violationId} accessibility violation`,
            instructions: fixCode.instructions
        };
        
        res.json({
            success: true,
            preview: preview
        });
        
    } catch (error) {
        console.error('Error generating preview:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to generate preview' 
        });
    }
});

// PHASE 2A ENHANCEMENT: Download endpoints for fix files
app.get('/api/download-fix/:type', (req, res) => {
    const { type } = req.params;
    const { violationId, platform } = req.query;
    
    // Generate fix for the specific violation
    const mockViolation = { id: violationId, impact: 'serious' };
    const platformInfo = { type: platform || 'custom', name: platform || 'Custom' };
    const fixCode = generateFixCode(mockViolation, platformInfo);
    
    let content = '';
    let filename = '';
    let contentType = '';
    
    switch (type) {
        case 'css':
            content = fixCode.css || '/* No CSS fixes available for this violation */';
            filename = `${violationId}-fix-${platform || 'custom'}.css`;
            contentType = 'text/css';
            break;
        case 'instructions':
            content = `# Fix Instructions for ${violationId}\n\n## Platform: ${platformInfo.name}\n\n## Steps:\n${fixCode.instructions.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n## CSS Code:\n\`\`\`css\n${fixCode.css}\n\`\`\`\n\n## HTML Example:\n\`\`\`html\n${fixCode.html}\n\`\`\``;
            filename = `${violationId}-instructions-${platform || 'custom'}.md`;
            contentType = 'text/markdown';
            break;
        default:
            return res.status(400).json({ error: 'Invalid file type' });
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', contentType);
    res.send(content);
});

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
        
        .ai-suggestions-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
            margin-right: 8px;
        }
        
        .ai-suggestions-btn:hover {
            background: #5a6fd8;
        }
        
        .guided-fixing-btn {
            background: #28a745;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        .guided-fixing-btn:hover {
            background: #218838;
        }
        
        /* AI Modal Styles */
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
            width: 80%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
        }
        
        .ai-modal-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .ai-modal-body {
            padding: 20px;
        }
        
        .close {
            color: white;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }
        
        .close:hover {
            opacity: 0.7;
        }
        
        .ai-suggestion {
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            margin-bottom: 20px;
            overflow: hidden;
        }
        
        .ai-suggestion-header {
            background: #f8f9fa;
            padding: 12px 16px;
            border-bottom: 1px solid #e1e5e9;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .priority-badge {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .priority-high {
            background: #f8d7da;
            color: #721c24;
        }
        
        .priority-medium {
            background: #fff3cd;
            color: #856404;
        }
        
        .priority-low {
            background: #d4edda;
            color: #155724;
        }
        
        .ai-suggestion-content {
            padding: 16px;
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
        }
        
        .ai-suggestion-content li {
            margin-bottom: 8px;
        }
        
        /* NEW: Guided Fixing Modal Styles */
        .guided-modal {
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
            border-radius: 8px;
            width: 90%;
            max-width: 900px;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }
        
        .guided-modal-header {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 20px;
            border-radius: 8px 8px 0 0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .progress-indicator {
            background: rgba(255,255,255,0.2);
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: 500;
        }
        
        .guided-modal-body {
            padding: 24px;
            min-height: 300px;
        }
        
        .guided-modal-footer {
            padding: 20px 24px;
            border-top: 1px solid #e1e5e9;
            display: flex;
            gap: 12px;
            justify-content: space-between;
            align-items: center;
        }
        
        .prev-btn, .next-btn {
            background: #6c757d;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        .prev-btn:hover, .next-btn:hover {
            background: #5a6268;
        }
        
        .prev-btn:disabled, .next-btn:disabled {
            background: #e9ecef;
            color: #6c757d;
            cursor: not-allowed;
        }
        
        .get-ai-fix-btn {
            background: #667eea;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        .get-ai-fix-btn:hover {
            background: #5a6fd8;
        }
        
        .finish-btn {
            background: #dc3545;
            color: white;
            border: none;
            padding: 10px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9rem;
        }
        
        .finish-btn:hover {
            background: #c82333;
        }
        
        .violation-details {
            background: #f8f9fa;
            border: 1px solid #e1e5e9;
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .violation-title {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 12px;
            color: #495057;
        }
        
        .violation-impact {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.8rem;
            font-weight: 600;
            text-transform: uppercase;
            margin-bottom: 16px;
        }
        
        .impact-critical { background: #f8d7da; color: #721c24; }
        .impact-serious { background: #fff3cd; color: #856404; }
        .impact-moderate { background: #d1ecf1; color: #0c5460; }
        .impact-minor { background: #d4edda; color: #155724; }
        
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
                <p>Enterprise Dashboard</p>
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
        
        // Scan functionality - PRESERVED FROM WORKING VERSION
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
        
        function displayScanResults(result) {
            // Store violations and platform info globally
            currentViolations = result.violations;
            window.currentPlatformInfo = result.platformInfo;
            
            const resultsContainer = document.getElementById('scan-results-container');
            
            const violations = result.violations || result.pages?.reduce((acc, page) => acc.concat(page.violations), []) || [];
            
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
                            '<div style="text-align: center; color: #666; padding: 20px; background: #f8f9fa; border-radius: 8px; margin: 20px 0;"><p>📋 <strong>' + violations.length + ' accessibility issues found</strong></p><p>Use the buttons below to view details or start fixing issues.</p></div>'
                            : '<p style="text-align: center; color: #28a745; font-size: 1.2rem; padding: 40px;">🎉 No accessibility issues found!</p>'
                        }
                        
                        <div style="margin-top: 20px; text-align: center;">
                            \${violations.length > 0 ? 
                                '<button class="view-report-btn" onclick="openDetailedReport()" style="background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; margin: 0 10px; cursor: pointer; font-size: 14px;">📄 View Detailed Report</button>' 
                                : ''
                            }
                            \${violations.length > 0 ? 
                                '<button class="ai-suggestions-btn" onclick="showAISuggestions(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ', ' + JSON.stringify(result.platformInfo || {}).replace(/"/g, '&quot;') + ')" style="background: #6f42c1; color: white; border: none; padding: 12px 24px; border-radius: 6px; margin: 0 10px; cursor: pointer; font-size: 14px;">🤖 Get AI Fix Suggestions</button>' 
                                : ''
                            }
                            \${violations.length > 0 ? 
                                '<button class="guided-fixing-btn" onclick="GuidedFixing.start(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')" style="background: #28a745; color: white; border: none; padding: 12px 24px; border-radius: 6px; margin: 0 10px; cursor: pointer; font-size: 14px;">🛠️ Let\\'s Start Fixing</button>' 
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
        
        // AI Suggestions functionality - PRESERVED FROM WORKING VERSION
        async function showAISuggestions(violations, platformInfo = null) {
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
                    body: JSON.stringify({ violations, platformInfo })
                });
                
                if (!response.ok) {
                    throw new Error('Failed to get AI suggestions');
                }
                
                const suggestions = await response.json();
                
                modalBody.innerHTML = suggestions.map(suggestion => \`
                    <div class="ai-suggestion">
                        <div class="ai-suggestion-header">
                            <strong>🤖 AI Fix Suggestion</strong>
                            <span class="priority-badge priority-\${suggestion.priority}">\${suggestion.priority.toUpperCase()}</span>
                        </div>
                        <div class="ai-suggestion-content">
                            <p><strong>Issue:</strong> \${suggestion.explanation}</p>
                            <p><strong>Code Example:</strong></p>
                            <pre><code>\${suggestion.codeExample}</code></pre>
                            <p><strong>Implementation Steps:</strong></p>
                            <ol>
                                \${suggestion.steps.map(step => \`<li>\${step}</li>\`).join('')}
                            </ol>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error getting AI suggestions:', error);
                modalBody.innerHTML = \`
                    <div style="color: #dc3545; text-align: center; padding: 20px;">
                        <h3>Unable to Generate AI Suggestions</h3>
                        <p>Please try again later or contact support if the problem persists.</p>
                    </div>
                \`;
            }
        }
        
        function closeAIModal() {
            document.getElementById('ai-modal').style.display = 'none';
        }
        
        // Global variable to store current violations for detailed report
        let currentViolations = [];
        
        // NEW: Open detailed report in new tab
        function openDetailedReport(violations) {
            // Use the stored violations if no parameter passed
            const violationsToShow = violations || currentViolations;
            
            if (!violationsToShow || violationsToShow.length === 0) {
                alert('No violations data available for detailed report. Please run a scan first.');
                return;
            }
            
            // Send violations to server endpoint for report generation
            fetch('/api/detailed-report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ violations: violationsToShow })
            })
            .then(response => response.text())
            .then(html => {
                const reportWindow = window.open('', '_blank');
                reportWindow.document.write(html);
                reportWindow.document.close();
            })
            .catch(error => {
                console.error('Error generating detailed report:', error);
                alert('Failed to generate detailed report. Please try again.');
            });
        }
        
        // Fallback: Simple detailed report function
        function openDetailedReportSimple(violations) {
            const violationsToShow = violations || currentViolations;
            const reportWindow = window.open('', '_blank');
            const reportHtml = \`
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
                        .report-title {
                            font-size: 2rem;
                            font-weight: bold;
                            color: #333;
                            margin-bottom: 10px;
                        }
                        .report-meta {
                            color: #666;
                            font-size: 1rem;
                        }
                        .violation {
                            background: white;
                            border-radius: 8px;
                            margin-bottom: 20px;
                            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                            overflow: hidden;
                        }
                        .violation-header {
                            padding: 20px;
                            border-bottom: 1px solid #eee;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .violation-title {
                            font-size: 1.25rem;
                            font-weight: bold;
                            color: #333;
                        }
                        .violation-impact {
                            padding: 4px 12px;
                            border-radius: 20px;
                            font-size: 0.875rem;
                            font-weight: bold;
                            text-transform: uppercase;
                        }
                        .impact-critical { background: #dc3545; color: white; }
                        .impact-serious { background: #fd7e14; color: white; }
                        .impact-moderate { background: #ffc107; color: #333; }
                        .impact-minor { background: #6c757d; color: white; }
                        .violation-body {
                            padding: 20px;
                        }
                        .violation-description {
                            font-size: 1rem;
                            margin-bottom: 15px;
                            line-height: 1.5;
                        }
                        .violation-help {
                            color: #666;
                            font-size: 0.9rem;
                            line-height: 1.4;
                        }
                        .violation-help a {
                            color: #007bff;
                            text-decoration: none;
                        }
                        .violation-help a:hover {
                            text-decoration: underline;
                        }
                        .summary-stats {
                            display: grid;
                            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                            gap: 15px;
                            margin: 20px 0;
                        }
                        .stat-item {
                            text-align: center;
                            padding: 15px;
                            background: #f8f9fa;
                            border-radius: 6px;
                        }
                        .stat-value {
                            font-size: 1.5rem;
                            font-weight: bold;
                            color: #333;
                        }
                        .stat-label {
                            font-size: 0.875rem;
                            color: #666;
                            margin-top: 5px;
                        }
                        @media print {
                            body { background: white; }
                            .violation { box-shadow: none; border: 1px solid #ddd; }
                        }
                    </style>
                </head>
                <body>
                    <div class="report-header">
                        <div class="report-title">🔍 Accessibility Scan Report</div>
                        <div class="report-meta">Generated on \${new Date().toLocaleString()}</div>
                        <div class="summary-stats">
                            <div class="stat-item">
                                <div class="stat-value">\${violationsToShow.length}</div>
                                <div class="stat-label">Total Issues</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${violationsToShow.filter(v => v.impact === 'critical').length}</div>
                                <div class="stat-label">Critical</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${violationsToShow.filter(v => v.impact === 'serious').length}</div>
                                <div class="stat-label">Serious</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${violationsToShow.filter(v => v.impact === 'moderate').length}</div>
                                <div class="stat-label">Moderate</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-value">\${violationsToShow.filter(v => v.impact === 'minor').length}</div>
                                <div class="stat-label">Minor</div>
                            </div>
                        </div>
                    </div>
                    
                    \${violationsToShow.map((violation, index) => \`
                        <div class="violation">
                            <div class="violation-header">
                                <div class="violation-title">\${index + 1}. \${violation.id}</div>
                                <div class="violation-impact impact-\${violation.impact}">\${violation.impact}</div>
                            </div>
                            <div class="violation-body">
                                <div class="violation-description">
                                    <strong>Description:</strong> \${violation.description || 'No description available'}
                                </div>
                                <div class="violation-help">
                                    <strong>Help:</strong> \${violation.help || 'Refer to WCAG guidelines for more information'}
                                    \${violation.helpUrl ? \`<br><br><strong>Learn more:</strong> <a href="\${violation.helpUrl}" target="_blank">\${violation.helpUrl}</a>\` : ''}
                                </div>
                            </div>
                        </div>
                    \`).join('')}
                    
                    <div style="text-align: center; margin: 40px 0; color: #666;">
                        <p>Report generated by SentryPrime Enterprise Accessibility Scanner</p>
                    </div>
                </body>
                </html>
            \`;
            
            reportWindow.document.write(reportHtml);
            reportWindow.document.close();
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
                
                alert('Report generated! ' + this.fixedViolations.length + ' fixes saved to your downloads.');
            }
        };
        
        // Dashboard data loading - PRESERVED FROM WORKING VERSION
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
        
        async function loadDashboardRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const scans = await response.json();
                
                const container = document.getElementById('dashboard-recent-scans');
                
                if (scans.length > 0) {
                    container.innerHTML = scans.slice(0, 3).map(scan => \`
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${new Date(scan.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="scan-score">\${scan.score}% Score</span>
                                <button class="view-report-btn">👁️ View Report</button>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No scans yet. Run your first scan above!</p>';
                }
            } catch (error) {
                console.error('Error loading dashboard recent scans:', error);
                document.getElementById('dashboard-recent-scans').innerHTML = '<p style="color: #dc3545; text-align: center; padding: 20px;">Error loading recent scans</p>';
            }
        }
        
        async function loadRecentScans() {
            try {
                const response = await fetch('/api/scans/recent');
                const scans = await response.json();
                
                const container = document.getElementById('recent-scans-list');
                
                if (scans.length > 0) {
                    container.innerHTML = scans.map(scan => \`
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>\${scan.url}</h4>
                                <div class="scan-meta">\${scan.scan_type === 'single' ? 'Single Page' : 'Multi-page'} • \${new Date(scan.created_at).toLocaleDateString()}</div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="scan-score">\${scan.score}% Score</span>
                                <button class="view-report-btn">👁️ View Report</button>
                            </div>
                        </div>
                    \`).join('');
                } else {
                    container.innerHTML = '<p style="color: #666; text-align: center; padding: 20px;">No scans yet. Run your first scan above!</p>';
                }
            } catch (error) {
                console.error('Error loading recent scans:', error);
                document.getElementById('recent-scans-list').innerHTML = '<p style="color: #dc3545; text-align: center; padding: 20px;">Error loading recent scans</p>';
            }
        }
        
        // Initialize dashboard - PRESERVED FROM WORKING VERSION
        document.addEventListener('DOMContentLoaded', () => {
            loadDashboardStats();
            loadDashboardRecentScans();
            loadRecentScans();
        });
    </script>
    
    <!-- AI Suggestions Modal -->
    <div id="ai-modal" class="ai-modal">
        <div class="ai-modal-content">
            <div class="ai-modal-header">
                <h2>🤖 AI Fix Suggestions</h2>
                <span class="close" onclick="closeAIModal()">&times;</span>
            </div>
            <div class="ai-modal-body" id="ai-modal-body">
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
</body>
</html>`;
    
    res.send(html);
});

// Helper functions for link extraction and scanning
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
                        if (url.hostname !== baseUrlObj.hostname) return null;
                        
                        // Exclude common non-page URLs
                        if (url.pathname.match(/\.(pdf|jpg|jpeg|png|gif|css|js|xml|zip|doc|docx)$/i)) return null;
                        if (url.pathname.includes('#')) return null;
                        
                        return url.href;
                    } catch (e) {
                        return null;
                    }
                })
                .filter(url => url !== null)
                .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
                .slice(0, 20); // Limit to 20 links max
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
        // Set viewport and user agent
        await page.setViewport({ width: 1280, height: 720 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to: ' + url);
        
        // Try multiple navigation strategies
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
        
        // Wait for page to stabilize
        console.log('Waiting for page to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Inject axe-core
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
                    else {
                        // PHASE 1 ENHANCEMENT: Collect detailed element information
                        results.violations = results.violations.map(violation => {
                            violation.nodes = violation.nodes.map(node => {
                                const element = document.querySelector(node.target[0]);
                                if (element) {
                                    // Enhanced element data collection
                                    node.enhancedData = {
                                        // Element targeting
                                        selector: node.target[0],
                                        xpath: getXPath(element),
                                        tagName: element.tagName.toLowerCase(),
                                        
                                        // Current element state
                                        outerHTML: element.outerHTML.substring(0, 500), // Truncate for size
                                        textContent: element.textContent?.substring(0, 200) || '',
                                        
                                        // Computed styles for relevant violations
                                        computedStyles: getRelevantStyles(element, violation.id),
                                        
                                        // Element attributes
                                        attributes: Array.from(element.attributes).reduce((acc, attr) => {
                                            acc[attr.name] = attr.value;
                                            return acc;
                                        }, {}),
                                        
                                        // Position information
                                        boundingRect: element.getBoundingClientRect(),
                                        
                                        // Parent context
                                        parentInfo: {
                                            tagName: element.parentElement?.tagName.toLowerCase(),
                                            className: element.parentElement?.className || '',
                                            id: element.parentElement?.id || ''
                                        }
                                    };
                                }
                                return node;
                            });
                            return violation;
                        });
                        
                        resolve(results);
                    }
                });
                
                // Helper function to get XPath
                function getXPath(element) {
                    if (element.id) return `//*[@id="${element.id}"]`;
                    if (element === document.body) return '/html/body';
                    
                    let ix = 0;
                    const siblings = element.parentNode?.childNodes || [];
                    for (let i = 0; i < siblings.length; i++) {
                        const sibling = siblings[i];
                        if (sibling === element) {
                            return getXPath(element.parentNode) + '/' + element.tagName.toLowerCase() + '[' + (ix + 1) + ']';
                        }
                        if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
                            ix++;
                        }
                    }
                    return '';
                }
                
                // Helper function to get relevant computed styles based on violation type
                function getRelevantStyles(element, violationId) {
                    const computedStyle = window.getComputedStyle(element);
                    const relevantStyles = {};
                    
                    // Collect styles relevant to specific violation types
                    if (violationId === 'color-contrast') {
                        relevantStyles.color = computedStyle.color;
                        relevantStyles.backgroundColor = computedStyle.backgroundColor;
                        relevantStyles.fontSize = computedStyle.fontSize;
                        relevantStyles.fontWeight = computedStyle.fontWeight;
                    } else if (violationId.includes('focus')) {
                        relevantStyles.outline = computedStyle.outline;
                        relevantStyles.outlineColor = computedStyle.outlineColor;
                        relevantStyles.outlineWidth = computedStyle.outlineWidth;
                        relevantStyles.boxShadow = computedStyle.boxShadow;
                    } else if (violationId.includes('size') || violationId.includes('target')) {
                        relevantStyles.width = computedStyle.width;
                        relevantStyles.height = computedStyle.height;
                        relevantStyles.padding = computedStyle.padding;
                        relevantStyles.margin = computedStyle.margin;
                    }
                    
                    // Always include basic layout styles
                    relevantStyles.display = computedStyle.display;
                    relevantStyles.position = computedStyle.position;
                    relevantStyles.zIndex = computedStyle.zIndex;
                    
                    return relevantStyles;
                }
            });
        });
        
        return results;
        
    } finally {
        await page.close();
    }
}

// PHASE 1 ENHANCEMENT: Platform Detection Function
async function detectPlatform(browser, url) {
    const page = await browser.newPage();
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
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
            
            // Webflow Detection
            else if (document.querySelector('script[src*="webflow"]') ||
                     document.querySelector('meta[name="generator"][content*="Webflow"]')) {
                platform.type = 'webflow';
                platform.name = 'Webflow';
                platform.confidence = 0.8;
                platform.indicators.push('Webflow generator meta tag', 'Webflow scripts');
                platform.capabilities = {
                    cssInjection: false,
                    themeEditor: true,
                    pluginSystem: false,
                    apiAccess: true
                };
            }
            
            // Generic CMS Detection
            else if (document.querySelector('meta[name="generator"]')) {
                const generator = document.querySelector('meta[name="generator"]').content;
                platform.name = generator.split(' ')[0];
                platform.confidence = 0.5;
                platform.indicators.push('Generic CMS generator tag');
            }
            
            return platform;
        });
        
        return platformInfo;
        
    } catch (error) {
        console.log('❌ Platform detection failed:', error.message);
        return {
            type: 'unknown',
            name: 'Unknown',
            confidence: 0,
            error: error.message
        };
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
        
        // PHASE 1 ENHANCEMENT: Platform Detection
        let platformInfo = null;
        
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
            
            // PHASE 1 ENHANCEMENT: Detect platform for single page scans
            platformInfo = await detectPlatform(browser, targetUrl);
            console.log('🔍 Platform detected:', platformInfo);
            
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
                platformInfo: platformInfo, // PHASE 1 ENHANCEMENT
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
            
            // Scan the first page and extract links
            const firstPageResults = await scanSinglePage(browser, targetUrl);
            
            // PHASE 1 ENHANCEMENT: Detect platform after first page scan
            if (!platformInfo) {
                platformInfo = await detectPlatform(browser, targetUrl);
                console.log('🔍 Platform detected:', platformInfo);
            }
            
            scannedPages.push({
                url: targetUrl,
                violations: firstPageResults.violations,
                scanTime: Date.now() - startTime
            });
            scannedUrls.add(targetUrl);
            
            // Extract links from the first page for crawling
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
                        scanTime: Date.now() - pageStartTime
                    });
                    scannedUrls.add(pageUrl);
                    
                } catch (error) {
                    console.log('❌ Error scanning page ' + pageUrl + ':', error.message);
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
