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

// PHASE 2D: Enhanced Visual Preview Endpoints - VIOLATION-SPECIFIC
app.post('/api/visual-preview', async (req, res) => {
    try {
        const { url, violation } = req.body;
        
        console.log('👁️ Generating violation-specific visual preview for:', violation?.id, 'URL:', url);
        
        // Validate URL
        if (!url || url === 'https://example.com') {
            return res.status(400).json({ 
                success: false,
                error: 'No valid URL provided. Please run a scan first to set the target URL.' 
            });
        }
        
        const browser = await puppeteer.launch({
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
                '--disable-gpu'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        // Navigate to the page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Take before screenshot
        const beforeScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        // Violation-specific highlighting
        const highlightResult = await page.evaluate((violationData) => {
            let highlightedCount = 0;
            let elementInfo = null;
            
            // Get impact color
            const impactColors = {
                critical: '#dc3545',
                serious: '#fd7e14', 
                moderate: '#ffc107',
                minor: '#6c757d'
            };
            const borderColor = impactColors[violationData?.impact] || '#dc3545';
            
            // Try to find elements using violation targets
            if (violationData?.target && violationData.target.length > 0) {
                violationData.target.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        elements.forEach(el => {
                            // Highlight the element
                            el.style.border = `4px solid ${borderColor}`;
                            el.style.boxShadow = `0 0 15px rgba(220, 53, 69, 0.6)`;
                            el.style.position = 'relative';
                            
                            // Add a tooltip
                            const tooltip = document.createElement('div');
                            tooltip.style.cssText = `
                                position: absolute;
                                top: -40px;
                                left: 0;
                                background: ${borderColor};
                                color: white;
                                padding: 5px 10px;
                                border-radius: 4px;
                                font-size: 12px;
                                font-weight: bold;
                                z-index: 10000;
                                white-space: nowrap;
                                box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                            `;
                            tooltip.textContent = `${violationData?.impact?.toUpperCase() || 'ISSUE'}: ${violationData?.id || 'Accessibility Issue'}`;
                            el.appendChild(tooltip);
                            
                            highlightedCount++;
                            
                            // Get element info for the first element
                            if (!elementInfo) {
                                elementInfo = {
                                    tagName: el.tagName.toLowerCase(),
                                    selector: selector,
                                    text: el.textContent?.substring(0, 50) || '',
                                    attributes: {
                                        id: el.id || null,
                                        class: el.className || null,
                                        alt: el.alt || null,
                                        'aria-label': el.getAttribute('aria-label') || null
                                    }
                                };
                            }
                        });
                    } catch (e) {
                        console.log('Could not select:', selector, e.message);
                    }
                });
            }
            
            // Fallback: violation-specific highlighting based on rule ID
            if (highlightedCount === 0 && violationData?.id) {
                const ruleSelectors = {
                    'color-contrast': ['a', 'button', '[role="button"]', 'input[type="submit"]', 'input[type="button"]'],
                    'image-alt': ['img:not([alt])', 'img[alt=""]'],
                    'label': ['input:not([aria-label]):not([aria-labelledby])', 'select:not([aria-label]):not([aria-labelledby])'],
                    'link-name': ['a:empty', 'a:not([aria-label]):not([title])'],
                    'button-name': ['button:empty', 'button:not([aria-label]):not([title])'],
                    'heading-order': ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
                    'landmark-one-main': ['main', '[role="main"]'],
                    'page-has-heading-one': ['h1'],
                    'region': ['header', 'nav', 'main', 'footer', '[role="banner"]', '[role="navigation"]', '[role="main"]', '[role="contentinfo"]']
                };
                
                const selectors = ruleSelectors[violationData.id] || ['*'];
                selectors.forEach(selector => {
                    try {
                        const elements = document.querySelectorAll(selector);
                        Array.from(elements).slice(0, 5).forEach(el => { // Limit to 5 elements
                            el.style.border = `3px solid ${borderColor}`;
                            el.style.boxShadow = `0 0 10px rgba(220, 53, 69, 0.5)`;
                            highlightedCount++;
                        });
                    } catch (e) {
                        console.log('Could not select:', selector, e.message);
                    }
                });
            }
            
            return { highlightedCount, elementInfo };
        }, violation);
        
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
            violationId: violation?.id || 'unknown',
            highlightedElements: highlightResult.highlightedCount,
            elementInfo: highlightResult.elementInfo
        });
        
    } catch (error) {
        console.error('Error generating visual preview:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate visual preview: ' + error.message 
        });
    }
});

