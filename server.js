const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');
const OpenAI = require('openai');

// ENHANCEMENT: Import new engines (with feature flag for safety)
const ENABLE_DEPLOYMENT_FEATURES = process.env.ENABLE_DEPLOYMENT_FEATURES || 'true';
let DOMParsingEngine, PatchGenerationEngine, DeploymentAutomationEngine, RollbackSafetyEngine;
let domParsingEngine, patchGenerationEngine, deploymentEngine, safetyEngine;

if (ENABLE_DEPLOYMENT_FEATURES === 'true') {
    try {
        DOMParsingEngine = require('./dom-parsing-engine.js');
        PatchGenerationEngine = require('./patch-generation-engine.js');
        DeploymentAutomationEngine = require('./deployment-automation-engine.js');
        RollbackSafetyEngine = require('./rollback-safety-engine.js');
        
        console.log('🚀 Initializing enhanced deployment engines...');
        domParsingEngine = new DOMParsingEngine();
        patchGenerationEngine = new PatchGenerationEngine();
        deploymentEngine = new DeploymentAutomationEngine();
        safetyEngine = new RollbackSafetyEngine();
        console.log('✅ Enhanced deployment engines initialized successfully');
    } catch (error) {
        console.log('⚠️ Deployment engines not available, running in standard mode:', error.message);
    }
} else {
    console.log('ℹ️ Running in standard mode - deployment features disabled');
}

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

// OpenAI client initialization - PRESERVED EXACTLY AS YOUR WORKING VERSION
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
        console.log('❌ Database error fetching scans:', error.message);
        return [];
    }
}

async function getAnalytics(userId = 1) {
    if (!db) {
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0
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
        
        const row = result.rows[0];
        return {
            totalScans: parseInt(row.total_scans),
            totalIssues: parseInt(row.total_issues),
            averageScore: Math.round(parseFloat(row.average_score)),
            thisWeekScans: parseInt(row.this_week_scans)
        };
    } catch (error) {
        console.log('❌ Database error fetching analytics:', error.message);
        return {
            totalScans: 0,
            totalIssues: 0,
            averageScore: 0,
            thisWeekScans: 0
        };
    }
}

// Health check endpoint - ENHANCED
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local',
        deploymentFeatures: ENABLE_DEPLOYMENT_FEATURES === 'true' ? 'enabled' : 'disabled',
        engines: {
            domParsing: domParsingEngine ? 'initialized' : 'not available',
            patchGeneration: patchGenerationEngine ? 'initialized' : 'not available',
            deployment: deploymentEngine ? 'initialized' : 'not available',
            safety: safetyEngine ? 'initialized' : 'not available'
        }
    });
});

// PRESERVED: Your exact working AI suggestion function
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

// PRESERVED: Your exact working AI response parser
function parseAITextResponse(aiResponse, violationId) {
    try {
        const suggestion = {
            priority: 'medium',
            explanation: '',
            codeExample: '',
            steps: []
        };

        // Extract priority
        const priorityMatch = aiResponse.match(/PRIORITY:\s*(high|medium|low)/i);
        if (priorityMatch) {
            suggestion.priority = priorityMatch[1].toLowerCase();
        }

        // Extract explanation
        const explanationMatch = aiResponse.match(/EXPLANATION:\s*([\s\S]*?)(?=CODE EXAMPLE:|IMPLEMENTATION STEPS:|$)/i);
        if (explanationMatch) {
            suggestion.explanation = explanationMatch[1].trim();
        }

        // Extract code example
        const codeMatch = aiResponse.match(/CODE EXAMPLE:\s*([\s\S]*?)(?=IMPLEMENTATION STEPS:|PLATFORM-SPECIFIC|$)/i);
        if (codeMatch) {
            suggestion.codeExample = codeMatch[1].trim();
        }

        // Extract implementation steps
        const stepsMatch = aiResponse.match(/IMPLEMENTATION STEPS:\s*([\s\S]*?)(?=PLATFORM-SPECIFIC|$)/i);
        if (stepsMatch) {
            const stepsText = stepsMatch[1].trim();
            const stepLines = stepsText.split('\n').filter(line => line.trim());
            suggestion.steps = stepLines.map(line => line.replace(/^\d+\.\s*/, '').trim()).filter(step => step.length > 0);
        }

        return suggestion;
    } catch (error) {
        console.log(`❌ Error parsing AI response for ${violationId}:`, error.message);
        return {
            priority: 'medium',
            explanation: 'AI response could not be parsed properly.',
            codeExample: '// Please refer to WCAG guidelines',
            steps: ['Review WCAG guidelines for this violation type']
        };
    }
}

// PRESERVED: Generate fix code function - EXACT COPY FROM YOUR WORKING VERSION
async function generateFixCode(violation, platformInfo = null) {
    console.log(`🔧 Generating fix code for violation: ${violation.id}`);
    
    // Get AI suggestion first
    const aiSuggestion = await generateAISuggestion(violation, platformInfo);
    
    // Platform-specific fix generation
    let fixCode = '';
    let instructions = [];
    
    const platform = platformInfo?.type || 'custom';
    
    switch (violation.id) {
        case 'image-alt':
            if (platform === 'wordpress') {
                fixCode = `
// WordPress: Add alt text to images
function add_missing_alt_text() {
    ?>
    <script>
    document.addEventListener('DOMContentLoaded', function() {
        const images = document.querySelectorAll('img:not([alt])');
        images.forEach(img => {
            img.alt = 'Descriptive text for ' + (img.src.split('/').pop() || 'image');
        });
    });
    </script>
    <?php
}
add_action('wp_footer', 'add_missing_alt_text');`;
                instructions = [
                    'Add this code to your theme\'s functions.php file',
                    'Or create a custom plugin with this code',
                    'Test that all images now have alt attributes'
                ];
            } else if (platform === 'shopify') {
                fixCode = `
<!-- Shopify: Add to theme.liquid before </head> -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    const images = document.querySelectorAll('img:not([alt])');
    images.forEach(img => {
        img.alt = 'Product image';
    });
});
</script>`;
                instructions = [
                    'Go to Online Store > Themes > Actions > Edit code',
                    'Open theme.liquid file',
                    'Add the script before the closing </head> tag',
                    'Save and preview your store'
                ];
            } else {
                fixCode = `
<!-- Add alt attributes to all images -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    const images = document.querySelectorAll('img:not([alt])');
    images.forEach(img => {
        img.alt = 'Descriptive text for this image';
    });
});
</script>`;
                instructions = [
                    'Add this script to your HTML head section',
                    'Or include it in your main JavaScript file',
                    'Manually add alt attributes to each image for better descriptions'
                ];
            }
            break;
            
        case 'button-name':
            fixCode = `
<!-- Add accessible labels to buttons -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    const buttons = document.querySelectorAll('button:not([aria-label]):not([aria-labelledby])');
    buttons.forEach(button => {
        if (!button.textContent.trim()) {
            button.setAttribute('aria-label', 'Button');
        }
    });
});
</script>`;
            instructions = [
                'Add aria-label attributes to buttons without text',
                'Use descriptive labels that explain the button\'s purpose',
                'Test with screen readers to ensure clarity'
            ];
            break;
            
        case 'label':
            fixCode = `
<!-- Associate form labels with inputs -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    const inputs = document.querySelectorAll('input:not([aria-label]):not([aria-labelledby])');
    inputs.forEach((input, index) => {
        if (!input.labels || input.labels.length === 0) {
            const label = document.createElement('label');
            label.textContent = 'Input field';
            label.setAttribute('for', input.id || 'input-' + index);
            if (!input.id) input.id = 'input-' + index;
            input.parentNode.insertBefore(label, input);
        }
    });
});
</script>`;
            instructions = [
                'Ensure every form input has an associated label',
                'Use the "for" attribute to connect labels to inputs',
                'Add aria-label for inputs that can\'t have visible labels'
            ];
            break;
            
        case 'link-name':
            fixCode = `
<!-- Add descriptive text to links -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    const links = document.querySelectorAll('a:not([aria-label])');
    links.forEach(link => {
        if (!link.textContent.trim()) {
            link.setAttribute('aria-label', 'Link to ' + (link.href || 'page'));
        }
    });
});
</script>`;
            instructions = [
                'Ensure all links have descriptive text or aria-label',
                'Avoid generic text like "click here" or "read more"',
                'Make link purpose clear from the text alone'
            ];
            break;
            
        case 'color-contrast':
            fixCode = `
/* Improve color contrast */
.low-contrast-text {
    color: #333333 !important; /* Dark text */
    background-color: #ffffff !important; /* Light background */
}

/* Apply to common elements */
p, span, div, a {
    color: #333333;
}

/* Ensure links are visible */
a {
    color: #0066cc;
    text-decoration: underline;
}

a:hover, a:focus {
    color: #004499;
    background-color: #f0f8ff;
}`;
            instructions = [
                'Use colors with at least 4.5:1 contrast ratio for normal text',
                'Use at least 3:1 contrast ratio for large text (18pt+)',
                'Test colors with a contrast checker tool',
                'Ensure interactive elements are clearly visible'
            ];
            break;
            
        case 'heading-order':
            fixCode = `
<!-- Fix heading hierarchy -->
<script>
document.addEventListener('DOMContentLoaded', function() {
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let currentLevel = 0;
    
    headings.forEach(heading => {
        const level = parseInt(heading.tagName.charAt(1));
        if (level > currentLevel + 1) {
            console.warn('Heading level jump detected:', heading);
            // Optionally fix automatically
            const newTag = 'h' + (currentLevel + 1);
            const newHeading = document.createElement(newTag);
            newHeading.innerHTML = heading.innerHTML;
            newHeading.className = heading.className;
            heading.parentNode.replaceChild(newHeading, heading);
        }
        currentLevel = level;
    });
});
</script>`;
            instructions = [
                'Ensure headings follow logical order (h1, h2, h3, etc.)',
                'Don\'t skip heading levels',
                'Use only one h1 per page',
                'Structure content hierarchically'
            ];
            break;
            
        default:
            fixCode = `
<!-- Generic accessibility fix -->
<script>
// Add basic accessibility improvements
document.addEventListener('DOMContentLoaded', function() {
    // Add focus indicators
    const style = document.createElement('style');
    style.textContent = \`
        *:focus {
            outline: 2px solid #0066cc !important;
            outline-offset: 2px !important;
        }
    \`;
    document.head.appendChild(style);
});
</script>`;
            instructions = [
                'Review WCAG guidelines for this specific issue',
                'Test with accessibility tools',
                'Verify fix with screen readers',
                'Document the solution for future reference'
            ];
    }
    
    return {
        success: true,
        violation: violation,
        fixCode: fixCode,
        instructions: instructions,
        aiSuggestion: aiSuggestion,
        platform: platform,
        timestamp: new Date().toISOString()
    };
}

