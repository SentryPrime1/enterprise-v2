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

// PHASE 2D: Visual Preview Endpoints - NEW ADDITIONS
app.post('/api/visual-preview', async (req, res) => {
    try {
        const { url, violationId, elementSelector } = req.body;
        
        console.log('👁️ Generating visual preview for:', violationId);
        
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        // Navigate to the page
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        // Take before screenshot
        const beforeScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        // Highlight the problematic element
        if (elementSelector) {
            await page.evaluate((selector) => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    el.style.border = '3px solid #dc3545';
                    el.style.boxShadow = '0 0 10px rgba(220, 53, 69, 0.5)';
                });
            }, elementSelector);
        }
        
        // Take after screenshot with highlighting
        const afterScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        await browser.close();
        
        res.json({
            success: true,
            beforeImage: `data:image/png;base64,${beforeScreenshot}`,
            afterImage: `data:image/png;base64,${afterScreenshot}`,
            violationId: violationId
        });
        
    } catch (error) {
        console.error('Error generating visual preview:', error);
        res.status(500).json({ error: 'Failed to generate visual preview' });
    }
});

app.post('/api/color-contrast-preview', async (req, res) => {
    try {
        const { url, simulationType } = req.body;
        
        console.log('🎨 Generating color contrast preview:', simulationType);
        
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        // Navigate to the page
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        // Apply color vision simulation
        const filterCSS = getColorVisionFilter(simulationType);
        await page.addStyleTag({ content: filterCSS });
        
        // Take screenshot
        const screenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        await browser.close();
        
        res.json({
            success: true,
            image: `data:image/png;base64,${screenshot}`,
            simulationType: simulationType
        });
        
    } catch (error) {
        console.error('Error generating color contrast preview:', error);
        res.status(500).json({ error: 'Failed to generate color contrast preview' });
    }
});

function getColorVisionFilter(type) {
    const filters = {
        protanopia: `
            html { 
                filter: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><defs><filter id='protanopia'><feColorMatrix values='0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0'/></filter></defs></svg>#protanopia") !important; 
            }
        `,
        deuteranopia: `
            html { 
                filter: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><defs><filter id='deuteranopia'><feColorMatrix values='0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0'/></filter></defs></svg>#deuteranopia") !important; 
            }
        `,
        tritanopia: `
            html { 
                filter: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><defs><filter id='tritanopia'><feColorMatrix values='0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0'/></filter></defs></svg>#tritanopia") !important; 
            }
        `,
        monochrome: `
            html { 
                filter: grayscale(100%) !important; 
            }
        `,
        lowcontrast: `
            html { 
                filter: contrast(50%) !important; 
            }
        `
    };
    
    return filters[type] || '';
}