app.post('/api/color-contrast-preview', async (req, res) => {
    try {
        const { url, simulationType } = req.body;
        
        console.log('🎨 Generating color contrast preview:', simulationType, 'URL:', url);
        
        // Validate URL
        if (!url || url === 'https://example.com') {
            return res.status(400).json({ 
                success: false,
                error: 'No valid URL provided. Please run a scan first to set the target URL.' 
            });
        }
        
        const browser = await puppeteer.launch({
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
                '--disable-gpu'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        // Navigate to the page
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        
        // Take before screenshot
        const beforeScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        // Apply color vision simulation
        await page.evaluate((simType) => {
            // Color vision simulation filters
            const filters = {
                protanopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><defs><filter id=\\"protanopia\\"><feColorMatrix values=\\"0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0\\"/></filter></defs></svg>#protanopia")',
                deuteranopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><defs><filter id=\\"deuteranopia\\"><feColorMatrix values=\\"0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0\\"/></filter></defs></svg>#deuteranopia")',
                tritanopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><defs><filter id=\\"tritanopia\\"><feColorMatrix values=\\"0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0\\"/></filter></defs></svg>#tritanopia")',
                achromatopsia: 'grayscale(100%)',
                lowVision: 'blur(2px) contrast(0.5)'
            };
            
            if (filters[simType]) {
                document.body.style.filter = filters[simType];
            }
        }, simulationType);
        
        // Take after screenshot with simulation
        const afterScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        await browser.close();
        
        res.json({
            success: true,
            beforeImage: `data:image/png;base64,${beforeScreenshot}`,
            afterImage: `data:image/png;base64,${afterScreenshot}`,
            simulationType: simulationType
        });
        
    } catch (error) {
        console.error('Error generating color contrast preview:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate color contrast preview: ' + error.message 
        });
    }
});

// PHASE 2E: AI-Powered Fix Suggestions
app.post('/api/ai-suggestions', async (req, res) => {
    try {
        const { violation, context } = req.body;
        
        console.log('🤖 Generating AI suggestions for violation:', violation?.id);
        
        if (!violation) {
            return res.status(400).json({ 
                success: false,
                error: 'No violation data provided' 
            });
        }
        
        let suggestions;
        
        if (openai) {
            // Use OpenAI for dynamic suggestions
            try {
                const prompt = `As an accessibility expert, provide specific, actionable fix suggestions for this WCAG violation:

Rule: ${violation.id}
Description: ${violation.description}
Impact: ${violation.impact}
Help: ${violation.help}
${violation.helpUrl ? `Reference: ${violation.helpUrl}` : ''}

Context:
- Element: ${violation.target ? violation.target[0] : 'Unknown'}
- HTML: ${violation.html || 'Not provided'}

Provide 3-5 specific, actionable suggestions in JSON format:
{
  "suggestions": [
    {
      "title": "Brief title",
      "description": "Detailed explanation",
      "code": "Example code fix",
      "priority": "high|medium|low"
    }
  ]
}`;

                const response = await openai.chat.completions.create({
                    model: "gpt-4",
                    messages: [{ role: "user", content: prompt }],
                    max_tokens: 1000,
                    temperature: 0.3
                });
                
                const aiResponse = JSON.parse(response.choices[0].message.content);
                suggestions = aiResponse.suggestions;
                
            } catch (aiError) {
                console.log('AI suggestion failed, using fallback:', aiError.message);
                suggestions = getFallbackSuggestions(violation);
            }
        } else {
            // Use predefined suggestions
            suggestions = getFallbackSuggestions(violation);
        }
        
        res.json({
            success: true,
            violationId: violation.id,
            suggestions: suggestions
        });
        
    } catch (error) {
        console.error('Error generating AI suggestions:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate suggestions: ' + error.message 
        });
    }
});

function getFallbackSuggestions(violation) {
    const suggestionMap = {
        'color-contrast': [
            {
                title: 'Increase Color Contrast',
                description: 'Ensure text has a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text.',
                code: '/* Example: Change text color */\n.text-element {\n  color: #333333; /* Darker text */\n  background-color: #ffffff; /* Light background */\n}',
                priority: 'high'
            },
            {
                title: 'Use Color Contrast Tools',
                description: 'Test your color combinations with online contrast checkers to ensure WCAG compliance.',
                code: '/* Tools: WebAIM Contrast Checker, Colour Contrast Analyser */',
                priority: 'medium'
            }
        ],
        'image-alt': [
            {
                title: 'Add Alt Text',
                description: 'Provide descriptive alternative text that conveys the meaning and context of the image.',
                code: '<img src="chart.png" alt="Sales increased 25% from Q1 to Q2 2024">',
                priority: 'high'
            },
            {
                title: 'Use Empty Alt for Decorative Images',
                description: 'For purely decorative images, use empty alt text to indicate they should be ignored by screen readers.',
                code: '<img src="decoration.png" alt="" role="presentation">',
                priority: 'medium'
            }
        ],
        'label': [
            {
                title: 'Add Form Labels',
                description: 'Associate form controls with descriptive labels using the for attribute or aria-labelledby.',
                code: '<label for="email">Email Address:</label>\n<input type="email" id="email" name="email">',
                priority: 'high'
            },
            {
                title: 'Use Aria-Label',
                description: 'For complex forms, use aria-label to provide accessible names for form controls.',
                code: '<input type="search" aria-label="Search products">',
                priority: 'medium'
            }
        ],
        'link-name': [
            {
                title: 'Add Descriptive Link Text',
                description: 'Ensure links have meaningful text that describes their destination or purpose.',
                code: '<a href="/products">View our products</a>\n<!-- Instead of: <a href="/products">Click here</a> -->',
                priority: 'high'
            },
            {
                title: 'Use Aria-Label for Context',
                description: 'When link text alone isn\'t descriptive enough, add aria-label for additional context.',
                code: '<a href="/article1" aria-label="Read more about accessibility testing">Read more</a>',
                priority: 'medium'
            }
        ]
    };
    
    return suggestionMap[violation.id] || [
        {
            title: 'Review WCAG Guidelines',
            description: 'Consult the official WCAG documentation for specific guidance on this violation.',
            code: '/* Refer to: https://www.w3.org/WAI/WCAG21/Understanding/ */',
            priority: 'medium'
        }
    ];
}

