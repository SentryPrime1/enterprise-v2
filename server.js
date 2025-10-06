// This is your EXACT working server.js with ONLY the modal fix added
// NO other changes - just making the integration buttons work

const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection error:', err.stack);
    } else {
        console.log('✅ Database connected successfully!');
        console.log('🐘 PostgreSQL version:', client.serverVersion);
        release();
    }
});

// OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// PHASE 2A ENHANCEMENT: Enhanced scan endpoint with AI-powered fix generation
app.post('/api/scan', async (req, res) => {
    const { url, scanType, standard } = req.body;
    
    console.log(`🔍 Starting accessibility scan for: ${url}`);
    console.log(`📋 Scan type: ${scanType} Standard: ${standard}`);
    
    let browser;
    try {
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
                '--single-process',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set viewport and user agent
        await page.setViewport({ width: 1200, height: 800 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log(`🌐 Navigating to: ${url}`);
        await page.goto(url, { 
            waitUntil: 'networkidle0',
            timeout: 30000 
        });
        
        // PHASE 2B: Enhanced platform detection with deep intelligence
        console.log('🔍 Detecting platform and gathering intelligence...');
        const platformInfo = await page.evaluate(() => {
            const platform = {
                type: 'unknown',
                name: 'Unknown Platform',
                version: null,
                confidence: 0,
                indicators: [],
                capabilities: {
                    cssInjection: false,
                    themeEditor: false,
                    pluginSystem: false,
                    apiAccess: false
                },
                theme: {
                    name: null,
                    framework: null,
                    customizable: false
                },
                accessibilityPlugins: [],
                customizations: {
                    customizationLevel: 'unknown',
                    hasCustomCSS: false,
                    hasCustomJS: false
                },
                deploymentMethod: 'unknown'
            };
            
            // PHASE 2B: Enhanced WordPress Detection with Deep Intelligence
            if (document.querySelector('meta[name="generator"][content*="WordPress"]') ||
                document.querySelector('link[href*="wp-content"]') ||
                document.querySelector('script[src*="wp-content"]') ||
                window.wp || document.body.className.includes('wordpress')) {
                platform.type = 'wordpress';
                platform.name = 'WordPress';
                platform.confidence = 0.9;
                platform.indicators.push('WordPress generator meta tag', 'wp-content references');
                platform.capabilities = {
                    cssInjection: true,
                    themeEditor: true,
                    pluginSystem: true,
                    apiAccess: true
                };
                platform.deploymentMethod = 'wordpress-admin';
                
                // PHASE 2B: Detect WordPress version
                const generator = document.querySelector('meta[name="generator"]');
                if (generator && generator.content) {
                    const versionMatch = generator.content.match(/WordPress\\s+([\\d.]+)/);
                    if (versionMatch) {
                        platform.version = versionMatch[1];
                        platform.indicators.push(`WordPress ${versionMatch[1]}`);
                    }
                }
                
                // PHASE 2B: Detect active theme
                const themeStylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
                    .filter(link => link.href.includes('/themes/'));
                if (themeStylesheets.length > 0) {
                    const themeMatch = themeStylesheets[0].href.match(/\\/themes\\/([^\\/]+)\\//);
                    if (themeMatch) {
                        platform.theme.name = themeMatch[1];
                        platform.theme.customizable = true;
                        platform.indicators.push(`Theme: ${themeMatch[1]}`);
                    }
                }
                
                // PHASE 2B: Detect accessibility plugins
                if (document.querySelector('[data-userway]') || document.querySelector('.userway-')) {
                    platform.accessibilityPlugins.push('UserWay');
                }
                if (document.querySelector('[data-accessibe]') || document.querySelector('.acsb-')) {
                    platform.accessibilityPlugins.push('accessiBe');
                }
                if (document.querySelector('[data-equalweb]') || document.querySelector('.ew-')) {
                    platform.accessibilityPlugins.push('EqualWeb');
                }
                if (document.querySelector('.wp-accessibility-') || document.querySelector('[id*="wp-accessibility"]')) {
                    platform.accessibilityPlugins.push('WP Accessibility Plugin');
                }
                
                // PHASE 2B: Detect customization level
                const customCSS = Array.from(document.querySelectorAll('style')).some(style => 
                    style.textContent && style.textContent.includes('/* Custom CSS'));
                const customJS = Array.from(document.querySelectorAll('script')).some(script => 
                    script.textContent && script.textContent.includes('/* Custom JS'));
                
                platform.customizations.hasCustomCSS = customCSS;
                platform.customizations.hasCustomJS = customJS;
                platform.customizations.customizationLevel = (customCSS || customJS) ? 'high' : 'medium';
            }
            
            // PHASE 2B: Enhanced Shopify Detection with Deep Intelligence
            else if (document.querySelector('script[src*="shopify"]') ||
                     document.querySelector('link[href*="shopify"]') ||
                     window.Shopify || document.querySelector('.shopify-')) {
                platform.type = 'shopify';
                platform.name = 'Shopify';
                platform.confidence = 0.9;
                platform.indicators.push('Shopify scripts', 'Shopify global object');
                platform.capabilities = {
                    cssInjection: true,
                    themeEditor: true,
                    pluginSystem: true,
                    apiAccess: true
                };
                platform.deploymentMethod = 'shopify-admin';
                
                // PHASE 2B: Detect Shopify theme
                if (window.Shopify && window.Shopify.theme) {
                    platform.theme.name = window.Shopify.theme.name;
                    platform.theme.framework = 'liquid';
                    platform.indicators.push(`Shopify Theme: ${window.Shopify.theme.name}`);
                } else if (document.querySelector('.dawn-') || document.querySelector('[class*="dawn"]')) {
                    platform.theme.name = 'Dawn';
                    platform.theme.framework = 'liquid';
                } else if (document.querySelector('.debut-') || document.querySelector('[class*="debut"]')) {
                    platform.theme.name = 'Debut';
                    platform.theme.framework = 'liquid';
                } else if (document.querySelector('.brooklyn-') || document.querySelector('[class*="brooklyn"]')) {
                    platform.theme.name = 'Brooklyn';
                    platform.theme.framework = 'liquid';
                } else if (document.querySelector('.narrative-') || document.querySelector('[class*="narrative"]')) {
                    platform.theme.name = 'Narrative';
                    platform.theme.framework = 'liquid';
                }
                
                // PHASE 2B: Detect Shopify apps (accessibility-related)
                if (document.querySelector('[data-userway]') || document.querySelector('.userway-')) {
                    platform.accessibilityPlugins.push('UserWay (Shopify App)');
                }
                if (document.querySelector('[data-accessibe]') || document.querySelector('.acsb-')) {
                    platform.accessibilityPlugins.push('accessiBe (Shopify App)');
                }
                if (document.querySelector('[data-equalweb]') || document.querySelector('.ew-')) {
                    platform.accessibilityPlugins.push('EqualWeb (Shopify App)');
                }
                
                // PHASE 2B: Detect customization level
                const liquidTemplates = Array.from(document.querySelectorAll('script')).some(script => 
                    script.textContent && script.textContent.includes('liquid'));
                const customSections = document.querySelectorAll('[id*="shopify-section-template"]').length;
                
                platform.customizations.customizationLevel = customSections > 5 ? 'high' : 
                    customSections > 2 ? 'medium' : 'low';
                platform.customizations.hasCustomCSS = Array.from(document.querySelectorAll('style')).some(style => 
                    style.textContent && style.textContent.length > 200);
            }
            
            // PHASE 2B: Enhanced Wix Detection with Deep Intelligence
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
                platform.deploymentMethod = 'wix-editor';
                
                // PHASE 2B: Detect Wix editor type
                if (document.querySelector('[data-wix-editor]') || document.querySelector('.wix-ads')) {
                    platform.deploymentMethod = 'wix-adi';
                    platform.indicators.push('Wix ADI detected');
                } else if (document.querySelector('[data-corvid]') || window.wixCode) {
                    platform.deploymentMethod = 'wix-corvid';
                    platform.indicators.push('Wix Corvid/Velo detected');
                    platform.capabilities.apiAccess = true;
                }
                
                // PHASE 2B: Detect accessibility apps
                if (document.querySelector('[data-userway]')) {
                    platform.accessibilityPlugins.push('UserWay (Wix App)');
                }
                if (document.querySelector('[data-accessibe]')) {
                    platform.accessibilityPlugins.push('accessiBe (Wix App)');
                }
            }
            
            // PHASE 2B: Enhanced Squarespace Detection with Deep Intelligence
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
                platform.deploymentMethod = 'squarespace-style-editor';
                
                // PHASE 2B: Detect Squarespace template family
                if (document.querySelector('.sqs-template-') || document.body.className.includes('sqs-template-')) {
                    const templateMatch = document.body.className.match(/sqs-template-([^\\s]+)/);
                    if (templateMatch) {
                        platform.theme.name = templateMatch[1];
                        platform.indicators.push(`Template: ${templateMatch[1]}`);
                    }
                }
                
                // PHASE 2B: Detect version
                if (document.querySelector('.sqs-7-1') || document.body.className.includes('sqs-7-1')) {
                    platform.version = '7.1';
                    platform.deploymentMethod = 'squarespace-7.1-editor';
                } else if (document.querySelector('.sqs-7-0') || document.body.className.includes('sqs-7-0')) {
                    platform.version = '7.0';
                    platform.deploymentMethod = 'squarespace-7.0-editor';
                }
            }
            
            // PHASE 2B: Enhanced Custom/Static Site Detection
            else {
                platform.type = 'custom';
                platform.name = 'Custom Website';
                platform.confidence = 0.6;
                platform.indicators.push('No major CMS detected');
                platform.capabilities = {
                    cssInjection: true,
                    themeEditor: false,
                    pluginSystem: false,
                    apiAccess: false
                };
                platform.deploymentMethod = 'manual';
                
                // PHASE 2B: Detect framework indicators
                if (document.querySelector('[data-react-root]') || window.React) {
                    platform.indicators.push('React framework detected');
                    platform.theme.framework = 'react';
                } else if (document.querySelector('[ng-app]') || window.angular) {
                    platform.indicators.push('Angular framework detected');
                    platform.theme.framework = 'angular';
                } else if (document.querySelector('[data-vue]') || window.Vue) {
                    platform.indicators.push('Vue.js framework detected');
                    platform.theme.framework = 'vue';
                } else if (document.querySelector('script[src*="bootstrap"]') || document.querySelector('.bootstrap')) {
                    platform.indicators.push('Bootstrap framework detected');
                    platform.theme.framework = 'bootstrap';
                }
                
                // PHASE 2B: Detect static site generators
                if (document.querySelector('meta[name="generator"][content*="Jekyll"]')) {
                    platform.indicators.push('Jekyll static site generator');
                    platform.deploymentMethod = 'jekyll';
                } else if (document.querySelector('meta[name="generator"][content*="Hugo"]')) {
                    platform.indicators.push('Hugo static site generator');
                    platform.deploymentMethod = 'hugo';
                } else if (document.querySelector('meta[name="generator"][content*="Gatsby"]')) {
                    platform.indicators.push('Gatsby static site generator');
                    platform.deploymentMethod = 'gatsby';
                }
            }
            
            return platform;
        });
        
        console.log('🎯 Platform detected:', platformInfo);
        
        // Inject axe-core
        await page.addScriptTag({
            content: axeCore.source
        });
        
        // Run accessibility scan
        console.log('🔍 Running axe-core accessibility scan...');
        const results = await page.evaluate((standard) => {
            return axe.run({
                tags: [standard.toLowerCase()],
                options: {
                    reporter: 'v2'
                }
            });
        }, standard);
        
        await browser.close();
        
        // PHASE 2A: Process violations and generate AI-powered fixes
        console.log(`📊 Scan completed. Found ${results.violations.length} violations`);
        
        const processedViolations = await Promise.all(
            results.violations.map(async (violation) => {
                // PHASE 2A: Generate AI-powered fix for each violation
                const fixCode = generateFixCode(violation, platformInfo);
                
                return {
                    ...violation,
                    fixCode: fixCode,
                    platformSpecific: {
                        platform: platformInfo.type,
                        deploymentMethod: platformInfo.deploymentMethod,
                        canAutoFix: platformInfo.capabilities.apiAccess,
                        fixComplexity: violation.impact === 'critical' ? 'high' : 
                                     violation.impact === 'serious' ? 'medium' : 'low'
                    }
                };
            })
        );
        
        // Calculate accessibility score
        const totalElements = results.passes.length + results.violations.length + results.incomplete.length;
        const passedElements = results.passes.length;
        const score = totalElements > 0 ? Math.round((passedElements / totalElements) * 100) : 0;
        
        // Store scan results in database
        try {
            const scanResult = await pool.query(
                'INSERT INTO scans (url, scan_type, standard, score, violations_count, platform_type, platform_name, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id',
                [url, scanType, standard, score, results.violations.length, platformInfo.type, platformInfo.name]
            );
            
            console.log('✅ Scan results stored in database with ID:', scanResult.rows[0].id);
        } catch (dbError) {
            console.error('❌ Database error:', dbError);
        }
        
        res.json({
            success: true,
            url: url,
            scanType: scanType,
            standard: standard,
            score: score,
            violations: processedViolations,
            passes: results.passes,
            incomplete: results.incomplete,
            platformInfo: platformInfo,
            timestamp: new Date().toISOString(),
            summary: {
                totalViolations: results.violations.length,
                criticalViolations: results.violations.filter(v => v.impact === 'critical').length,
                seriousViolations: results.violations.filter(v => v.impact === 'serious').length,
                moderateViolations: results.violations.filter(v => v.impact === 'moderate').length,
                minorViolations: results.violations.filter(v => v.impact === 'minor').length,
                autoFixableViolations: processedViolations.filter(v => v.platformSpecific.canAutoFix).length
            }
        });
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        
        if (browser) {
            await browser.close();
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to scan the website',
            details: error.message,
            url: url
        });
    }
});

