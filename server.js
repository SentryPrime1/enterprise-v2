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
    
    db = new Pool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT || 5432,
        ssl: {
            rejectUnauthorized: false
        }
    });

    // Test database connection
    db.connect()
        .then(() => {
            console.log('✅ Database connected successfully');
            
            // Create tables if they don't exist
            const createTablesQuery = `
                CREATE TABLE IF NOT EXISTS scans (
                    id SERIAL PRIMARY KEY,
                    url VARCHAR(2048) NOT NULL,
                    scan_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    violations_count INTEGER DEFAULT 0,
                    violations_data JSONB,
                    user_id VARCHAR(255),
                    platform VARCHAR(100),
                    status VARCHAR(50) DEFAULT 'completed'
                );

                CREATE TABLE IF NOT EXISTS scan_analytics (
                    id SERIAL PRIMARY KEY,
                    scan_id INTEGER REFERENCES scans(id),
                    metric_name VARCHAR(100),
                    metric_value NUMERIC,
                    recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_scans_user_id ON scans(user_id);
                CREATE INDEX IF NOT EXISTS idx_scans_date ON scans(scan_date);
                CREATE INDEX IF NOT EXISTS idx_analytics_scan_id ON scan_analytics(scan_id);
            `;
            
            return db.query(createTablesQuery);
        })
        .then(() => {
            console.log('✅ Database tables verified/created successfully');
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

// OpenAI client initialization - PRESERVED EXACTLY AS WORKING
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

// PRESERVED: All existing functions exactly as they work
async function saveScan(url, violations, userId = null, platform = 'unknown') {
    if (!db) {
        console.log('📝 Database not available, scan not saved');
        return null;
    }

    try {
        const query = `
            INSERT INTO scans (url, violations_count, violations_data, user_id, platform)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id, scan_date
        `;
        
        const values = [
            url,
            violations.length,
            JSON.stringify(violations),
            userId,
            platform
        ];
        
        const result = await db.query(query, values);
        console.log('✅ Scan saved to database with ID:', result.rows[0].id);
        return result.rows[0];
    } catch (error) {
        console.error('❌ Error saving scan:', error);
        return null;
    }
}

async function getRecentScans(userId = null, limit = 10) {
    if (!db) {
        return [];
    }

    try {
        let query, values;
        
        if (userId) {
            query = `
                SELECT id, url, scan_date, violations_count, platform, status
                FROM scans 
                WHERE user_id = $1 
                ORDER BY scan_date DESC 
                LIMIT $2
            `;
            values = [userId, limit];
        } else {
            query = `
                SELECT id, url, scan_date, violations_count, platform, status
                FROM scans 
                ORDER BY scan_date DESC 
                LIMIT $1
            `;
            values = [limit];
        }
        
        const result = await db.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('❌ Error fetching recent scans:', error);
        return [];
    }
}

async function getAnalytics(userId = null, days = 30) {
    if (!db) {
        return {
            totalScans: 0,
            avgViolations: 0,
            topViolationTypes: [],
            scanTrend: []
        };
    }

    try {
        const dateFilter = `scan_date >= NOW() - INTERVAL '${days} days'`;
        const userFilter = userId ? `AND user_id = '${userId}'` : '';
        
        // Total scans
        const totalQuery = `SELECT COUNT(*) as total FROM scans WHERE ${dateFilter} ${userFilter}`;
        const totalResult = await db.query(totalQuery);
        
        // Average violations
        const avgQuery = `SELECT AVG(violations_count) as avg FROM scans WHERE ${dateFilter} ${userFilter}`;
        const avgResult = await db.query(avgQuery);
        
        // Scan trend (daily)
        const trendQuery = `
            SELECT DATE(scan_date) as date, COUNT(*) as count 
            FROM scans 
            WHERE ${dateFilter} ${userFilter}
            GROUP BY DATE(scan_date) 
            ORDER BY date DESC 
            LIMIT 30
        `;
        const trendResult = await db.query(trendQuery);
        
        return {
            totalScans: parseInt(totalResult.rows[0].total) || 0,
            avgViolations: parseFloat(avgResult.rows[0].avg) || 0,
            topViolationTypes: [], // Would need more complex query
            scanTrend: trendResult.rows
        };
    } catch (error) {
        console.error('❌ Error fetching analytics:', error);
        return {
            totalScans: 0,
            avgViolations: 0,
            topViolationTypes: [],
            scanTrend: []
        };
    }
}

// PRESERVED: Exact working AI suggestion function
async function generateAISuggestion(violation) {
    if (!openai) {
        // Fallback suggestions when OpenAI is not available
        const fallbackSuggestions = {
            'color-contrast': {
                priority: 'high',
                explanation: 'Text color does not have sufficient contrast against the background. This makes content difficult to read for users with visual impairments.',
                codeExample: `/* Increase contrast ratio to at least 4.5:1 for normal text */
.text-element {
    color: #000000; /* Dark text */
    background-color: #ffffff; /* Light background */
}`,
                steps: [
                    'Check current contrast ratio using browser dev tools',
                    'Adjust text color or background color',
                    'Verify contrast ratio meets WCAG AA standards (4.5:1)',
                    'Test with users who have visual impairments'
                ]
            },
            'image-alt': {
                priority: 'high',
                explanation: 'Images must have alternative text to be accessible to screen readers and users with visual impairments.',
                codeExample: `<img src="chart.png" alt="Sales increased 25% from Q1 to Q2 2023">`,
                steps: [
                    'Add descriptive alt text that conveys the image content',
                    'For decorative images, use alt=""',
                    'For complex images, consider longer descriptions',
                    'Test with screen readers'
                ]
            }
        };
        
        const suggestionKey = Object.keys(fallbackSuggestions).find(key => 
            violation.id.includes(key) || violation.description.toLowerCase().includes(key)
        );
        
        return fallbackSuggestions[suggestionKey] || {
            priority: 'medium',
            explanation: 'This accessibility issue should be addressed according to WCAG guidelines.',
            codeExample: '// Please refer to WCAG documentation for specific guidance',
            steps: ['Review WCAG guidelines', 'Implement appropriate fix', 'Test with assistive technologies']
        };
    }

    try {
        const prompt = `As an accessibility expert, provide a detailed fix suggestion for this WCAG violation:

VIOLATION: ${violation.id}
DESCRIPTION: ${violation.description}
IMPACT: ${violation.impact}
HELP: ${violation.help}
ELEMENT: ${violation.target ? violation.target[0] : 'Not specified'}

Please provide your response in this exact format:

PRIORITY: [high/medium/low]

EXPLANATION: [Clear explanation of why this is an accessibility issue and its impact on users]

CODE EXAMPLE: [Specific code example showing how to fix this issue]

IMPLEMENTATION STEPS:
1. [First step]
2. [Second step]
3. [Third step]

PLATFORM-SPECIFIC NOTES: [Any WordPress, Shopify, or general web platform considerations]`;

        const completion = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                {
                    role: "system",
                    content: "You are an expert web accessibility consultant specializing in WCAG compliance. Provide practical, actionable advice for fixing accessibility violations."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            max_tokens: 800,
            temperature: 0.3
        });

        const aiResponse = completion.choices[0].message.content;
        return parseAITextResponse(aiResponse, violation.id);

    } catch (error) {
        console.error('❌ OpenAI API error:', error);
        return {
            priority: 'medium',
            explanation: 'AI suggestion temporarily unavailable. Please refer to WCAG guidelines.',
            codeExample: '// Please refer to WCAG documentation',
            steps: ['Review WCAG guidelines for this violation type']
        };
    }
}

// PRESERVED: Exact working AI response parser
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

// PRESERVED: Exact working fix code generation
async function generateFixCode(violation, platform = 'generic') {
    const fixes = {
        'color-contrast': {
            generic: `/* Fix color contrast */
.element {
    color: #000000;
    background-color: #ffffff;
    /* Ensure contrast ratio >= 4.5:1 */
}`,
            wordpress: `/* Add to your theme's style.css */
.wp-block-paragraph {
    color: #333333;
    background-color: #ffffff;
}`,
            shopify: `/* Add to your theme's CSS */
.rte {
    color: #000000;
    background-color: #ffffff;
}`
        },
        'image-alt': {
            generic: `<img src="image.jpg" alt="Descriptive alternative text">`,
            wordpress: `// In your theme's functions.php
function add_default_alt_text($attr, $attachment) {
    if (empty($attr['alt'])) {
        $attr['alt'] = get_the_title($attachment->ID);
    }
    return $attr;
}
add_filter('wp_get_attachment_image_attributes', 'add_default_alt_text', 10, 2);`,
            shopify: `<!-- In your Liquid templates -->
<img src="{{ image | img_url: 'master' }}" alt="{{ image.alt | default: product.title }}">`,
        }
    };

    const violationType = Object.keys(fixes).find(type => 
        violation.id.includes(type) || violation.description.toLowerCase().includes(type)
    );

    if (violationType && fixes[violationType][platform]) {
        return fixes[violationType][platform];
    }

    return `/* Generic fix for ${violation.id} */
/* Please refer to WCAG guidelines for specific implementation */`;
}

// PRESERVED: All existing endpoints exactly as they work

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: db ? 'connected' : 'standalone',
        openai: openai ? 'connected' : 'standalone',
        deploymentFeatures: ENABLE_DEPLOYMENT_FEATURES === 'true' ? 'enabled' : 'disabled'
    });
});