// Detailed report endpoint - ENHANCED WITH PHASE 2D
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
                
                /* PHASE 2D: Enhanced button styles */
                .action-buttons {
                    display: flex;
                    gap: 10px;
                    margin-top: 15px;
                    flex-wrap: wrap;
                }
                .action-btn {
                    padding: 8px 16px;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: all 0.2s;
                    text-decoration: none;
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                }
                .btn-visual { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
                .btn-autofix { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; }
                .btn-color { background: linear-gradient(135deg, #fd7e14 0%, #ffc107 100%); color: white; }
                .btn-screen { background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%); color: white; }
                .btn-keyboard { background: linear-gradient(135deg, #17a2b8 0%, #6610f2 100%); color: white; }
                
                .action-btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                }
                
                /* Modal styles for Phase 2D */
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
                    padding: 20px;
                    border-radius: 8px;
                    width: 90%;
                    max-width: 800px;
                    max-height: 80vh;
                    overflow-y: auto;
                }
                .modal-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 10px;
                }
                .close {
                    color: #aaa;
                    float: right;
                    font-size: 28px;
                    font-weight: bold;
                    cursor: pointer;
                }
                .close:hover { color: black; }
                
                .tabs {
                    display: flex;
                    border-bottom: 1px solid #ddd;
                    margin-bottom: 20px;
                }
                .tab {
                    padding: 10px 20px;
                    cursor: pointer;
                    border-bottom: 2px solid transparent;
                }
                .tab.active {
                    border-bottom-color: #007bff;
                    color: #007bff;
                }
                .tab-content {
                    display: none;
                }
                .tab-content.active {
                    display: block;
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

                        <!-- PHASE 2D: Enhanced Action Buttons -->
                        <div class="action-buttons">
                            <button class="action-btn btn-visual" onclick="showVisualPreview('${violation.id}', ${index})">
                                👁️ Visual Preview
                            </button>
                            <button class="action-btn btn-autofix" onclick="autoFixViolation('${violation.id}', ${index})">
                                🔧 Auto-Fix
                            </button>
                            <button class="action-btn btn-color" onclick="showColorTest('${violation.id}')">
                                🎨 Color Test
                            </button>
                            <button class="action-btn btn-screen" onclick="showScreenReader('${violation.id}')">
                                🔊 Screen Reader
                            </button>
                            <button class="action-btn btn-keyboard" onclick="showKeyboardTest('${violation.id}')">
                                ⌨️ Keyboard Test
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            <!-- PHASE 2D: Visual Preview Modal -->
            <div id="visualModal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Visual Preview</h2>
                        <span class="close" onclick="closeModal('visualModal')">&times;</span>
                    </div>
                    <div class="tabs">
                        <div class="tab active" onclick="switchTab('before')">Before (Highlighted)</div>
                        <div class="tab" onclick="switchTab('after')">After (Fixed)</div>
                        <div class="tab" onclick="switchTab('details')">Details</div>
                    </div>
                    <div id="before" class="tab-content active">
                        <img id="beforeImage" style="width: 100%; border: 1px solid #ddd; border-radius: 4px;" />
                    </div>
                    <div id="after" class="tab-content">
                        <img id="afterImage" style="width: 100%; border: 1px solid #ddd; border-radius: 4px;" />
                    </div>
                    <div id="details" class="tab-content">
                        <div id="violationDetails"></div>
                    </div>
                </div>
            </div>
            
            <!-- PHASE 2D: Color Test Modal -->
            <div id="colorModal" class="modal">
                <div class="modal-content">
                    <div class="modal-header">
                        <h2>Color Vision Test</h2>
                        <span class="close" onclick="closeModal('colorModal')">&times;</span>
                    </div>
                    <div class="action-buttons" style="margin-bottom: 20px;">
                        <button class="action-btn" onclick="loadColorSimulation('protanopia')" style="background: #dc3545; color: white;">Protanopia</button>
                        <button class="action-btn" onclick="loadColorSimulation('deuteranopia')" style="background: #28a745; color: white;">Deuteranopia</button>
                        <button class="action-btn" onclick="loadColorSimulation('tritanopia')" style="background: #007bff; color: white;">Tritanopia</button>
                        <button class="action-btn" onclick="loadColorSimulation('monochrome')" style="background: #6c757d; color: white;">Monochrome</button>
                        <button class="action-btn" onclick="loadColorSimulation('lowcontrast')" style="background: #ffc107; color: black;">Low Contrast</button>
                    </div>
                    <div id="colorPreview">
                        <p>Select a color vision simulation above to see how the page appears to users with different types of color vision deficiency.</p>
                    </div>
                </div>
            </div>
            
            <!-- PHASE 2A: Auto-Fix JavaScript Functions -->
            <script>
                // PHASE 2D: Visual Preview Functions
                async function showVisualPreview(violationId, index) {
                    try {
                        const modal = document.getElementById('visualModal');
                        modal.style.display = 'block';
                        
                        // Show loading state
                        document.getElementById('beforeImage').src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjEwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+TG9hZGluZy4uLjwvdGV4dD48L3N2Zz4=';
                        
                        const response = await fetch('/api/visual-preview', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                url: window.location.origin,
                                violationId: violationId,
                                elementSelector: '[data-violation="' + violationId + '"]'
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            document.getElementById('beforeImage').src = result.beforeImage;
                            document.getElementById('afterImage').src = result.afterImage;
                            document.getElementById('violationDetails').innerHTML = \`
                                <h3>Violation: \${violationId}</h3>
                                <p>This preview shows the element with accessibility issues highlighted in red.</p>
                                <p><strong>Before:</strong> Shows the current state with issues highlighted</p>
                                <p><strong>After:</strong> Shows how the page looks with the issue highlighted for identification</p>
                            \`;
                        }
                    } catch (error) {
                        console.error('Visual preview error:', error);
                        alert('Failed to generate visual preview');
                    }
                }
                
                async function showColorTest(violationId) {
                    const modal = document.getElementById('colorModal');
                    modal.style.display = 'block';
                }
                
                async function loadColorSimulation(type) {
                    try {
                        const response = await fetch('/api/color-contrast-preview', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ 
                                url: window.location.origin,
                                simulationType: type
                            })
                        });
                        
                        const result = await response.json();
                        
                        if (result.success) {
                            document.getElementById('colorPreview').innerHTML = \`
                                <h3>\${type.charAt(0).toUpperCase() + type.slice(1)} Simulation</h3>
                                <img src="\${result.image}" style="width: 100%; border: 1px solid #ddd; border-radius: 4px;" />
                                <p>This shows how the page appears to users with \${type}.</p>
                            \`;
                        }
                    } catch (error) {
                        console.error('Color simulation error:', error);
                        alert('Failed to generate color simulation');
                    }
                }
                
                async function showScreenReader(violationId) {
                    alert('Screen Reader analysis: This feature analyzes how screen readers would interpret the page content. Implementation coming soon!');
                }
                
                async function showKeyboardTest(violationId) {
                    alert('Keyboard Navigation test: This feature tests keyboard accessibility and tab order. Implementation coming soon!');
                }
                
                // Modal functions
                function closeModal(modalId) {
                    document.getElementById(modalId).style.display = 'none';
                }
                
                function switchTab(tabName) {
                    // Hide all tab contents
                    const contents = document.querySelectorAll('.tab-content');
                    contents.forEach(content => content.classList.remove('active'));
                    
                    // Remove active class from all tabs
                    const tabs = document.querySelectorAll('.tab');
                    tabs.forEach(tab => tab.classList.remove('active'));
                    
                    // Show selected tab content
                    document.getElementById(tabName).classList.add('active');
                    
                    // Add active class to clicked tab
                    event.target.classList.add('active');
                }
                
                // Close modal when clicking outside
                window.onclick = function(event) {
                    const modals = document.querySelectorAll('.modal');
                    modals.forEach(modal => {
                        if (event.target === modal) {
                            modal.style.display = 'none';
                        }
                    });
                }

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
                            button.style.background = '';
                            button.disabled = false;
                        }, 3000);
                    }
                }

                async function downloadFix(violationId, fileType) {
                    try {
                        const response = await fetch(\`/api/download-fix/\${violationId}/\${fileType}\`);
                        const blob = await response.blob();
                        
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = \`\${violationId}-fix.\${fileType === 'css' ? 'css' : 'txt'}\`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    } catch (error) {
                        console.error('Download error:', error);
                        alert('Failed to download fix file');
                    }
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
            error: 'Failed to implement fix',
            details: error.message 
        });
    }
});

// PHASE 2A ENHANCEMENT: Download fix files endpoint
app.get('/api/download-fix/:violationId/:fileType', (req, res) => {
    try {
        const { violationId, fileType } = req.params;
        
        console.log(`📥 Downloading ${fileType} fix for violation: ${violationId}`);
        
        // Generate fix code for the specific violation
        const mockViolation = { id: violationId, impact: 'serious' };
        const fixCode = generateFixCode(mockViolation, { type: 'custom' });
        
        let content = '';
        let filename = '';
        let contentType = 'text/plain';
        
        switch (fileType) {
            case 'css':
                content = fixCode.css;
                filename = `${violationId}-fix.css`;
                contentType = 'text/css';
                break;
            case 'html':
                content = fixCode.html;
                filename = `${violationId}-examples.html`;
                contentType = 'text/html';
                break;
            case 'instructions':
                content = fixCode.instructions.join('\n');
                filename = `${violationId}-instructions.txt`;
                contentType = 'text/plain';
                break;
            default:
                return res.status(400).json({ error: 'Invalid file type' });
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(content);
        
    } catch (error) {
        console.error('Error downloading fix file:', error);
        res.status(500).json({ error: 'Failed to download fix file' });
    }
});

// PHASE 2B ENHANCEMENT: Bulk download endpoint for all fixes
app.post('/api/bulk-download-fixes', (req, res) => {
    try {
        const { violations, platformInfo } = req.body;
        
        console.log('📦 Generating bulk download for', violations.length, 'violations');
        
        const fixFiles = createFixFiles(violations, platformInfo);
        
        // Create a simple text file with all fixes
        const bulkContent = `# Bulk Accessibility Fixes
# Generated: ${new Date().toLocaleString()}
# Platform: ${platformInfo?.name || 'Custom'}
# Total Violations: ${violations.length}

${fixFiles.instructions}

# Combined CSS Fixes:
${fixFiles.css}

# Combined HTML Examples:
${fixFiles.html}
`;
        
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', 'attachment; filename="accessibility-fixes-bulk.txt"');
        res.send(bulkContent);
        
    } catch (error) {
        console.error('Error generating bulk download:', error);
        res.status(500).json({ error: 'Failed to generate bulk download' });
    }
});

// Serve static files
app.use(express.static('public'));

// Main dashboard route
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>SentryPrime Enterprise - Accessibility Scanner</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
                
                .container {
                    max-width: 1200px;
                    margin: 0 auto;
                    padding: 20px;
                }
                
                .header {
                    text-align: center;
                    color: white;
                    margin-bottom: 40px;
                }
                
                .header h1 {
                    font-size: 3em;
                    margin-bottom: 10px;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
                }
                
                .header p {
                    font-size: 1.2em;
                    opacity: 0.9;
                }
                
                .dashboard {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 30px;
                    margin-bottom: 40px;
                }
                
                .card {
                    background: white;
                    border-radius: 15px;
                    padding: 30px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                    transition: transform 0.3s ease;
                }
                
                .card:hover {
                    transform: translateY(-5px);
                }
                
                .card h2 {
                    color: #333;
                    margin-bottom: 20px;
                    font-size: 1.5em;
                }
                
                .scanner-form {
                    display: flex;
                    flex-direction: column;
                    gap: 15px;
                }
                
                .input-group {
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }
                
                .input-group label {
                    font-weight: 600;
                    color: #555;
                }
                
                .input-group input, .input-group select {
                    padding: 12px;
                    border: 2px solid #e1e5e9;
                    border-radius: 8px;
                    font-size: 16px;
                    transition: border-color 0.3s ease;
                }
                
                .input-group input:focus, .input-group select:focus {
                    outline: none;
                    border-color: #667eea;
                }
                
                .scan-button {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    border: none;
                    padding: 15px 30px;
                    border-radius: 8px;
                    font-size: 16px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                }
                
                .scan-button:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
                }
                
                .scan-button:disabled {
                    background: #ccc;
                    cursor: not-allowed;
                    transform: none;
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 15px;
                }
                
                .stat-item {
                    text-align: center;
                    padding: 15px;
                    background: #f8f9fa;
                    border-radius: 8px;
                }
                
                .stat-number {
                    font-size: 2em;
                    font-weight: bold;
                    color: #667eea;
                }
                
                .stat-label {
                    color: #666;
                    font-size: 0.9em;
                }
                
                .recent-scans {
                    grid-column: 1 / -1;
                }
                
                .scan-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 15px;
                    border: 1px solid #e1e5e9;
                    border-radius: 8px;
                    margin-bottom: 10px;
                    transition: background-color 0.3s ease;
                }
                
                .scan-item:hover {
                    background-color: #f8f9fa;
                }
                
                .scan-url {
                    font-weight: 600;
                    color: #333;
                }
                
                .scan-score {
                    padding: 5px 10px;
                    border-radius: 20px;
                    font-weight: bold;
                    font-size: 0.9em;
                }
                
                .score-excellent { background: #d4edda; color: #155724; }
                .score-good { background: #d1ecf1; color: #0c5460; }
                .score-fair { background: #fff3cd; color: #856404; }
                .score-poor { background: #f8d7da; color: #721c24; }
                
                .results {
                    background: white;
                    border-radius: 15px;
                    padding: 30px;
                    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                    margin-top: 30px;
                    display: none;
                }
                
                .loading {
                    text-align: center;
                    padding: 40px;
                }
                
                .spinner {
                    border: 4px solid #f3f3f3;
                    border-top: 4px solid #667eea;
                    border-radius: 50%;
                    width: 50px;
                    height: 50px;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 20px;
                }
                
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                
                .results-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 2px solid #e1e5e9;
                }
                
                .score-display {
                    font-size: 3em;
                    font-weight: bold;
                    color: #667eea;
                }
                
                .violations-summary {
                    display: grid;
                    grid-template-columns: repeat(4, 1fr);
                    gap: 20px;
                    margin-bottom: 30px;
                }
                
                .violation-count {
                    text-align: center;
                    padding: 20px;
                    border-radius: 10px;
                    color: white;
                    font-weight: bold;
                }
                
                .critical { background: #dc3545; }
                .serious { background: #fd7e14; }
                .moderate { background: #ffc107; color: #333; }
                .minor { background: #6c757d; }
                
                .action-buttons {
                    display: flex;
                    gap: 15px;
                    margin-top: 20px;
                }
                
                .btn {
                    padding: 12px 24px;
                    border: none;
                    border-radius: 8px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    text-decoration: none;
                    display: inline-block;
                }
                
                .btn-primary {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                
                .btn-secondary {
                    background: #6c757d;
                    color: white;
                }
                
                .btn:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0,0,0,0.2);
                }
                
                @media (max-width: 768px) {
                    .dashboard {
                        grid-template-columns: 1fr;
                    }
                    
                    .stats-grid {
                        grid-template-columns: 1fr;
                    }
                    
                    .violations-summary {
                        grid-template-columns: repeat(2, 1fr);
                    }
                    
                    .action-buttons {
                        flex-direction: column;
                    }
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔍 SentryPrime Enterprise</h1>
                    <p>Advanced Accessibility Scanner with AI-Powered Fixes</p>
                </div>
                
                <div class="dashboard">
                    <div class="card">
                        <h2>🚀 Start New Scan</h2>
                        <form class="scanner-form" onsubmit="startScan(event)">
                            <div class="input-group">
                                <label for="url">Website URL</label>
                                <input type="url" id="url" name="url" placeholder="https://example.com" required>
                            </div>
                            
                            <div class="input-group">
                                <label for="scanType">Scan Type</label>
                                <select id="scanType" name="scanType">
                                    <option value="single">Single Page Scan</option>
                                    <option value="crawl">Multi-Page Crawl (up to 5 pages)</option>
                                </select>
                            </div>
                            
                            <button type="submit" class="scan-button" id="scanButton">
                                🔍 Start Accessibility Scan
                            </button>
                        </form>
                    </div>
                    
                    <div class="card">
                        <h2>📊 Dashboard Stats</h2>
                        <div class="stats-grid" id="statsGrid">
                            <div class="stat-item">
                                <div class="stat-number" id="totalScans">-</div>
                                <div class="stat-label">Total Scans</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-number" id="totalIssues">-</div>
                                <div class="stat-label">Issues Found</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-number" id="averageScore">-</div>
                                <div class="stat-label">Avg Score</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-number" id="thisWeekScans">-</div>
                                <div class="stat-label">This Week</div>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card recent-scans">
                        <h2>📋 Recent Scans</h2>
                        <div id="recentScans">
                            <div class="loading">Loading recent scans...</div>
                        </div>
                    </div>
                </div>
                
                <div class="results" id="results">
                    <!-- Results will be populated here -->
                </div>
            </div>
            
            <script>
                // Load dashboard data on page load
                document.addEventListener('DOMContentLoaded', function() {
                    loadDashboardStats();
                    loadRecentScans();
                });
                
                async function loadDashboardStats() {
                    try {
                        const response = await fetch('/api/dashboard/stats');
                        const stats = await response.json();
                        
                        document.getElementById('totalScans').textContent = stats.totalScans;
                        document.getElementById('totalIssues').textContent = stats.totalIssues;
                        document.getElementById('averageScore').textContent = stats.averageScore + '%';
                        document.getElementById('thisWeekScans').textContent = stats.thisWeekScans;
                    } catch (error) {
                        console.error('Error loading dashboard stats:', error);
                    }
                }
                
                async function loadRecentScans() {
                    try {
                        const response = await fetch('/api/scans/recent');
                        const scans = await response.json();
                        
                        const container = document.getElementById('recentScans');
                        
                        if (scans.length === 0) {
                            container.innerHTML = '<p>No recent scans found. Start your first scan above!</p>';
                            return;
                        }
                        
                        container.innerHTML = scans.map(scan => {
                            const scoreClass = getScoreClass(scan.score);
                            const date = new Date(scan.created_at).toLocaleDateString();
                            
                            return \`
                                <div class="scan-item">
                                    <div>
                                        <div class="scan-url">\${scan.url}</div>
                                        <small>\${date} • \${scan.scan_type} scan • \${scan.total_issues} issues</small>
                                    </div>
                                    <div class="scan-score \${scoreClass}">\${scan.score}%</div>
                                </div>
                            \`;
                        }).join('');
                    } catch (error) {
                        console.error('Error loading recent scans:', error);
                        document.getElementById('recentScans').innerHTML = '<p>Error loading recent scans</p>';
                    }
                }
                
                function getScoreClass(score) {
                    if (score >= 90) return 'score-excellent';
                    if (score >= 75) return 'score-good';
                    if (score >= 60) return 'score-fair';
                    return 'score-poor';
                }
                
                async function startScan(event) {
                    event.preventDefault();
                    
                    const url = document.getElementById('url').value;
                    const scanType = document.getElementById('scanType').value;
                    const button = document.getElementById('scanButton');
                    const results = document.getElementById('results');
                    
                    // Show loading state
                    button.disabled = true;
                    button.textContent = '🔄 Scanning...';
                    results.style.display = 'block';
                    results.innerHTML = \`
                        <div class="loading">
                            <div class="spinner"></div>
                            <h3>Scanning \${url}</h3>
                            <p>This may take a few moments...</p>
                        </div>
                    \`;
                    
                    try {
                        const response = await fetch('/api/scan', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({ url, scanType })
                        });
                        
                        const data = await response.json();
                        
                        if (data.success) {
                            displayResults(data);
                            // Refresh dashboard stats and recent scans
                            loadDashboardStats();
                            loadRecentScans();
                        } else {
                            throw new Error(data.error || 'Scan failed');
                        }
                    } catch (error) {
                        console.error('Scan error:', error);
                        results.innerHTML = \`
                            <div class="loading">
                                <h3>❌ Scan Failed</h3>
                                <p>Error: \${error.message}</p>
                                <button class="btn btn-primary" onclick="location.reload()">Try Again</button>
                            </div>
                        \`;
                    } finally {
                        button.disabled = false;
                        button.textContent = '🔍 Start Accessibility Scan';
                    }
                }
                
                function displayResults(data) {
                    const results = document.getElementById('results');
                    const violations = data.violations || [];
                    
                    // Calculate score
                    const score = violations.length === 0 ? 100 : Math.max(0, 100 - (violations.length * 2));
                    
                    // Count violations by impact
                    const counts = {
                        critical: violations.filter(v => v.impact === 'critical').length,
                        serious: violations.filter(v => v.impact === 'serious').length,
                        moderate: violations.filter(v => v.impact === 'moderate').length,
                        minor: violations.filter(v => v.impact === 'minor').length
                    };
                    
                    results.innerHTML = \`
                        <div class="results-header">
                            <div>
                                <h2>Scan Results for \${data.url}</h2>
                                <p>Scanned \${data.pagesScanned || 1} page(s) in \${(data.scanTime / 1000).toFixed(1)}s</p>
                            </div>
                            <div class="score-display">\${score}%</div>
                        </div>
                        
                        <div class="violations-summary">
                            <div class="violation-count critical">
                                <div>\${counts.critical}</div>
                                <div>Critical</div>
                            </div>
                            <div class="violation-count serious">
                                <div>\${counts.serious}</div>
                                <div>Serious</div>
                            </div>
                            <div class="violation-count moderate">
                                <div>\${counts.moderate}</div>
                                <div>Moderate</div>
                            </div>
                            <div class="violation-count minor">
                                <div>\${counts.minor}</div>
                                <div>Minor</div>
                            </div>
                        </div>
                        
                        <div class="action-buttons">
                            <button class="btn btn-primary" onclick="viewDetailedReport()">
                                📋 View Detailed Report
                            </button>
                            <button class="btn btn-secondary" onclick="getAIFixes()">
                                🤖 Get AI Suggestions
                            </button>
                            <button class="btn btn-secondary" onclick="downloadBulkFixes()">
                                📦 Download All Fixes
                            </button>
                        </div>
                    \`;
                    
                    // Store data for later use
                    window.currentScanData = data;
                }
                
                function viewDetailedReport() {
                    if (!window.currentScanData) return;
                    
                    // Open detailed report in new tab
                    const form = document.createElement('form');
                    form.method = 'POST';
                    form.action = '/api/detailed-report';
                    form.target = '_blank';
                    
                    const input = document.createElement('input');
                    input.type = 'hidden';
                    input.name = 'violations';
                    input.value = JSON.stringify(window.currentScanData.violations);
                    
                    form.appendChild(input);
                    document.body.appendChild(form);
                    form.submit();
                    document.body.removeChild(form);
                }
                
                async function getAIFixes() {
                    if (!window.currentScanData) return;
                    
                    try {
                        const response = await fetch('/api/ai-fixes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                violations: window.currentScanData.violations,
                                platformInfo: { type: 'custom', name: 'Custom Website' }
                            })
                        });
                        
                        const suggestions = await response.json();
                        
                        // Display AI suggestions in a new window or modal
                        const suggestionsWindow = window.open('', '_blank');
                        suggestionsWindow.document.write(\`
                            <html>
                            <head><title>AI Accessibility Suggestions</title></head>
                            <body style="font-family: Arial, sans-serif; padding: 20px;">
                                <h1>🤖 AI Accessibility Suggestions</h1>
                                \${suggestions.map((suggestion, index) => \`
                                    <div style="margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                                        <h3>Suggestion \${index + 1}</h3>
                                        <p><strong>Priority:</strong> \${suggestion.priority}</p>
                                        <p><strong>Explanation:</strong> \${suggestion.explanation}</p>
                                        <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">\${suggestion.codeExample}</pre>
                                        <ol>
                                            \${suggestion.steps.map(step => \`<li>\${step}</li>\`).join('')}
                                        </ol>
                                    </div>
                                \`).join('')}
                            </body>
                            </html>
                        \`);
                    } catch (error) {
                        alert('Failed to get AI suggestions: ' + error.message);
                    }
                }
                
                async function downloadBulkFixes() {
                    if (!window.currentScanData) return;
                    
                    try {
                        const response = await fetch('/api/bulk-download-fixes', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                violations: window.currentScanData.violations,
                                platformInfo: { type: 'custom', name: 'Custom Website' }
                            })
                        });
                        
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = 'accessibility-fixes-bulk.txt';
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                    } catch (error) {
                        alert('Failed to download bulk fixes: ' + error.message);
                    }
                }
            </script>
        </body>
        </html>
    `);
});

// Main scan endpoint - PRESERVED FROM WORKING VERSION
app.post('/api/scan', async (req, res) => {
    let browser = null;
    const startTime = Date.now();
    
    try {
        const { url, scanType = 'single' } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'URL is required' 
            });
        }

        console.log(`🔍 Starting ${scanType} scan for: ${url}`);

        // Launch browser
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

        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });

        let allViolations = [];
        let pagesScanned = 0;
        let urlsToScan = [url];

        // If crawl type, discover additional URLs
        if (scanType === 'crawl') {
            console.log('🕷️ Crawling for additional pages...');
            try {
                await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
                
                const discoveredUrls = await page.evaluate((baseUrl) => {
                    const links = Array.from(document.querySelectorAll('a[href]'));
                    const baseHost = new URL(baseUrl).host;
                    
                    return links
                        .map(link => {
                            try {
                                const href = link.getAttribute('href');
                                if (!href) return null;
                                
                                // Convert relative URLs to absolute
                                const absoluteUrl = new URL(href, baseUrl).href;
                                const urlHost = new URL(absoluteUrl).host;
                                
                                // Only include URLs from the same domain
                                if (urlHost === baseHost) {
                                    return absoluteUrl;
                                }
                                return null;
                            } catch (e) {
                                return null;
                            }
                        })
                        .filter(url => url !== null)
                        .filter((url, index, array) => array.indexOf(url) === index) // Remove duplicates
                        .slice(0, 5); // Limit to 5 pages total
                }, url);

                urlsToScan = [url, ...discoveredUrls.slice(0, 4)]; // Include original URL + up to 4 more
                console.log(`🔗 Found ${urlsToScan.length} pages to scan:`, urlsToScan);
            } catch (crawlError) {
                console.log('⚠️ Crawling failed, scanning single page only:', crawlError.message);
                urlsToScan = [url];
            }
        }

        // Scan each URL
        for (const currentUrl of urlsToScan) {
            try {
                console.log(`📄 Scanning page ${pagesScanned + 1}: ${currentUrl}`);
                
                await page.goto(currentUrl, { 
                    waitUntil: 'networkidle0', 
                    timeout: 30000 
                });

                // Inject axe-core
                await page.addScriptTag({
                    content: axeCore.source
                });

                // Run accessibility scan
                const results = await page.evaluate(async () => {
                    return await axe.run();
                });

                // Add page URL to each violation for context
                const pageViolations = results.violations.map(violation => ({
                    ...violation,
                    pageUrl: window.location.href,
                    pageTitle: document.title
                }));

                allViolations = allViolations.concat(pageViolations);
                pagesScanned++;
                
                console.log(`✅ Page ${pagesScanned} scanned: ${pageViolations.length} violations found`);
                
            } catch (pageError) {
                console.log(`❌ Error scanning ${currentUrl}:`, pageError.message);
                // Continue with other pages
            }
        }

        const scanTime = Date.now() - startTime;
        
        // Remove duplicate violations (same rule ID and target)
        const uniqueViolations = allViolations.filter((violation, index, array) => {
            return array.findIndex(v => 
                v.id === violation.id && 
                JSON.stringify(v.nodes[0]?.target) === JSON.stringify(violation.nodes[0]?.target)
            ) === index;
        });

        console.log(`🎯 Scan completed: ${uniqueViolations.length} unique violations found across ${pagesScanned} pages`);

        // Save scan to database
        const scanId = await saveScan(
            1, // userId - hardcoded for now
            1, // organizationId - hardcoded for now
            url,
            scanType,
            uniqueViolations.length,
            scanTime,
            pagesScanned,
            uniqueViolations
        );

        res.json({
            success: true,
            url: url,
            scanType: scanType,
            violations: uniqueViolations,
            scanTime: scanTime,
            pagesScanned: pagesScanned,
            scanId: scanId,
            summary: {
                total: uniqueViolations.length,
                critical: uniqueViolations.filter(v => v.impact === 'critical').length,
                serious: uniqueViolations.filter(v => v.impact === 'serious').length,
                moderate: uniqueViolations.filter(v => v.impact === 'moderate').length,
                minor: uniqueViolations.filter(v => v.impact === 'minor').length
            }
        });

    } catch (error) {
        const scanTime = Date.now() - startTime;
        const errorMessage = error.message || 'Unknown error occurred';
        
        console.error('❌ Scan failed:', errorMessage);
        
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