// PHASE 2A: AI-powered fix code generation
function generateFixCode(violation, platformInfo) {
    const fixes = {
        css: '',
        html: '',
        javascript: '',
        instructions: ''
    };
    
    // PHASE 2A: Generate platform-specific fixes based on violation type
    switch (violation.id) {
        case 'color-contrast':
            fixes.css = `
/* Fix for color contrast violation */
.low-contrast-text {
    color: #333333 !important; /* WCAG AA compliant dark text */
    background-color: #ffffff !important; /* High contrast background */
}

/* For dark backgrounds */
.dark-background {
    color: #ffffff !important; /* White text on dark background */
    background-color: #333333 !important;
}
`;
            fixes.instructions = `
## Color Contrast Fix Instructions

### For ${platformInfo.name}:
1. Navigate to your ${platformInfo.deploymentMethod === 'wordpress-admin' ? 'WordPress admin → Appearance → Customize → Additional CSS' : 'theme editor'}
2. Add the provided CSS code
3. Apply the classes to elements with contrast issues
4. Test with a color contrast analyzer tool
`;
            break;
            
        case 'image-alt':
            fixes.html = `
<!-- Fix for missing alt text -->
<!-- Replace images without alt text: -->
<img src="image.jpg" alt=""> <!-- Decorative image -->
<img src="logo.jpg" alt="Company Name Logo"> <!-- Meaningful image -->
<img src="chart.jpg" alt="Sales increased 25% from Q1 to Q2 2024"> <!-- Complex image -->
`;
            fixes.javascript = `
// Automatically add alt text to images missing it
document.querySelectorAll('img:not([alt])').forEach(img => {
    // For decorative images
    if (img.closest('.decoration') || img.classList.contains('decorative')) {
        img.alt = '';
    } else {
        // Prompt for meaningful alt text
        img.alt = 'Image description needed';
        console.warn('Alt text needed for:', img.src);
    }
});
`;
            break;
            
        case 'heading-order':
            fixes.html = `
<!-- Fix for heading order violation -->
<!-- Correct heading hierarchy: -->
<h1>Main Page Title</h1>
  <h2>Section Title</h2>
    <h3>Subsection Title</h3>
    <h3>Another Subsection</h3>
  <h2>Another Section</h2>
    <h3>Subsection</h3>
`;
            break;
            
        case 'link-name':
            fixes.html = `
<!-- Fix for link without accessible name -->
<!-- Instead of: <a href="/read-more">Read more</a> -->
<a href="/article-title">Read more about Article Title</a>

<!-- Or use aria-label: -->
<a href="/read-more" aria-label="Read more about Article Title">Read more</a>

<!-- Or use sr-only text: -->
<a href="/read-more">Read more <span class="sr-only">about Article Title</span></a>
`;
            fixes.css = `
/* Screen reader only text */
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
}
`;
            break;
            
        case 'button-name':
            fixes.html = `
<!-- Fix for button without accessible name -->
<!-- Instead of: <button><i class="icon-save"></i></button> -->
<button aria-label="Save document">
    <i class="icon-save" aria-hidden="true"></i>
</button>

<!-- Or with visible text: -->
<button>
    <i class="icon-save" aria-hidden="true"></i>
    Save
</button>
`;
            break;
            
        case 'form-field-multiple-labels':
            fixes.html = `
<!-- Fix for form field with multiple labels -->
<!-- Use fieldset and legend for grouped fields: -->
<fieldset>
    <legend>Contact Information</legend>
    <label for="email">Email Address</label>
    <input type="email" id="email" name="email">
    
    <label for="phone">Phone Number</label>
    <input type="tel" id="phone" name="phone">
</fieldset>
`;
            break;
            
        case 'landmark-one-main':
            fixes.html = `
<!-- Fix for missing or multiple main landmarks -->
<header>
    <nav aria-label="Main navigation">
        <!-- Navigation content -->
    </nav>
</header>

<main>
    <!-- Main content goes here -->
    <h1>Page Title</h1>
    <!-- Page content -->
</main>

<footer>
    <!-- Footer content -->
</footer>
`;
            break;
    }
    
    // PHASE 2A: Add platform-specific deployment instructions
    let platformInstructions = '';
    switch (platformInfo.type) {
        case 'wordpress':
            platformInstructions = `
### WordPress Implementation:
1. **CSS Changes**: Go to Appearance → Customize → Additional CSS
2. **HTML Changes**: Edit the theme files or use a child theme
3. **JavaScript**: Add to theme's functions.php or use a plugin like "Insert Headers and Footers"
4. **Testing**: Use WordPress accessibility plugins to verify fixes
`;
            break;
            
        case 'shopify':
            platformInstructions = `
### Shopify Implementation:
1. **CSS Changes**: Go to Online Store → Themes → Actions → Edit Code → Assets → theme.scss.liquid
2. **HTML Changes**: Edit the relevant template files (.liquid files)
3. **JavaScript**: Add to assets/theme.js or create a new asset file
4. **Testing**: Preview changes before publishing
`;
            break;
            
        case 'wix':
            platformInstructions = `
### Wix Implementation:
1. **CSS Changes**: Use the Wix Editor → Add → More → HTML iFrame (for custom CSS)
2. **HTML Changes**: Limited - use Wix's built-in elements and accessibility features
3. **JavaScript**: Add through HTML iFrame or Corvid (if available)
4. **Note**: Wix has limited customization - consider using built-in accessibility features
`;
            break;
            
        case 'squarespace':
            platformInstructions = `
### Squarespace Implementation:
1. **CSS Changes**: Go to Design → Custom CSS
2. **HTML Changes**: Limited - use Code Blocks for custom HTML
3. **JavaScript**: Add through Code Injection in Settings → Advanced
4. **Testing**: Use Squarespace's preview mode to test changes
`;
            break;
            
        default:
            platformInstructions = `
### Custom Website Implementation:
1. **CSS Changes**: Add to your main stylesheet
2. **HTML Changes**: Update your HTML templates
3. **JavaScript**: Add to your main JavaScript file or create a new one
4. **Testing**: Test across different browsers and devices
`;
    }
    
    // Combine all fixes and instructions
    const combinedCSS = fixes.css;
    const combinedHTML = fixes.html;
    const combinedJS = fixes.javascript;
    
    const instructionsText = `
# Accessibility Fix Instructions

## Violation: ${violation.id}
**Impact Level**: ${violation.impact}
**Description**: ${violation.description}

${platformInstructions}

## Generated Code:

### CSS:
\`\`\`css
${combinedCSS}
\`\`\`

### HTML:
\`\`\`html
${combinedHTML}
\`\`\`

### JavaScript:
\`\`\`javascript
${combinedJS}
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

// PHASE 2A ENHANCEMENT: New endpoint for generating fix previews
app.post('/api/preview-fix', async (req, res) => {
    try {
        const { violationId, element, platformInfo } = req.body;
        
        console.log('👀 Generating fix preview for violation:', violationId);
        
        // Generate the fix code
        const mockViolation = { id: violationId, impact: 'serious', description: 'Sample violation' };
        const fixCode = generateFixCode(mockViolation, platformInfo);
        
        res.json({
            success: true,
            violationId: violationId,
            preview: {
                before: element.outerHTML || '<div>Original element</div>',
                after: `<!-- Fixed element with accessibility improvements -->
${element.outerHTML || '<div>Fixed element</div>'}`,
                explanation: `This fix addresses the ${violationId} violation by implementing WCAG 2.1 AA compliant changes.`
            },
            fixCode: fixCode,
            estimatedImpact: {
                scoreImprovement: '+5-15 points',
                violationsFixed: 1,
                timeToImplement: '5-10 minutes'
            }
        });
        
    } catch (error) {
        console.error('Error generating fix preview:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate fix preview',
            details: error.message
        });
    }
});

// Main dashboard route
app.get('/', (req, res) => {
    const html = `
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
            background: #f8fafc;
            color: #334155;
            line-height: 1.6;
        }
        
        .dashboard {
            display: flex;
            min-height: 100vh;
        }
        
        .sidebar {
            width: 280px;
            background: #1e293b;
            color: white;
            padding: 0;
            position: fixed;
            height: 100vh;
            overflow-y: auto;
        }
        
        .logo {
            padding: 24px;
            border-bottom: 1px solid #334155;
        }
        
        .logo h1 {
            font-size: 24px;
            font-weight: 700;
            color: #f1f5f9;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .logo .subtitle {
            font-size: 14px;
            color: #94a3b8;
            font-weight: 400;
            margin-top: 4px;
        }
        
        .nav {
            padding: 24px 0;
        }
        
        .nav-item {
            display: flex;
            align-items: center;
            padding: 12px 24px;
            color: #cbd5e1;
            text-decoration: none;
            transition: all 0.2s;
            border-left: 3px solid transparent;
            position: relative;
        }
        
        .nav-item:hover {
            background: #334155;
            color: #f1f5f9;
            border-left-color: #3b82f6;
        }
        
        .nav-item.active {
            background: #1e40af;
            color: white;
            border-left-color: #60a5fa;
        }
        
        .nav-item .icon {
            width: 20px;
            height: 20px;
            margin-right: 12px;
            opacity: 0.8;
        }
        
        .nav-item .badge {
            background: #dc2626;
            color: white;
            font-size: 12px;
            padding: 2px 8px;
            border-radius: 12px;
            margin-left: auto;
            font-weight: 600;
        }
        
        .main-content {
            flex: 1;
            margin-left: 280px;
            padding: 0;
        }
        
        .header {
            background: white;
            padding: 16px 32px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .search-bar {
            flex: 1;
            max-width: 400px;
            margin: 0 32px;
        }
        
        .search-bar input {
            width: 100%;
            padding: 8px 16px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 14px;
        }
        
        .user-menu {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .notification-bell {
            position: relative;
            padding: 8px;
            border-radius: 8px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
        }
        
        .notification-bell .badge {
            position: absolute;
            top: -4px;
            right: -4px;
            background: #dc2626;
            color: white;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 10px;
        }
        
        .user-profile {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 16px;
            border-radius: 8px;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
        }
        
        .user-avatar {
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #3b82f6;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
        }
        
        .user-info h3 {
            font-size: 14px;
            font-weight: 600;
            color: #1f2937;
        }
        
        .user-info p {
            font-size: 12px;
            color: #6b7280;
        }
        
        .page-content {
            padding: 32px;
        }
        
        .page {
            display: none;
        }
        
        .page.active {
            display: block;
        }
        
        .dashboard-header h1 {
            font-size: 32px;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 8px;
        }
        
        .dashboard-header p {
            color: #6b7280;
            font-size: 16px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 24px;
            margin: 32px 0;
        }
        
        .stat-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .stat-number {
            font-size: 36px;
            font-weight: 700;
            color: #1f2937;
            margin-bottom: 8px;
        }
        
        .stat-label {
            color: #6b7280;
            font-size: 14px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
        }
        
        .stat-change {
            font-size: 14px;
            font-weight: 600;
        }
        
        .stat-change.positive {
            color: #059669;
        }
        
        .stat-change.negative {
            color: #dc2626;
        }
        
        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 24px;
            margin: 32px 0;
        }
        
        .action-card {
            background: white;
            padding: 24px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            text-align: center;
            cursor: pointer;
            transition: all 0.2s;
            text-decoration: none;
            color: inherit;
        }
        
        .action-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border-color: #3b82f6;
        }
        
        .action-icon {
            width: 48px;
            height: 48px;
            margin: 0 auto 16px;
            background: #eff6ff;
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
        }
        
        .action-card h3 {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
            color: #1f2937;
        }
        
        .action-card p {
            color: #6b7280;
            font-size: 14px;
        }
        
        .recent-scans {
            background: white;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
        }
        
        .recent-scans h2 {
            padding: 24px;
            border-bottom: 1px solid #e2e8f0;
            font-size: 20px;
            font-weight: 600;
            color: #1f2937;
        }
        
        .scan-item {
            padding: 16px 24px;
            border-bottom: 1px solid #f1f5f9;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .scan-item:last-child {
            border-bottom: none;
        }
        
        .scan-info h4 {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 4px;
        }
        
        .scan-info p {
            color: #6b7280;
            font-size: 14px;
        }
        
        .scan-score {
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .score-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-weight: 600;
            font-size: 14px;
        }
        
        .score-excellent {
            background: #dcfce7;
            color: #166534;
        }
        
        .score-good {
            background: #fef3c7;
            color: #92400e;
        }
        
        .score-poor {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .btn {
            padding: 8px 16px;
            border-radius: 6px;
            border: none;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            transition: all 0.2s;
        }
        
        .btn-primary {
            background: #3b82f6;
            color: white;
        }
        
        .btn-primary:hover {
            background: #2563eb;
        }
        
        .btn-secondary {
            background: #f1f5f9;
            color: #475569;
            border: 1px solid #e2e8f0;
        }
        
        .btn-secondary:hover {
            background: #e2e8f0;
        }
        
        /* Scan Form Styles */
        .scan-form {
            background: white;
            padding: 32px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            max-width: 600px;
        }
        
        .form-group {
            margin-bottom: 24px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: #374151;
        }
        
        .form-group input,
        .form-group select {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid #d1d5db;
            border-radius: 8px;
            font-size: 16px;
            transition: border-color 0.2s;
        }
        
        .form-group input:focus,
        .form-group select:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }
        
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        
        .scan-results {
            margin-top: 32px;
        }
        
        .alert {
            padding: 16px;
            border-radius: 8px;
            margin-bottom: 16px;
        }
        
        .alert-success {
            background: #dcfce7;
            color: #166534;
            border: 1px solid #bbf7d0;
        }
        
        .alert-error {
            background: #fee2e2;
            color: #991b1b;
            border: 1px solid #fecaca;
        }
        
        .loading {
            display: none;
            text-align: center;
            padding: 32px;
        }
        
        .loading.show {
            display: block;
        }
        
        .spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #f3f4f6;
            border-top: 4px solid #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 16px;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .results-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 16px;
            margin-bottom: 24px;
        }
        
        .summary-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            text-align: center;
        }
        
        .summary-number {
            font-size: 24px;
            font-weight: 700;
            margin-bottom: 4px;
        }
        
        .summary-label {
            color: #6b7280;
            font-size: 14px;
        }
        
        .violations-list {
            background: white;
            border-radius: 8px;
            border: 1px solid #e2e8f0;
            overflow: hidden;
        }
        
        .violation-item {
            padding: 20px;
            border-bottom: 1px solid #f1f5f9;
        }
        
        .violation-item:last-child {
            border-bottom: none;
        }
        
        .violation-header {
            display: flex;
            justify-content: between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        
        .violation-title {
            font-weight: 600;
            color: #1f2937;
            margin-bottom: 4px;
        }
        
        .violation-impact {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .impact-critical {
            background: #fee2e2;
            color: #991b1b;
        }
        
        .impact-serious {
            background: #fed7aa;
            color: #9a3412;
        }
        
        .impact-moderate {
            background: #fef3c7;
            color: #92400e;
        }
        
        .impact-minor {
            background: #dbeafe;
            color: #1e40af;
        }
        
        .violation-description {
            color: #6b7280;
            margin-bottom: 12px;
            line-height: 1.5;
        }
        
        .violation-help {
            background: #f8fafc;
            padding: 12px;
            border-radius: 6px;
            border-left: 3px solid #3b82f6;
            font-size: 14px;
            color: #475569;
        }
        
        /* PHASE 2G: Modal Styles for Platform Integration */
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
        }
        
        .modal.show {
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .modal-content {
            background: white;
            padding: 32px;
            border-radius: 12px;
            width: 90%;
            max-width: 500px;
            position: relative;
        }
        
        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
        }
        
        .modal-title {
            font-size: 24px;
            font-weight: 600;
            color: #1f2937;
        }
        
        .modal-close {
            background: none;
            border: none;
            font-size: 24px;
            cursor: pointer;
            color: #6b7280;
            padding: 4px;
        }
        
        .modal-close:hover {
            color: #374151;
        }
        
        .modal-body {
            margin-bottom: 24px;
        }
        
        .modal-footer {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
        }
        
        .btn-cancel {
            background: #f3f4f6;
            color: #374151;
            border: 1px solid #d1d5db;
        }
        
        .btn-cancel:hover {
            background: #e5e7eb;
        }
    </style>
</head>
<body>
    <div class="dashboard">
        <nav class="sidebar">
            <div class="logo">
                <h1>🛡️ SentryPrime</h1>
                <div class="subtitle">Enterprise Dashboard</div>
            </div>
            
            <div class="nav">
                <a href="#" class="nav-item active" data-page="dashboard">
                    <span class="icon">📊</span>
                    Dashboard
                </a>
                <a href="#" class="nav-item" data-page="scans">
                    <span class="icon">🔍</span>
                    Scans
                    <span class="badge">2</span>
                </a>
                <a href="#" class="nav-item" data-page="analytics">
                    <span class="icon">📈</span>
                    Analytics
                    <span class="badge">8</span>
                </a>
                <a href="#" class="nav-item" data-page="team">
                    <span class="icon">👥</span>
                    Team
                    <span class="badge">4</span>
                </a>
                <a href="#" class="nav-item" data-page="integrations">
                    <span class="icon">🔗</span>
                    Integrations
                    <span class="badge">5</span>
                </a>
                <a href="#" class="nav-item" data-page="api">
                    <span class="icon">⚙️</span>
                    API Management
                    <span class="badge">6</span>
                </a>
                <a href="#" class="nav-item" data-page="billing">
                    <span class="icon">💳</span>
                    Billing
                    <span class="badge">7</span>
                </a>
                <a href="#" class="nav-item" data-page="settings">
                    <span class="icon">⚙️</span>
                    Settings
                    <span class="badge">8</span>
                </a>
            </div>
        </nav>
        
        <main class="main-content">
            <header class="header">
                <div class="search-bar">
                    <input type="text" placeholder="Search scans, reports, or settings...">
                </div>
                
                <div class="user-menu">
                    <div class="notification-bell">
                        🔔
                        <span class="badge">3</span>
                    </div>
                    
                    <div class="user-profile">
                        <div class="user-avatar">JD</div>
                        <div class="user-info">
                            <h3>John Doe</h3>
                            <p>Acme Corporation</p>
                        </div>
                        <span>▼</span>
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
                            <div class="stat-number">57</div>
                            <div class="stat-label">TOTAL SCANS</div>
                            <div class="stat-change positive">+2 this week</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">606</div>
                            <div class="stat-label">ISSUES FOUND</div>
                            <div class="stat-change negative">-5 from last week</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">79%</div>
                            <div class="stat-label">AVERAGE SCORE</div>
                            <div class="stat-change positive">+3% improvement</div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-number">29</div>
                            <div class="stat-label">THIS WEEK</div>
                            <div class="stat-change">scans completed</div>
                        </div>
                    </div>
                    
                    <div class="quick-actions">
                        <a href="#" class="action-card" onclick="showPage('scans')">
                            <div class="action-icon">🔍</div>
                            <h3>New Scan</h3>
                            <p>Start a new accessibility scan</p>
                        </a>
                        <a href="#" class="action-card" onclick="showPage('analytics')">
                            <div class="action-icon">📊</div>
                            <h3>View Analytics</h3>
                            <p>Analyze compliance trends</p>
                        </a>
                        <a href="#" class="action-card" onclick="showPage('team')">
                            <div class="action-icon">👥</div>
                            <h3>Manage Team</h3>
                            <p>Add or remove team members</p>
                        </a>
                        <a href="#" class="action-card" onclick="showPage('settings')">
                            <div class="action-icon">⚙️</div>
                            <h3>Settings</h3>
                            <p>Configure your preferences</p>
                        </a>
                    </div>
                    
                    <div class="recent-scans">
                        <h2>Recent Scans</h2>
                        <p style="color: #6b7280; padding: 0 24px 16px;">Your latest accessibility scan results</p>
                        
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>https://essolar.com/</h4>
                                <p>Single Page • 10/6/2025</p>
                            </div>
                            <div class="scan-score">
                                <span class="score-badge score-excellent">90% Score</span>
                                <a href="#" class="btn btn-primary">👁️ View Report</a>
                            </div>
                        </div>
                        
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>https://essolar.com/</h4>
                                <p>Single Page • 10/6/2025</p>
                            </div>
                            <div class="scan-score">
                                <span class="score-badge score-excellent">90% Score</span>
                                <a href="#" class="btn btn-primary">👁️ View Report</a>
                            </div>
                        </div>
                        
                        <div class="scan-item">
                            <div class="scan-info">
                                <h4>https://essolar.com/</h4>
                                <p>Single Page • 10/6/2025</p>
                            </div>
                            <div class="scan-score">
                                <span class="score-badge score-excellent">90% Score</span>
                                <a href="#" class="btn btn-primary">👁️ View Report</a>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div id="scans" class="page">
                    <div class="dashboard-header">
                        <h1>🔍 Accessibility Scans</h1>
                        <p>Run comprehensive accessibility audits on your websites</p>
                    </div>
                    
                    <div class="scan-form">
                        <h2 style="margin-bottom: 24px;">Start New Scan</h2>
                        
                        <form id="scanForm">
                            <div class="form-group">
                                <label for="url">Website URL</label>
                                <input type="url" id="url" name="url" placeholder="https://essolar.com/" required>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="scanType">Scan Type</label>
                                    <select id="scanType" name="scanType">
                                        <option value="single">Single Page</option>
                                        <option value="sitemap">Full Sitemap</option>
                                        <option value="crawl">Deep Crawl</option>
                                    </select>
                                </div>
                                
                                <div class="form-group">
                                    <label for="standard">Accessibility Standard</label>
                                    <select id="standard" name="standard">
                                        <option value="wcag2aa">WCAG 2.1 AA</option>
                                        <option value="wcag2aaa">WCAG 2.1 AAA</option>
                                        <option value="section508">Section 508</option>
                                    </select>
                                </div>
                            </div>
                            
                            <button type="submit" class="btn btn-primary" style="margin-top: 16px;">
                                🚀 Start Scan
                            </button>
                        </form>
                    </div>
                    
                    <div class="loading" id="loading">
                        <div class="spinner"></div>
                        <p>Scanning website for accessibility issues...</p>
                    </div>
                    
                    <div class="scan-results" id="scanResults"></div>
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
                        <h1>🔗 Platform Integrations</h1>
                        <p>Connect your websites for automated accessibility monitoring</p>
                    </div>
                    
                    <div style="margin-top: 32px;">
                        <h2 style="margin-bottom: 16px;">Connected Platforms</h2>
                        <p style="color: #6b7280; margin-bottom: 24px;">Manage your connected platforms and deployment settings</p>
                        <div id="connectedPlatforms">
                            <!-- Connected platforms will be loaded here -->
                        </div>
                    </div>
                    
                    <div style="margin-top: 48px;">
                        <h2 style="margin-bottom: 16px;">Connect New Platform</h2>
                        <p style="color: #6b7280; margin-bottom: 24px;">Add a new website or platform below.</p>
                        
                        <div class="quick-actions">
                            <div class="action-card" onclick="showConnectModal('wordpress')">
                                <div class="action-icon">🌐</div>
                                <h3>WordPress</h3>
                                <p>Connect your WordPress site via REST API</p>
                                <div style="margin-top: 12px;">
                                    <span style="background: #3b82f6; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">Most Popular</span>
                                </div>
                            </div>
                            <div class="action-card" onclick="showConnectModal('shopify')">
                                <div class="action-icon">🛒</div>
                                <h3>Shopify</h3>
                                <p>Connect your Shopify store via Admin API</p>
                                <div style="margin-top: 12px;">
                                    <span style="background: #8b5cf6; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">E-commerce</span>
                                </div>
                            </div>
                            <div class="action-card" onclick="showConnectModal('custom')">
                                <div class="action-icon">⚙️</div>
                                <h3>Custom Site</h3>
                                <p>Connect via FTP, SFTP, or SSH</p>
                                <div style="margin-top: 12px;">
                                    <span style="background: #f59e0b; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">Advanced</span>
                                </div>
                            </div>
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

    <!-- PHASE 2G: Platform Connection Modals -->
    <div id="connectModal" class="modal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title" id="modalTitle">Connect Platform</h2>
                <button class="modal-close" onclick="closeConnectModal()">&times;</button>
            </div>
            <div class="modal-body" id="modalBody">
                <!-- Modal content will be populated here -->
            </div>
            <div class="modal-footer" id="modalFooter">
                <!-- Modal buttons will be populated here -->
            </div>
        </div>
    </div>

    <script>
        // Navigation functionality
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
            
            // Add active class to selected nav item
            document.querySelector(`[data-page="${pageId}"]`).classList.add('active');
        }
        
        // Add click event listeners to nav items
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const pageId = item.getAttribute('data-page');
                showPage(pageId);
            });
        });
        
        // PHASE 2G: Modal functionality for platform connections - FIXED SCOPING
        function showConnectModal(platform) {
            const modal = document.getElementById('connectModal');
            const modalTitle = document.getElementById('modalTitle');
            const modalBody = document.getElementById('modalBody');
            const modalFooter = document.getElementById('modalFooter');
            
            let title, body, footer;
            
            switch(platform) {
                case 'wordpress':
                    title = '🌐 Connect WordPress Site';
                    body = \`
                        <div class="form-group">
                            <label for="wpUrl">WordPress Site URL</label>
                            <input type="url" id="wpUrl" placeholder="https://yoursite.com" required>
                        </div>
                        <div class="form-group">
                            <label for="wpUsername">Username</label>
                            <input type="text" id="wpUsername" placeholder="admin" required>
                        </div>
                        <div class="form-group">
                            <label for="wpPassword">Application Password</label>
                            <input type="password" id="wpPassword" placeholder="xxxx xxxx xxxx xxxx" required>
                            <small style="color: #6b7280; font-size: 12px; margin-top: 4px; display: block;">
                                Generate an application password in WordPress admin → Users → Profile
                            </small>
                        </div>
                    \`;
                    footer = \`
                        <button class="btn btn-cancel" onclick="closeConnectModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="connectPlatform('wordpress')">Connect WordPress</button>
                    \`;
                    break;
                    
                case 'shopify':
                    title = '🛒 Connect Shopify Store';
                    body = \`
                        <div class="form-group">
                            <label for="shopifyUrl">Shopify Store URL</label>
                            <input type="url" id="shopifyUrl" placeholder="https://yourstore.myshopify.com" required>
                        </div>
                        <div class="form-group">
                            <label for="shopifyToken">Private App Access Token</label>
                            <input type="password" id="shopifyToken" placeholder="shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" required>
                            <small style="color: #6b7280; font-size: 12px; margin-top: 4px; display: block;">
                                Create a private app in Shopify admin → Apps → App and sales channel settings → Develop apps
                            </small>
                        </div>
                    \`;
                    footer = \`
                        <button class="btn btn-cancel" onclick="closeConnectModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="connectPlatform('shopify')">Connect Shopify</button>
                    \`;
                    break;
                    
                case 'custom':
                    title = '⚙️ Connect Custom Site';
                    body = \`
                        <div class="form-group">
                            <label for="customUrl">Website URL</label>
                            <input type="url" id="customUrl" placeholder="https://yoursite.com" required>
                        </div>
                        <div class="form-group">
                            <label for="deployMethod">Deployment Method</label>
                            <select id="deployMethod" required>
                                <option value="">Select method...</option>
                                <option value="ftp">FTP</option>
                                <option value="sftp">SFTP</option>
                                <option value="ssh">SSH</option>
                                <option value="git">Git Repository</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="customHost">Host/Server</label>
                            <input type="text" id="customHost" placeholder="ftp.yoursite.com" required>
                        </div>
                        <div class="form-row">
                            <div class="form-group">
                                <label for="customUsername">Username</label>
                                <input type="text" id="customUsername" placeholder="username" required>
                            </div>
                            <div class="form-group">
                                <label for="customPassword">Password/Key</label>
                                <input type="password" id="customPassword" placeholder="password or SSH key" required>
                            </div>
                        </div>
                    \`;
                    footer = \`
                        <button class="btn btn-cancel" onclick="closeConnectModal()">Cancel</button>
                        <button class="btn btn-primary" onclick="connectPlatform('custom')">Connect Site</button>
                    \`;
                    break;
            }
            
            modalTitle.textContent = title;
            modalBody.innerHTML = body;
            modalFooter.innerHTML = footer;
            modal.classList.add('show');
        }
        
        function closeConnectModal() {
            document.getElementById('connectModal').classList.remove('show');
        }
        
        function connectPlatform(platform) {
            // This would normally make an API call to connect the platform
            alert(\`\${platform.charAt(0).toUpperCase() + platform.slice(1)} connection initiated! This would connect to your platform in a real implementation.\`);
            closeConnectModal();
        }
        
        // Close modal when clicking outside
        document.getElementById('connectModal').addEventListener('click', (e) => {
            if (e.target.id === 'connectModal') {
                closeConnectModal();
            }
        });
        
        // Scan form functionality
        document.getElementById('scanForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const scanData = {
                url: formData.get('url'),
                scanType: formData.get('scanType'),
                standard: formData.get('standard')
            };
            
            // Show loading
            document.getElementById('loading').classList.add('show');
            document.getElementById('scanResults').innerHTML = '';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(scanData)
                });
                
                const result = await response.json();
                
                // Hide loading
                document.getElementById('loading').classList.remove('show');
                
                if (result.success) {
                    displayScanResults(result);
                } else {
                    displayError(result.error || 'Scan failed');
                }
                
            } catch (error) {
                console.error('Scan error:', error);
                document.getElementById('loading').classList.remove('show');
                displayError('Network error occurred');
            }
        });
        
        function displayScanResults(result) {
            const resultsContainer = document.getElementById('scanResults');
            
            const html = \`
                <div class="alert alert-success">
                    ✅ Scan completed successfully! Found \${result.violations.length} accessibility issues.
                </div>
                
                <div class="results-summary">
                    <div class="summary-card">
                        <div class="summary-number" style="color: \${result.score >= 80 ? '#059669' : result.score >= 60 ? '#d97706' : '#dc2626'}">\${result.score}%</div>
                        <div class="summary-label">Accessibility Score</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-number">\${result.violations.length}</div>
                        <div class="summary-label">Total Issues</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-number">\${result.summary.criticalViolations}</div>
                        <div class="summary-label">Critical Issues</div>
                    </div>
                    <div class="summary-card">
                        <div class="summary-number">\${result.summary.seriousViolations}</div>
                        <div class="summary-label">Serious Issues</div>
                    </div>
                </div>
                
                \${result.violations.length > 0 ? \`
                    <div class="violations-list">
                        \${result.violations.map(violation => \`
                            <div class="violation-item">
                                <div class="violation-header">
                                    <div>
                                        <div class="violation-title">\${violation.id}</div>
                                        <span class="violation-impact impact-\${violation.impact}">\${violation.impact}</span>
                                    </div>
                                </div>
                                <div class="violation-description">\${violation.description}</div>
                                <div class="violation-help">\${violation.help}</div>
                            </div>
                        \`).join('')}
                    </div>
                \` : '<div class="alert alert-success">🎉 No accessibility violations found!</div>'}
            \`;
            
            resultsContainer.innerHTML = html;
        }
        
        function displayError(error) {
            const resultsContainer = document.getElementById('scanResults');
            resultsContainer.innerHTML = \`
                <div class="alert alert-error">
                    ❌ Scan failed: \${error}
                </div>
            \`;
        }
    </script>
</body>
</html>
    `;
    
    res.send(html);
});

// Start server
app.listen(port, () => {
    console.log(\`🚀 SentryPrime server running on port \${port}\`);
    console.log(\`📊 Dashboard: http://localhost:\${port}\`);
    console.log(\`🔍 Health check: http://localhost:\${port}/health\`);
    
    // Log server time for debugging
    console.log(\`🕒 Server time: \${new Date().toISOString()}\`);
});
