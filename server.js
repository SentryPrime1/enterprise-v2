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
        await page.evaluate((type) => {
            // Create CSS filter for color vision simulation
            const filters = {
                protanopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><defs><filter id=\\"protanopia\\"><feColorMatrix values=\\"0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0\\"/></filter></defs></svg>#protanopia")',
                deuteranopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><defs><filter id=\\"deuteranopia\\"><feColorMatrix values=\\"0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0\\"/></filter></defs></svg>#deuteranopia")',
                tritanopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><defs><filter id=\\"tritanopia\\"><feColorMatrix values=\\"0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0\\"/></filter></defs></svg>#tritanopia")',
                achromatopsia: 'grayscale(100%)',
                lowContrast: 'contrast(50%)'
            };
            
            if (filters[type]) {
                document.documentElement.style.filter = filters[type];
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
        
        let suggestions = [];
        
        if (openai) {
            try {
                // Create a detailed prompt for the AI
                const prompt = `As an accessibility expert, provide specific, actionable fix suggestions for this WCAG violation:

Rule: ${violation.id}
Impact: ${violation.impact}
Description: ${violation.description}
Help: ${violation.help}
${violation.helpUrl ? `Help URL: ${violation.helpUrl}` : ''}

Context:
- Element: ${violation.target ? violation.target[0] : 'Unknown'}
- HTML: ${violation.html || 'Not provided'}

Please provide:
1. A clear explanation of the issue
2. Step-by-step fix instructions
3. Code examples (HTML/CSS/JS as needed)
4. Best practices to prevent this issue

Format your response as JSON with this structure:
{
  "explanation": "Clear explanation of the issue",
  "steps": ["Step 1", "Step 2", "Step 3"],
  "codeExample": "HTML/CSS/JS code example",
  "bestPractices": ["Practice 1", "Practice 2"],
  "priority": "high|medium|low"
}`;

                const completion = await openai.chat.completions.create({
                    model: "gpt-4",
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert web accessibility consultant specializing in WCAG compliance. Provide practical, implementable solutions."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    max_tokens: 1000,
                    temperature: 0.3
                });
                
                const aiResponse = completion.choices[0].message.content;
                
                try {
                    const parsedResponse = JSON.parse(aiResponse);
                    suggestions.push({
                        type: 'ai-generated',
                        ...parsedResponse
                    });
                } catch (parseError) {
                    console.log('Failed to parse AI response as JSON, using as text');
                    suggestions.push({
                        type: 'ai-generated',
                        explanation: aiResponse,
                        steps: ['Review the AI-generated explanation above'],
                        priority: 'medium'
                    });
                }
                
            } catch (aiError) {
                console.log('AI suggestion failed:', aiError.message);
                // Fall back to predefined suggestions
            }
        }
        
        // Add predefined suggestions as fallback or supplement
        const predefinedSuggestions = getPredefinedSuggestions(violation.id, violation.impact);
        suggestions = suggestions.concat(predefinedSuggestions);
        
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

function getPredefinedSuggestions(ruleId, impact) {
    const suggestions = {
        'color-contrast': [
            {
                type: 'predefined',
                explanation: 'Text does not have sufficient color contrast against its background, making it difficult for users with visual impairments to read.',
                steps: [
                    'Check the contrast ratio using a color contrast analyzer',
                    'Ensure normal text has a contrast ratio of at least 4.5:1',
                    'Ensure large text (18pt+ or 14pt+ bold) has a contrast ratio of at least 3:1',
                    'Adjust either the text color or background color to meet requirements'
                ],
                codeExample: `/* Example: Improving contrast */
.low-contrast-text {
  color: #777; /* Poor contrast */
  background: #fff;
}

.high-contrast-text {
  color: #333; /* Better contrast */
  background: #fff;
}`,
                bestPractices: [
                    'Use online contrast checkers during design',
                    'Test with actual users who have visual impairments',
                    'Consider using darker colors for text',
                    'Avoid relying solely on color to convey information'
                ],
                priority: impact === 'serious' ? 'high' : 'medium'
            }
        ],
        'image-alt': [
            {
                type: 'predefined',
                explanation: 'Images must have alternative text that describes their content or function for screen reader users.',
                steps: [
                    'Add an alt attribute to the image element',
                    'Write descriptive text that conveys the image\'s purpose',
                    'For decorative images, use alt=""',
                    'For complex images, consider using longdesc or aria-describedby'
                ],
                codeExample: `<!-- Bad: Missing alt text -->
<img src="chart.png">

<!-- Good: Descriptive alt text -->
<img src="chart.png" alt="Sales increased 25% from Q1 to Q2 2024">

<!-- Good: Decorative image -->
<img src="decoration.png" alt="">`,
                bestPractices: [
                    'Keep alt text concise but descriptive',
                    'Don\'t start with "Image of" or "Picture of"',
                    'Include important text that appears in images',
                    'Use empty alt="" for purely decorative images'
                ],
                priority: 'high'
            }
        ],
        'label': [
            {
                type: 'predefined',
                explanation: 'Form controls must have accessible labels so screen reader users understand their purpose.',
                steps: [
                    'Add a <label> element associated with the form control',
                    'Use the "for" attribute to connect label to input',
                    'Alternatively, use aria-label or aria-labelledby',
                    'Ensure the label text is descriptive and clear'
                ],
                codeExample: `<!-- Good: Explicit label -->
<label for="email">Email Address</label>
<input type="email" id="email" name="email">

<!-- Good: Implicit label -->
<label>
  Phone Number
  <input type="tel" name="phone">
</label>

<!-- Good: ARIA label -->
<input type="search" aria-label="Search products">`,
                bestPractices: [
                    'Always provide labels for form inputs',
                    'Make label text clear and descriptive',
                    'Place labels before or above their inputs',
                    'Use required indicators that are accessible'
                ],
                priority: 'high'
            }
        ],
        'link-name': [
            {
                type: 'predefined',
                explanation: 'Links must have accessible names that describe their destination or function.',
                steps: [
                    'Add descriptive text inside the link element',
                    'Use aria-label for links with only icons',
                    'Use aria-labelledby to reference descriptive text',
                    'Avoid generic text like "click here" or "read more"'
                ],
                codeExample: `<!-- Bad: Generic link text -->
<a href="/report.pdf">Click here</a>

<!-- Good: Descriptive link text -->
<a href="/report.pdf">Download 2024 Annual Report (PDF)</a>

<!-- Good: Icon link with aria-label -->
<a href="/contact" aria-label="Contact us">
  <i class="icon-phone"></i>
</a>`,
                bestPractices: [
                    'Make link text descriptive of the destination',
                    'Include file type and size for downloads',
                    'Avoid "click here" and "read more"',
                    'Ensure links make sense out of context'
                ],
                priority: 'medium'
            }
        ]
    };
    
    return suggestions[ruleId] || [
        {
            type: 'predefined',
            explanation: 'This accessibility issue needs to be addressed to improve usability for all users.',
            steps: [
                'Review the WCAG guidelines for this rule',
                'Test with assistive technologies',
                'Implement the recommended fixes',
                'Verify the fix resolves the issue'
            ],
            bestPractices: [
                'Follow WCAG 2.1 AA guidelines',
                'Test with real users when possible',
                'Use automated testing as a starting point',
                'Consider the user experience impact'
            ],
            priority: impact === 'critical' ? 'high' : 'medium'
        }
    ];
}

// PHASE 2F: Comprehensive Scan Endpoint with Enhanced Features
app.post('/api/scan', async (req, res) => {
    const startTime = Date.now();
    let browser = null;
    
    try {
        const { url, scanType = 'single', maxPages = 5 } = req.body;
        
        console.log(`🔍 Starting ${scanType} scan for:`, url);
        
        // Validate URL
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'URL is required' 
            });
        }
        
        // Launch browser with optimized settings for Cloud Run
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
                '--disable-features=VizDisplayCompositor'
            ],
            timeout: 60000
        });
        
        const page = await browser.newPage();
        
        // Set viewport and user agent
        await page.setViewport({ width: 1200, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        let urlsToScan = [url];
        
        // For crawl scans, discover additional URLs
        if (scanType === 'crawl') {
            console.log('🕷️ Discovering URLs for crawl scan...');
            try {
                await page.goto(url, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 30000 
                });
                
                // Extract links from the page
                const discoveredUrls = await page.evaluate((baseUrl, maxPages) => {
                    const links = Array.from(document.querySelectorAll('a[href]'));
                    const urls = links
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
                        .filter(url => url !== null)
                        .filter((url, index, array) => array.indexOf(url) === index) // Remove duplicates
                        .slice(0, maxPages - 1); // Reserve one slot for the main URL
                    
                    return urls;
                }, url, maxPages);
                
                urlsToScan = [url, ...discoveredUrls].slice(0, maxPages);
                console.log(`📄 Found ${urlsToScan.length} URLs to scan:`, urlsToScan);
                
            } catch (crawlError) {
                console.log('⚠️ Crawl discovery failed, scanning single page only:', crawlError.message);
                urlsToScan = [url];
            }
        }
        
        // Scan each URL
        let allViolations = [];
        let scanResults = [];
        let totalIssues = 0;
        
        for (let i = 0; i < urlsToScan.length; i++) {
            const currentUrl = urlsToScan[i];
            console.log(`🔍 Scanning page ${i + 1}/${urlsToScan.length}: ${currentUrl}`);
            
            try {
                // Navigate to the page
                await page.goto(currentUrl, { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 30000 
                });
                
                // Wait a bit for dynamic content
                await page.waitForTimeout(2000);
                
                // Inject axe-core and run accessibility scan
                await page.addScriptTag({
                    content: axeCore.source
                });
                
                // Run axe scan with comprehensive rules
                const axeResults = await page.evaluate(() => {
                    return new Promise((resolve) => {
                        axe.run({
                            rules: {
                                'color-contrast': { enabled: true },
                                'image-alt': { enabled: true },
                                'label': { enabled: true },
                                'link-name': { enabled: true },
                                'button-name': { enabled: true },
                                'heading-order': { enabled: true },
                                'landmark-one-main': { enabled: true },
                                'page-has-heading-one': { enabled: true },
                                'region': { enabled: true },
                                'skip-link': { enabled: true },
                                'focus-order-semantics': { enabled: true },
                                'tabindex': { enabled: true },
                                'duplicate-id': { enabled: true },
                                'form-field-multiple-labels': { enabled: true },
                                'frame-title': { enabled: true },
                                'html-has-lang': { enabled: true },
                                'html-lang-valid': { enabled: true },
                                'input-image-alt': { enabled: true },
                                'meta-refresh': { enabled: true },
                                'object-alt': { enabled: true },
                                'video-caption': { enabled: true }
                            }
                        }, (err, results) => {
                            if (err) {
                                resolve({ violations: [], passes: [], incomplete: [] });
                            } else {
                                resolve(results);
                            }
                        });
                    });
                });
                
                // Process violations for this page
                const pageViolations = axeResults.violations.map(violation => ({
                    ...violation,
                    pageUrl: currentUrl,
                    pageTitle: violation.pageTitle || currentUrl
                }));
                
                allViolations = allViolations.concat(pageViolations);
                totalIssues += pageViolations.reduce((sum, v) => sum + v.nodes.length, 0);
                
                scanResults.push({
                    url: currentUrl,
                    violations: pageViolations.length,
                    issues: pageViolations.reduce((sum, v) => sum + v.nodes.length, 0),
                    passes: axeResults.passes.length
                });
                
                console.log(`✅ Page ${i + 1} scanned: ${pageViolations.length} violation types, ${pageViolations.reduce((sum, v) => sum + v.nodes.length, 0)} total issues`);
                
            } catch (pageError) {
                console.log(`❌ Failed to scan page ${currentUrl}:`, pageError.message);
                scanResults.push({
                    url: currentUrl,
                    error: pageError.message,
                    violations: 0,
                    issues: 0,
                    passes: 0
                });
            }
        }
        
        // Calculate accessibility score
        const maxPossibleIssues = urlsToScan.length * 50; // Rough estimate
        const score = Math.max(0, Math.round(100 - (totalIssues / maxPossibleIssues) * 100));
        
        const scanTimeMs = Date.now() - startTime;
        
        // Save scan to database
        const scanId = await saveScan(
            1, // userId - hardcoded for now
            1, // organizationId - hardcoded for now
            url,
            scanType,
            totalIssues,
            scanTimeMs,
            urlsToScan.length,
            allViolations
        );
        
        console.log(`🎉 Scan completed in ${scanTimeMs}ms: ${totalIssues} total issues found across ${urlsToScan.length} pages`);
        
        res.json({
            success: true,
            scanId: scanId,
            url: url,
            scanType: scanType,
            pagesScanned: urlsToScan.length,
            totalIssues: totalIssues,
            score: score,
            scanTimeMs: scanTimeMs,
            violations: allViolations,
            pageResults: scanResults,
            summary: {
                critical: allViolations.filter(v => v.impact === 'critical').length,
                serious: allViolations.filter(v => v.impact === 'serious').length,
                moderate: allViolations.filter(v => v.impact === 'moderate').length,
                minor: allViolations.filter(v => v.impact === 'minor').length
            }
        });
        
    } catch (error) {
        console.error('❌ Scan failed:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Scan failed: ' + error.message,
            scanTimeMs: Date.now() - startTime
        });
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (closeError) {
                console.log('⚠️ Error closing browser:', closeError.message);
            }
        }
    }
});