// PHASE 2F: Guided Fixing Interface
app.post('/api/implement-fix', async (req, res) => {
    try {
        const { url, violation, fixType, customCode } = req.body;
        
        console.log('🔧 Implementing fix for violation:', violation?.id, 'Fix type:', fixType);
        
        // Validate URL
        if (!url || url === 'https://example.com') {
            return res.status(400).json({ 
                success: false,
                error: 'No valid URL provided. Please run a scan first to set the target URL.' 
            });
        }
        
        const browser = await puppeteer.launch({
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
                '--disable-gpu'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        // Navigate to the page
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        
        // Take before screenshot
        const beforeScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        // Apply the fix based on violation type and fix type
        const fixResult = await page.evaluate((violationData, fixType, customCode) => {
            let fixedCount = 0;
            let appliedFixes = [];
            
            // Get elements to fix
            let elements = [];
            if (violationData?.target && violationData.target.length > 0) {
                violationData.target.forEach(selector => {
                    try {
                        const found = document.querySelectorAll(selector);
                        elements.push(...Array.from(found));
                    } catch (e) {
                        console.log('Could not select:', selector);
                    }
                });
            }
            
            // Apply fixes based on violation type
            if (violationData?.id === 'color-contrast' && fixType === 'auto') {
                elements.forEach(el => {
                    const originalColor = window.getComputedStyle(el).color;
                    const originalBg = window.getComputedStyle(el).backgroundColor;
                    
                    // Apply high contrast colors
                    el.style.color = '#000000';
                    el.style.backgroundColor = '#ffffff';
                    el.style.border = '1px solid #cccccc';
                    
                    appliedFixes.push({
                        element: el.tagName.toLowerCase(),
                        fix: 'Applied high contrast colors',
                        before: `color: ${originalColor}, background: ${originalBg}`,
                        after: 'color: #000000, background: #ffffff'
                    });
                    fixedCount++;
                });
            }
            
            else if (violationData?.id === 'image-alt' && fixType === 'auto') {
                elements.forEach(el => {
                    if (el.tagName.toLowerCase() === 'img') {
                        const originalAlt = el.alt;
                        
                        // Generate basic alt text based on src or context
                        let altText = 'Image';
                        if (el.src) {
                            const filename = el.src.split('/').pop().split('.')[0];
                            altText = filename.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        }
                        
                        el.alt = altText;
                        el.style.border = '2px solid green';
                        
                        appliedFixes.push({
                            element: 'img',
                            fix: 'Added alt text',
                            before: `alt="${originalAlt}"`,
                            after: `alt="${altText}"`
                        });
                        fixedCount++;
                    }
                });
            }
            
            else if (violationData?.id === 'label' && fixType === 'auto') {
                elements.forEach(el => {
                    if (['input', 'select', 'textarea'].includes(el.tagName.toLowerCase())) {
                        const originalLabel = el.getAttribute('aria-label') || '';
                        
                        // Add aria-label based on input type or placeholder
                        let labelText = el.placeholder || el.type || 'Form field';
                        labelText = labelText.charAt(0).toUpperCase() + labelText.slice(1);
                        
                        el.setAttribute('aria-label', labelText);
                        el.style.border = '2px solid green';
                        
                        appliedFixes.push({
                            element: el.tagName.toLowerCase(),
                            fix: 'Added aria-label',
                            before: `aria-label="${originalLabel}"`,
                            after: `aria-label="${labelText}"`
                        });
                        fixedCount++;
                    }
                });
            }
            
            else if (violationData?.id === 'link-name' && fixType === 'auto') {
                elements.forEach(el => {
                    if (el.tagName.toLowerCase() === 'a') {
                        const originalText = el.textContent;
                        const originalAriaLabel = el.getAttribute('aria-label') || '';
                        
                        // Improve link text
                        if (!originalText.trim() || originalText.trim().toLowerCase() === 'click here') {
                            const href = el.href;
                            let linkText = 'Link';
                            if (href) {
                                const path = new URL(href).pathname;
                                linkText = path.split('/').filter(p => p).pop() || 'Home';
                                linkText = linkText.replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            }
                            el.textContent = linkText;
                        }
                        
                        // Add aria-label for additional context
                        if (!originalAriaLabel) {
                            el.setAttribute('aria-label', `Navigate to ${el.textContent}`);
                        }
                        
                        el.style.border = '2px solid green';
                        
                        appliedFixes.push({
                            element: 'a',
                            fix: 'Improved link text and added aria-label',
                            before: `text="${originalText}", aria-label="${originalAriaLabel}"`,
                            after: `text="${el.textContent}", aria-label="${el.getAttribute('aria-label')}"`
                        });
                        fixedCount++;
                    }
                });
            }
            
            // Apply custom code if provided
            if (fixType === 'custom' && customCode) {
                try {
                    // Create a style element with the custom CSS
                    const style = document.createElement('style');
                    style.textContent = customCode;
                    document.head.appendChild(style);
                    
                    appliedFixes.push({
                        element: 'custom',
                        fix: 'Applied custom CSS',
                        before: 'No custom styles',
                        after: customCode
                    });
                    fixedCount++;
                } catch (e) {
                    console.log('Error applying custom code:', e);
                }
            }
            
            return { fixedCount, appliedFixes };
        }, violation, fixType, customCode);
        
        // Take after screenshot
        const afterScreenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        await browser.close();
        
        res.json({
            success: true,
            beforeImage: `data:image/png;base64,${beforeScreenshot}`,
            afterImage: `data:image/png;base64,${afterScreenshot}`,
            violationId: violation?.id || 'unknown',
            fixType: fixType,
            fixedElements: fixResult.fixedCount,
            appliedFixes: fixResult.appliedFixes
        });
        
    } catch (error) {
        console.error('Error implementing fix:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to implement fix: ' + error.message 
        });
    }
});

// Main scan endpoint - PRESERVED FROM WORKING VERSION
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { url, scanType, standard } = req.body;
        
        console.log(`🔍 Starting accessibility scan for: ${url}`);
        console.log(`📋 Scan type: ${scanType}, Standard: ${standard}`);
        
        // Validate URL
        if (!url) {
            return res.status(400).json({ 
                success: false,
                error: 'URL is required' 
            });
        }
        
        // Launch browser with Cloud Run optimized settings
        const browser = await puppeteer.launch({
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
                '--disable-gpu'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        // Navigate to the page
        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 30000 
        });
        
        // Inject axe-core
        await page.addScriptTag({
            content: axeCore.source
        });
        
        // Configure axe based on standard
        const axeConfig = {
            'wcag2a': { tags: ['wcag2a'] },
            'wcag2aa': { tags: ['wcag2aa'] },
            'wcag2aaa': { tags: ['wcag2aaa'] },
            'wcag21aa': { tags: ['wcag21aa'] },
            'section508': { tags: ['section508'] }
        };
        
        // Run axe-core accessibility scan
        const results = await page.evaluate((config) => {
            return axe.run(document, config);
        }, axeConfig[standard] || { tags: ['wcag2aa'] });
        
        // Take screenshot for visual reference
        const screenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false
        });
        
        await browser.close();
        
        const scanTimeMs = Date.now() - startTime;
        const totalIssues = results.violations.length;
        
        // Calculate accessibility score
        let score = 100;
        results.violations.forEach(violation => {
            const impact = violation.impact;
            const deduction = {
                'critical': 10,
                'serious': 7,
                'moderate': 4,
                'minor': 2
            }[impact] || 2;
            score -= deduction;
        });
        score = Math.max(0, score);
        
        console.log(`✅ Scan completed in ${scanTimeMs}ms`);
        console.log(`📊 Found ${totalIssues} violations, Score: ${score}`);
        
        // Save scan to database
        const scanId = await saveScan(1, 1, url, scanType, totalIssues, scanTimeMs, 1, results.violations);
        
        res.json({
            success: true,
            scanId: scanId,
            url: url,
            scanType: scanType,
            standard: standard,
            score: score,
            totalIssues: totalIssues,
            scanTimeMs: scanTimeMs,
            violations: results.violations,
            passes: results.passes.length,
            incomplete: results.incomplete.length,
            screenshot: `data:image/png;base64,${screenshot}`,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        const scanTimeMs = Date.now() - startTime;
        console.error('❌ Scan error:', error.message);
        
        res.status(500).json({ 
            success: false,
            error: error.message,
            scanTimeMs: scanTimeMs
        });
    }
});