// PRESERVED: Main scan endpoint exactly as working
app.post('/api/scan', async (req, res) => {
    const { url, userId } = req.body;
    
    if (!url) {
        return res.status(400).json({
            success: false,
            error: 'URL is required'
        });
    }

    let browser;
    try {
        console.log('🔍 Starting accessibility scan for:', url);
        
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
        await page.setViewport({ width: 1200, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        // Navigate to the page
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });

        // Inject axe-core
        await page.addScriptTag({
            content: axeCore.source
        });

        // Run accessibility scan
        const results = await page.evaluate(() => {
            return new Promise((resolve) => {
                axe.run((err, results) => {
                    if (err) throw err;
                    resolve(results);
                });
            });
        });

        // Detect platform
        const platform = await page.evaluate(() => {
            // WordPress detection
            if (document.querySelector('meta[name="generator"][content*="WordPress"]') ||
                document.querySelector('link[href*="wp-content"]') ||
                document.querySelector('script[src*="wp-content"]')) {
                return 'wordpress';
            }
            
            // Shopify detection
            if (document.querySelector('script[src*="shopify"]') ||
                document.querySelector('link[href*="shopify"]') ||
                window.Shopify) {
                return 'shopify';
            }
            
            return 'custom';
        });

        console.log('✅ Scan completed successfully');
        console.log(`📊 Found ${results.violations.length} violations`);
        console.log(`🏗️ Platform detected: ${platform}`);

        // Generate AI suggestions for violations
        const violationsWithSuggestions = await Promise.all(
            results.violations.map(async (violation) => {
                const suggestion = await generateAISuggestion(violation);
                const fixCode = await generateFixCode(violation, platform);
                
                return {
                    ...violation,
                    aiSuggestion: suggestion,
                    fixCode: fixCode,
                    platform: platform
                };
            })
        );

        // Save scan to database
        const scanRecord = await saveScan(url, violationsWithSuggestions, userId, platform);

        res.json({
            success: true,
            url: url,
            platform: platform,
            scanId: scanRecord?.id || null,
            timestamp: new Date().toISOString(),
            violations: violationsWithSuggestions,
            summary: {
                total: results.violations.length,
                critical: results.violations.filter(v => v.impact === 'critical').length,
                serious: results.violations.filter(v => v.impact === 'serious').length,
                moderate: results.violations.filter(v => v.impact === 'moderate').length,
                minor: results.violations.filter(v => v.impact === 'minor').length
            },
            passes: results.passes.length,
            incomplete: results.incomplete.length
        });

    } catch (error) {
        console.error('❌ Scan error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            details: 'Failed to complete accessibility scan'
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// ENHANCEMENT: New analyze-website endpoint for deployment readiness
app.post('/api/analyze-website', async (req, res) => {
    if (ENABLE_DEPLOYMENT_FEATURES !== 'true' || !domParsingEngine) {
        return res.status(501).json({
            success: false,
            error: 'Deployment features not available'
        });
    }

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
            deploymentReadiness: analysis.deploymentReadiness || {
                canGenerateFixes: true,
                supportedMethods: ['Manual'],
                riskLevel: 'Medium',
                automationLevel: 50
            }
        });

    } catch (error) {
        console.error('❌ Enhanced analysis error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ENHANCEMENT: Generate deployment patches endpoint
app.post('/api/generate-deployment-patches', async (req, res) => {
    if (ENABLE_DEPLOYMENT_FEATURES !== 'true' || !patchGenerationEngine) {
        return res.status(501).json({
            success: false,
            error: 'Deployment features not available'
        });
    }

    const { scanId, violations, platform, options } = req.body;
    
    if (!violations || !Array.isArray(violations)) {
        return res.status(400).json({
            success: false,
            error: 'Violations array is required'
        });
    }

    try {
        console.log('🔧 Generating deployment patches for:', scanId);
        
        const patches = await patchGenerationEngine.generateDeploymentPatches(
            violations,
            platform || 'custom',
            options || {}
        );
        
        const packageId = await patchGenerationEngine.createPatchPackage(patches);
        
        res.json({
            success: true,
            patchId: packageId,
            patches: patches,
            summary: {
                totalPatches: patches.length,
                automatedFixes: patches.filter(p => p.automationLevel > 80).length,
                manualFixes: patches.filter(p => p.automationLevel <= 80).length,
                estimatedTime: patches.reduce((sum, p) => sum + (p.estimatedTime || 5), 0)
            }
        });

    } catch (error) {
        console.error('❌ Patch generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ENHANCEMENT: Deploy patches endpoint
app.post('/api/deploy-patches', async (req, res) => {
    if (ENABLE_DEPLOYMENT_FEATURES !== 'true' || !deploymentEngine) {
        return res.status(501).json({
            success: false,
            error: 'Deployment features not available'
        });
    }

    const { patchId, deploymentConfig } = req.body;
    
    if (!patchId || !deploymentConfig) {
        return res.status(400).json({
            success: false,
            error: 'Patch ID and deployment configuration are required'
        });
    }

    try {
        console.log('🚀 Deploying patches:', patchId);
        
        const deploymentResult = await deploymentEngine.deployPatches(patchId, deploymentConfig);
        
        res.json({
            success: true,
            deploymentId: deploymentResult.deploymentId,
            status: deploymentResult.status,
            backupId: deploymentResult.backupId,
            deployedPatches: deploymentResult.deployedPatches,
            summary: deploymentResult.summary
        });

    } catch (error) {
        console.error('❌ Deployment error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ENHANCEMENT: Rollback deployment endpoint
app.post('/api/rollback-deployment', async (req, res) => {
    if (ENABLE_DEPLOYMENT_FEATURES !== 'true' || !safetyEngine) {
        return res.status(501).json({
            success: false,
            error: 'Deployment features not available'
        });
    }

    const { deploymentId, reason } = req.body;
    
    if (!deploymentId) {
        return res.status(400).json({
            success: false,
            error: 'Deployment ID is required'
        });
    }

    try {
        console.log('🔄 Rolling back deployment:', deploymentId);
        
        const rollbackResult = await safetyEngine.performRollback(deploymentId, reason);
        
        res.json({
            success: true,
            rollbackId: rollbackResult.rollbackId,
            status: rollbackResult.status,
            restoredFiles: rollbackResult.restoredFiles,
            summary: rollbackResult.summary
        });

    } catch (error) {
        console.error('❌ Rollback error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ENHANCEMENT: Deployment status endpoint
app.get('/api/deployment-status/:deploymentId', async (req, res) => {
    if (ENABLE_DEPLOYMENT_FEATURES !== 'true' || !safetyEngine) {
        return res.status(501).json({
            success: false,
            error: 'Deployment features not available'
        });
    }

    const { deploymentId } = req.params;

    try {
        const status = await safetyEngine.getDeploymentStatus(deploymentId);
        
        res.json({
            success: true,
            deploymentId: deploymentId,
            status: status
        });

    } catch (error) {
        console.error('❌ Status check error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// PRESERVED: Visual preview endpoint exactly as working
app.post('/api/visual-preview', async (req, res) => {
    const { url, violationSelector, simulationType } = req.body;
    
    if (!url || !violationSelector) {
        return res.status(400).json({
            success: false,
            error: 'URL and violation selector are required'
        });
    }

    let browser;
    try {
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
        await page.setViewport({ width: 1200, height: 800 });
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        // Apply visual highlighting
        await page.evaluate((selector, simType) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.style.outline = '3px solid red';
                el.style.outlineOffset = '2px';
                
                if (simType === 'colorBlind') {
                    el.style.filter = 'grayscale(100%)';
                } else if (simType === 'lowVision') {
                    el.style.filter = 'blur(2px)';
                }
            });
        }, violationSelector, simulationType);

        const screenshot = await page.screenshot({
            encoding: 'base64',
            fullPage: false
        });

        res.json({
            success: true,
            screenshot: `data:image/png;base64,${screenshot}`,
            violationSelector: violationSelector,
            simulationType: simulationType || 'normal'
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

// PRESERVED: Bulk operations endpoint exactly as working
app.post('/api/bulk-scan', async (req, res) => {
    const { urls, userId } = req.body;
    
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'URLs array is required'
        });
    }

    if (urls.length > 10) {
        return res.status(400).json({
            success: false,
            error: 'Maximum 10 URLs allowed per bulk scan'
        });
    }

    try {
        console.log(`🔍 Starting bulk scan for ${urls.length} URLs`);
        
        const results = [];
        
        for (const url of urls) {
            try {
                // Simulate individual scan (reuse scan logic)
                const scanResult = await performSingleScan(url, userId);
                results.push({
                    url: url,
                    success: true,
                    ...scanResult
                });
            } catch (error) {
                results.push({
                    url: url,
                    success: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            totalUrls: urls.length,
            completedScans: results.filter(r => r.success).length,
            failedScans: results.filter(r => !r.success).length,
            results: results,
            summary: {
                totalViolations: results.reduce((sum, r) => sum + (r.violations?.length || 0), 0),
                avgViolationsPerSite: results.length > 0 ? 
                    results.reduce((sum, r) => sum + (r.violations?.length || 0), 0) / results.length : 0
            }
        });

    } catch (error) {
        console.error('❌ Bulk scan error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper function for individual scans
async function performSingleScan(url, userId) {
    let browser;
    try {
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
        await page.setViewport({ width: 1200, height: 800 });
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

        await page.addScriptTag({ content: axeCore.source });

        const results = await page.evaluate(() => {
            return new Promise((resolve) => {
                axe.run((err, results) => {
                    if (err) throw err;
                    resolve(results);
                });
            });
        });

        const platform = await page.evaluate(() => {
            if (document.querySelector('meta[name="generator"][content*="WordPress"]') ||
                document.querySelector('link[href*="wp-content"]')) {
                return 'wordpress';
            }
            if (document.querySelector('script[src*="shopify"]') ||
                window.Shopify) {
                return 'shopify';
            }
            return 'custom';
        });

        const violationsWithSuggestions = await Promise.all(
            results.violations.map(async (violation) => {
                const suggestion = await generateAISuggestion(violation);
                const fixCode = await generateFixCode(violation, platform);
                
                return {
                    ...violation,
                    aiSuggestion: suggestion,
                    fixCode: fixCode,
                    platform: platform
                };
            })
        );

        const scanRecord = await saveScan(url, violationsWithSuggestions, userId, platform);

        return {
            platform: platform,
            scanId: scanRecord?.id || null,
            violations: violationsWithSuggestions,
            summary: {
                total: results.violations.length,
                critical: results.violations.filter(v => v.impact === 'critical').length,
                serious: results.violations.filter(v => v.impact === 'serious').length,
                moderate: results.violations.filter(v => v.impact === 'moderate').length,
                minor: results.violations.filter(v => v.impact === 'minor').length
            }
        };

    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// PRESERVED: Analytics endpoint exactly as working
app.get('/api/analytics', async (req, res) => {
    try {
        const { userId, days } = req.query;
        const analytics = await getAnalytics(userId, parseInt(days) || 30);
        
        res.json({
            success: true,
            analytics: analytics
        });
    } catch (error) {
        console.error('Analytics fetch error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics'
        });
    }
});

// PRESERVED: Recent scans endpoint exactly as working
app.get('/api/scans/recent', async (req, res) => {
    try {
        const { userId, limit } = req.query;
        const scans = await getRecentScans(userId, parseInt(limit) || 10);
        
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

// PRESERVED: Serve static files
app.use(express.static('public'));

// PRESERVED: Default route with complete embedded frontend
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🛡️ SentryPrime Enterprise Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }

        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            text-align: center;
            margin-bottom: 40px;
            color: white;
        }

        .header h1 {
            font-size: 3rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }

        .header p {
            font-size: 1.2rem;
            opacity: 0.9;
        }

        .dashboard {
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: 30px;
            margin-bottom: 40px;
        }

        .control-panel {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            height: fit-content;
        }

        .results-panel {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            min-height: 600px;
        }

        .form-group {
            margin-bottom: 25px;
        }

        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #555;
        }

        .form-group input, .form-group select {
            width: 100%;
            padding: 12px;
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.3s ease;
        }

        .form-group input:focus, .form-group select:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 15px 30px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            width: 100%;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .loading {
            display: none;
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

        .results {
            display: none;
        }

        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }

        .summary-card {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            text-align: center;
        }

        .summary-card h3 {
            font-size: 2rem;
            margin-bottom: 5px;
        }

        .summary-card p {
            opacity: 0.9;
        }

        .violations-list {
            max-height: 500px;
            overflow-y: auto;
        }

        .violation-item {
            border: 1px solid #e1e5e9;
            border-radius: 8px;
            margin-bottom: 15px;
            overflow: hidden;
        }

        .violation-header {
            background: #f8f9fa;
            padding: 15px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .violation-header:hover {
            background: #e9ecef;
        }

        .violation-title {
            font-weight: 600;
            color: #333;
        }

        .violation-impact {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
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
            color: #333;
        }

        .impact-minor {
            background: #28a745;
            color: white;
        }

        .violation-details {
            display: none;
            padding: 20px;
            background: white;
        }

        .violation-details.active {
            display: block;
        }

        .detail-section {
            margin-bottom: 20px;
        }

        .detail-section h4 {
            color: #667eea;
            margin-bottom: 10px;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .detail-section p, .detail-section pre {
            color: #666;
            line-height: 1.6;
        }

        .detail-section pre {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            overflow-x: auto;
            font-size: 14px;
        }

        .ai-suggestion {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-top: 15px;
        }

        .ai-suggestion h4 {
            color: white;
            margin-bottom: 10px;
        }

        .steps-list {
            list-style: none;
            padding: 0;
        }

        .steps-list li {
            padding: 8px 0;
            border-bottom: 1px solid rgba(255,255,255,0.2);
        }

        .steps-list li:last-child {
            border-bottom: none;
        }

        .bulk-operations {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-top: 30px;
        }

        .bulk-operations h2 {
            color: #333;
            margin-bottom: 20px;
        }

        .url-input-group {
            display: flex;
            gap: 10px;
            margin-bottom: 15px;
        }

        .url-input-group input {
            flex: 1;
            padding: 10px;
            border: 2px solid #e1e5e9;
            border-radius: 5px;
        }

        .url-input-group button {
            padding: 10px 20px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
        }

        .url-list {
            background: #f8f9fa;
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 20px;
            min-height: 100px;
        }

        .url-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 8px 0;
            border-bottom: 1px solid #dee2e6;
        }

        .url-item:last-child {
            border-bottom: none;
        }

        .remove-url {
            background: #dc3545;
            color: white;
            border: none;
            padding: 4px 8px;
            border-radius: 3px;
            cursor: pointer;
            font-size: 12px;
        }

        .analytics-panel {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-top: 30px;
        }

        .analytics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }

        .analytics-card {
            background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%);
            color: white;
            padding: 25px;
            border-radius: 10px;
            text-align: center;
        }

        .analytics-card h3 {
            font-size: 2.5rem;
            margin-bottom: 10px;
        }

        .analytics-card p {
            opacity: 0.9;
            font-size: 1.1rem;
        }

        @media (max-width: 768px) {
            .dashboard {
                grid-template-columns: 1fr;
            }
            
            .header h1 {
                font-size: 2rem;
            }
            
            .container {
                padding: 10px;
            }
        }

        .enhancement-banner {
            background: linear-gradient(135deg, #ff6b6b 0%, #feca57 100%);
            color: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 30px;
            text-align: center;
        }

        .enhancement-banner h3 {
            margin-bottom: 10px;
        }

        .deployment-panel {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            margin-top: 30px;
        }

        .deployment-options {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }

        .deployment-option {
            border: 2px solid #e1e5e9;
            border-radius: 8px;
            padding: 20px;
            text-align: center;
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .deployment-option:hover {
            border-color: #667eea;
            background: #f8f9ff;
        }

        .deployment-option.selected {
            border-color: #667eea;
            background: #667eea;
            color: white;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛡️ SentryPrime Enterprise</h1>
            <p>Professional Accessibility Scanner with AI-Powered Suggestions & Deployment Automation</p>
        </div>

        <div class="enhancement-banner">
            <h3>🚀 Enhanced with Deployment Automation</h3>
            <p>Now featuring automated accessibility fixes with platform-specific deployment capabilities</p>
        </div>

        <div class="dashboard">
            <div class="control-panel">
                <h2>🔍 Accessibility Scanner</h2>
                <form id="scanForm">
                    <div class="form-group">
                        <label for="url">Website URL</label>
                        <input type="url" id="url" name="url" placeholder="https://example.com" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="userId">User ID (Optional)</label>
                        <input type="text" id="userId" name="userId" placeholder="user123">
                    </div>
                    
                    <button type="submit" class="btn" id="scanBtn">
                        🚀 Start Accessibility Scan
                    </button>
                </form>

                <div class="deployment-panel">
                    <h3>🔧 Deployment Options</h3>
                    <div class="deployment-options">
                        <div class="deployment-option" data-platform="wordpress">
                            <h4>WordPress</h4>
                            <p>Automated fixes via REST API</p>
                        </div>
                        <div class="deployment-option" data-platform="shopify">
                            <h4>Shopify</h4>
                            <p>Theme-level accessibility improvements</p>
                        </div>
                        <div class="deployment-option" data-platform="custom">
                            <h4>Custom Site</h4>
                            <p>Manual deployment packages</p>
                        </div>
                    </div>
                </div>
            </div>

            <div class="results-panel">
                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <p>Scanning website for accessibility issues...</p>
                    <p><small>This may take 30-60 seconds</small></p>
                </div>

                <div class="results" id="results">
                    <div class="summary" id="summary"></div>
                    <div class="violations-list" id="violationsList"></div>
                </div>

                <div id="welcomeMessage">
                    <h2>Welcome to SentryPrime Enterprise</h2>
                    <p>Enter a website URL to begin your comprehensive accessibility analysis with AI-powered suggestions and automated deployment capabilities.</p>
                    
                    <h3>🌟 Enhanced Features:</h3>
                    <ul style="margin: 20px 0; padding-left: 20px;">
                        <li><strong>AI-Powered Suggestions:</strong> Get intelligent fix recommendations</li>
                        <li><strong>Platform Detection:</strong> Automatic WordPress/Shopify detection</li>
                        <li><strong>Deployment Automation:</strong> One-click accessibility fixes</li>
                        <li><strong>Visual Previews:</strong> See violations highlighted on your site</li>
                        <li><strong>Bulk Operations:</strong> Scan multiple URLs simultaneously</li>
                        <li><strong>Enterprise Analytics:</strong> Track accessibility improvements</li>
                    </ul>
                </div>
            </div>
        </div>

        <div class="bulk-operations">
            <h2>📊 Bulk Operations</h2>
            <div class="url-input-group">
                <input type="url" id="bulkUrl" placeholder="https://example.com">
                <button type="button" onclick="addBulkUrl()">Add URL</button>
            </div>
            <div class="url-list" id="urlList">
                <p style="color: #666; text-align: center;">No URLs added yet</p>
            </div>
            <button type="button" class="btn" onclick="startBulkScan()" id="bulkScanBtn" disabled>
                🚀 Start Bulk Scan
            </button>
        </div>

        <div class="analytics-panel">
            <h2>📈 Analytics Dashboard</h2>
            <div class="analytics-grid" id="analyticsGrid">
                <div class="analytics-card">
                    <h3 id="totalScans">-</h3>
                    <p>Total Scans</p>
                </div>
                <div class="analytics-card">
                    <h3 id="avgViolations">-</h3>
                    <p>Avg Violations</p>
                </div>
                <div class="analytics-card">
                    <h3 id="deploymentSuccess">-</h3>
                    <p>Deployment Success Rate</p>
                </div>
                <div class="analytics-card">
                    <h3 id="timesSaved">-</h3>
                    <p>Hours Saved</p>
                </div>
            </div>
        </div>
    </div>

    <script>
        let bulkUrls = [];
        let currentScanData = null;
        let selectedPlatform = 'custom';

        // Platform selection
        document.querySelectorAll('.deployment-option').forEach(option => {
            option.addEventListener('click', function() {
                document.querySelectorAll('.deployment-option').forEach(opt => opt.classList.remove('selected'));
                this.classList.add('selected');
                selectedPlatform = this.dataset.platform;
            });
        });

        // Main scan form
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const url = document.getElementById('url').value;
            const userId = document.getElementById('userId').value;
            
            if (!url) {
                alert('Please enter a valid URL');
                return;
            }

            // Show loading state
            document.getElementById('loading').style.display = 'block';
            document.getElementById('results').style.display = 'none';
            document.getElementById('welcomeMessage').style.display = 'none';
            document.getElementById('scanBtn').disabled = true;

            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url, userId })
                });

                const data = await response.json();

                if (data.success) {
                    currentScanData = data;
                    displayResults(data);
                    loadAnalytics();
                } else {
                    throw new Error(data.error || 'Scan failed');
                }
            } catch (error) {
                console.error('Scan error:', error);
                alert('Scan failed: ' + error.message);
            } finally {
                document.getElementById('loading').style.display = 'none';
                document.getElementById('scanBtn').disabled = false;
            }
        });

        function displayResults(data) {
            // Display summary
            const summary = document.getElementById('summary');
            summary.innerHTML = \`
                <div class="summary-card">
                    <h3>\${data.summary.total}</h3>
                    <p>Total Violations</p>
                </div>
                <div class="summary-card">
                    <h3>\${data.summary.critical}</h3>
                    <p>Critical Issues</p>
                </div>
                <div class="summary-card">
                    <h3>\${data.summary.serious}</h3>
                    <p>Serious Issues</p>
                </div>
                <div class="summary-card">
                    <h3>\${data.platform}</h3>
                    <p>Platform Detected</p>
                </div>
            \`;

            // Display violations
            const violationsList = document.getElementById('violationsList');
            if (data.violations.length === 0) {
                violationsList.innerHTML = '<p style="text-align: center; color: #28a745; font-size: 1.2rem;">🎉 No accessibility violations found!</p>';
            } else {
                violationsList.innerHTML = data.violations.map((violation, index) => \`
                    <div class="violation-item">
                        <div class="violation-header" onclick="toggleViolation(\${index})">
                            <div class="violation-title">\${violation.help}</div>
                            <div class="violation-impact impact-\${violation.impact}">\${violation.impact}</div>
                        </div>
                        <div class="violation-details" id="violation-\${index}">
                            <div class="detail-section">
                                <h4>Description</h4>
                                <p>\${violation.description}</p>
                            </div>
                            
                            <div class="detail-section">
                                <h4>Elements Affected</h4>
                                <p>\${violation.nodes?.length || 0} element(s)</p>
                                <pre>\${violation.nodes?.[0]?.target?.[0] || 'No specific target'}</pre>
                            </div>

                            <div class="detail-section">
                                <h4>Fix Code (\${data.platform})</h4>
                                <pre>\${violation.fixCode || '/* No fix code available */'}</pre>
                            </div>

                            \${violation.aiSuggestion ? \`
                                <div class="ai-suggestion">
                                    <h4>🤖 AI-Powered Suggestion</h4>
                                    <p><strong>Priority:</strong> \${violation.aiSuggestion.priority}</p>
                                    <p>\${violation.aiSuggestion.explanation}</p>
                                    
                                    \${violation.aiSuggestion.codeExample ? \`
                                        <h4>Code Example:</h4>
                                        <pre style="background: rgba(255,255,255,0.1); margin-top: 10px;">\${violation.aiSuggestion.codeExample}</pre>
                                    \` : ''}
                                    
                                    \${violation.aiSuggestion.steps?.length ? \`
                                        <h4>Implementation Steps:</h4>
                                        <ul class="steps-list">
                                            \${violation.aiSuggestion.steps.map(step => \`<li>\${step}</li>\`).join('')}
                                        </ul>
                                    \` : ''}
                                </div>
                            \` : ''}

                            <div style="margin-top: 20px;">
                                <button class="btn" onclick="generateDeploymentPatch('\${violation.id}', \${index})" style="margin-right: 10px;">
                                    🔧 Generate Deployment Patch
                                </button>
                                <button class="btn" onclick="previewViolation('\${violation.nodes?.[0]?.target?.[0] || ''}')" style="background: #28a745;">
                                    👁️ Visual Preview
                                </button>
                            </div>
                        </div>
                    </div>
                \`).join('');
            }

            document.getElementById('results').style.display = 'block';
        }

        function toggleViolation(index) {
            const details = document.getElementById(\`violation-\${index}\`);
            details.classList.toggle('active');
        }

        async function generateDeploymentPatch(violationId, index) {
            if (!currentScanData) return;

            try {
                const response = await fetch('/api/generate-deployment-patches', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        scanId: currentScanData.scanId,
                        violations: [currentScanData.violations[index]],
                        platform: selectedPlatform,
                        options: {}
                    })
                });

                const data = await response.json();

                if (data.success) {
                    alert(\`Deployment patch generated successfully!\\nPatch ID: \${data.patchId}\\nEstimated deployment time: \${data.summary.estimatedTime} minutes\`);
                    
                    // Offer to deploy immediately
                    if (confirm('Would you like to deploy this patch now?')) {
                        deployPatch(data.patchId);
                    }
                } else {
                    throw new Error(data.error || 'Patch generation failed');
                }
            } catch (error) {
                console.error('Patch generation error:', error);
                alert('Patch generation failed: ' + error.message);
            }
        }

        async function deployPatch(patchId) {
            const deploymentConfig = {
                platform: selectedPlatform,
                method: 'manual', // For demo purposes
                backupEnabled: true
            };

            try {
                const response = await fetch('/api/deploy-patches', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        patchId: patchId,
                        deploymentConfig: deploymentConfig
                    })
                });

                const data = await response.json();

                if (data.success) {
                    alert(\`Deployment successful!\\nDeployment ID: \${data.deploymentId}\\nBackup ID: \${data.backupId}\`);
                } else {
                    throw new Error(data.error || 'Deployment failed');
                }
            } catch (error) {
                console.error('Deployment error:', error);
                alert('Deployment failed: ' + error.message);
            }
        }

        async function previewViolation(selector) {
            if (!selector || !currentScanData) return;

            try {
                const response = await fetch('/api/visual-preview', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: currentScanData.url,
                        violationSelector: selector,
                        simulationType: 'normal'
                    })
                });

                const data = await response.json();

                if (data.success) {
                    // Open preview in new window
                    const previewWindow = window.open('', '_blank', 'width=1200,height=800');
                    previewWindow.document.write(\`
                        <html>
                            <head><title>Violation Preview</title></head>
                            <body style="margin:0;padding:20px;background:#f5f5f5;">
                                <h2>Violation Preview: \${selector}</h2>
                                <img src="\${data.screenshot}" style="max-width:100%;border:1px solid #ddd;border-radius:5px;">
                            </body>
                        </html>
                    \`);
                } else {
                    throw new Error(data.error || 'Preview generation failed');
                }
            } catch (error) {
                console.error('Preview error:', error);
                alert('Preview generation failed: ' + error.message);
            }
        }

        // Bulk operations
        function addBulkUrl() {
            const urlInput = document.getElementById('bulkUrl');
            const url = urlInput.value.trim();
            
            if (!url) return;
            
            if (bulkUrls.includes(url)) {
                alert('URL already added');
                return;
            }
            
            if (bulkUrls.length >= 10) {
                alert('Maximum 10 URLs allowed');
                return;
            }
            
            bulkUrls.push(url);
            urlInput.value = '';
            updateUrlList();
        }

        function updateUrlList() {
            const urlList = document.getElementById('urlList');
            const bulkScanBtn = document.getElementById('bulkScanBtn');
            
            if (bulkUrls.length === 0) {
                urlList.innerHTML = '<p style="color: #666; text-align: center;">No URLs added yet</p>';
                bulkScanBtn.disabled = true;
            } else {
                urlList.innerHTML = bulkUrls.map((url, index) => \`
                    <div class="url-item">
                        <span>\${url}</span>
                        <button class="remove-url" onclick="removeBulkUrl(\${index})">Remove</button>
                    </div>
                \`).join('');
                bulkScanBtn.disabled = false;
            }
        }

        function removeBulkUrl(index) {
            bulkUrls.splice(index, 1);
            updateUrlList();
        }

        async function startBulkScan() {
            if (bulkUrls.length === 0) return;

            const bulkScanBtn = document.getElementById('bulkScanBtn');
            bulkScanBtn.disabled = true;
            bulkScanBtn.textContent = 'Scanning...';

            try {
                const response = await fetch('/api/bulk-scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        urls: bulkUrls,
                        userId: document.getElementById('userId').value
                    })
                });

                const data = await response.json();

                if (data.success) {
                    alert(\`Bulk scan completed!\\nTotal URLs: \${data.totalUrls}\\nSuccessful: \${data.completedScans}\\nFailed: \${data.failedScans}\\nTotal Violations: \${data.summary.totalViolations}\`);
                    
                    // Clear bulk URLs
                    bulkUrls = [];
                    updateUrlList();
                    loadAnalytics();
                } else {
                    throw new Error(data.error || 'Bulk scan failed');
                }
            } catch (error) {
                console.error('Bulk scan error:', error);
                alert('Bulk scan failed: ' + error.message);
            } finally {
                bulkScanBtn.disabled = false;
                bulkScanBtn.textContent = '🚀 Start Bulk Scan';
            }
        }

        // Analytics
        async function loadAnalytics() {
            try {
                const response = await fetch('/api/analytics');
                const data = await response.json();

                if (data.success) {
                    document.getElementById('totalScans').textContent = data.analytics.totalScans;
                    document.getElementById('avgViolations').textContent = data.analytics.avgViolations.toFixed(1);
                    document.getElementById('deploymentSuccess').textContent = '95%'; // Mock data
                    document.getElementById('timesSaved').textContent = Math.round(data.analytics.totalScans * 2.5); // Mock calculation
                }
            } catch (error) {
                console.error('Analytics error:', error);
            }
        }

        // Load analytics on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadAnalytics();
        });

        // Allow Enter key to add bulk URLs
        document.getElementById('bulkUrl').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                addBulkUrl();
            }
        });
    </script>
</body>
</html>`);
});

// Start server
app.listen(PORT, () => {
    console.log('🛡️ SentryPrime Enterprise Dashboard running on port', PORT);
    console.log('🌐 Health check: http://localhost:' + PORT + '/health');
    console.log('📊 Dashboard: http://localhost:' + PORT + '/');
    console.log('🗄️ Database:', db ? 'Connected' : 'Standalone mode');
    console.log('🤖 OpenAI:', openai ? 'Connected' : 'Standalone mode');
    console.log('🚀 Deployment Features:', ENABLE_DEPLOYMENT_FEATURES === 'true' ? 'Enabled' : 'Disabled');
});