// PRESERVED: All your existing API endpoints - EXACT COPIES

// Main scanning endpoint - PRESERVED EXACTLY
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single', pages = 1 } = req.body;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL is required' 
        });
    }
    
    const startTime = Date.now();
    let browser = null;
    
    try {
        console.log(`🔍 Starting ${scanType} scan for: ${url}`);
        
        // Launch browser with optimized settings
        browser = await puppeteer.launch({
            headless: 'new',
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
        
        // Set viewport and user agent
        await page.setViewport({ width: 1200, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        let allViolations = [];
        let scannedPages = [];
        let platformInfo = null;
        
        if (scanType === 'single') {
            // Single page scan
            console.log(`📄 Scanning single page: ${url}`);
            
            await page.goto(url, { 
                waitUntil: 'networkidle0',
                timeout: 30000 
            });
            
            // Detect platform
            platformInfo = await detectPlatform(page, url);
            console.log(`🔍 Platform detected:`, platformInfo);
            
            // Inject axe-core and run accessibility scan
            await page.addScriptTag({ content: axeCore.source });
            
            const results = await page.evaluate(async () => {
                return await axe.run();
            });
            
            // Process violations with enhanced details
            const violations = results.violations.map(violation => ({
                ...violation,
                url: url,
                timestamp: new Date().toISOString(),
                // PHASE 2F: Add business impact analysis
                businessImpact: analyzeBusinessImpact(violation),
                // Add element context for better fixing
                elementContext: violation.nodes.map(node => ({
                    selector: node.target[0],
                    html: node.html,
                    impact: node.impact,
                    failureSummary: node.failureSummary
                }))
            }));
            
            allViolations = violations;
            scannedPages = [{ url, violations: violations.length }];
            
        } else if (scanType === 'crawl') {
            // Multi-page crawl
            console.log(`🕷️ Starting crawl scan for: ${url} (${pages} pages)`);
            
            const urlsToCrawl = await discoverUrls(page, url, pages);
            console.log(`📋 Found ${urlsToCrawl.length} URLs to scan`);
            
            for (const crawlUrl of urlsToCrawl) {
                try {
                    console.log(`📄 Scanning: ${crawlUrl}`);
                    
                    await page.goto(crawlUrl, { 
                        waitUntil: 'networkidle0',
                        timeout: 30000 
                    });
                    
                    // Detect platform on first page
                    if (!platformInfo) {
                        platformInfo = await detectPlatform(page, crawlUrl);
                        console.log(`🔍 Platform detected:`, platformInfo);
                    }
                    
                    // Inject axe-core and run scan
                    await page.addScriptTag({ content: axeCore.source });
                    
                    const results = await page.evaluate(async () => {
                        return await axe.run();
                    });
                    
                    const violations = results.violations.map(violation => ({
                        ...violation,
                        url: crawlUrl,
                        timestamp: new Date().toISOString(),
                        businessImpact: analyzeBusinessImpact(violation),
                        elementContext: violation.nodes.map(node => ({
                            selector: node.target[0],
                            html: node.html,
                            impact: node.impact,
                            failureSummary: node.failureSummary
                        }))
                    }));
                    
                    allViolations.push(...violations);
                    scannedPages.push({ url: crawlUrl, violations: violations.length });
                    
                } catch (pageError) {
                    console.log(`❌ Error scanning ${crawlUrl}:`, pageError.message);
                    scannedPages.push({ url: crawlUrl, violations: 0, error: pageError.message });
                }
            }
        }
        
        const scanTime = Date.now() - startTime;
        
        // Calculate summary statistics
        const summary = {
            critical: allViolations.filter(v => v.impact === 'critical').length,
            serious: allViolations.filter(v => v.impact === 'serious').length,
            moderate: allViolations.filter(v => v.impact === 'moderate').length,
            minor: allViolations.filter(v => v.impact === 'minor').length
        };
        
        // PHASE 2F: Generate website context for enhanced fixing
        const websiteContext = await generateWebsiteContext(page, url, platformInfo);
        
        // Save scan to database if available
        const scanId = await saveScan(
            1, // userId - default for now
            1, // organizationId - default for now
            url,
            scanType,
            allViolations.length,
            scanTime,
            scannedPages.length,
            allViolations
        );
        
        console.log(`✅ Scan completed in ${scanTime}ms. Found ${allViolations.length} violations.`);
        
        res.json({
            success: true,
            scanId: scanId,
            url: url,
            scanType: scanType,
            violations: allViolations,
            summary: summary,
            scanTime: scanTime,
            pagesScanned: scannedPages.length,
            pages: scannedPages,
            platformInfo: platformInfo,
            websiteContext: websiteContext // PHASE 2F: Include website context
        });
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            scanTime: Date.now() - startTime
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// PHASE 2F: Business Impact Analysis Function
function analyzeBusinessImpact(violation) {
    const impactMapping = {
        'image-alt': { level: 'high', category: 'SEO & Compliance', description: 'Missing alt text affects SEO rankings and legal compliance' },
        'color-contrast': { level: 'critical', category: 'User Experience', description: 'Poor contrast makes content unreadable for many users' },
        'button-name': { level: 'high', category: 'Conversion', description: 'Unlabeled buttons reduce conversion rates and usability' },
        'link-name': { level: 'medium', category: 'Navigation', description: 'Unclear links hurt user navigation and SEO' },
        'label': { level: 'high', category: 'Form Completion', description: 'Missing form labels reduce form completion rates' },
        'heading-order': { level: 'medium', category: 'Content Structure', description: 'Poor heading structure affects SEO and navigation' },
        'landmark-one-main': { level: 'medium', category: 'Navigation', description: 'Missing landmarks make navigation difficult for assistive technology users' },
        'region': { level: 'low', category: 'Structure', description: 'Missing regions affect content organization for screen readers' }
    };
    
    return impactMapping[violation.id] || { 
        level: 'medium', 
        category: 'Accessibility', 
        description: 'This issue affects website accessibility and user experience' 
    };
}

// PHASE 2F: Website Context Generation Function
async function generateWebsiteContext(page, url, platformInfo) {
    try {
        const context = await page.evaluate(() => {
            return {
                title: document.title,
                description: document.querySelector('meta[name="description"]')?.content || '',
                language: document.documentElement.lang || 'en',
                viewport: document.querySelector('meta[name="viewport"]')?.content || '',
                charset: document.characterSet || 'UTF-8',
                headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
                    level: h.tagName.toLowerCase(),
                    text: h.textContent.trim().substring(0, 100)
                })),
                forms: Array.from(document.forms).length,
                images: Array.from(document.images).length,
                links: Array.from(document.links).length,
                buttons: Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]')).length
            };
        });
        
        return {
            ...context,
            url: url,
            platform: platformInfo,
            scanTimestamp: new Date().toISOString()
        };
    } catch (error) {
        console.log('Error generating website context:', error.message);
        return {
            url: url,
            platform: platformInfo,
            scanTimestamp: new Date().toISOString()
        };
    }
}

// Helper function: Discover URLs for crawling
async function discoverUrls(page, baseUrl, maxPages) {
    try {
        await page.goto(baseUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        
        const urls = await page.evaluate((baseUrl, maxPages) => {
            const links = Array.from(document.querySelectorAll('a[href]'));
            const baseHost = new URL(baseUrl).host;
            
            const discoveredUrls = new Set([baseUrl]);
            
            links.forEach(link => {
                try {
                    const href = link.href;
                    const url = new URL(href);
                    
                    // Only include same-domain URLs
                    if (url.host === baseHost && 
                        !href.includes('#') && 
                        !href.includes('mailto:') && 
                        !href.includes('tel:') &&
                        !href.includes('.pdf') &&
                        !href.includes('.jpg') &&
                        !href.includes('.png')) {
                        discoveredUrls.add(href);
                    }
                } catch (e) {
                    // Invalid URL, skip
                }
            });
            
            return Array.from(discoveredUrls).slice(0, maxPages);
        }, baseUrl, maxPages);
        
        return urls;
    } catch (error) {
        console.log('Error discovering URLs:', error.message);
        return [baseUrl];
    }
}

// Helper function: Detect platform
async function detectPlatform(page, url) {
    try {
        const platformInfo = await page.evaluate(() => {
            const indicators = {
                wordpress: [
                    () => window.wp !== undefined,
                    () => document.querySelector('meta[name="generator"][content*="WordPress"]') !== null,
                    () => document.querySelector('link[href*="wp-content"]') !== null,
                    () => document.querySelector('script[src*="wp-includes"]') !== null,
                    () => document.body.className.includes('wordpress')
                ],
                shopify: [
                    () => window.Shopify !== undefined,
                    () => document.querySelector('meta[name="generator"][content*="Shopify"]') !== null,
                    () => document.querySelector('script[src*="shopify"]') !== null,
                    () => document.querySelector('link[href*="shopify"]') !== null,
                    () => window.ShopifyAnalytics !== undefined
                ],
                wix: [
                    () => document.querySelector('meta[name="generator"][content*="Wix"]') !== null,
                    () => document.querySelector('script[src*="wix.com"]') !== null,
                    () => window._wixCIDX !== undefined
                ],
                squarespace: [
                    () => document.querySelector('meta[name="generator"][content*="Squarespace"]') !== null,
                    () => document.querySelector('script[src*="squarespace"]') !== null,
                    () => window.Static !== undefined && window.Static.SQUARESPACE_CONTEXT !== undefined
                ]
            };
            
            for (const [platform, checks] of Object.entries(indicators)) {
                const matches = checks.filter(check => {
                    try {
                        return check();
                    } catch (e) {
                        return false;
                    }
                }).length;
                
                if (matches > 0) {
                    return {
                        name: platform.charAt(0).toUpperCase() + platform.slice(1),
                        type: platform,
                        confidence: matches / checks.length,
                        capabilities: getPlatformCapabilities(platform)
                    };
                }
            }
            
            return {
                name: 'Custom/Unknown',
                type: 'custom',
                confidence: 1.0,
                capabilities: {
                    cssInjection: true,
                    jsInjection: true,
                    htmlModification: false,
                    themeEditor: false
                }
            };
            
            function getPlatformCapabilities(platform) {
                const capabilities = {
                    wordpress: {
                        cssInjection: true,
                        jsInjection: true,
                        htmlModification: true,
                        themeEditor: true,
                        pluginSupport: true
                    },
                    shopify: {
                        cssInjection: true,
                        jsInjection: true,
                        htmlModification: true,
                        themeEditor: true,
                        liquidTemplates: true
                    },
                    wix: {
                        cssInjection: false,
                        jsInjection: false,
                        htmlModification: false,
                        themeEditor: false,
                        limitedCustomization: true
                    },
                    squarespace: {
                        cssInjection: true,
                        jsInjection: true,
                        htmlModification: false,
                        themeEditor: true,
                        codeInjection: true
                    }
                };
                
                return capabilities[platform] || {
                    cssInjection: true,
                    jsInjection: true,
                    htmlModification: false,
                    themeEditor: false
                };
            }
        });
        
        return platformInfo;
    } catch (error) {
        console.log('Error detecting platform:', error.message);
        return {
            name: 'Unknown',
            type: 'custom',
            confidence: 0,
            capabilities: {
                cssInjection: true,
                jsInjection: true,
                htmlModification: false,
                themeEditor: false
            }
        };
    }
}

// AI Fixes endpoint - PRESERVED EXACTLY
app.post('/api/ai-fixes', async (req, res) => {
    const { violations, platformInfo } = req.body;
    
    if (!violations || !Array.isArray(violations)) {
        return res.status(400).json({ error: 'Violations array is required' });
    }
    
    try {
        console.log(`🤖 Generating AI fixes for ${violations.length} violations`);
        
        const suggestions = await Promise.all(
            violations.map(violation => generateAISuggestion(violation, platformInfo))
        );
        
        console.log(`✅ Generated ${suggestions.length} AI suggestions`);
        res.json(suggestions);
        
    } catch (error) {
        console.error('❌ Error generating AI fixes:', error);
        res.status(500).json({ error: 'Failed to generate AI suggestions' });
    }
});

// Implement fix endpoint - PRESERVED EXACTLY
app.post('/api/implement-fix', async (req, res) => {
    const { violationId, fixType, platformInfo } = req.body;
    
    if (!violationId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Violation ID is required' 
        });
    }
    
    try {
        console.log(`🔧 Implementing fix for violation: ${violationId}`);
        
        // Create a mock violation object for fix generation
        const violation = {
            id: violationId,
            description: `Fix for ${violationId}`,
            impact: 'moderate'
        };
        
        const fixResult = await generateFixCode(violation, platformInfo);
        
        console.log(`✅ Fix generated for ${violationId}`);
        res.json(fixResult);
        
    } catch (error) {
        console.error('❌ Error implementing fix:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ENHANCEMENT: New deployment-ready endpoints
if (ENABLE_DEPLOYMENT_FEATURES === 'true' && domParsingEngine) {
    
    // Enhanced website analysis with deployment readiness
    app.post('/api/analyze-website', async (req, res) => {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'URL is required' 
            });
        }
        
        try {
            console.log('🔍 Enhanced website analysis for:', url);
            
            const analysis = await domParsingEngine.performComprehensiveCrawl(url);
            
            res.json({
                success: true,
                scanId: `scan_${Date.now()}`,
                url: url,
                analysis: analysis,
                violations: analysis.violations || [],
                deploymentReadiness: analysis.deploymentReadiness,
                platformInfo: analysis.platform,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Enhanced analysis error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Generate deployment patches
    app.post('/api/generate-deployment-patches', async (req, res) => {
        const { violations, platformInfo, deploymentConfig } = req.body;
        
        try {
            console.log('🔧 Generating deployment patches...');
            
            const patches = await patchGenerationEngine.generateDeploymentPatches(
                violations, 
                platformInfo, 
                deploymentConfig
            );
            
            res.json({
                success: true,
                patches: patches,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Patch generation error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Deploy patches
    app.post('/api/deploy-patches', async (req, res) => {
        const { patchId, deploymentConfig } = req.body;
        
        try {
            console.log('🚀 Deploying patches...');
            
            const deployment = await deploymentEngine.deployPatches(patchId, deploymentConfig);
            
            res.json({
                success: true,
                deployment: deployment,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Deployment error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
    
    // Rollback deployment
    app.post('/api/rollback-deployment', async (req, res) => {
        const { deploymentId, reason } = req.body;
        
        try {
            console.log('🔄 Rolling back deployment...');
            
            const rollback = await safetyEngine.rollbackDeployment(deploymentId, reason);
            
            res.json({
                success: true,
                rollback: rollback,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Rollback error:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    });
}

// PRESERVED: All your existing endpoints continue below...

// Visual preview endpoint - PRESERVED EXACTLY
app.post('/api/visual-preview', async (req, res) => {
    const { url, violationSelector } = req.body;
    
    if (!url || !violationSelector) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL and violation selector are required' 
        });
    }
    
    let browser = null;
    
    try {
        console.log(`📸 Generating visual preview for: ${url}`);
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        // Highlight the violation element
        await page.evaluate((selector) => {
            try {
                const element = document.querySelector(selector);
                if (element) {
                    element.style.outline = '3px solid #ff0000';
                    element.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            } catch (e) {
                console.log('Could not highlight element:', e.message);
            }
        }, violationSelector);
        
        // Wait a moment for scroll animation
        await page.waitForTimeout(1000);
        
        const screenshot = await page.screenshot({ 
            type: 'png',
            fullPage: false,
            encoding: 'base64'
        });
        
        console.log(`✅ Visual preview generated for ${violationSelector}`);
        
        res.json({
            success: true,
            image: `data:image/png;base64,${screenshot}`,
            selector: violationSelector,
            url: url
        });
        
    } catch (error) {
        console.error('❌ Visual preview error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Color simulation endpoint - PRESERVED EXACTLY
app.post('/api/color-simulation', async (req, res) => {
    const { url, simulationType } = req.body;
    
    if (!url || !simulationType) {
        return res.status(400).json({ 
            success: false, 
            error: 'URL and simulation type are required' 
        });
    }
    
    let browser = null;
    
    try {
        console.log(`🎨 Generating color simulation: ${simulationType} for ${url}`);
        
        browser = await puppeteer.launch({
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1200, height: 800 });
        
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        // Apply color vision simulation
        await page.evaluate((type) => {
            const filters = {
                protanopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><filter id=\\"protanopia\\"><feColorMatrix values=\\"0.567,0.433,0,0,0 0.558,0.442,0,0,0 0,0.242,0.758,0,0 0,0,0,1,0\\"/></filter></svg>#protanopia")',
                deuteranopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><filter id=\\"deuteranopia\\"><feColorMatrix values=\\"0.625,0.375,0,0,0 0.7,0.3,0,0,0 0,0.3,0.7,0,0 0,0,0,1,0\\"/></filter></svg>#deuteranopia")',
                tritanopia: 'url("data:image/svg+xml;charset=utf-8,<svg xmlns=\\"http://www.w3.org/2000/svg\\"><filter id=\\"tritanopia\\"><feColorMatrix values=\\"0.95,0.05,0,0,0 0,0.433,0.567,0,0 0,0.475,0.525,0,0 0,0,0,1,0\\"/></filter></svg>#tritanopia")',
                monochrome: 'grayscale(100%)',
                lowcontrast: 'contrast(50%) brightness(150%)'
            };
            
            document.documentElement.style.filter = filters[type] || '';
        }, simulationType);
        
        // Wait for filter to apply
        await page.waitForTimeout(500);
        
        const screenshot = await page.screenshot({ 
            type: 'png',
            fullPage: false,
            encoding: 'base64'
        });
        
        console.log(`✅ Color simulation generated: ${simulationType}`);
        
        res.json({
            success: true,
            image: `data:image/png;base64,${screenshot}`,
            simulationType: simulationType,
            url: url
        });
        
    } catch (error) {
        console.error('❌ Color simulation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// PRESERVED: All remaining endpoints from your working version...

// Detailed report endpoint - PRESERVED EXACTLY
app.post('/api/detailed-report', async (req, res) => {
    const { violations, websiteContext, platformInfo } = req.body;
    
    if (!violations || !Array.isArray(violations)) {
        return res.status(400).send('Invalid violations data');
    }
    
    try {
        console.log(`📄 Generating detailed report for ${violations.length} violations`);
        
        // Generate comprehensive HTML report
        const reportHtml = generateDetailedReportHtml(violations, websiteContext, platformInfo);
        
        res.setHeader('Content-Type', 'text/html');
        res.send(reportHtml);
        
    } catch (error) {
        console.error('❌ Report generation error:', error);
        res.status(500).send('Failed to generate report');
    }
});

function generateDetailedReportHtml(violations, websiteContext, platformInfo) {
    const summary = {
        critical: violations.filter(v => v.impact === 'critical').length,
        serious: violations.filter(v => v.impact === 'serious').length,
        moderate: violations.filter(v => v.impact === 'moderate').length,
        minor: violations.filter(v => v.impact === 'minor').length
    };
    
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Accessibility Scan Report - ${websiteContext?.url || 'Website'}</title>
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0; 
            padding: 20px; 
            background: #f8f9fa; 
            color: #333;
            line-height: 1.6;
        }
        .report-container {
            max-width: 1200px;
            margin: 0 auto;
        }
        .report-header {
            background: white;
            padding: 40px;
            border-radius: 12px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            text-align: center;
        }
        .report-title {
            font-size: 2.5rem;
            font-weight: 700;
            color: #333;
            margin-bottom: 15px;
        }
        .report-meta {
            color: #666;
            font-size: 1.1rem;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        .summary-card {
            background: white;
            padding: 25px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .summary-value {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 10px;
        }
        .summary-label {
            color: #666;
            font-size: 0.9rem;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .critical { color: #dc3545; }
        .serious { color: #fd7e14; }
        .moderate { color: #ffc107; }
        .minor { color: #28a745; }
        
        .violations-section {
            background: white;
            border-radius: 12px;
            padding: 30px;
            margin-bottom: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .section-title {
            font-size: 1.8rem;
            font-weight: 600;
            margin-bottom: 25px;
            color: #333;
        }
        .violation {
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
        }
        .violation-header {
            background: #f8f9fa;
            padding: 20px;
            border-bottom: 1px solid #e1e5e9;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .violation-title {
            font-weight: 600;
            color: #333;
            font-size: 1.1rem;
        }
        .violation-impact {
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 600;
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
            padding: 20px;
        }
        .violation-description {
            margin-bottom: 15px;
            color: #666;
            font-size: 1rem;
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
        .nodes-list {
            margin-top: 15px;
        }
        .node-item {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            margin-bottom: 10px;
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
        }
        .platform-info {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 12px;
            margin-bottom: 30px;
        }
        .platform-title {
            font-size: 1.3rem;
            font-weight: 600;
            margin-bottom: 15px;
        }
        .platform-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }
        .platform-detail {
            background: rgba(255,255,255,0.1);
            padding: 15px;
            border-radius: 6px;
        }
        .print-button {
            background: #667eea;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 1rem;
            cursor: pointer;
            margin: 20px 0;
        }
        .print-button:hover {
            background: #5a6fd8;
        }
        @media print {
            .print-button { display: none; }
            body { background: white; }
            .report-container { max-width: none; }
        }
    </style>
</head>
<body>
    <div class="report-container">
        <div class="report-header">
            <h1 class="report-title">🛡️ Accessibility Scan Report</h1>
            <div class="report-meta">
                <strong>Website:</strong> ${websiteContext?.url || 'N/A'}<br>
                <strong>Scan Date:</strong> ${new Date().toLocaleDateString()}<br>
                <strong>Total Issues:</strong> ${violations.length}
            </div>
            <button class="print-button" onclick="window.print()">🖨️ Print Report</button>
        </div>
        
        ${platformInfo ? `
        <div class="platform-info">
            <div class="platform-title">🔍 Platform Information</div>
            <div class="platform-details">
                <div class="platform-detail">
                    <strong>Platform:</strong> ${platformInfo.name || 'Unknown'}
                </div>
                <div class="platform-detail">
                    <strong>Type:</strong> ${platformInfo.type || 'custom'}
                </div>
                <div class="platform-detail">
                    <strong>Confidence:</strong> ${Math.round((platformInfo.confidence || 0) * 100)}%
                </div>
            </div>
        </div>
        ` : ''}
        
        <div class="violations-section">
            <h2 class="section-title">📊 Summary</h2>
            <div class="summary-grid">
                <div class="summary-card">
                    <div class="summary-value critical">${summary.critical}</div>
                    <div class="summary-label">Critical</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value serious">${summary.serious}</div>
                    <div class="summary-label">Serious</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value moderate">${summary.moderate}</div>
                    <div class="summary-label">Moderate</div>
                </div>
                <div class="summary-card">
                    <div class="summary-value minor">${summary.minor}</div>
                    <div class="summary-label">Minor</div>
                </div>
            </div>
        </div>
        
        <div class="violations-section">
            <h2 class="section-title">🔍 Detailed Violations</h2>
            ${violations.map(violation => `
                <div class="violation">
                    <div class="violation-header">
                        <div class="violation-title">${violation.id}</div>
                        <div class="violation-impact impact-${violation.impact}">${violation.impact}</div>
                    </div>
                    <div class="violation-body">
                        <div class="violation-description">
                            <strong>Description:</strong> ${violation.description || 'No description available'}
                        </div>
                        ${violation.help ? `
                        <div class="violation-help">
                            <strong>How to fix:</strong> ${violation.help}
                            ${violation.helpUrl ? `<br><a href="${violation.helpUrl}" target="_blank">Learn more →</a>` : ''}
                        </div>
                        ` : ''}
                        ${violation.nodes && violation.nodes.length > 0 ? `
                        <div class="nodes-list">
                            <strong>Affected Elements:</strong>
                            ${violation.nodes.slice(0, 3).map(node => `
                                <div class="node-item">
                                    <strong>Element:</strong> ${node.target ? node.target[0] : 'Unknown'}<br>
                                    ${node.html ? `<strong>HTML:</strong> ${node.html.substring(0, 200)}${node.html.length > 200 ? '...' : ''}` : ''}
                                </div>
                            `).join('')}
                            ${violation.nodes.length > 3 ? `<div style="color: #666; font-style: italic; margin-top: 10px;">... and ${violation.nodes.length - 3} more elements</div>` : ''}
                        </div>
                        ` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="violations-section">
            <h2 class="section-title">📋 Recommendations</h2>
            <p>This report identifies accessibility issues that should be addressed to improve user experience and ensure compliance with WCAG guidelines.</p>
            <ul>
                <li><strong>Critical and Serious issues</strong> should be addressed immediately as they significantly impact user experience.</li>
                <li><strong>Moderate issues</strong> should be planned for the next development cycle.</li>
                <li><strong>Minor issues</strong> can be addressed as time permits but still improve overall accessibility.</li>
            </ul>
            <p>For assistance with implementing fixes, consider consulting with accessibility experts or using automated fixing tools.</p>
        </div>
    </div>
</body>
</html>
    `;
}

// PRESERVED: Bulk download fixes endpoint
app.post('/api/bulk-download-fixes', async (req, res) => {
    const { violations, platformInfo } = req.body;
    
    if (!violations || !Array.isArray(violations)) {
        return res.status(400).json({ error: 'Violations array is required' });
    }
    
    try {
        console.log(`📦 Generating bulk fixes download for ${violations.length} violations`);
        
        const JSZip = require('jszip');
        const zip = new JSZip();
        
        // Generate fixes for each violation
        for (let i = 0; i < violations.length; i++) {
            const violation = violations[i];
            const fixResult = await generateFixCode(violation, platformInfo);
            
            if (fixResult.success) {
                const folderName = `fix-${i + 1}-${violation.id}`;
                const folder = zip.folder(folderName);
                
                // Add fix code file
                folder.file('fix-code.txt', fixResult.fixCode);
                
                // Add instructions file
                folder.file('instructions.md', `# Fix Instructions for ${violation.id}\n\n${fixResult.instructions.map(inst => `- ${inst}`).join('\n')}`);
                
                // Add AI suggestion if available
                if (fixResult.aiSuggestion) {
                    folder.file('ai-suggestion.md', `# AI Suggestion\n\n**Priority:** ${fixResult.aiSuggestion.priority}\n\n**Explanation:** ${fixResult.aiSuggestion.explanation}\n\n**Code Example:**\n\`\`\`\n${fixResult.aiSuggestion.codeExample}\n\`\`\`\n\n**Steps:**\n${fixResult.aiSuggestion.steps.map(step => `- ${step}`).join('\n')}`);
                }
            }
        }
        
        // Add summary file
        const summary = `# Accessibility Fixes Summary\n\nGenerated: ${new Date().toISOString()}\nTotal Violations: ${violations.length}\nPlatform: ${platformInfo?.name || 'Unknown'}\n\n## Violations Fixed:\n${violations.map((v, i) => `${i + 1}. ${v.id} (${v.impact})`).join('\n')}`;
        zip.file('README.md', summary);
        
        const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
        
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="accessibility-fixes-${new Date().toISOString().split('T')[0]}.zip"`);
        res.send(zipBuffer);
        
        console.log(`✅ Bulk fixes download generated successfully`);
        
    } catch (error) {
        console.error('❌ Bulk download error:', error);
        res.status(500).json({ error: 'Failed to generate bulk download' });
    }
});

// PRESERVED: Analytics endpoint
app.get('/api/analytics', async (req, res) => {
    try {
        const analytics = await getAnalytics();
        res.json({
            success: true,
            analytics: analytics
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics'
        });
    }
});

// PRESERVED: Recent scans endpoint
app.get('/api/scans', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const userId = parseInt(req.query.userId) || 1;
        
        const scans = await getRecentScans(userId, limit);
        
        res.json({
            success: true,
            scans: scans
        });
    } catch (error) {
        console.error('Scans fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch scans'
        });
    }
});

// PRESERVED: Serve static files and default route
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/guided-fixing.html');
});

// PRESERVED: Your complete embedded frontend code
app.get('/guided-fixing', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🛡️ SentryPrime Enterprise Dashboard</title>
    <style>
        /* PRESERVED: All your existing CSS styles - EXACT COPY */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #f5f7fa;
            color: #333;
            overflow-x: hidden;
        }
        
        /* Layout */
        .dashboard-container {
            display: flex;
            min-height: 100vh;
        }
        
        /* Sidebar */
        .sidebar {
            width: 260px;
            background: #2c3e50;
            color: white;
            display: flex;
            flex-direction: column;
            position: fixed;
            height: 100vh;
            left: 0;
            top: 0;
            z-index: 1000;
        }
        
        .sidebar-header {
            padding: 20px;
            border-bottom: 1px solid #34495e;
        }
        
        .sidebar-header h2 {
            font-size: 1.3rem;
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
            margin-left: 260px;
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
            color: #333;
        }
        
        .summary-label {
            font-size: 0.8rem;
            color: #666;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        /* Modal Styles */
        .modal {
            display: none;
            position: fixed;
            z-index: 2000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.8);
        }
        
        .modal-content {
            background-color: white;
            margin: 5% auto;
            padding: 30px;
            border-radius: 12px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
            position: relative;
        }
        
        .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            position: absolute;
            right: 20px;
            top: 15px;
            cursor: pointer;
        }
        
        .close:hover,
        .close:focus {
            color: #000;
            text-decoration: none;
        }
        
        .ai-suggestion {
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            margin-bottom: 20px;
            overflow: hidden;
        }
        
        .ai-suggestion-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .ai-suggestion-content {
            padding: 20px;
        }
        
        .ai-suggestion-content pre {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 10px 0;
        }
        
        .ai-suggestion-content code {
            font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
            font-size: 0.9rem;
        }
        
        .priority-badge {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.8rem;
            font-weight: 600;
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
        
        /* Responsive Design */
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
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .actions-grid {
                grid-template-columns: 1fr;
            }
            
            .search-bar {
                width: 200px;
            }
        }
        
        /* Additional styles for enhanced features */
        .view-report-btn, .guided-fixing-btn {
            transition: all 0.2s ease;
        }
        
        .view-report-btn:hover, .guided-fixing-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        
        .business-impact-summary {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
        }
        
        .business-impact-title {
            margin: 0 0 15px 0;
            color: #856404;
            display: flex;
            align-items: center;
        }
        
        .business-impact-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
        }
        
        .business-impact-item {
            text-align: center;
            padding: 10px;
            background: rgba(255,255,255,0.7);
            border-radius: 6px;
        }
        
        .bulk-operations {
            margin-top: 30px;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 12px;
            color: white;
        }
        
        .bulk-operations h3 {
            margin: 0 0 15px 0;
            text-align: center;
        }
        
        .bulk-operations button {
            background: #28a745;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 6px;
            margin: 5px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.2s ease;
        }
        
        .bulk-operations button:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        }
        
        .bulk-operations button.critical {
            background: #dc3545;
        }
        
        .bulk-operations button.download {
            background: #17a2b8;
        }
        
        .bulk-operations button.preview {
            background: #fd7e14;
        }
    </style>
</head>
<body>
    <div class="dashboard-container">
        <!-- Sidebar -->
        <div class="sidebar">
            <div class="sidebar-header">
                <h2>🛡️ SentryPrime</h2>
                <p>Enterprise Dashboard</p>
            </div>
            <nav class="sidebar-nav">
                <a href="#" class="nav-item active" onclick="showPage('dashboard')">
                    <span class="nav-icon">📊</span>
                    Dashboard
                </a>
                <a href="#" class="nav-item" onclick="showPage('scanner')">
                    <span class="nav-icon">🔍</span>
                    Accessibility Scanner
                </a>
                <a href="#" class="nav-item" onclick="showPage('history')">
                    <span class="nav-icon">📋</span>
                    Scan History
                </a>
                <a href="#" class="nav-item" onclick="showPage('platforms')">
                    <span class="nav-icon">🔗</span>
                    Platform Integrations
                </a>
                <a href="#" class="nav-item" onclick="showPage('reports')">
                    <span class="nav-icon">📄</span>
                    Reports & Analytics
                </a>
                <a href="#" class="nav-item" onclick="showPage('settings')">
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
                        <input type="text" placeholder="Search scans, reports...">
                    </div>
                </div>
                <div class="header-right">
                    <div class="user-profile">
                        <div class="user-avatar">SP</div>
                        <span>SentryPrime User</span>
                    </div>
                </div>
            </div>

            <!-- Content Area -->
            <div class="content-area">
                <!-- Dashboard Page -->
                <div id="dashboard" class="page active">
                    <div class="dashboard-header">
                        <h1>Welcome to SentryPrime Enterprise</h1>
                        <p>Professional accessibility scanning and compliance management</p>
                    </div>

                    <!-- Stats Grid -->
                    <div class="stats-grid" id="stats-grid">
                        <!-- Stats will be loaded dynamically -->
                    </div>

                    <!-- Quick Actions -->
                    <div class="actions-grid">
                        <div class="action-card primary" onclick="showPage('scanner')">
                            <div class="action-icon">🚀</div>
                            <div class="action-title">Quick Scan</div>
                            <div class="action-description">Start scanning a website immediately</div>
                        </div>
                        <div class="action-card secondary" onclick="showPage('history')">
                            <div class="action-icon">📊</div>
                            <div class="action-title">View Reports</div>
                            <div class="action-description">Access detailed accessibility reports</div>
                        </div>
                        <div class="action-card success" onclick="showPage('platforms')">
                            <div class="action-icon">🔗</div>
                            <div class="action-title">Connect Platform</div>
                            <div class="action-description">Integrate with WordPress, Shopify, etc.</div>
                        </div>
                    </div>
                </div>

                <!-- Scanner Page -->
                <div id="scanner" class="page">
                    <div class="dashboard-header">
                        <h1>Accessibility Scanner</h1>
                        <p>Scan websites for accessibility issues and get AI-powered fix suggestions</p>
                    </div>

                    <div class="scan-form">
                        <div class="form-group">
                            <label class="form-label" for="url-input">Website URL</label>
                            <input type="url" id="url-input" class="form-input" placeholder="https://example.com" required>
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Scan Type</label>
                            <div class="scan-options">
                                <div class="scan-option">
                                    <input type="radio" id="single-page" name="scanType" value="single" checked>
                                    <label for="single-page">Single Page</label>
                                </div>
                                <div class="scan-option">
                                    <input type="radio" id="multi-page" name="scanType" value="crawl">
                                    <label for="multi-page">Multi-page Crawl</label>
                                    <input type="number" id="pages-count" class="pages-input" value="5" min="1" max="50" disabled>
                                    <span>pages</span>
                                </div>
                            </div>
                        </div>
                        
                        <button type="button" class="scan-button" onclick="startScan()">
                            🔍 Start Accessibility Scan
                        </button>
                    </div>

                    <div id="scan-results-container"></div>
                </div>

                <!-- History Page -->
                <div id="history" class="page">
                    <div class="dashboard-header">
                        <h1>Scan History</h1>
                        <p>View and manage your previous accessibility scans</p>
                    </div>
                    <div id="history-content">
                        <!-- History content will be loaded dynamically -->
                    </div>
                </div>

                <!-- Platforms Page -->
                <div id="platforms" class="page">
                    <div class="dashboard-header">
                        <h1>Platform Integrations</h1>
                        <p>Connect your websites and platforms for automated accessibility management</p>
                    </div>
                    
                    <div class="scan-form">
                        <h3>WordPress Integration</h3>
                        <div class="form-group">
                            <label class="form-label">WordPress Site URL</label>
                            <input type="url" id="wp-url" class="form-input" placeholder="https://yoursite.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Application Password</label>
                            <input type="password" id="wp-password" class="form-input" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx">
                        </div>
                        <button type="button" class="scan-button" onclick="connectWordPress()">
                            🔗 Connect WordPress
                        </button>
                    </div>
                    
                    <div class="scan-form">
                        <h3>Shopify Integration</h3>
                        <div class="form-group">
                            <label class="form-label">Store URL</label>
                            <input type="url" id="shopify-url" class="form-input" placeholder="https://yourstore.myshopify.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Private App Password</label>
                            <input type="password" id="shopify-password" class="form-input" placeholder="shppa_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx">
                        </div>
                        <button type="button" class="scan-button" onclick="connectShopify()">
                            🛒 Connect Shopify
                        </button>
                    </div>
                    
                    <div class="scan-form">
                        <h3>Custom Site Integration</h3>
                        <div class="form-group">
                            <label class="form-label">Site URL</label>
                            <input type="url" id="custom-url" class="form-input" placeholder="https://yoursite.com">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Connection Method</label>
                            <select id="custom-method" class="form-input">
                                <option value="ftp">FTP</option>
                                <option value="ssh">SSH</option>
                                <option value="api">API</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Credentials (JSON format)</label>
                            <textarea id="custom-credentials" class="form-input" rows="4" placeholder='{"username": "user", "password": "pass", "host": "ftp.example.com"}'></textarea>
                        </div>
                        <button type="button" class="scan-button" onclick="connectCustomSite()">
                            🔧 Connect Custom Site
                        </button>
                    </div>
                </div>

                <!-- Reports Page -->
                <div id="reports" class="page">
                    <div class="dashboard-header">
                        <h1>Reports & Analytics</h1>
                        <p>Comprehensive accessibility analytics and compliance reporting</p>
                    </div>
                    <div id="reports-content">
                        <p>Advanced reporting features coming soon...</p>
                    </div>
                </div>

                <!-- Settings Page -->
                <div id="settings" class="page">
                    <div class="dashboard-header">
                        <h1>Settings</h1>
                        <p>Configure your SentryPrime preferences and integrations</p>
                    </div>
                    <div id="settings-content">
                        <p>Settings panel coming soon...</p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- AI Modal -->
    <div id="ai-modal" class="modal">
        <div class="modal-content">
            <span class="close" onclick="closeAIModal()">&times;</span>
            <h2>🤖 AI Fix Suggestions</h2>
            <div id="ai-modal-body">
                <!-- AI suggestions will be loaded here -->
            </div>
        </div>
    </div>

    <script>
        // PRESERVED: All your existing JavaScript functionality - EXACT COPY
        
        // Global variables
        let currentViolations = [];
        
        // Page navigation
        function showPage(pageId) {
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
            
            // Load page-specific content
            if (pageId === 'dashboard') {
                loadDashboardStats();
            } else if (pageId === 'history') {
                loadScanHistory();
            }
        }
        
        // Load dashboard statistics
        async function loadDashboardStats() {
            try {
                const response = await fetch('/api/analytics');
                const data = await response.json();
                
                if (data.success) {
                    const stats = data.analytics;
                    document.getElementById('stats-grid').innerHTML = \`
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Total Scans</div>
                                <div>📊</div>
                            </div>
                            <div class="stat-value">\${stats.totalScans}</div>
                            <div class="stat-change positive">+\${stats.thisWeekScans} this week</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Issues Found</div>
                                <div>🔍</div>
                            </div>
                            <div class="stat-value">\${stats.totalIssues}</div>
                            <div class="stat-change">Total across all scans</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">Average Score</div>
                                <div>⭐</div>
                            </div>
                            <div class="stat-value">\${stats.averageScore}%</div>
                            <div class="stat-change \${stats.averageScore >= 90 ? 'positive' : 'negative'}">
                                \${stats.averageScore >= 90 ? 'Excellent' : 'Needs improvement'}
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-header">
                                <div class="stat-title">This Week</div>
                                <div>📅</div>
                            </div>
                            <div class="stat-value">\${stats.thisWeekScans}</div>
                            <div class="stat-change">Scans completed</div>
                        </div>
                    \`;
                }
            } catch (error) {
                console.error('Error loading dashboard stats:', error);
            }
        }
        
        // Load scan history
        async function loadScanHistory() {
            try {
                const response = await fetch('/api/scans?limit=20');
                const data = await response.json();
                
                if (data.success) {
                    const scans = data.scans;
                    document.getElementById('history-content').innerHTML = \`
                        <div class="scan-results">
                            <div class="results-header">
                                <div class="results-title">Recent Scans</div>
                                <div class="results-meta">\${scans.length} scans found</div>
                            </div>
                            <div class="results-body">
                                \${scans.map(scan => \`
                                    <div class="violation">
                                        <div class="violation-header">
                                            <div class="violation-title">\${scan.url}</div>
                                            <div class="violation-impact impact-\${scan.total_issues === 0 ? 'minor' : scan.total_issues > 10 ? 'critical' : 'moderate'}">
                                                Score: \${scan.score}%
                                            </div>
                                        </div>
                                        <div class="violation-body">
                                            <div class="violation-description">
                                                <strong>Issues Found:</strong> \${scan.total_issues}<br>
                                                <strong>Scan Type:</strong> \${scan.scan_type}<br>
                                                <strong>Date:</strong> \${new Date(scan.created_at).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </div>
                                \`).join('')}
                            </div>
                        </div>
                    \`;
                }
            } catch (error) {
                console.error('Error loading scan history:', error);
            }
        }
        
        // Enable/disable pages input based on scan type
        document.addEventListener('DOMContentLoaded', function() {
            const scanTypeInputs = document.querySelectorAll('input[name="scanType"]');
            const pagesInput = document.getElementById('pages-count');
            
            scanTypeInputs.forEach(input => {
                input.addEventListener('change', function() {
                    pagesInput.disabled = this.value === 'single';
                });
            });
            
            // Load initial dashboard stats
            loadDashboardStats();
        });
        
        // Main scan function
        async function startScan() {
            const url = document.getElementById('url-input').value.trim();
            const scanType = document.querySelector('input[name="scanType"]:checked').value;
            const pages = document.getElementById('pages-count').value;
            
            if (!url) {
                alert('Please enter a valid URL');
                return;
            }
            
            const button = document.querySelector('.scan-button');
            const originalText = button.textContent;
            
            try {
                button.disabled = true;
                button.textContent = '🔄 Scanning...';
                
                // Show loading state
                document.getElementById('scan-results-container').innerHTML = \`
                    <div class="scan-results">
                        <div class="results-header">
                            <div class="results-title">Scanning in Progress</div>
                            <div class="results-meta">Please wait...</div>
                        </div>
                        <div class="results-body">
                            <div class="loading">
                                <div class="spinner"></div>
                                <p>Analyzing accessibility issues...</p>
                            </div>
                        </div>
                    </div>
                \`;
                
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        url: url,
                        scanType: scanType,
                        pages: scanType === 'crawl' ? parseInt(pages) : 1
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    displayScanResults(result);
                } else {
                    displayScanError(result.error);
                }
                
            } catch (error) {
                console.error('Scan error:', error);
                displayScanError(error.message);
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
        
        // Platform connection functions
        async function connectWordPress() {
            const url = document.getElementById('wp-url').value.trim();
            const password = document.getElementById('wp-password').value.trim();
            
            if (!url || !password) {
                alert('Please fill in all fields');
                return;
            }
            
            const button = event.target;
            const originalText = button.textContent;
            
            try {
                button.disabled = true;
                button.textContent = '🔄 Connecting...';
                
                const response = await fetch('/api/platforms/connect/wordpress', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, password })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ ' + result.message);
                    // Clear form
                    document.getElementById('wp-url').value = '';
                    document.getElementById('wp-password').value = '';
                } else {
                    alert('❌ ' + result.error);
                }
                
            } catch (error) {
                console.error('Connection error:', error);
                alert('❌ Connection failed: ' + error.message);
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
        
        async function connectShopify() {
            const url = document.getElementById('shopify-url').value.trim();
            const password = document.getElementById('shopify-password').value.trim();
            
            if (!url || !password) {
                alert('Please fill in all fields');
                return;
            }
            
            const button = event.target;
            const originalText = button.textContent;
            
            try {
                button.disabled = true;
                button.textContent = '🔄 Connecting...';
                
                const response = await fetch('/api/platforms/connect/shopify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, password })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ ' + result.message);
                    // Clear form
                    document.getElementById('shopify-url').value = '';
                    document.getElementById('shopify-password').value = '';
                } else {
                    alert('❌ ' + result.error);
                }
                
            } catch (error) {
                console.error('Connection error:', error);
                alert('❌ Connection failed: ' + error.message);
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
        
        async function connectCustomSite() {
            const url = document.getElementById('custom-url').value.trim();
            const method = document.getElementById('custom-method').value;
            const credentials = document.getElementById('custom-credentials').value.trim();
            
            if (!url || !credentials) {
                alert('Please fill in all fields');
                return;
            }
            
            const button = event.target;
            const originalText = button.textContent;
            
            try {
                button.disabled = true;
                button.textContent = '🔄 Connecting...';
                
                const response = await fetch('/api/platforms/connect/custom', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url, method, credentials })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    alert('✅ ' + result.message);
                    // Clear form
                    document.getElementById('custom-url').value = '';
                    document.getElementById('custom-credentials').value = '';
                } else {
                    alert('❌ ' + result.error);
                }
                
            } catch (error) {
                console.error('Connection error:', error);
                alert('❌ Connection failed: ' + error.message);
            } finally {
                button.disabled = false;
                button.textContent = originalText;
            }
        }
        
        function displayScanResults(result) {
            // Store violations, platform info, and URL globally
            currentViolations = result.violations;
            window.currentPlatformInfo = result.platformInfo;
            window.currentScanUrl = result.url;
            window.currentWebsiteContext = result.websiteContext; // PHASE 2F: Store website context
            
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
                        
                        <!-- PHASE 2F: Business Impact Summary -->
                        \${violations.length > 0 && violations.some(v => v.businessImpact) ? 
                            '<div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; margin: 20px 0;"><h4 style="margin: 0 0 15px 0; color: #856404; display: flex; align-items: center;"><span style="margin-right: 8px;">📊</span>Business Impact Analysis</h4><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">' + 
                            (() => {
                                const impactCounts = violations.reduce((acc, v) => {
                                    if (v.businessImpact) {
                                        acc[v.businessImpact.level] = (acc[v.businessImpact.level] || 0) + 1;
                                    }
                                    return acc;
                                }, {});
                                return Object.entries(impactCounts).map(([level, count]) => 
                                    '<div style="text-align: center; padding: 10px; background: rgba(255,255,255,0.7); border-radius: 6px;"><div style="font-size: 1.2rem; font-weight: 600; color: ' + 
                                    (level === 'critical' ? '#dc3545' : level === 'high' ? '#fd7e14' : level === 'medium' ? '#ffc107' : '#28a745') + 
                                    ';">' + count + '</div><div style="font-size: 0.9rem; color: #856404; text-transform: capitalize;">' + level + ' Impact</div></div>'
                                ).join('');
                            })() + 
                            '</div></div>' 
                            : ''
                        }
                        
                        \${violations.length > 0 ? 
                            '<div style="text-align: center; color: #666; padding: 20px; background: #f8f9fa; border-radius: 8px; margin: 20px 0;"><p>📋 <strong>' + violations.length + ' accessibility issues found</strong></p><p>Use the buttons below to view details or start fixing issues.</p></div>'
                            : '<p style="text-align: center; color: #28a745; font-size: 1.2rem; padding: 40px;">🎉 No accessibility issues found!</p>'
                        }
                        
                        <!-- PHASE 2C: Enhanced Action Buttons with Bulk Operations -->
                        <div style="margin-top: 20px; text-align: center;">
                            \${violations.length > 0 ? 
                                '<button class="view-report-btn" onclick="openDetailedReport()" style="background: #007bff; color: white; border: none; padding: 12px 24px; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">📄 View Detailed Report</button>' 
                                : ''
                            }

                            \${violations.length > 0 ? 
                                '<button class="guided-fixing-btn" onclick="GuidedFixing.start(' + JSON.stringify(violations).replace(/"/g, '&quot;') + ')" style="background: #28a745; color: white; border: none; padding: 12px 24px; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px;">🛠️ Let\\'s Start Fixing</button>' 
                                : ''
                            }
                        </div>
                        
                        <!-- PHASE 2C: Bulk Operations Section -->
                        \${violations.length > 1 ? 
                            '<div style="margin-top: 30px; padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;"><h3 style="margin: 0 0 15px 0; text-align: center;">⚡ Bulk Operations</h3><div style="text-align: center;"><button onclick="BulkOperations.fixAllIssues()" style="background: #28a745; color: white; border: none; padding: 12px 20px; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px; font-weight: 600;">🔧 Fix All Issues</button><button onclick="BulkOperations.fixCriticalOnly()" style="background: #dc3545; color: white; border: none; padding: 12px 20px; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px; font-weight: 600;">🚨 Fix Critical Only</button><button onclick="BulkOperations.downloadAllFixes()" style="background: #17a2b8; color: white; border: none; padding: 12px 20px; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px; font-weight: 600;">📦 Download All Fixes</button><button onclick="BulkOperations.showBulkPreview()" style="background: #fd7e14; color: white; border: none; padding: 12px 20px; border-radius: 6px; margin: 5px; cursor: pointer; font-size: 14px; font-weight: 600;">👁️ Preview All Changes</button></div></div>' 
                            : ''
                        }
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
                body: JSON.stringify({ 
                    violations: violationsToShow,
                    websiteContext: window.currentWebsiteContext,
                    platformInfo: window.currentPlatformInfo
                })
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
        
        // PRESERVED: All your existing JavaScript objects and functions continue...
        
        // PHASE 2A: Enhanced Guided Fixing System with Visual Previews
        const GuidedFixing = {
            currentViolations: [],
            currentIndex: 0,
            fixingModal: null,
            
            start: function(violations) {
                this.currentViolations = violations || currentViolations || [];
                this.currentIndex = 0;
                
                if (this.currentViolations.length === 0) {
                    alert('No violations to fix!');
                    return;
                }
                
                this.createFixingModal();
                this.showCurrentViolation();
            },
            
            createFixingModal: function() {
                // Remove existing modal if any
                if (this.fixingModal) {
                    document.body.removeChild(this.fixingModal);
                }
                
                this.fixingModal = document.createElement('div');
                this.fixingModal.style.cssText = \`
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(0,0,0,0.9); z-index: 3000; 
                    display: flex; align-items: center; justify-content: center;
                \`;
                
                this.fixingModal.innerHTML = \`
                    <div style="background: white; border-radius: 16px; max-width: 95vw; max-height: 95vh; overflow-y: auto; position: relative; box-shadow: 0 20px 40px rgba(0,0,0,0.3);">
                        <div style="position: sticky; top: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 16px 16px 0 0; z-index: 1;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <h2 style="margin: 0; font-size: 1.5rem;">🛠️ Guided Accessibility Fixing</h2>
                                <button onclick="GuidedFixing.close()" style="background: rgba(255,255,255,0.2); border: none; color: white; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 16px;">✕</button>
                            </div>
                            <div id="fixing-progress" style="margin-top: 15px; font-size: 0.9rem;"></div>
                        </div>
                        <div id="fixing-content" style="padding: 30px; min-height: 400px;"></div>
                        <div style="background: #f8f9fa; padding: 20px; border-radius: 0 0 16px 16px; display: flex; justify-content: space-between; align-items: center;">
                            <button id="prev-btn" onclick="GuidedFixing.previousViolation()" style="background: #6c757d; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer;">← Previous</button>
                            <div style="display: flex; gap: 10px;">
                                <button onclick="GuidedFixing.skipViolation()" style="background: #ffc107; color: #333; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer;">Skip</button>
                                <button onclick="GuidedFixing.implementFix()" style="background: #28a745; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer;">✅ Implement Fix</button>
                            </div>
                            <button id="next-btn" onclick="GuidedFixing.nextViolation()" style="background: #007bff; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer;">Next →</button>
                        </div>
                    </div>
                \`;
                
                document.body.appendChild(this.fixingModal);
            },
            
            showCurrentViolation: function() {
                const violation = this.currentViolations[this.currentIndex];
                const progress = \`\${this.currentIndex + 1} of \${this.currentViolations.length}\`;
                
                document.getElementById('fixing-progress').innerHTML = \`
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>Issue \${progress}</span>
                        <div style="background: rgba(255,255,255,0.2); border-radius: 10px; padding: 4px; width: 200px;">
                            <div style="background: white; height: 6px; border-radius: 6px; width: \${((this.currentIndex + 1) / this.currentViolations.length) * 100}%; transition: width 0.3s ease;"></div>
                        </div>
                    </div>
                \`;
                
                document.getElementById('fixing-content').innerHTML = \`
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 30px; min-height: 400px;">
                        <div>
                            <h3 style="color: #333; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
                                <span style="background: #dc3545; color: white; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; text-transform: uppercase;">\${violation.impact}</span>
                                \${violation.id}
                            </h3>
                            
                            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <h4 style="margin-bottom: 10px; color: #333;">📋 Issue Description</h4>
                                <p style="color: #666; line-height: 1.6;">\${violation.description || 'Accessibility violation detected'}</p>
                                \${violation.help ? \`<p style="color: #666; line-height: 1.6; margin-top: 15px;"><strong>How to fix:</strong> \${violation.help}</p>\` : ''}
                            </div>
                            
                            \${violation.nodes && violation.nodes.length > 0 ? \`
                            <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <h4 style="margin-bottom: 10px; color: #856404;">🎯 Affected Elements</h4>
                                \${violation.nodes.slice(0, 2).map(node => \`
                                    <div style="background: rgba(255,255,255,0.7); padding: 15px; border-radius: 6px; margin-bottom: 10px; font-family: monospace; font-size: 0.9rem;">
                                        <strong>Selector:</strong> \${node.target ? node.target[0] : 'Unknown'}<br>
                                        \${node.html ? \`<strong>HTML:</strong> \${node.html.substring(0, 100)}\${node.html.length > 100 ? '...' : ''}\` : ''}
                                    </div>
                                \`).join('')}
                                \${violation.nodes.length > 2 ? \`<p style="color: #856404; font-style: italic;">... and \${violation.nodes.length - 2} more elements</p>\` : ''}
                            </div>
                            \` : ''}
                            
                            <div style="text-align: center;">
                                <button onclick="GuidedFixing.showVisualPreview('\${violation.nodes?.[0]?.target?.[0] || ''}')" 
                                        style="background: #17a2b8; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; margin: 5px;">
                                    👁️ Show Visual Preview
                                </button>
                                <button onclick="GuidedFixing.showAISuggestion()" 
                                        style="background: #6f42c1; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; margin: 5px;">
                                    🤖 Get AI Suggestion
                                </button>
                            </div>
                        </div>
                        
                        <div>
                            <h3 style="color: #333; margin-bottom: 20px;">🔧 Fix Implementation</h3>
                            <div id="fix-implementation-area">
                                <div style="text-align: center; color: #666; padding: 40px;">
                                    <p>Click "Get AI Suggestion" to see recommended fixes for this issue.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                \`;
                
                // Update navigation buttons
                document.getElementById('prev-btn').disabled = this.currentIndex === 0;
                document.getElementById('next-btn').disabled = this.currentIndex === this.currentViolations.length - 1;
            },
            
            showVisualPreview: async function(selector) {
                if (!selector || !window.currentScanUrl) {
                    alert('Unable to generate visual preview - missing selector or URL');
                    return;
                }
                
                try {
                    const response = await fetch('/api/visual-preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            url: window.currentScanUrl,
                            violationSelector: selector
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        // Show preview in a modal
                        const previewModal = document.createElement('div');
                        previewModal.style.cssText = \`
                            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                            background: rgba(0,0,0,0.9); z-index: 4000; 
                            display: flex; align-items: center; justify-content: center;
                        \`;
                        
                        previewModal.innerHTML = \`
                            <div style="background: white; padding: 20px; border-radius: 12px; max-width: 90vw; max-height: 90vh; overflow: auto;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                    <h3>👁️ Visual Preview - Issue Highlighted</h3>
                                    <button onclick="this.parentElement.parentElement.parentElement.remove()" 
                                            style="background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer;">✕</button>
                                </div>
                                <img src="\${result.image}" style="max-width: 100%; border: 1px solid #ddd; border-radius: 8px;" alt="Visual preview">
                                <p style="margin-top: 15px; color: #666; text-align: center;">The highlighted element shows where the accessibility issue is located on your page.</p>
                            </div>
                        \`;
                        
                        document.body.appendChild(previewModal);
                    } else {
                        alert('Failed to generate visual preview: ' + result.error);
                    }
                    
                } catch (error) {
                    console.error('Visual preview error:', error);
                    alert('Error generating visual preview: ' + error.message);
                }
            },
            
            showAISuggestion: async function() {
                const violation = this.currentViolations[this.currentIndex];
                const fixArea = document.getElementById('fix-implementation-area');
                
                fixArea.innerHTML = '<div style="text-align: center; padding: 20px;"><div class="spinner"></div><p>Generating AI suggestion...</p></div>';
                
                try {
                    const response = await fetch('/api/ai-fixes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            violations: [violation],
                            platformInfo: window.currentPlatformInfo
                        })
                    });
                    
                    const suggestions = await response.json();
                    const suggestion = suggestions[0];
                    
                    fixArea.innerHTML = \`
                        <div style="background: #e8f5e8; border: 1px solid #c3e6c3; border-radius: 8px; padding: 20px; margin-bottom: 20px;">
                            <h4 style="color: #155724; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;">
                                🤖 AI Recommendation
                                <span style="background: #28a745; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; text-transform: uppercase;">\${suggestion.priority}</span>
                            </h4>
                            <p style="color: #155724; margin-bottom: 15px;"><strong>Explanation:</strong> \${suggestion.explanation}</p>
                            
                            <div style="margin-bottom: 15px;">
                                <strong style="color: #155724;">Code Example:</strong>
                                <pre style="background: #f8f9fa; padding: 15px; border-radius: 6px; overflow-x: auto; margin-top: 8px;"><code>\${suggestion.codeExample}</code></pre>
                            </div>
                            
                            <div>
                                <strong style="color: #155724;">Implementation Steps:</strong>
                                <ol style="margin-top: 8px; color: #155724;">
                                    \${suggestion.steps.map(step => \`<li style="margin-bottom: 5px;">\${step}</li>\`).join('')}
                                </ol>
                            </div>
                        </div>
                        
                        <div style="text-align: center;">
                            <button onclick="GuidedFixing.generateFixCode()" 
                                    style="background: #fd7e14; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; margin: 5px;">
                                📝 Generate Platform-Specific Code
                            </button>
                        </div>
                    \`;
                    
                } catch (error) {
                    console.error('AI suggestion error:', error);
                    fixArea.innerHTML = \`
                        <div style="background: #f8d7da; border: 1px solid #f5c6cb; border-radius: 8px; padding: 20px; color: #721c24;">
                            <h4>Unable to Generate AI Suggestion</h4>
                            <p>Please try again or implement the fix manually using WCAG guidelines.</p>
                        </div>
                    \`;
                }
            },
            
            generateFixCode: async function() {
                const violation = this.currentViolations[this.currentIndex];
                const fixArea = document.getElementById('fix-implementation-area');
                
                try {
                    const response = await fetch('/api/implement-fix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            violationId: violation.id,
                            fixType: 'auto',
                            platformInfo: window.currentPlatformInfo
                        })
                    });
                    
                    const fixResult = await response.json();
                    
                    if (fixResult.success) {
                        fixArea.innerHTML += \`
                            <div style="background: #d1ecf1; border: 1px solid #bee5eb; border-radius: 8px; padding: 20px; margin-top: 20px;">
                                <h4 style="color: #0c5460; margin-bottom: 15px;">🔧 Platform-Specific Fix Code</h4>
                                <p style="color: #0c5460; margin-bottom: 15px;"><strong>Platform:</strong> \${fixResult.platform}</p>
                                
                                <div style="margin-bottom: 15px;">
                                    <strong style="color: #0c5460;">Generated Code:</strong>
                                    <pre style="background: #f8f9fa; padding: 15px; border-radius: 6px; overflow-x: auto; margin-top: 8px;"><code>\${fixResult.fixCode}</code></pre>
                                </div>
                                
                                <div>
                                    <strong style="color: #0c5460;">Implementation Instructions:</strong>
                                    <ol style="margin-top: 8px; color: #0c5460;">
                                        \${fixResult.instructions.map(instruction => \`<li style="margin-bottom: 5px;">\${instruction}</li>\`).join('')}
                                    </ol>
                                </div>
                                
                                <div style="text-align: center; margin-top: 20px;">
                                    <button onclick="GuidedFixing.copyToClipboard(\`\${fixResult.fixCode.replace(/\`/g, '\\\\`')}\`)" 
                                            style="background: #17a2b8; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; margin: 5px;">
                                        📋 Copy Code
                                    </button>
                                    <button onclick="GuidedFixing.downloadFix()" 
                                            style="background: #28a745; color: white; border: none; padding: 10px 16px; border-radius: 6px; cursor: pointer; margin: 5px;">
                                        💾 Download Fix
                                    </button>
                                </div>
                            </div>
                        \`;
                    }
                    
                } catch (error) {
                    console.error('Fix generation error:', error);
                }
            },
            
            copyToClipboard: function(text) {
                navigator.clipboard.writeText(text).then(() => {
                    alert('✅ Code copied to clipboard!');
                }).catch(err => {