// Dashboard API endpoints
app.get('/api/dashboard/stats', async (req, res) => {
    try {
        const stats = await getDashboardStats();
        res.json(stats);
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        res.status(500).json({ error: 'Failed to get dashboard stats' });
    }
});

app.get('/api/dashboard/recent-scans', async (req, res) => {
    try {
        const scans = await getRecentScans();
        res.json(scans);
    } catch (error) {
        console.error('Error getting recent scans:', error);
        res.status(500).json({ error: 'Failed to get recent scans' });
    }
});

// Serve the main application
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
            background: #f8f9fa;
            color: #333;
            line-height: 1.6;
        }
        
        .app-container {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 250px;
            background: #2c3e50;
            color: white;
            padding: 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }
        
        .logo {
            padding: 20px;
            border-bottom: 1px solid #34495e;
            text-align: center;
        }
        
        .logo h1 {
            font-size: 24px;
            font-weight: 700;
            color: #3498db;
        }
        
        .logo p {
            font-size: 12px;
            color: #bdc3c7;
            margin-top: 5px;
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
            color: #ecf0f1;
            text-decoration: none;
            transition: all 0.3s ease;
            border: none;
            background: none;
            width: 100%;
            text-align: left;
            cursor: pointer;
        }
        
        .nav-link:hover {
            background: #34495e;
            color: #3498db;
        }
        
        .nav-link.active {
            background: #3498db;
            color: white;
        }
        
        .nav-icon {
            margin-right: 10px;
            font-size: 18px;
        }
        
        .main-content {
            flex: 1;
            margin-left: 250px;
            padding: 0;
        }
        
        .header {
            background: white;
            padding: 20px 30px;
            border-bottom: 1px solid #e9ecef;
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
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 15px;
        }
        
        .notification-bell {
            position: relative;
            cursor: pointer;
            font-size: 20px;
            color: #6c757d;
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
            font-size: 28px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .dashboard-header p {
            color: #6c757d;
            font-size: 16px;
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
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            border-left: 4px solid #3498db;
        }
        
        .stat-value {
            font-size: 32px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .stat-label {
            color: #6c757d;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .content-grid {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 30px;
        }
        
        .card {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .card-header {
            padding: 20px 25px;
            border-bottom: 1px solid #e9ecef;
            background: #f8f9fa;
        }
        
        .card-title {
            font-size: 18px;
            font-weight: 600;
            color: #2c3e50;
        }
        
        .card-body {
            padding: 25px;
        }
        
        .scan-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        
        .form-label {
            font-weight: 500;
            color: #2c3e50;
        }
        
        .form-input {
            padding: 12px 15px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.3s ease;
        }
        
        .form-input:focus {
            outline: none;
            border-color: #3498db;
            box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.1);
        }
        
        .form-select {
            padding: 12px 15px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 14px;
            background: white;
            cursor: pointer;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
        }
        
        .btn-primary {
            background: #3498db;
            color: white;
        }
        
        .btn-primary:hover {
            background: #2980b9;
        }
        
        .btn-primary:disabled {
            background: #bdc3c7;
            cursor: not-allowed;
        }
        
        .recent-scans {
            list-style: none;
        }
        
        .scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px 0;
            border-bottom: 1px solid #e9ecef;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            font-size: 14px;
            font-weight: 500;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .scan-info p {
            font-size: 12px;
            color: #6c757d;
        }
        
        .scan-score {
            font-size: 18px;
            font-weight: 700;
            padding: 5px 10px;
            border-radius: 4px;
            color: white;
        }
        
        .score-excellent { background: #27ae60; }
        .score-good { background: #f39c12; }
        .score-poor { background: #e74c3c; }
        
        .loading {
            display: none;
            text-align: center;
            padding: 20px;
            color: #6c757d;
        }
        
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #3498db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .results-container {
            display: none;
            margin-top: 30px;
        }
        
        .results-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding: 20px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .results-score {
            text-align: center;
        }
        
        .score-circle {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            font-weight: bold;
            color: white;
            margin: 0 auto 10px;
        }
        
        .violations-list {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        
        .violation-item {
            border-bottom: 1px solid #e9ecef;
            padding: 20px;
        }
        
        .violation-item:last-child {
            border-bottom: none;
        }
        
        .violation-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10px;
        }
        
        .violation-title {
            font-size: 16px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 5px;
        }
        
        .violation-impact {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 500;
            text-transform: uppercase;
        }
        
        .impact-critical { background: #e74c3c; color: white; }
        .impact-serious { background: #fd7e14; color: white; }
        .impact-moderate { background: #ffc107; color: #333; }
        .impact-minor { background: #6c757d; color: white; }
        
        .violation-description {
            color: #6c757d;
            margin-bottom: 15px;
            line-height: 1.5;
        }
        
        .violation-actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .btn-sm {
            padding: 6px 12px;
            font-size: 12px;
        }
        
        .btn-outline {
            background: transparent;
            border: 1px solid #3498db;
            color: #3498db;
        }
        
        .btn-outline:hover {
            background: #3498db;
            color: white;
        }
        
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
            padding: 20px 25px;
            border-bottom: 1px solid #e9ecef;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .modal-title {
            font-size: 18px;
            font-weight: 600;
            color: #2c3e50;
        }
        
        .close {
            color: #aaa;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            border: none;
            background: none;
        }
        
        .close:hover {
            color: #333;
        }
        
        .modal-body {
            padding: 25px;
        }
        
        .preview-container {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
        }
        
        .preview-section h4 {
            margin-bottom: 10px;
            color: #2c3e50;
        }
        
        .preview-image {
            width: 100%;
            border: 1px solid #ddd;
            border-radius: 4px;
        }
        
        .suggestions-list {
            list-style: none;
        }
        
        .suggestion-item {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 15px;
            border-left: 4px solid #3498db;
        }
        
        .suggestion-item h5 {
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .suggestion-steps {
            list-style: decimal;
            margin-left: 20px;
            margin-bottom: 10px;
        }
        
        .suggestion-steps li {
            margin-bottom: 5px;
            color: #6c757d;
        }
        
        .code-example {
            background: #2c3e50;
            color: #ecf0f1;
            padding: 15px;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 13px;
            overflow-x: auto;
            margin: 10px 0;
        }
        
        .alert {
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 20px;
        }
        
        .alert-info {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            color: #0c5460;
        }
        
        .alert-success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        
        .alert-error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        
        .integration-platforms {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        
        .platform-card {
            background: white;
            border: 1px solid #e9ecef;
            border-radius: 8px;
            padding: 25px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .platform-card:hover {
            border-color: #3498db;
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
            transform: translateY(-2px);
        }
        
        .platform-icon {
            font-size: 48px;
            margin-bottom: 15px;
            color: #3498db;
        }
        
        .platform-card h3 {
            font-size: 20px;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        
        .platform-card p {
            color: #6c757d;
            margin-bottom: 20px;
        }
        
        .connect-btn {
            background: #3498db;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.3s ease;
        }
        
        .connect-btn:hover {
            background: #2980b9;
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
            
            .content-grid {
                grid-template-columns: 1fr;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .preview-container {
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
                    <button class="nav-link active" onclick="showPage('dashboard')">
                        <span class="nav-icon">📊</span>
                        Dashboard
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('scans')">
                        <span class="nav-icon">🔍</span>
                        Scans
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('analytics')">
                        <span class="nav-icon">📈</span>
                        Analytics
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('team')">
                        <span class="nav-icon">👥</span>
                        Team
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('integrations')">
                        <span class="nav-icon">🔗</span>
                        Integrations
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('api')">
                        <span class="nav-icon">⚙️</span>
                        API Management
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('billing')">
                        <span class="nav-icon">💳</span>
                        Billing
                    </button>
                </li>
                <li class="nav-item">
                    <button class="nav-link" onclick="showPage('settings')">
                        <span class="nav-icon">⚙️</span>
                        Settings
                    </button>
                </li>
            </ul>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" class="search-input" placeholder="Search scans, reports, or settings...">
                </div>
                <div class="user-menu">
                    <div class="notification-bell">🔔</div>
                    <div class="user-avatar">JD</div>
                    <span>John Doe<br><small>Acme Corporation</small></span>
                </div>
            </header>
            
            <div id="dashboard" class="page active">
                <div class="dashboard-header">
                    <h1>Dashboard</h1>
                    <p>Monitor your accessibility compliance and scan results</p>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-value" id="total-scans">-</div>
                        <div class="stat-label">Total Scans</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="total-issues">-</div>
                        <div class="stat-label">Issues Found</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="average-score">-</div>
                        <div class="stat-label">Average Score</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value" id="this-week-scans">-</div>
                        <div class="stat-label">This Week</div>
                    </div>
                </div>
                
                <div class="content-grid">
                    <div class="card">
                        <div class="card-header">
                            <h2 class="card-title">Quick Scan</h2>
                        </div>
                        <div class="card-body">
                            <form class="scan-form" onsubmit="startScan(event)">
                                <div class="form-group">
                                    <label class="form-label">Website URL</label>
                                    <input type="url" class="form-input" id="scan-url" placeholder="https://example.com" required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Scan Type</label>
                                    <select class="form-select" id="scan-type">
                                        <option value="single">Single Page</option>
                                        <option value="crawl">Site Crawl (up to 5 pages)</option>
                                    </select>
                                </div>
                                <button type="submit" class="btn btn-primary" id="scan-btn">
                                    <span class="btn-text">Start Scan</span>
                                    <span class="spinner" style="display: none;"></span>
                                </button>
                            </form>
                            
                            <div class="loading" id="scan-loading">
                                <div class="spinner"></div>
                                <p>Scanning website for accessibility issues...</p>
                            </div>
                        </div>
                    </div>
                    
                    <div class="card">
                        <div class="card-header">
                            <h2 class="card-title">Recent Scans</h2>
                        </div>
                        <div class="card-body">
                            <ul class="recent-scans" id="recent-scans-list">
                                <li class="scan-item">
                                    <div class="scan-info">
                                        <h4>Loading...</h4>
                                        <p>Please wait</p>
                                    </div>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                
                <div class="results-container" id="results-container">
                    <div class="results-header">
                        <div>
                            <h2 id="results-title">Scan Results</h2>
                            <p id="results-summary">-</p>
                        </div>
                        <div class="results-score">
                            <div class="score-circle" id="results-score-circle">-</div>
                            <div>Accessibility Score</div>
                        </div>
                    </div>
                    
                    <div class="violations-list" id="violations-list">
                        <!-- Violations will be populated here -->
                    </div>
                </div>
            </div>
            
            <div id="scans" class="page">
                <div class="dashboard-header">
                    <h1>Accessibility Scans</h1>
                    <p>Comprehensive accessibility testing and monitoring</p>
                </div>
                
                <div class="card">
                    <div class="card-header">
                        <h2 class="card-title">New Accessibility Scan</h2>
                    </div>
                    <div class="card-body">
                        <form class="scan-form" onsubmit="startScan(event)">
                            <div class="form-group">
                                <label class="form-label">Website URL</label>
                                <input type="url" class="form-input" id="scan-url-page" placeholder="https://example.com" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Scan Type</label>
                                <select class="form-select" id="scan-type-page">
                                    <option value="single">Single Page Scan</option>
                                    <option value="crawl">Multi-Page Crawl (up to 5 pages)</option>
                                </select>
                            </div>
                            <button type="submit" class="btn btn-primary">
                                🔍 Start Accessibility Scan
                            </button>
                        </form>
                    </div>
                </div>
            </div>
            
            <div id="analytics" class="page">
                <div class="dashboard-header">
                    <h1>Analytics</h1>
                    <p>Coming soon - Detailed accessibility analytics and trends</p>
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
                    <p>Connect your platforms for automated accessibility fixes</p>
                </div>
                
                <div class="integration-platforms">
                    <div class="platform-card" onclick="showConnectModal('WordPress')">
                        <div class="platform-icon">📝</div>
                        <h3>WordPress</h3>
                        <p>Connect your WordPress site for automated accessibility fixes</p>
                        <button class="connect-btn">Connect WordPress</button>
                    </div>
                    
                    <div class="platform-card" onclick="showConnectModal('Shopify')">
                        <div class="platform-icon">🛍️</div>
                        <h3>Shopify</h3>
                        <p>Connect your Shopify store for automated accessibility improvements</p>
                        <button class="connect-btn">Connect Shopify</button>
                    </div>
                    
                    <div class="platform-card" onclick="showConnectModal('Custom')">
                        <div class="platform-icon">🔧</div>
                        <h3>Custom Site</h3>
                        <p>Connect any website via FTP, SFTP, or SSH</p>
                        <button class="connect-btn">Connect Custom Site</button>
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
        </main>
    </div>
    
    <!-- Visual Preview Modal -->
    <div id="visual-preview-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">Visual Preview</h2>
                <button class="close" onclick="closeModal('visual-preview-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="preview-container">
                    <div class="preview-section">
                        <h4>Before (Original)</h4>
                        <img id="preview-before" class="preview-image" alt="Before preview">
                    </div>
                    <div class="preview-section">
                        <h4>After (Highlighted Issues)</h4>
                        <img id="preview-after" class="preview-image" alt="After preview with highlighted issues">
                    </div>
                </div>
                <div id="preview-info"></div>
            </div>
        </div>
    </div>
    
    <!-- AI Suggestions Modal -->
    <div id="ai-suggestions-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">AI-Powered Fix Suggestions</h2>
                <button class="close" onclick="closeModal('ai-suggestions-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <div id="suggestions-content">
                    <div class="loading">
                        <div class="spinner"></div>
                        <p>Generating AI-powered suggestions...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Color Contrast Preview Modal -->
    <div id="color-contrast-modal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">Color Vision Simulation</h2>
                <button class="close" onclick="closeModal('color-contrast-modal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Simulation Type</label>
                    <select class="form-select" id="simulation-type" onchange="updateColorPreview()">
                        <option value="protanopia">Protanopia (Red-blind)</option>
                        <option value="deuteranopia">Deuteranopia (Green-blind)</option>
                        <option value="tritanopia">Tritanopia (Blue-blind)</option>
                        <option value="achromatopsia">Achromatopsia (Total color blindness)</option>
                        <option value="lowContrast">Low Contrast Simulation</option>
                    </select>
                </div>
                <div class="preview-container">
                    <div class="preview-section">
                        <h4>Normal Vision</h4>
                        <img id="contrast-before" class="preview-image" alt="Normal vision">
                    </div>
                    <div class="preview-section">
                        <h4 id="contrast-simulation-title">Simulated Vision</h4>
                        <img id="contrast-after" class="preview-image" alt="Simulated vision">
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let currentScanUrl = 'https://example.com';
        let currentViolations = [];
        
        // Navigation
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
            
            // Add active class to clicked nav link
            event.target.classList.add('active');
        }
        
        // Load dashboard data
        async function loadDashboardData() {
            try {
                // Load stats
                const statsResponse = await fetch('/api/dashboard/stats');
                const stats = await statsResponse.json();
                
                document.getElementById('total-scans').textContent = stats.totalScans;
                document.getElementById('total-issues').textContent = stats.totalIssues;
                document.getElementById('average-score').textContent = stats.averageScore + '%';
                document.getElementById('this-week-scans').textContent = stats.thisWeekScans;
                
                // Load recent scans
                const scansResponse = await fetch('/api/dashboard/recent-scans');
                const scans = await scansResponse.json();
                
                const scansList = document.getElementById('recent-scans-list');
                scansList.innerHTML = '';
                
                if (scans.length === 0) {
                    scansList.innerHTML = '<li class="scan-item"><div class="scan-info"><h4>No scans yet</h4><p>Start your first accessibility scan</p></div></li>';
                } else {
                    scans.forEach(scan => {
                        const scoreClass = scan.score >= 90 ? 'score-excellent' : scan.score >= 70 ? 'score-good' : 'score-poor';
                        const scanDate = new Date(scan.created_at).toLocaleDateString();
                        
                        scansList.innerHTML += `
                            <li class="scan-item">
                                <div class="scan-info">
                                    <h4>${scan.url}</h4>
                                    <p>${scan.scan_type} scan • ${scanDate}</p>
                                </div>
                                <div class="scan-score ${scoreClass}">${scan.score}</div>
                            </li>
                        `;
                    });
                }
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        }
        
        // Start accessibility scan
        async function startScan(event) {
            event.preventDefault();
            
            const form = event.target;
            const urlInput = form.querySelector('input[type="url"]');
            const typeSelect = form.querySelector('select');
            const submitBtn = form.querySelector('button[type="submit"]');
            
            const url = urlInput.value;
            const scanType = typeSelect.value;
            
            if (!url) {
                alert('Please enter a valid URL');
                return;
            }
            
            // Update UI to show loading state
            submitBtn.disabled = true;
            submitBtn.querySelector('.btn-text').textContent = 'Scanning...';
            submitBtn.querySelector('.spinner').style.display = 'inline-block';
            
            const loadingDiv = document.getElementById('scan-loading');
            if (loadingDiv) {
                loadingDiv.style.display = 'block';
            }
            
            const resultsContainer = document.getElementById('results-container');
            if (resultsContainer) {
                resultsContainer.style.display = 'none';
            }
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url, scanType })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    currentScanUrl = url;
                    currentViolations = result.violations;
                    displayScanResults(result);
                    loadDashboardData(); // Refresh dashboard stats
                } else {
                    throw new Error(result.error || 'Scan failed');
                }
            } catch (error) {
                console.error('Scan error:', error);
                alert('Scan failed: ' + error.message);
            } finally {
                // Reset UI
                submitBtn.disabled = false;
                submitBtn.querySelector('.btn-text').textContent = 'Start Scan';
                submitBtn.querySelector('.spinner').style.display = 'none';
                
                if (loadingDiv) {
                    loadingDiv.style.display = 'none';
                }
            }
        }
        
        // Display scan results
        function displayScanResults(result) {
            const resultsContainer = document.getElementById('results-container');
            const resultsTitle = document.getElementById('results-title');
            const resultsSummary = document.getElementById('results-summary');
            const resultsScoreCircle = document.getElementById('results-score-circle');
            const violationsList = document.getElementById('violations-list');
            
            if (!resultsContainer) return;
            
            // Update results header
            resultsTitle.textContent = `Scan Results for ${result.url}`;
            resultsSummary.textContent = `${result.totalIssues} issues found across ${result.pagesScanned} page(s) • Scanned in ${(result.scanTimeMs / 1000).toFixed(1)}s`;
            
            // Update score circle
            const scoreClass = result.score >= 90 ? 'score-excellent' : result.score >= 70 ? 'score-good' : 'score-poor';
            resultsScoreCircle.textContent = result.score;
            resultsScoreCircle.className = `score-circle ${scoreClass}`;
            
            // Clear and populate violations list
            violationsList.innerHTML = '';
            
            if (result.violations.length === 0) {
                violationsList.innerHTML = `
                    <div class="violation-item">
                        <div class="alert alert-success">
                            🎉 Congratulations! No accessibility violations were found on this page.
                        </div>
                    </div>
                `;
            } else {
                result.violations.forEach((violation, index) => {
                    const impactClass = `impact-${violation.impact}`;
                    const violationHtml = `
                        <div class="violation-item">
                            <div class="violation-header">
                                <div>
                                    <div class="violation-title">${violation.id}</div>
                                    <div class="violation-impact ${impactClass}">${violation.impact}</div>
                                </div>
                            </div>
                            <div class="violation-description">
                                ${violation.description}
                                <br><strong>Help:</strong> ${violation.help}
                                ${violation.helpUrl ? `<br><a href="${violation.helpUrl}" target="_blank">Learn more</a>` : ''}
                            </div>
                            <div class="violation-actions">
                                <button class="btn btn-sm btn-outline" onclick="showVisualPreview(${index})">
                                    👁️ Visual Preview
                                </button>
                                <button class="btn btn-sm btn-outline" onclick="showAISuggestions(${index})">
                                    🤖 AI Suggestions
                                </button>
                                <button class="btn btn-sm btn-outline" onclick="showColorContrastPreview()">
                                    🎨 Color Vision Test
                                </button>
                            </div>
                        </div>
                    `;
                    violationsList.innerHTML += violationHtml;
                });
            }
            
            // Show results container
            resultsContainer.style.display = 'block';
            resultsContainer.scrollIntoView({ behavior: 'smooth' });
        }
        
        // Show visual preview
        async function showVisualPreview(violationIndex) {
            const violation = currentViolations[violationIndex];
            const modal = document.getElementById('visual-preview-modal');
            const beforeImg = document.getElementById('preview-before');
            const afterImg = document.getElementById('preview-after');
            const infoDiv = document.getElementById('preview-info');
            
            modal.style.display = 'block';
            
            // Show loading state
            beforeImg.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjhmOWZhIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzZjNzU3ZCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkxvYWRpbmcuLi48L3RleHQ+PC9zdmc+';
            afterImg.src = beforeImg.src;
            infoDiv.innerHTML = '<p>Generating visual preview...</p>';
            
            try {
                const response = await fetch('/api/visual-preview', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: currentScanUrl,
                        violation: violation
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    beforeImg.src = result.beforeImage;
                    afterImg.src = result.afterImage;
                    
                    infoDiv.innerHTML = `
                        <div class="alert alert-info">
                            <strong>Violation:</strong> ${result.violationId}<br>
                            <strong>Elements highlighted:</strong> ${result.highlightedElements}<br>
                            ${result.elementInfo ? `<strong>Element type:</strong> ${result.elementInfo.tagName}` : ''}
                        </div>
                    `;
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Visual preview error:', error);
                infoDiv.innerHTML = `<div class="alert alert-error">Failed to generate preview: ${error.message}</div>`;
            }
        }
        
        // Show AI suggestions
        async function showAISuggestions(violationIndex) {
            const violation = currentViolations[violationIndex];
            const modal = document.getElementById('ai-suggestions-modal');
            const content = document.getElementById('suggestions-content');
            
            modal.style.display = 'block';
            content.innerHTML = `
                <div class="loading">
                    <div class="spinner"></div>
                    <p>Generating AI-powered suggestions...</p>
                </div>
            `;
            
            try {
                const response = await fetch('/api/ai-suggestions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        violation: violation,
                        context: { url: currentScanUrl }
                    })
                });
                
                const result = await response.json();
                
                if (result.success && result.suggestions.length > 0) {
                    let suggestionsHtml = '';
                    
                    result.suggestions.forEach(suggestion => {
                        suggestionsHtml += `
                            <div class="suggestion-item">
                                <h5>${suggestion.type === 'ai-generated' ? '🤖 AI-Generated Suggestion' : '📋 Expert Recommendation'}</h5>
                                <p><strong>Issue:</strong> ${suggestion.explanation}</p>
                                
                                ${suggestion.steps ? `
                                    <p><strong>Steps to fix:</strong></p>
                                    <ol class="suggestion-steps">
                                        ${suggestion.steps.map(step => `<li>${step}</li>`).join('')}
                                    </ol>
                                ` : ''}
                                
                                ${suggestion.codeExample ? `
                                    <p><strong>Code example:</strong></p>
                                    <div class="code-example">${suggestion.codeExample}</div>
                                ` : ''}
                                
                                ${suggestion.bestPractices ? `
                                    <p><strong>Best practices:</strong></p>
                                    <ul>
                                        ${suggestion.bestPractices.map(practice => `<li>${practice}</li>`).join('')}
                                    </ul>
                                ` : ''}
                                
                                <p><strong>Priority:</strong> <span class="priority-${suggestion.priority}">${suggestion.priority}</span></p>
                            </div>
                        `;
                    });
                    
                    content.innerHTML = suggestionsHtml;
                } else {
                    throw new Error(result.error || 'No suggestions available');
                }
            } catch (error) {
                console.error('AI suggestions error:', error);
                content.innerHTML = `<div class="alert alert-error">Failed to generate suggestions: ${error.message}</div>`;
            }
        }
        
        // Show color contrast preview
        async function showColorContrastPreview() {
            const modal = document.getElementById('color-contrast-modal');
            modal.style.display = 'block';
            
            // Generate initial preview
            updateColorPreview();
        }
        
        // Update color contrast preview
        async function updateColorPreview() {
            const simulationType = document.getElementById('simulation-type').value;
            const beforeImg = document.getElementById('contrast-before');
            const afterImg = document.getElementById('contrast-after');
            const titleElement = document.getElementById('contrast-simulation-title');
            
            const simulationTitles = {
                protanopia: 'Protanopia (Red-blind)',
                deuteranopia: 'Deuteranopia (Green-blind)',
                tritanopia: 'Tritanopia (Blue-blind)',
                achromatopsia: 'Achromatopsia (Total color blindness)',
                lowContrast: 'Low Contrast Simulation'
            };
            
            titleElement.textContent = simulationTitles[simulationType];
            
            // Show loading
            const loadingImg = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZjhmOWZhIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCwgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIxNCIgZmlsbD0iIzZjNzU3ZCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkxvYWRpbmcuLi48L3RleHQ+PC9zdmc+';
            beforeImg.src = loadingImg;
            afterImg.src = loadingImg;
            
            try {
                const response = await fetch('/api/color-contrast-preview', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: currentScanUrl,
                        simulationType: simulationType
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    beforeImg.src = result.beforeImage;
                    afterImg.src = result.afterImage;
                } else {
                    throw new Error(result.error);
                }
            } catch (error) {
                console.error('Color contrast preview error:', error);
                // Keep loading images on error
            }
        }
        
        // Close modal
        function closeModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
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
        
        // ULTRA-MINIMAL ENHANCEMENT: WordPress prompt function
        function showConnectModal(platform) {
            if (platform === 'WordPress') {
                var url = prompt('Enter WordPress URL:');
                if (url) {
                    alert('Would connect to: ' + url + '\\n\\nNext: Enter username and app password');
                }
            } else {
                alert('Connect to ' + platform + ' - Feature coming soon!');
            }
        }
        
        // Initialize dashboard
        document.addEventListener('DOMContentLoaded', function() {
            loadDashboardData();
        });
    </script>
</body>
</html>
    `);
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 SentryPrime Enterprise server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔍 Health check: http://localhost:${PORT}/health`);
});