// Dashboard data endpoint - PRESERVED FROM WORKING VERSION
app.get('/api/dashboard', async (req, res) => {
    try {
        console.log('📊 Fetching dashboard data...');
        
        const [stats, recentScans] = await Promise.all([
            getDashboardStats(),
            getRecentScans()
        ]);
        
        res.json({
            success: true,
            stats: stats,
            recentScans: recentScans
        });
        
    } catch (error) {
        console.error('❌ Dashboard error:', error.message);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Serve static files
app.use(express.static('public'));

// Main application route - PRESERVED FROM WORKING VERSION
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SentryPrime - Enterprise Accessibility Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        
        .app-container {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 250px;
            background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%);
            color: white;
            padding: 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
            box-shadow: 2px 0 10px rgba(0,0,0,0.1);
        }
        
        .logo {
            padding: 20px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
            background: rgba(0,0,0,0.2);
        }
        
        .logo h1 {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 5px;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        .logo p {
            font-size: 14px;
            opacity: 0.8;
            font-weight: 300;
        }
        
        .nav-menu {
            list-style: none;
            padding: 20px 0;
        }
        
        .nav-item {
            margin: 0;
        }
        
        .nav-link {
            display: flex;
            align-items: center;
            padding: 15px 20px;
            color: rgba(255,255,255,0.8);
            text-decoration: none;
            transition: all 0.3s ease;
            border-left: 3px solid transparent;
            position: relative;
        }
        
        .nav-link:hover {
            background: rgba(255,255,255,0.1);
            color: white;
            border-left-color: #3498db;
        }
        
        .nav-link.active {
            background: rgba(255,255,255,0.15);
            color: white;
            border-left-color: #e74c3c;
            font-weight: 600;
        }
        
        .nav-icon {
            margin-right: 12px;
            font-size: 18px;
            width: 20px;
            text-align: center;
        }
        
        .badge {
            background: #e74c3c;
            color: white;
            border-radius: 12px;
            padding: 2px 8px;
            font-size: 11px;
            font-weight: 600;
            margin-left: auto;
        }
        
        .main-content {
            flex: 1;
            margin-left: 250px;
            background: #f8f9fa;
        }
        
        .header {
            background: white;
            padding: 20px 30px;
            border-bottom: 1px solid #e9ecef;
            box-shadow: 0 2px 4px rgba(0,0,0,0.04);
            position: sticky;
            top: 0;
            z-index: 100;
        }
        
        .header-content {
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
            padding: 12px 20px;
            border: 1px solid #e9ecef;
            border-radius: 25px;
            font-size: 14px;
            background: #f8f9fa;
            transition: all 0.3s ease;
        }
        
        .search-input:focus {
            outline: none;
            border-color: #3498db;
            background: white;
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }
        
        .user-profile {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .notification-bell {
            position: relative;
            padding: 8px;
            border-radius: 50%;
            background: #f8f9fa;
            border: none;
            cursor: pointer;
            transition: background 0.3s ease;
        }
        
        .notification-bell:hover {
            background: #e9ecef;
        }
        
        .notification-dot {
            position: absolute;
            top: 5px;
            right: 5px;
            width: 8px;
            height: 8px;
            background: #e74c3c;
            border-radius: 50%;
        }
        
        .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: linear-gradient(135deg, #3498db, #2980b9);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 16px;
        }
        
        .user-info h3 {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 2px;
        }
        
        .user-info p {
            font-size: 12px;
            color: #6c757d;
        }
        
        .page-content {
            padding: 30px;
        }
        
        .page {
            display: none;
        }
        
        .page.active {
            display: block;
        }
        
        .dashboard-header {
            margin-bottom: 30px;
        }
        
        .dashboard-header h1 {
            font-size: 32px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 8px;
        }
        
        .dashboard-header p {
            font-size: 16px;
            color: #6c757d;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .stat-card {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            border-left: 4px solid #3498db;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        
        .stat-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        }
        
        .stat-card.critical {
            border-left-color: #e74c3c;
        }
        
        .stat-card.warning {
            border-left-color: #f39c12;
        }
        
        .stat-card.success {
            border-left-color: #27ae60;
        }
        
        .stat-number {
            font-size: 36px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 8px;
        }
        
        .stat-label {
            font-size: 14px;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 5px;
        }
        
        .stat-change {
            font-size: 12px;
            font-weight: 600;
        }
        
        .stat-change.positive {
            color: #27ae60;
        }
        
        .stat-change.negative {
            color: #e74c3c;
        }
        
        .actions-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        
        .action-card {
            background: white;
            padding: 25px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            text-align: center;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            cursor: pointer;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 20px rgba(0,0,0,0.12);
        }
        
        .action-icon {
            font-size: 48px;
            margin-bottom: 15px;
            opacity: 0.8;
        }
        
        .action-card h3 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 10px;
            color: #2c3e50;
        }
        
        .action-card p {
            color: #6c757d;
            font-size: 14px;
            line-height: 1.5;
        }
        
        .recent-scans {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            overflow: hidden;
        }
        
        .recent-scans-header {
            padding: 20px 25px;
            border-bottom: 1px solid #e9ecef;
            background: #f8f9fa;
        }
        
        .recent-scans-header h2 {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .recent-scans-header p {
            color: #6c757d;
            font-size: 14px;
        }
        
        .scan-item {
            padding: 20px 25px;
            border-bottom: 1px solid #f1f3f4;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.3s ease;
        }
        
        .scan-item:hover {
            background: #f8f9fa;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            font-size: 16px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .scan-meta {
            font-size: 12px;
            color: #6c757d;
        }
        
        .scan-score {
            text-align: right;
        }
        
        .score-badge {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
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
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.3s ease;
        }
        
        .view-report-btn:hover {
            background: #2980b9;
        }
        
        /* Scan Page Styles */
        .scan-form {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            margin-bottom: 30px;
        }
        
        .form-group {
            margin-bottom: 20px;
        }
        
        .form-label {
            display: block;
            font-weight: 600;
            margin-bottom: 8px;
            color: #2c3e50;
        }
        
        .form-input {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }
        
        .form-select {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            font-size: 14px;
            background: white;
            cursor: pointer;
        }
        
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
        }
        
        .scan-btn {
            background: linear-gradient(135deg, #3498db, #2980b9);
            color: white;
            border: none;
            padding: 14px 28px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(52, 152, 219, 0.3);
        }
        
        .scan-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(52, 152, 219, 0.4);
        }
        
        .scan-btn:disabled {
            background: #bdc3c7;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }
        
        .scan-results {
            background: white;
            border-radius: 12px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.08);
            overflow: hidden;
            margin-top: 20px;
        }
        
        .results-header {
            padding: 20px 25px;
            background: linear-gradient(135deg, #2c3e50, #34495e);
            color: white;
        }
        
        .results-header h3 {
            font-size: 20px;
            margin-bottom: 10px;
        }
        
        .results-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 20px;
            padding: 20px 25px;
            background: #f8f9fa;
            border-bottom: 1px solid #e9ecef;
        }
        
        .summary-item {
            text-align: center;
        }
        
        .summary-number {
            font-size: 24px;
            font-weight: 700;
            color: #2c3e50;
        }
        
        .summary-label {
            font-size: 12px;
            color: #6c757d;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .violations-list {
            max-height: 400px;
            overflow-y: auto;
        }
        
        .violation-item {
            padding: 20px 25px;
            border-bottom: 1px solid #f1f3f4;
        }
        
        .violation-header {
            display: flex;
            justify-content: between;
            align-items: flex-start;
            margin-bottom: 10px;
        }
        
        .violation-title {
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .impact-badge {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            margin-left: 10px;
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
        
        .violation-description {
            color: #6c757d;
            font-size: 14px;
            line-height: 1.5;
            margin-bottom: 10px;
        }
        
        .violation-help {
            font-size: 13px;
            color: #3498db;
            text-decoration: none;
        }
        
        .violation-help:hover {
            text-decoration: underline;
        }
        
        .loading {
            text-align: center;
            padding: 40px;
            color: #6c757d;
        }
        
        .loading-spinner {
            display: inline-block;
            width: 40px;
            height: 40px;
            border: 4px solid #f3f3f3;
            border-top: 4px solid #3498db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-bottom: 15px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .error-message {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            border: 1px solid #f5c6cb;
        }
        
        .success-message {
            background: #d4edda;
            color: #155724;
            padding: 15px;
            border-radius: 8px;
            margin: 20px 0;
            border: 1px solid #c3e6cb;
        }
        
        @media (max-width: 768px) {
            .sidebar {
                transform: translateX(-100%);
                transition: transform 0.3s ease;
            }
            
            .sidebar.open {
                transform: translateX(0);
            }
            
            .main-content {
                margin-left: 0;
            }
            
            .form-row {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .actions-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="app-container">
        <nav class="sidebar">
            <div class="logo">
                <h1>🛡️ SentryPrime</h1>
                <p>Enterprise Dashboard</p>
            </div>
            <ul class="nav-menu">
                <li class="nav-item">
                    <a href="#" class="nav-link active" data-page="dashboard">
                        <span class="nav-icon">📊</span>
                        Dashboard
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="scans">
                        <span class="nav-icon">🔍</span>
                        Scans
                        <span class="badge">2</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="analytics">
                        <span class="nav-icon">📈</span>
                        Analytics
                        <span class="badge">8</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="team">
                        <span class="nav-icon">👥</span>
                        Team
                        <span class="badge">4</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="integrations">
                        <span class="nav-icon">🔗</span>
                        Integrations
                        <span class="badge">5</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="api">
                        <span class="nav-icon">⚙️</span>
                        API Management
                        <span class="badge">6</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="billing">
                        <span class="nav-icon">💳</span>
                        Billing
                        <span class="badge">7</span>
                    </a>
                </li>
                <li class="nav-item">
                    <a href="#" class="nav-link" data-page="settings">
                        <span class="nav-icon">⚙️</span>
                        Settings
                        <span class="badge">8</span>
                    </a>
                </li>
            </ul>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="header-content">
                    <div class="search-bar">
                        <input type="text" class="search-input" placeholder="Search scans, reports, or settings...">
                    </div>
                    <div class="user-profile">
                        <button class="notification-bell">
                            🔔
                            <span class="notification-dot"></span>
                        </button>
                        <div class="user-avatar">JD</div>
                        <div class="user-info">
                            <h3>John Doe</h3>
                            <p>Acme Corporation</p>
                        </div>
                    </div>
                </div>
            </header>
            
            <div class="page-content">
                <div id="dashboard" class="page active">
                    <div class="dashboard-header">
                        <h1>Dashboard Overview</h1>
                        <p>Monitor your accessibility compliance and recent activity</p>
                    </div>
                    
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-number" id="total-scans">57</div>
                            <div class="stat-label">Total Scans</div>
                            <div class="stat-change positive">+2 this week</div>
                        </div>
                        <div class="stat-card warning">
                            <div class="stat-number" id="total-issues">606</div>
                            <div class="stat-label">Issues Found</div>
                            <div class="stat-change negative">-5 from last week</div>
                        </div>
                        <div class="stat-card success">
                            <div class="stat-number" id="average-score">79%</div>
                            <div class="stat-label">Average Score</div>
                            <div class="stat-change positive">+3% improvement</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number" id="this-week-scans">29</div>
                            <div class="stat-label">This Week</div>
                            <div class="stat-change">scans completed</div>
                        </div>
                    </div>
                    
                    <div class="actions-grid">
                        <div class="action-card" onclick="showPage('scans')">
                            <div class="action-icon">🔍</div>
                            <h3>New Scan</h3>
                            <p>Start a new accessibility scan</p>
                        </div>
                        <div class="action-card" onclick="showPage('analytics')">
                            <div class="action-icon">📊</div>
                            <h3>View Analytics</h3>
                            <p>Analyze compliance trends</p>
                        </div>
                        <div class="action-card" onclick="showPage('team')">
                            <div class="action-icon">👥</div>
                            <h3>Manage Team</h3>
                            <p>Add or remove team members</p>
                        </div>
                        <div class="action-card" onclick="showPage('settings')">
                            <div class="action-icon">⚙️</div>
                            <h3>Settings</h3>
                            <p>Configure your preferences</p>
                        </div>
                    </div>
                    
                    <div class="recent-scans">
                        <div class="recent-scans-header">
                            <h2>Recent Scans</h2>
                            <p>Your latest accessibility scan results</p>
                        </div>
                        <div id="recent-scans-list">
                            <!-- Recent scans will be loaded here -->
                        </div>
                    </div>
                </div>
                
                <div id="scans" class="page">
                    <div class="dashboard-header">
                        <h1>🔍 Accessibility Scans</h1>
                        <p>Run comprehensive accessibility audits on your websites</p>
                    </div>
                    
                    <div class="scan-form">
                        <h2>Start New Scan</h2>
                        <form id="scan-form">
                            <div class="form-group">
                                <label class="form-label" for="website-url">Website URL</label>
                                <input type="url" id="website-url" class="form-input" placeholder="https://essolar.com/" value="https://essolar.com/" required>
                            </div>
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label" for="scan-type">Scan Type</label>
                                    <select id="scan-type" class="form-select">
                                        <option value="single">Single Page</option>
                                        <option value="crawl">Full Site Crawl</option>
                                        <option value="sitemap">Sitemap Based</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label" for="accessibility-standard">Accessibility Standard</label>
                                    <select id="accessibility-standard" class="form-select">
                                        <option value="wcag2aa">WCAG 2.1 AA</option>
                                        <option value="wcag2a">WCAG 2.1 A</option>
                                        <option value="wcag2aaa">WCAG 2.1 AAA</option>
                                        <option value="section508">Section 508</option>
                                    </select>
                                </div>
                            </div>
                            <button type="submit" class="scan-btn" id="start-scan-btn">Start Scan</button>
                        </form>
                    </div>
                    
                    <div id="scan-results-container"></div>
                </div>
                
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
                        <h1>Platform Integrations</h1>
                        <p>Connect your websites for automated accessibility monitoring</p>
                    </div>
                    
                    <div class="actions-grid">
                        <div class="action-card" onclick="showConnectModal('wordpress')">
                            <div class="action-icon">🌐</div>
                            <h3>WordPress</h3>
                            <p>Connect your WordPress site via REST API</p>
                            <div class="badge" style="background: #0073aa; margin-top: 10px;">Most Popular</div>
                        </div>
                        <div class="action-card" onclick="showConnectModal('shopify')">
                            <div class="action-icon">🛒</div>
                            <h3>Shopify</h3>
                            <p>Connect your Shopify store via Admin API</p>
                            <div class="badge" style="background: #96bf48; margin-top: 10px;">E-commerce</div>
                        </div>
                        <div class="action-card" onclick="showConnectModal('custom')">
                            <div class="action-icon">⚙️</div>
                            <h3>Custom Site</h3>
                            <p>Connect via FTP, SFTP, or SSH</p>
                            <div class="badge" style="background: #f39c12; margin-top: 10px;">Advanced</div>
                        </div>
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
        </main>
    </div>

    <script>
        // Navigation functionality - PRESERVED FROM WORKING VERSION
        function showPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            
            // Remove active class from all nav links
            document.querySelectorAll('.nav-link').forEach(link => {
                link.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId).classList.add('active');
            
            // Add active class to corresponding nav link
            document.querySelector(`[data-page="${pageId}"]`).classList.add('active');
        }

        // Add click event listeners to navigation links
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const pageId = link.getAttribute('data-page');
                showPage(pageId);
            });
        });

        // MINIMAL ADDITION: Only the showConnectModal function
        function showConnectModal(platform) {
            const modalHtml = `
                <div id="connect-modal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
                    <div style="background: white; padding: 30px; border-radius: 12px; width: 90%; max-width: 500px; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                            <h2 style="margin: 0; color: #2c3e50;">🌐 Connect ${platform.charAt(0).toUpperCase() + platform.slice(1)} Site</h2>
                            <button onclick="closeModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6c757d;">×</button>
                        </div>
                        <div id="modal-content">
                            ${getModalContent(platform)}
                        </div>
                    </div>
                </div>
            `;
            
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }

        function getModalContent(platform) {
            if (platform === 'wordpress') {
                return `
                    <div class="form-group">
                        <label class="form-label">WordPress Site URL</label>
                        <input type="url" class="form-input" placeholder="https://yoursite.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Username</label>
                        <input type="text" class="form-input" placeholder="admin" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Application Password</label>
                        <input type="password" class="form-input" placeholder="xxxx xxxx xxxx xxxx" required>
                        <small style="color: #6c757d; font-size: 12px;">Generate an application password in WordPress admin → Users → Profile</small>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button onclick="closeModal()" style="flex: 1; padding: 12px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">Cancel</button>
                        <button onclick="connectPlatform('wordpress')" style="flex: 1; padding: 12px; background: #0073aa; color: white; border: none; border-radius: 6px; cursor: pointer;">Connect WordPress</button>
                    </div>
                `;
            } else if (platform === 'shopify') {
                return `
                    <div class="form-group">
                        <label class="form-label">Shopify Store URL</label>
                        <input type="url" class="form-input" placeholder="https://yourstore.myshopify.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Access Token</label>
                        <input type="password" class="form-input" placeholder="shpat_xxxxxxxxxxxxxxxx" required>
                        <small style="color: #6c757d; font-size: 12px;">Create a private app in Shopify admin to get access token</small>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button onclick="closeModal()" style="flex: 1; padding: 12px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">Cancel</button>
                        <button onclick="connectPlatform('shopify')" style="flex: 1; padding: 12px; background: #96bf48; color: white; border: none; border-radius: 6px; cursor: pointer;">Connect Shopify</button>
                    </div>
                `;
            } else if (platform === 'custom') {
                return `
                    <div class="form-group">
                        <label class="form-label">Site URL</label>
                        <input type="url" class="form-input" placeholder="https://yoursite.com" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Connection Type</label>
                        <select class="form-select">
                            <option value="ftp">FTP</option>
                            <option value="sftp">SFTP</option>
                            <option value="ssh">SSH</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Host</label>
                        <input type="text" class="form-input" placeholder="ftp.yoursite.com" required>
                    </div>
                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Username</label>
                            <input type="text" class="form-input" placeholder="username" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Password</label>
                            <input type="password" class="form-input" placeholder="password" required>
                        </div>
                    </div>
                    <div style="display: flex; gap: 10px; margin-top: 20px;">
                        <button onclick="closeModal()" style="flex: 1; padding: 12px; border: 1px solid #ddd; background: white; border-radius: 6px; cursor: pointer;">Cancel</button>
                        <button onclick="connectPlatform('custom')" style="flex: 1; padding: 12px; background: #f39c12; color: white; border: none; border-radius: 6px; cursor: pointer;">Connect Site</button>
                    </div>
                `;
            }
        }

        function closeModal() {
            const modal = document.getElementById('connect-modal');
            if (modal) {
                modal.remove();
            }
        }

        function connectPlatform(platform) {
            alert(`${platform.charAt(0).toUpperCase() + platform.slice(1)} connection functionality will be implemented in the backend.`);
            closeModal();
        }

        // Scan functionality - PRESERVED FROM WORKING VERSION
        document.getElementById('scan-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const url = document.getElementById('website-url').value;
            const scanType = document.getElementById('scan-type').value;
            const standard = document.getElementById('accessibility-standard').value;
            
            const startBtn = document.getElementById('start-scan-btn');
            const resultsContainer = document.getElementById('scan-results-container');
            
            // Show loading state
            startBtn.disabled = true;
            startBtn.textContent = 'Scanning...';
            
            resultsContainer.innerHTML = `
                <div class="loading">
                    <div class="loading-spinner"></div>
                    <p>Scanning ${url}...</p>
                    <p>This may take a few moments</p>
                </div>
            `;
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        standard: standard
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    displayScanResults(result);
                    loadDashboardData(); // Refresh dashboard stats
                } else {
                    resultsContainer.innerHTML = `
                        <div class="error-message">
                            <strong>Scan failed:</strong> ${result.error}
                        </div>
                    `;
                }
            } catch (error) {
                resultsContainer.innerHTML = `
                    <div class="error-message">
                        <strong>Error:</strong> ${error.message}
                    </div>
                `;
            } finally {
                startBtn.disabled = false;
                startBtn.textContent = 'Start Scan';
            }
        });

        function displayScanResults(result) {
            const container = document.getElementById('scan-results-container');
            
            let scoreClass = 'score-excellent';
            if (result.score < 60) scoreClass = 'score-poor';
            else if (result.score < 80) scoreClass = 'score-fair';
            else if (result.score < 90) scoreClass = 'score-good';
            
            const violationsList = result.violations.map(violation => `
                <div class="violation-item">
                    <div class="violation-header">
                        <div>
                            <div class="violation-title">${violation.id}</div>
                            <span class="impact-badge impact-${violation.impact}">${violation.impact}</span>
                        </div>
                    </div>
                    <div class="violation-description">${violation.description}</div>
                    <a href="${violation.helpUrl}" target="_blank" class="violation-help">Learn more →</a>
                </div>
            `).join('');
            
            container.innerHTML = `
                <div class="scan-results">
                    <div class="results-header">
                        <h3>Scan Results for ${result.url}</h3>
                        <p>Completed in ${result.scanTimeMs}ms using ${result.standard.toUpperCase()}</p>
                    </div>
                    <div class="results-summary">
                        <div class="summary-item">
                            <div class="summary-number ${scoreClass}">${result.score}</div>
                            <div class="summary-label">Accessibility Score</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">${result.totalIssues}</div>
                            <div class="summary-label">Issues Found</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">${result.passes}</div>
                            <div class="summary-label">Tests Passed</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number">${result.incomplete}</div>
                            <div class="summary-label">Needs Review</div>
                        </div>
                    </div>
                    ${result.violations.length > 0 ? `
                        <div class="violations-list">
                            ${violationsList}
                        </div>
                    ` : `
                        <div style="padding: 40px; text-align: center; color: #27ae60;">
                            <h3>🎉 No accessibility violations found!</h3>
                            <p>Your website meets the ${result.standard.toUpperCase()} accessibility standards.</p>
                        </div>
                    `}
                </div>
            `;
        }

        // Dashboard data loading - PRESERVED FROM WORKING VERSION
        async function loadDashboardData() {
            try {
                const response = await fetch('/api/dashboard');
                const data = await response.json();
                
                if (data.success) {
                    // Update stats
                    document.getElementById('total-scans').textContent = data.stats.totalScans;
                    document.getElementById('total-issues').textContent = data.stats.totalIssues;
                    document.getElementById('average-score').textContent = data.stats.averageScore + '%';
                    document.getElementById('this-week-scans').textContent = data.stats.thisWeekScans;
                    
                    // Update recent scans
                    const recentScansList = document.getElementById('recent-scans-list');
                    if (data.recentScans.length > 0) {
                        recentScansList.innerHTML = data.recentScans.map(scan => {
                            let scoreClass = 'score-excellent';
                            if (scan.score < 60) scoreClass = 'score-poor';
                            else if (scan.score < 80) scoreClass = 'score-fair';
                            else if (scan.score < 90) scoreClass = 'score-good';
                            
                            const date = new Date(scan.created_at).toLocaleDateString();
                            
                            return `
                                <div class="scan-item">
                                    <div class="scan-info">
                                        <h4>${scan.url}</h4>
                                        <div class="scan-meta">
                                            ${scan.scan_type.charAt(0).toUpperCase() + scan.scan_type.slice(1)} Page • ${date}
                                        </div>
                                    </div>
                                    <div class="scan-score">
                                        <div class="score-badge ${scoreClass}">${scan.score}% Score</div>
                                        <button class="view-report-btn">👁️ View Report</button>
                                    </div>
                                </div>
                            `;
                        }).join('');
                    } else {
                        recentScansList.innerHTML = `
                            <div style="padding: 40px; text-align: center; color: #6c757d;">
                                <p>No scans yet. <a href="#" onclick="showPage('scans')" style="color: #3498db;">Start your first scan</a></p>
                            </div>
                        `;
                    }
                }
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        }

        // Load dashboard data on page load
        loadDashboardData();
    </script>
</body>
</html>
    `);
});

console.log(`🚀 SentryPrime server running on port ${PORT}`);
console.log(`📍 Dashboard: http://localhost:${PORT}`);
console.log(`🔍 Health check: http://localhost:${PORT}/health`);

app.listen(PORT, () => {
    console.log(`✅ Server started successfully`);
});
