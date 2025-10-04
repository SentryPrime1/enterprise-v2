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

// PHASE 2D: Visual Preview Endpoint
app.post('/api/visual-preview', async (req, res) => {
    const { url, violation } = req.body;

    if (!url || !violation) {
        return res.status(400).json({ error: 'URL and violation data are required' });
    }

    let browser;
    try {
        console.log('👁️ Starting visual preview for:', url, 'violation:', violation.id);
        browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Inject highlighting CSS based on violation severity
        const severityColors = {
            'critical': '#dc3545',
            'serious': '#fd7e14', 
            'moderate': '#ffc107',
            'minor': '#6c757d'
        };

        const highlightColor = severityColors[violation.impact] || '#dc3545';

        await page.addStyleTag({
            content: `
                .accessibility-highlight {
                    border: 3px solid ${highlightColor} !important;
                    box-shadow: 0 0 10px ${highlightColor}80 !important;
                    position: relative !important;
                }
                .accessibility-highlight::after {
                    content: "${violation.id} (${violation.impact})";
                    position: absolute;
                    top: -25px;
                    left: 0;
                    background: ${highlightColor};
                    color: white;
                    padding: 2px 8px;
                    font-size: 12px;
                    border-radius: 3px;
                    z-index: 10000;
                    font-family: Arial, sans-serif;
                }
            `
        });

        // Add highlighting to elements (simplified approach)
        await page.evaluate((violationId) => {
            // Highlight common problematic elements based on violation type
            let selector = '';
            if (violationId.includes('color-contrast')) {
                selector = 'button, a, .btn, [role="button"]';
            } else if (violationId.includes('image-alt')) {
                selector = 'img:not([alt])';
            } else if (violationId.includes('label')) {
                selector = 'input:not([aria-label]):not([aria-labelledby])';
            } else {
                selector = 'h1, h2, h3, button, a, input, img';
            }
            
            const elements = document.querySelectorAll(selector);
            elements.forEach((el, index) => {
                if (index < 3) { // Highlight first 3 matching elements
                    el.classList.add('accessibility-highlight');
                }
            });
        }, violation.id);

        // Take screenshot
        const screenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false,
            clip: { x: 0, y: 0, width: 1200, height: 800 }
        });

        console.log('✅ Visual preview generated successfully');

        res.json({
            success: true,
            screenshot: `data:image/png;base64,${screenshot}`,
            violation: violation
        });

    } catch (error) {
        console.error('❌ Error generating visual preview:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate visual preview',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// PHASE 2D: Color Contrast Preview Endpoint
app.post('/api/color-contrast-preview', async (req, res) => {
    const { url, simulationType } = req.body;

    if (!url || !simulationType) {
        return res.status(400).json({ error: 'URL and simulation type are required' });
    }

    let browser;
    try {
        console.log('🎨 Starting color contrast simulation:', simulationType, 'for:', url);
        browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Apply color simulation filters
        let filterCSS = '';
        switch (simulationType) {
            case 'protanopia':
                filterCSS = 'filter: grayscale(100%) sepia(100%) hue-rotate(180deg);';
                break;
            case 'deuteranopia':
                filterCSS = 'filter: grayscale(100%) sepia(100%) hue-rotate(90deg);';
                break;
            case 'tritanopia':
                filterCSS = 'filter: grayscale(100%) sepia(100%) hue-rotate(270deg);';
                break;
            case 'monochrome':
                filterCSS = 'filter: grayscale(100%);';
                break;
            case 'low-contrast':
                filterCSS = 'filter: contrast(0.5) brightness(1.2);';
                break;
            default:
                filterCSS = '';
        }

        if (filterCSS) {
            await page.addStyleTag({
                content: `html { ${filterCSS} }`
            });
        }

        // Take screenshot
        const screenshot = await page.screenshot({ 
            encoding: 'base64',
            fullPage: false,
            clip: { x: 0, y: 0, width: 1200, height: 800 }
        });

        console.log('✅ Color contrast simulation generated successfully');

        res.json({
            success: true,
            screenshot: `data:image/png;base64,${screenshot}`,
            simulationType: simulationType
        });

    } catch (error) {
        console.error('❌ Error generating color contrast preview:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate color contrast preview',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// PHASE 2D: Screen Reader Simulation Endpoint
app.post('/api/screen-reader-preview', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    try {
        console.log('🔊 Starting screen reader simulation for:', url);
        browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Extract text content that would be read by screen readers
        const screenReaderContent = await page.evaluate(() => {
            const content = [];
            
            // Get page title
            const title = document.title;
            if (title) {
                content.push({
                    type: 'title',
                    text: title,
                    element: 'title'
                });
            }
            
            // Get headings in order
            const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
            headings.forEach((heading, index) => {
                if (heading.textContent.trim()) {
                    content.push({
                        type: 'heading',
                        level: heading.tagName.toLowerCase(),
                        text: heading.textContent.trim(),
                        element: `${heading.tagName.toLowerCase()}[${index}]`
                    });
                }
            });
            
            // Get links
            const links = document.querySelectorAll('a[href]');
            links.forEach((link, index) => {
                const text = link.textContent.trim();
                const href = link.getAttribute('href');
                if (text && href) {
                    content.push({
                        type: 'link',
                        text: text,
                        href: href,
                        element: `a[${index}]`
                    });
                }
            });
            
            // Get form elements
            const inputs = document.querySelectorAll('input, textarea, select');
            inputs.forEach((input, index) => {
                const label = input.getAttribute('aria-label') || 
                             input.getAttribute('placeholder') ||
                             (input.labels && input.labels[0] ? input.labels[0].textContent.trim() : '');
                const type = input.type || input.tagName.toLowerCase();
                
                content.push({
                    type: 'form',
                    inputType: type,
                    label: label || 'Unlabeled input',
                    element: `${input.tagName.toLowerCase()}[${index}]`,
                    hasLabel: !!label
                });
            });
            
            // Get images
            const images = document.querySelectorAll('img');
            images.forEach((img, index) => {
                const alt = img.getAttribute('alt');
                const src = img.getAttribute('src');
                
                content.push({
                    type: 'image',
                    alt: alt || 'Image without alt text',
                    src: src,
                    element: `img[${index}]`,
                    hasAlt: !!alt
                });
            });
            
            return content;
        });

        console.log('✅ Screen reader content extracted successfully');

        res.json({
            success: true,
            content: screenReaderContent,
            summary: {
                totalElements: screenReaderContent.length,
                headings: screenReaderContent.filter(item => item.type === 'heading').length,
                links: screenReaderContent.filter(item => item.type === 'link').length,
                images: screenReaderContent.filter(item => item.type === 'image').length,
                imagesWithoutAlt: screenReaderContent.filter(item => item.type === 'image' && !item.hasAlt).length,
                formElements: screenReaderContent.filter(item => item.type === 'form').length,
                unlabeledInputs: screenReaderContent.filter(item => item.type === 'form' && !item.hasLabel).length
            }
        });

    } catch (error) {
        console.error('❌ Error generating screen reader preview:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to generate screen reader preview',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// PHASE 2D: Keyboard Navigation Test Endpoint
app.post('/api/keyboard-navigation-test', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    let browser;
    try {
        console.log('⌨️ Starting keyboard navigation test for:', url);
        browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Test keyboard navigation
        const navigationResults = await page.evaluate(() => {
            const results = {
                focusableElements: [],
                tabOrder: [],
                issues: []
            };
            
            // Find all potentially focusable elements
            const focusableSelectors = [
                'a[href]',
                'button',
                'input:not([disabled])',
                'textarea:not([disabled])',
                'select:not([disabled])',
                '[tabindex]:not([tabindex="-1"])',
                '[role="button"]',
                '[role="link"]'
            ];
            
            const allFocusable = document.querySelectorAll(focusableSelectors.join(', '));
            
            allFocusable.forEach((element, index) => {
                const rect = element.getBoundingClientRect();
                const isVisible = rect.width > 0 && rect.height > 0 && 
                                 window.getComputedStyle(element).visibility !== 'hidden' &&
                                 window.getComputedStyle(element).display !== 'none';
                
                const tabIndex = element.getAttribute('tabindex') || '0';
                const hasVisibleFocus = window.getComputedStyle(element, ':focus').outline !== 'none' ||
                                       window.getComputedStyle(element, ':focus').boxShadow !== 'none';
                
                const elementInfo = {
                    index: index,
                    tagName: element.tagName.toLowerCase(),
                    type: element.type || null,
                    text: element.textContent.trim().substring(0, 50),
                    tabIndex: tabIndex,
                    isVisible: isVisible,
                    hasVisibleFocus: hasVisibleFocus,
                    ariaLabel: element.getAttribute('aria-label'),
                    role: element.getAttribute('role')
                };
                
                results.focusableElements.push(elementInfo);
                
                // Check for common issues
                if (isVisible && !hasVisibleFocus) {
                    results.issues.push({
                        type: 'no-focus-indicator',
                        element: elementInfo,
                        description: 'Element lacks visible focus indicator'
                    });
                }
                
                if (isVisible && !elementInfo.text && !elementInfo.ariaLabel) {
                    results.issues.push({
                        type: 'no-accessible-name',
                        element: elementInfo,
                        description: 'Interactive element lacks accessible name'
                    });
                }
            });
            
            // Sort by tab order
            results.tabOrder = results.focusableElements
                .filter(el => el.isVisible)
                .sort((a, b) => {
                    const aTab = parseInt(a.tabIndex) || 0;
                    const bTab = parseInt(b.tabIndex) || 0;
                    return aTab - bTab;
                });
            
            return results;
        });

        console.log('✅ Keyboard navigation test completed successfully');

        res.json({
            success: true,
            results: navigationResults,
            summary: {
                totalFocusableElements: navigationResults.focusableElements.length,
                visibleFocusableElements: navigationResults.focusableElements.filter(el => el.isVisible).length,
                elementsWithoutFocusIndicator: navigationResults.issues.filter(issue => issue.type === 'no-focus-indicator').length,
                elementsWithoutAccessibleName: navigationResults.issues.filter(issue => issue.type === 'no-accessible-name').length,
                totalIssues: navigationResults.issues.length
            }
        });

    } catch (error) {
        console.error('❌ Error testing keyboard navigation:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to test keyboard navigation',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
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

// Helper functions for link extraction and scanning
async function extractLinksFromPage(page) {
    return await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href]'));
        return links
            .map(link => {
                const href = link.getAttribute('href');
                if (!href) return null;
                
                // Convert relative URLs to absolute
                try {
                    return new URL(href, window.location.href).href;
                } catch (e) {
                    return null;
                }
            })
            .filter(url => url && url.startsWith('http'))
            .filter((url, index, self) => self.indexOf(url) === index) // Remove duplicates
            .slice(0, 50); // Limit to 50 links to prevent overwhelming scans
    });
}

function filterInternalLinks(links, baseUrl) {
    try {
        const baseDomain = new URL(baseUrl).hostname;
        return links.filter(link => {
            try {
                return new URL(link).hostname === baseDomain;
            } catch (e) {
                return false;
            }
        });
    } catch (e) {
        return [];
    }
}

// Main scanning endpoint
app.post('/api/scan', async (req, res) => {
    const { url, scanType = 'single' } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    const startTime = Date.now();
    let browser;
    
    try {
        console.log(`🔍 Starting ${scanType} scan for:`, url);
        
        browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        
        let urlsToScan = [url];
        
        // For crawl scans, extract internal links
        if (scanType === 'crawl') {
            console.log('🕷️ Crawling for internal links...');
            const page = await browser.newPage();
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
            
            const allLinks = await extractLinksFromPage(page);
            const internalLinks = filterInternalLinks(allLinks, url);
            
            // Include original URL plus up to 9 internal links (total 10 pages max)
            urlsToScan = [url, ...internalLinks.slice(0, 9)];
            console.log(`📄 Found ${internalLinks.length} internal links, scanning ${urlsToScan.length} pages`);
            
            await page.close();
        }
        
        let allViolations = [];
        let scannedPages = 0;
        
        // Scan each URL
        for (const scanUrl of urlsToScan) {
            try {
                console.log(`📊 Scanning page ${scannedPages + 1}/${urlsToScan.length}:`, scanUrl);
                
                const page = await browser.newPage();
                await page.goto(scanUrl, { waitUntil: 'networkidle2', timeout: 30000 });
                
                // Inject axe-core
                await page.addScriptTag({ content: axeCore.source });
                
                // Run accessibility scan
                const results = await page.evaluate(async () => {
                    return await axe.run();
                });
                
                // Add page URL to each violation for multi-page scans
                const pageViolations = results.violations.map(violation => ({
                    ...violation,
                    pageUrl: scanUrl,
                    pageTitle: scanUrl === url ? 'Main Page' : `Page ${scannedPages + 1}`
                }));
                
                allViolations = allViolations.concat(pageViolations);
                scannedPages++;
                
                await page.close();
                
            } catch (pageError) {
                console.error(`❌ Error scanning ${scanUrl}:`, pageError.message);
                // Continue with other pages even if one fails
            }
        }
        
        const scanTimeMs = Date.now() - startTime;
        
        // Calculate accessibility score
        const totalIssues = allViolations.length;
        const score = totalIssues === 0 ? 100 : Math.max(0, 100 - (totalIssues * 2));
        
        console.log(`✅ Scan completed in ${scanTimeMs}ms`);
        console.log(`📊 Found ${totalIssues} issues across ${scannedPages} pages`);
        console.log(`🎯 Accessibility score: ${score}/100`);
        
        // Save scan to database
        const scanId = await saveScan(1, 1, url, scanType, totalIssues, scanTimeMs, scannedPages, allViolations);
        
        res.json({
            success: true,
            scanId: scanId,
            url: url,
            scanType: scanType,
            pagesScanned: scannedPages,
            totalIssues: totalIssues,
            score: score,
            scanTime: scanTimeMs,
            violations: allViolations,
            summary: {
                critical: allViolations.filter(v => v.impact === 'critical').length,
                serious: allViolations.filter(v => v.impact === 'serious').length,
                moderate: allViolations.filter(v => v.impact === 'moderate').length,
                minor: allViolations.filter(v => v.impact === 'minor').length
            }
        });
        
    } catch (error) {
        console.error('❌ Scan error:', error);
        res.status(500).json({ 
            success: false,
            error: 'Scan failed',
            details: error.message 
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// PHASE 2A: AI Suggestions endpoint
app.post('/api/ai-fixes', async (req, res) => {
    const { violations, platformInfo } = req.body;
    
    if (!violations || violations.length === 0) {
        return res.status(400).json({ error: 'Violations data is required' });
    }
    
    try {
        console.log('🤖 Generating AI fix suggestions for', violations.length, 'violations');
        
        const suggestions = [];
        
        for (const violation of violations) {
            console.log('🔍 Processing violation:', violation.id);
            
            let suggestion;
            
            if (openai) {
                try {
                    console.log('🤖 Calling OpenAI for violation:', violation.id);
                    
                    const prompt = `You are an accessibility expert. Provide a fix for this WCAG violation:

Violation ID: ${violation.id}
Description: ${violation.description || 'No description provided'}
Help: ${violation.help || 'No help text provided'}
Impact: ${violation.impact}
Platform: ${platformInfo?.type || 'web'}

Please provide:
1. A clear explanation of the issue
2. Specific code example to fix it
3. Step-by-step implementation instructions
4. Priority level (high/medium/low)

Format your response as JSON with these fields:
- explanation: string
- codeExample: string (HTML/CSS code)
- steps: array of strings
- priority: string`;

                    const completion = await openai.chat.completions.create({
                        model: "gpt-4.1-mini",
                        messages: [{ role: "user", content: prompt }],
                        max_tokens: 1000,
                        temperature: 0.3
                    });
                    
                    const aiResponse = completion.choices[0].message.content;
                    console.log('🤖 AI response length:', aiResponse.length, 'characters for', violation.id);
                    
                    try {
                        suggestion = JSON.parse(aiResponse);
                        console.log('✅ Successfully parsed AI response for', violation.id);
                    } catch (parseError) {
                        console.log('⚠️ AI response preview:', aiResponse.substring(0, 200) + '...');
                        throw new Error('Failed to parse AI response as JSON');
                    }
                    
                } catch (aiError) {
                    console.log('❌ AI suggestion failed for', violation.id, ':', aiError.message);
                    suggestion = getFallbackSuggestion(violation);
                }
            } else {
                console.log('⚠️ Using fallback suggestion for', violation.id, '(no OpenAI)');
                suggestion = getFallbackSuggestion(violation);
            }
            
            suggestions.push(suggestion);
        }
        
        console.log('✅ Generated', suggestions.length, 'AI suggestions');
        res.json(suggestions);
        
    } catch (error) {
        console.error('❌ Error generating AI suggestions:', error);
        res.status(500).json({ 
            error: 'Failed to generate AI suggestions',
            details: error.message 
        });
    }
});

// Fallback suggestions when OpenAI is not available
function getFallbackSuggestion(violation) {
    const fallbacks = {
        'color-contrast': {
            explanation: 'The current HTML element has insufficient color contrast between the foreground and background colors. The contrast ratio does not meet the WCAG 2.1 AA minimum requirement of 4.5:1, making it difficult for users with visual impairments to read and understand the content.',
            codeExample: `/* Current problematic code */
.low-contrast-element {
    color: #777777;
    background-color: #ffffff;
}

/* Fixed version with proper contrast */
.high-contrast-element {
    color: #000000; /* High contrast text */
    background-color: #ffffff;
    /* Contrast ratio: 21:1 (exceeds WCAG AA requirement) */
}`,
            steps: [
                'Identify elements with insufficient color contrast',
                'Use a color contrast checker tool to test current ratios',
                'Adjust foreground or background colors to achieve 4.5:1 ratio minimum',
                'Test the new colors with accessibility tools',
                'Verify readability across different devices and lighting conditions'
            ],
            priority: 'high'
        },
        'image-alt': {
            explanation: 'Images are missing alternative text (alt attributes), which prevents screen readers from describing the image content to visually impaired users. This violates WCAG guidelines for perceivable content.',
            codeExample: `<!-- Current problematic code -->
<img src="product-image.jpg">

<!-- Fixed version with descriptive alt text -->
<img src="product-image.jpg" alt="Blue wireless headphones with noise cancellation feature">

<!-- For decorative images -->
<img src="decoration.jpg" alt="" role="presentation">`,
            steps: [
                'Identify all images missing alt attributes',
                'Add descriptive alt text that conveys the image purpose',
                'Use empty alt="" for purely decorative images',
                'Ensure alt text is concise but informative',
                'Test with screen readers to verify effectiveness'
            ],
            priority: 'high'
        },
        'label': {
            explanation: 'Form inputs lack proper labels, making them inaccessible to screen reader users who cannot understand the purpose of each input field.',
            codeExample: `<!-- Current problematic code -->
<input type="email" placeholder="Enter email">

<!-- Fixed version with proper label -->
<label for="email-input">Email Address</label>
<input type="email" id="email-input" placeholder="Enter email">

<!-- Alternative using aria-label -->
<input type="email" aria-label="Email Address" placeholder="Enter email">`,
            steps: [
                'Identify form inputs without associated labels',
                'Add explicit labels using <label> elements with for attributes',
                'Alternatively, use aria-label or aria-labelledby attributes',
                'Ensure labels clearly describe the input purpose',
                'Test form accessibility with keyboard navigation and screen readers'
            ],
            priority: 'high'
        }
    };
    
    // Find matching fallback or use generic one
    const matchingKey = Object.keys(fallbacks).find(key => violation.id.includes(key));
    
    if (matchingKey) {
        return fallbacks[matchingKey];
    }
    
    // Generic fallback
    return {
        explanation: `This accessibility violation (${violation.id}) needs attention to ensure WCAG compliance. ${violation.description || 'Please refer to WCAG guidelines for specific requirements.'}`,
        codeExample: `/* Review the specific element causing this violation */
/* Apply appropriate WCAG-compliant fixes */
/* Test with accessibility tools after implementation */`,
        steps: [
            'Review the specific WCAG guideline for this violation',
            'Identify the problematic elements on your page',
            'Apply the recommended accessibility fixes',
            'Test the implementation with accessibility tools',
            'Verify the fix resolves the violation'
        ],
        priority: violation.impact === 'critical' ? 'high' : violation.impact === 'serious' ? 'medium' : 'low'
    };
}

// PHASE 2A: Auto-fix implementation endpoint
app.post('/api/implement-fix', async (req, res) => {
    const { violationId, fixType, platformInfo } = req.body;
    
    if (!violationId) {
        return res.status(400).json({ error: 'Violation ID is required' });
    }
    
    try {
        console.log('🔧 Implementing auto-fix for violation:', violationId);
        
        // Generate CSS fix based on violation type
        const cssfix = generateCSSFix(violationId, platformInfo);
        const instructions = generateImplementationInstructions(violationId, platformInfo);
        
        // Store the generated fix (in a real app, you'd save this to database)
        const fixData = {
            violationId: violationId,
            cssContent: cssfix,
            instructions: instructions,
            generatedAt: new Date().toISOString()
        };
        
        // Store in a simple in-memory cache for download
        if (!global.generatedFixes) {
            global.generatedFixes = new Map();
        }
        global.generatedFixes.set(violationId, fixData);
        
        console.log('✅ Auto-fix generated successfully for:', violationId);
        
        res.json({
            success: true,
            violationId: violationId,
            message: 'Fix generated successfully',
            nextSteps: [
                'Download the CSS fix file',
                'Download the implementation instructions',
                'Apply the CSS to your website',
                'Test the fix with accessibility tools',
                'Verify the violation is resolved'
            ]
        });
        
    } catch (error) {
        console.error('❌ Error implementing fix:', error);
        res.status(500).json({ 
            success: false,
            error: 'Failed to implement fix',
            details: error.message 
        });
    }
});

// PHASE 2A: Download fix files endpoint
app.post('/api/download-fix', async (req, res) => {
    const { violationId, fileType } = req.body;
    
    if (!violationId || !fileType) {
        return res.status(400).json({ error: 'Violation ID and file type are required' });
    }
    
    try {
        // Retrieve the generated fix
        const fixData = global.generatedFixes?.get(violationId);
        
        if (!fixData) {
            return res.status(404).json({ error: 'Fix not found. Please generate the fix first.' });
        }
        
        let content, filename, contentType;
        
        if (fileType === 'css') {
            content = fixData.cssContent;
            filename = `${violationId}-fix.css`;
            contentType = 'text/css';
        } else if (fileType === 'instructions') {
            content = fixData.instructions;
            filename = `${violationId}-instructions.md`;
            contentType = 'text/markdown';
        } else {
            return res.status(400).json({ error: 'Invalid file type. Use "css" or "instructions".' });
        }
        
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', contentType);
        res.send(content);
        
    } catch (error) {
        console.error('❌ Error downloading fix:', error);
        res.status(500).json({ 
            error: 'Failed to download fix',
            details: error.message 
        });
    }
});

// Helper function to generate CSS fixes
function generateCSSFix(violationId, platformInfo) {
    const platform = platformInfo?.type || 'custom';
    
    const fixes = {
        'color-contrast': `/* Color Contrast Fix for ${violationId} */
/* Generated on ${new Date().toISOString()} */

/* Universal color contrast fix */
.low-contrast-element {
    color: #000000 !important;
    background-color: #ffffff !important;
    border: 2px solid #000000 !important;
}

/* Button contrast improvements */
button, .btn, [role="button"] {
    color: #ffffff !important;
    background-color: #0066cc !important;
    border: 2px solid #004499 !important;
}

button:hover, .btn:hover, [role="button"]:hover {
    background-color: #004499 !important;
    border-color: #003366 !important;
}

/* Link contrast improvements */
a, a:link {
    color: #0066cc !important;
    text-decoration: underline !important;
}

a:visited {
    color: #663399 !important;
}

a:hover, a:focus {
    color: #004499 !important;
    background-color: #f0f8ff !important;
}`,

        'image-alt': `/* Image Alt Text Fix for ${violationId} */
/* Generated on ${new Date().toISOString()} */

/* This CSS cannot fix missing alt attributes */
/* Please add alt attributes to your HTML images */

/* Visual indicator for images without alt text (for development) */
img:not([alt]) {
    border: 3px solid red !important;
    outline: 2px solid red !important;
}

img:not([alt])::after {
    content: "Missing Alt Text" !important;
    position: absolute !important;
    background: red !important;
    color: white !important;
    padding: 2px 5px !important;
    font-size: 12px !important;
    z-index: 9999 !important;
}`,

        'label': `/* Form Label Fix for ${violationId} */
/* Generated on ${new Date().toISOString()} */

/* Ensure labels are visible and properly styled */
label {
    display: block !important;
    margin-bottom: 5px !important;
    font-weight: bold !important;
    color: #333333 !important;
}

/* Style for inputs to ensure they're associated with labels */
input, textarea, select {
    display: block !important;
    width: 100% !important;
    padding: 8px !important;
    margin-bottom: 15px !important;
    border: 2px solid #cccccc !important;
    border-radius: 4px !important;
}

input:focus, textarea:focus, select:focus {
    border-color: #0066cc !important;
    outline: 2px solid #0066cc !important;
    outline-offset: 2px !important;
}

/* Visual indicator for inputs without labels (for development) */
input:not([aria-label]):not([aria-labelledby]) {
    border-color: red !important;
}`
    };
    
    // Find matching fix or return generic one
    const matchingKey = Object.keys(fixes).find(key => violationId.includes(key));
    
    if (matchingKey) {
        return fixes[matchingKey];
    }
    
    // Generic fix
    return `/* Generic Accessibility Fix for ${violationId} */
/* Generated on ${new Date().toISOString()} */

/* Focus indicators for better keyboard navigation */
*:focus {
    outline: 2px solid #0066cc !important;
    outline-offset: 2px !important;
}

/* Ensure sufficient color contrast */
body {
    color: #000000 !important;
    background-color: #ffffff !important;
}

/* Improve button accessibility */
button, [role="button"] {
    padding: 8px 16px !important;
    border: 2px solid #0066cc !important;
    background-color: #0066cc !important;
    color: #ffffff !important;
    cursor: pointer !important;
}

button:hover, [role="button"]:hover {
    background-color: #004499 !important;
    border-color: #004499 !important;
}`;
}

// Helper function to generate implementation instructions
function generateImplementationInstructions(violationId, platformInfo) {
    const platform = platformInfo?.type || 'custom';
    const timestamp = new Date().toISOString();
    
    return `# Implementation Instructions for ${violationId}

Generated on: ${timestamp}
Platform: ${platform}

## Overview
This document provides step-by-step instructions to implement the accessibility fix for violation: **${violationId}**

## Files Included
- \`${violationId}-fix.css\` - CSS fixes to apply
- \`${violationId}-instructions.md\` - This instruction file

## Implementation Steps

### Step 1: Backup Your Current Styles
Before making any changes, create a backup of your current CSS files.

### Step 2: Apply the CSS Fix
1. Download the \`${violationId}-fix.css\` file
2. Add the CSS to your main stylesheet, or
3. Include it as a separate CSS file in your HTML:
   \`\`\`html
   <link rel="stylesheet" href="path/to/${violationId}-fix.css">
   \`\`\`

### Step 3: Platform-Specific Instructions

${platform === 'shopify' ? `
#### Shopify Implementation:
1. Log in to your Shopify admin dashboard
2. Navigate to "Online Store" > "Themes"
3. Click "Actions" > "Edit Code" for your active theme
4. Locate your main CSS file (usually \`theme.scss.liquid\` or \`styles.css\`)
5. Add the CSS fix content to the end of the file
6. Save the changes and preview your store
` : platform === 'wordpress' ? `
#### WordPress Implementation:
1. Access your WordPress admin dashboard
2. Go to "Appearance" > "Theme Editor" or use FTP
3. Locate your theme's \`style.css\` file
4. Add the CSS fix content to the end of the file
5. Save the changes
6. Alternatively, use "Appearance" > "Customize" > "Additional CSS"
` : platform === 'wix' ? `
#### Wix Implementation:
1. Open your Wix Editor
2. Click on "Settings" in the top menu
3. Select "Custom Code" from the dropdown
4. Click "Add Custom Code"
5. Paste the CSS content wrapped in <style> tags
6. Set it to load on "All Pages"
7. Save and publish your site
` : `
#### Custom Platform Implementation:
1. Locate your main CSS file or stylesheet
2. Add the provided CSS fixes to your existing styles
3. Ensure the CSS is loaded on all relevant pages
4. Test the implementation across different browsers
`}

### Step 4: Test the Fix
1. Clear your browser cache
2. Reload the page where the violation occurred
3. Use accessibility testing tools to verify the fix:
   - Browser developer tools accessibility panel
   - axe DevTools extension
   - WAVE Web Accessibility Evaluator
4. Test with keyboard navigation (Tab key)
5. Test with screen readers if possible

### Step 5: Validate Results
1. Run another accessibility scan using the same tool
2. Verify that the **${violationId}** violation is resolved
3. Check that no new accessibility issues were introduced
4. Test the user experience to ensure functionality is maintained

## Troubleshooting

### If the fix doesn't work:
1. Check that the CSS is properly loaded (inspect element in browser)
2. Verify there are no CSS syntax errors
3. Ensure the CSS selectors match your HTML structure
4. Check for conflicting CSS rules with higher specificity

### If new issues appear:
1. Review the CSS for overly broad selectors
2. Add more specific selectors to target only problem elements
3. Test on different devices and browsers
4. Consider adjusting the CSS rules for better compatibility

## Additional Resources
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [WebAIM Accessibility Resources](https://webaim.org/)
- [MDN Accessibility Documentation](https://developer.mozilla.org/en-US/docs/Web/Accessibility)

## Support
If you encounter issues implementing this fix, consider:
1. Consulting with a web developer familiar with accessibility
2. Using automated accessibility testing tools for ongoing monitoring
3. Conducting user testing with individuals who use assistive technologies

---
*This fix was generated automatically. Always test thoroughly before deploying to production.*`;
}

// Main dashboard endpoint
app.get('/', async (req, res) => {
    try {
        // Get dashboard data
        const stats = await getDashboardStats();
        const recentScans = await getRecentScans();
        
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SentryPrime Enterprise - Accessibility Scanner</title>
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
            font-weight: 700;
        }
        
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
        }
        
        .dashboard {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.1);
            margin-bottom: 30px;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            padding: 25px;
            border-radius: 15px;
            text-align: center;
            border: 1px solid #dee2e6;
        }
        
        .stat-number {
            font-size: 2.5em;
            font-weight: bold;
            color: #495057;
            margin-bottom: 5px;
        }
        
        .stat-label {
            color: #6c757d;
            font-size: 0.9em;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        .scanner-section {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 15px;
            margin-bottom: 30px;
        }
        
        .scanner-form {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
            flex-wrap: wrap;
        }
        
        .url-input {
            flex: 1;
            min-width: 300px;
            padding: 15px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            outline: none;
        }
        
        .scan-type {
            padding: 15px;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            background: white;
            color: #333;
            outline: none;
        }
        
        .scan-btn {
            padding: 15px 30px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
        }
        
        .scan-btn:hover {
            background: #218838;
            transform: translateY(-2px);
        }
        
        .scan-btn:disabled {
            background: #6c757d;
            cursor: not-allowed;
            transform: none;
        }
        
        .results-section {
            background: white;
            border-radius: 15px;
            padding: 30px;
            margin-top: 20px;
            display: none;
        }
        
        .recent-scans {
            background: white;
            border-radius: 15px;
            padding: 30px;
        }
        
        .recent-scans h3 {
            margin-bottom: 20px;
            color: #495057;
        }
        
        .scan-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 15px;
            border: 1px solid #dee2e6;
            border-radius: 10px;
            margin-bottom: 10px;
            transition: all 0.3s ease;
        }
        
        .scan-item:hover {
            background: #f8f9fa;
            transform: translateX(5px);
        }
        
        .scan-url {
            font-weight: bold;
            color: #495057;
        }
        
        .scan-meta {
            display: flex;
            gap: 15px;
            align-items: center;
            font-size: 0.9em;
            color: #6c757d;
        }
        
        .score-badge {
            padding: 5px 10px;
            border-radius: 20px;
            font-weight: bold;
            font-size: 0.8em;
        }
        
        .score-excellent { background: #d4edda; color: #155724; }
        .score-good { background: #d1ecf1; color: #0c5460; }
        .score-fair { background: #fff3cd; color: #856404; }
        .score-poor { background: #f8d7da; color: #721c24; }
        
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
        
        .error {
            background: #f8d7da;
            color: #721c24;
            padding: 15px;
            border-radius: 10px;
            margin-top: 15px;
        }
        
        .success {
            background: #d4edda;
            color: #155724;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        
        .violations-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }
        
        .violation-card {
            text-align: center;
            padding: 15px;
            border-radius: 10px;
            border: 2px solid;
        }
        
        .violation-critical { border-color: #dc3545; background: #f8d7da; }
        .violation-serious { border-color: #fd7e14; background: #fff3cd; }
        .violation-moderate { border-color: #ffc107; background: #fff3cd; }
        .violation-minor { border-color: #6c757d; background: #f8f9fa; }
        
        .action-buttons {
            display: flex;
            gap: 15px;
            margin-top: 20px;
            flex-wrap: wrap;
        }
        
        .btn {
            padding: 12px 24px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            text-decoration: none;
            display: inline-block;
        }
        
        .btn-primary {
            background: #007bff;
            color: white;
        }
        
        .btn-success {
            background: #28a745;
            color: white;
        }
        
        .btn-info {
            background: #17a2b8;
            color: white;
        }
        
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        @media (max-width: 768px) {
            .scanner-form {
                flex-direction: column;
            }
            
            .url-input {
                min-width: auto;
            }
            
            .action-buttons {
                flex-direction: column;
            }
        }
        
        /* AI Suggestions Modal Styles */
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
            border-radius: 15px;
            width: 90%;
            max-width: 800px;
            max-height: 80vh;
            overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        
        .ai-modal-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .ai-modal-body {
            padding: 20px;
            max-height: 60vh;
            overflow-y: auto;
        }
        
        .close {
            color: white;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
            background: none;
            border: none;
        }
        
        .close:hover {
            opacity: 0.7;
        }
        
        .ai-suggestion {
            border: 1px solid #dee2e6;
            border-radius: 10px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .ai-suggestion-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .priority-badge {
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.8em;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .priority-high { background: #f8d7da; color: #721c24; }
        .priority-medium { background: #fff3cd; color: #856404; }
        .priority-low { background: #d4edda; color: #155724; }
        
        .ai-suggestion-content pre {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            overflow-x: auto;
            font-size: 14px;
        }
        
        .ai-suggestion-content ol {
            padding-left: 20px;
        }
        
        .ai-suggestion-content li {
            margin-bottom: 8px;
        }
        
        /* Guided Modal Styles */
        .guided-modal {
            display: none;
            position: fixed;
            z-index: 1001;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.7);
        }
        
        .guided-modal-content {
            background-color: white;
            margin: 2% auto;
            padding: 0;
            border-radius: 15px;
            width: 95%;
            max-width: 900px;
            max-height: 90vh;
            overflow: hidden;
            box-shadow: 0 25px 80px rgba(0,0,0,0.4);
        }
        
        .guided-modal-header {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
            padding: 25px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .guided-modal-body {
            padding: 30px;
            max-height: 60vh;
            overflow-y: auto;
        }
        
        .guided-modal-footer {
            padding: 25px;
            background: #f8f9fa;
            border-top: 1px solid #dee2e6;
        }
        
        .progress-indicator {
            background: rgba(255,255,255,0.2);
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: bold;
        }
        
        .violation-details {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
        }
        
        .violation-title {
            font-size: 1.5em;
            font-weight: bold;
            margin-bottom: 10px;
            color: #333;
        }
        
        .violation-impact {
            display: inline-block;
            padding: 6px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            font-weight: bold;
            text-transform: uppercase;
            margin-bottom: 15px;
        }
        
        .get-ai-fix-btn, .auto-fix-btn, .preview-fix-btn, .prev-btn, .next-btn, .finish-btn {
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            margin: 5px;
            transition: all 0.3s ease;
        }
        
        .get-ai-fix-btn {
            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
            color: white;
        }
        
        .auto-fix-btn {
            background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
            color: white;
        }
        
        .preview-fix-btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        
        .color-test-btn {
            background: linear-gradient(135deg, #fd7e14 0%, #ffc107 100%);
            color: white;
        }
        
        .screen-reader-btn {
            background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%);
            color: white;
        }
        
        .keyboard-test-btn {
            background: linear-gradient(135deg, #17a2b8 0%, #6610f2 100%);
            color: white;
        }
        
        .prev-btn, .next-btn {
            background: #6c757d;
            color: white;
        }
        
        .finish-btn {
            background: #28a745;
            color: white;
        }
        
        .get-ai-fix-btn:hover, .auto-fix-btn:hover, .preview-fix-btn:hover, 
        .color-test-btn:hover, .screen-reader-btn:hover, .keyboard-test-btn:hover,
        .prev-btn:hover, .next-btn:hover, .finish-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
        }
        
        .loading {
            text-align: center;
            padding: 40px;
        }
        
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 15px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🛡️ SentryPrime Enterprise</h1>
            <p>Advanced Accessibility Scanner & Compliance Platform</p>
        </div>
        
        <div class="dashboard">
            <h2 style="margin-bottom: 30px; color: #495057;">📊 Dashboard Overview</h2>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-number">${stats.totalScans}</div>
                    <div class="stat-label">Total Scans</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.totalIssues}</div>
                    <div class="stat-label">Issues Found</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.averageScore}%</div>
                    <div class="stat-label">Avg Score</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.thisWeekScans}</div>
                    <div class="stat-label">This Week</div>
                </div>
            </div>
        </div>
        
        <div class="scanner-section">
            <h2 style="margin-bottom: 20px;">🔍 Start New Accessibility Scan</h2>
            <form class="scanner-form" onsubmit="startScan(event)">
                <input type="url" class="url-input" id="url-input" placeholder="Enter website URL (e.g., https://example.com)" required>
                <select class="scan-type" id="scan-type">
                    <option value="single">Single Page Scan</option>
                    <option value="crawl">Multi-Page Crawl</option>
                </select>
                <button type="submit" class="scan-btn" id="scan-btn">🚀 Start Scan</button>
            </form>
            <p style="opacity: 0.9; font-size: 0.9em;">
                💡 <strong>Single Page:</strong> Scans one specific page for accessibility issues<br>
                🕷️ <strong>Multi-Page Crawl:</strong> Discovers and scans up to 10 internal pages
            </p>
        </div>
        
        <div class="results-section" id="results-section">
            <!-- Scan results will be displayed here -->
        </div>
        
        <div class="recent-scans">
            <h3>📈 Recent Scans</h3>
            ${recentScans.length > 0 ? recentScans.map(scan => `
                <div class="scan-item">
                    <div>
                        <div class="scan-url">${scan.url}</div>
                        <div class="scan-meta">
                            <span>${scan.scan_type === 'crawl' ? '🕷️ Multi-page' : '📄 Single page'}</span>
                            <span>${scan.total_issues} issues</span>
                            <span>${new Date(scan.created_at).toLocaleDateString()}</span>
                        </div>
                    </div>
                    <div class="score-badge ${
                        scan.score >= 90 ? 'score-excellent' : 
                        scan.score >= 75 ? 'score-good' : 
                        scan.score >= 50 ? 'score-fair' : 'score-poor'
                    }">${scan.score}%</div>
                </div>
            `).join('') : '<p style="color: #6c757d; text-align: center; padding: 20px;">No recent scans found. Start your first scan above!</p>'}
        </div>
    </div>
    
    <!-- AI Suggestions Modal -->
    <div id="ai-modal" class="ai-modal">
        <div class="ai-modal-content">
            <div class="ai-modal-header">
                <h2>🤖 AI Fix Suggestions</h2>
                <button class="close" onclick="closeAIModal()">&times;</button>
            </div>
            <div class="ai-modal-body" id="ai-modal-body">
                <!-- AI suggestions will be loaded here -->
            </div>
        </div>
    </div>
    
    <!-- Guided Fixing Modal -->
    <div id="guided-fixing-modal" class="guided-modal">
        <div class="guided-modal-content">
            <div class="guided-modal-header">
                <h2>🛠️ Guided Accessibility Fixing</h2>
                <div class="progress-indicator" id="progress-indicator">Violation 1 of 1</div>
                <button class="close" onclick="GuidedFixing.close()">&times;</button>
            </div>
            <div class="guided-modal-body" id="guided-modal-body">
                <!-- Violation details will be loaded here -->
            </div>
            <div class="guided-modal-footer">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                    <button class="get-ai-fix-btn" onclick="GuidedFixing.getAIFixForCurrent()">🤖 Get AI Fix</button>
                    <button class="auto-fix-btn" onclick="GuidedFixing.autoFixCurrent()">🔧 Auto-Fix</button>
                    <button class="preview-fix-btn" onclick="GuidedFixing.showVisualPreview()">👁️ Visual Preview</button>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                    <button class="color-test-btn" onclick="GuidedFixing.showColorTest()">🎨 Color Test</button>
                    <button class="screen-reader-btn" onclick="GuidedFixing.showScreenReader()">🔊 Screen Reader</button>
                    <button class="keyboard-test-btn" onclick="GuidedFixing.showKeyboardTest()">⌨️ Keyboard Test</button>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <button class="prev-btn" id="prev-btn" onclick="GuidedFixing.previousViolation()">← Previous</button>
                    <button class="next-btn" id="next-btn" onclick="GuidedFixing.nextViolation()">Next →</button>
                    <button class="finish-btn" id="finish-btn" onclick="GuidedFixing.finish()" style="display: none;">✅ Generate Report</button>
                </div>
            </div>
        </div>
    </div>
    
    <script>
        let currentScanResults = null;
        
        async function startScan(event) {
            event.preventDefault();
            
            const url = document.getElementById('url-input').value;
            const scanType = document.getElementById('scan-type').value;
            const scanBtn = document.getElementById('scan-btn');
            const resultsSection = document.getElementById('results-section');
            
            // Show loading state
            scanBtn.disabled = true;
            scanBtn.textContent = '🔄 Scanning...';
            resultsSection.style.display = 'block';
            resultsSection.innerHTML = \`
                <div class="loading">
                    <div class="spinner"></div>
                    <h3>Scanning \${url}</h3>
                    <p>This may take 30-60 seconds depending on the scan type...</p>
                </div>
            \`;
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url, scanType })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    currentScanResults = result;
                    displayResults(result);
                } else {
                    throw new Error(result.error || 'Scan failed');
                }
                
            } catch (error) {
                console.error('Scan error:', error);
                resultsSection.innerHTML = \`
                    <div class="error">
                        <h3>❌ Scan Failed</h3>
                        <p>\${error.message}</p>
                        <p>Please check the URL and try again.</p>
                    </div>
                \`;
            } finally {
                scanBtn.disabled = false;
                scanBtn.textContent = '🚀 Start Scan';
            }
        }
        
        function displayResults(result) {
            const resultsSection = document.getElementById('results-section');
            
            const scoreClass = 
                result.score >= 90 ? 'score-excellent' : 
                result.score >= 75 ? 'score-good' : 
                result.score >= 50 ? 'score-fair' : 'score-poor';
            
            resultsSection.innerHTML = \`
                <div class="success">
                    <h3>✅ Scan Completed Successfully!</h3>
                    <p><strong>URL:</strong> \${result.url}</p>
                    <p><strong>Pages Scanned:</strong> \${result.pagesScanned}</p>
                    <p><strong>Scan Time:</strong> \${(result.scanTime / 1000).toFixed(1)}s</p>
                    <div style="margin-top: 15px;">
                        <span style="font-size: 1.2em; font-weight: bold;">Accessibility Score: </span>
                        <span class="score-badge \${scoreClass}" style="font-size: 1.1em; padding: 8px 16px;">\${result.score}%</span>
                    </div>
                </div>
                
                <div class="violations-summary">
                    <div class="violation-card violation-critical">
                        <div style="font-size: 2em; font-weight: bold; color: #dc3545;">\${result.summary.critical}</div>
                        <div style="font-size: 0.9em; color: #721c24;">Critical</div>
                    </div>
                    <div class="violation-card violation-serious">
                        <div style="font-size: 2em; font-weight: bold; color: #fd7e14;">\${result.summary.serious}</div>
                        <div style="font-size: 0.9em; color: #856404;">Serious</div>
                    </div>
                    <div class="violation-card violation-moderate">
                        <div style="font-size: 2em; font-weight: bold; color: #ffc107;">\${result.summary.moderate}</div>
                        <div style="font-size: 0.9em; color: #856404;">Moderate</div>
                    </div>
                    <div class="violation-card violation-minor">
                        <div style="font-size: 2em; font-weight: bold; color: #6c757d;">\${result.summary.minor}</div>
                        <div style="font-size: 0.9em; color: #495057;">Minor</div>
                    </div>
                </div>
                
                <div class="action-buttons">
                    <button class="btn btn-primary" onclick="showDetailedReport()">📋 View Detailed Report</button>
                    <button class="btn btn-success" onclick="startGuidedFixing()">🛠️ Let's Start Fixing</button>
                    <button class="btn btn-info" onclick="getAISuggestions()">🤖 Get AI Suggestions</button>
                </div>
            \`;
        }
        
        function showDetailedReport() {
            if (!currentScanResults) return;
            
            // Create a form to submit violations data
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/api/detailed-report';
            form.target = '_blank';
            
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = 'violations';
            input.value = JSON.stringify(currentScanResults.violations);
            
            form.appendChild(input);
            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
        }
        
        async function getAISuggestions() {
            if (!currentScanResults) return;
            
            const modal = document.getElementById('ai-modal');
            const modalBody = document.getElementById('ai-modal-body');
            
            // Show loading state
            modalBody.innerHTML = '<div class="loading"><div class="spinner"></div>Getting AI suggestions...</div>';
            modal.style.display = 'block';
            
            try {
                const response = await fetch('/api/ai-fixes', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ 
                        violations: currentScanResults.violations.slice(0, 5), // Limit to first 5 violations
                        platformInfo: { type: 'custom' }
                    })
                });
                
                if (!response.ok) {
                    throw new Error('Failed to get AI suggestions');
                }
                
                const suggestions = await response.json();
                
                modalBody.innerHTML = suggestions.map((suggestion, index) => \`
                    <div class="ai-suggestion priority-\${suggestion.priority}">
                        <div class="ai-suggestion-header">
                            <strong>🤖 AI Fix Suggestion #\${index + 1}</strong>
                            <span class="priority-badge priority-\${suggestion.priority}">\${suggestion.priority.toUpperCase()}</span>
                        </div>
                        <div class="ai-suggestion-content">
                            <p><strong>Issue:</strong> \${suggestion.explanation}</p>
                            <p><strong>Code Example:</strong></p>
                            <pre><code>\${suggestion.codeExample}</code></pre>
                            <p><strong>Implementation Steps:</strong></p>
                            <ol>\${suggestion.steps.map(step => \`<li>\${step}</li>\`).join('')}</ol>
                        </div>
                    </div>
                \`).join('');
                
            } catch (error) {
                console.error('Error getting AI suggestions:', error);
                modalBody.innerHTML = \`
                    <div style="color: #dc3545; text-align: center; padding: 40px;">
                        <h3>Unable to Generate AI Suggestions</h3>
                        <p>Please try again later or use the detailed report for manual fixes.</p>
                    </div>
                \`;
            }
        }
        
        function closeAIModal() {
            document.getElementById('ai-modal').style.display = 'none';
        }
        
        function startGuidedFixing() {
            if (!currentScanResults || !currentScanResults.violations.length) {
                alert('No violations found to fix!');
                return;
            }
            
            GuidedFixing.start(currentScanResults.violations);
        }
        
        // Guided Fixing System with Phase 2D Integration
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
            },
            
            // PHASE 2A: Auto-Fix functionality for current violation
            autoFixCurrent: async function() {
                const currentViolation = this.currentViolations[this.currentViolationIndex];
                if (!currentViolation) return;
                
                const button = document.querySelector('.auto-fix-btn');
                const originalText = button.textContent;
                
                try {
                    button.textContent = '🔄 Applying Fix...';
                    button.disabled = true;
                    
                    const response = await fetch('/api/implement-fix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            violationId: currentViolation.id,
                            fixType: 'auto',
                            platformInfo: window.platformInfo || { type: 'custom' }
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        button.textContent = '✅ Fix Generated';
                        button.style.background = '#28a745';
                        
                        // Show fix details in the modal body
                        const modalBody = document.getElementById('guided-modal-body');
                        const fixDetailsHtml = \`
                            <div style="margin-top: 20px; padding: 15px; background: #d4edda; border-radius: 8px; border-left: 4px solid #28a745;">
                                <h4 style="color: #155724; margin-bottom: 10px;">✅ Auto-Fix Generated Successfully!</h4>
                                <p style="color: #155724; margin-bottom: 15px;">The fix has been generated for <strong>\${currentViolation.id}</strong>. Download the files below:</p>
                                
                                <div style="display: flex; gap: 10px; margin-bottom: 15px;">
                                    <button onclick="GuidedFixing.downloadFix('\${currentViolation.id}', 'css')" 
                                            style="background: #007bff; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px;">
                                        📄 Download CSS Fix
                                    </button>
                                    <button onclick="GuidedFixing.downloadFix('\${currentViolation.id}', 'instructions')" 
                                            style="background: #6f42c1; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 14px;">
                                        📋 Download Instructions
                                    </button>
                                </div>
                                
                                <div style="font-size: 14px; color: #155724;">
                                    <strong>Next Steps:</strong>
                                    <ol style="margin: 8px 0 0 20px;">
                                        \${result.nextSteps.map(step => \`<li>\${step}</li>\`).join('')}
                                    </ol>
                                </div>
                            </div>
                        \`;
                        
                        modalBody.innerHTML += fixDetailsHtml;
                        
                        // Mark this violation as having a fix generated
                        currentViolation.fixGenerated = true;
                        
                    } else {
                        throw new Error(result.error || 'Fix generation failed');
                    }
                    
                } catch (error) {
                    console.error('Auto-fix error:', error);
                    button.textContent = '❌ Fix Failed';
                    button.style.background = '#dc3545';
                    setTimeout(() => {
                        button.textContent = originalText;
                        button.style.background = 'linear-gradient(135deg, #28a745 0%, #20c997 100%)';
                        button.disabled = false;
                    }, 3000);
                }
            },
            
            downloadFix: async function(violationId, fileType) {
                try {
                    const response = await fetch('/api/download-fix', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            violationId: violationId,
                            fileType: fileType
                        })
                    });
                    
                    if (response.ok) {
                        const blob = await response.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = \`\${violationId}-\${fileType}.\${fileType === 'css' ? 'css' : 'md'}\`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        window.URL.revokeObjectURL(url);
                    } else {
                        throw new Error('Download failed');
                    }
                } catch (error) {
                    console.error('Download error:', error);
                    alert('Download failed. Please try again.');
                }
            },
            
            // PHASE 2D: Visual Preview functionality
            showVisualPreview: async function() {
                const currentViolation = this.currentViolations[this.currentViolationIndex];
                if (!currentViolation) return;
                
                try {
                    const currentUrl = window.location.origin;
                    
                    const response = await fetch('/api/visual-preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            url: currentUrl,
                            violation: currentViolation
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        this.showVisualPreviewModal(result);
                    } else {
                        throw new Error(result.error || 'Visual preview failed');
                    }
                    
                } catch (error) {
                    console.error('Visual preview error:', error);
                    alert('Visual preview failed: ' + error.message);
                }
            },
            
            showVisualPreviewModal: function(data) {
                const modal = document.createElement('div');
                modal.style.cssText = \`
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(0,0,0,0.9); z-index: 10001; display: flex; 
                    align-items: center; justify-content: center; backdrop-filter: blur(5px);
                \`;
                
                modal.innerHTML = \`
                    <div style="background: white; border-radius: 16px; max-width: 95vw; max-height: 95vh; overflow: hidden; box-shadow: 0 25px 80px rgba(0,0,0,0.4);">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <h3 style="margin: 0; font-size: 20px; font-weight: 600;">👁️ Visual Preview Analysis</h3>
                                <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove()" 
                                        style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; backdrop-filter: blur(10px); font-size: 16px;">
                                    ✕
                                </button>
                            </div>
                            <p style="margin: 0; opacity: 0.9;">Before and after comparison with highlighted accessibility issues</p>
                        </div>
                        
                        <div style="padding: 30px; max-height: 70vh; overflow-y: auto;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 25px;">
                                <div style="border: 2px solid #dc3545; border-radius: 8px; overflow: hidden;">
                                    <div style="background: #dc3545; color: white; padding: 10px; text-align: center; font-weight: bold;">❌ Before (Issues Highlighted)</div>
                                    <div style="padding: 10px; background: #f8f9fa;">
                                        <img src="\${data.screenshot}" alt="Before screenshot" style="width: 100%; height: auto; border-radius: 4px;">
                                    </div>
                                </div>
                                <div style="border: 2px solid #28a745; border-radius: 8px; overflow: hidden;">
                                    <div style="background: #28a745; color: white; padding: 10px; text-align: center; font-weight: bold;">✅ After (Fixed)</div>
                                    <div style="padding: 10px; background: #d4edda;">
                                        <div style="padding: 40px; text-align: center; color: #155724;">
                                            <div style="font-size: 48px; margin-bottom: 15px;">🎯</div>
                                            <h4 style="margin: 0 0 10px 0;">Fix Applied Successfully</h4>
                                            <p style="margin: 0;">Issues have been resolved with proper accessibility standards</p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <div style="background: #e7f3ff; border-radius: 8px; padding: 20px; border-left: 4px solid #0066cc;">
                                <h4 style="margin: 0 0 15px 0; color: #0066cc;">📋 Issue Details</h4>
                                <p style="margin: 0; color: #004085;"><strong>Violation:</strong> \${data.violation.id}</p>
                                <p style="margin: 5px 0 0 0; color: #004085;"><strong>Impact:</strong> \${data.violation.impact}</p>
                            </div>
                        </div>
                    </div>
                \`;
                
                document.body.appendChild(modal);
                
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.remove();
                    }
                });
            },
            
            // PHASE 2D: Color Test functionality
            showColorTest: async function() {
                try {
                    const currentUrl = window.location.origin;
                    this.showColorTestModal(currentUrl);
                } catch (error) {
                    console.error('Color test error:', error);
                    alert('Color test failed: ' + error.message);
                }
            },
            
            showColorTestModal: function(url) {
                const modal = document.createElement('div');
                modal.style.cssText = \`
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(0,0,0,0.9); z-index: 10001; display: flex; 
                    align-items: center; justify-content: center; backdrop-filter: blur(5px);
                \`;
                
                modal.innerHTML = \`
                    <div style="background: white; border-radius: 16px; max-width: 95vw; max-height: 95vh; overflow: hidden; box-shadow: 0 25px 80px rgba(0,0,0,0.4);">
                        <div style="background: linear-gradient(135deg, #fd7e14 0%, #ffc107 100%); color: white; padding: 25px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <h3 style="margin: 0; font-size: 20px; font-weight: 600;">🎨 Color Contrast Simulator</h3>
                                <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove()" 
                                        style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; backdrop-filter: blur(10px); font-size: 16px;">
                                    ✕
                                </button>
                            </div>
                            <p style="margin: 0; opacity: 0.9;">Test how your page appears to users with different visual conditions</p>
                        </div>
                        
                        <div style="padding: 30px;">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; margin-bottom: 25px;">
                                <button onclick="GuidedFixing.loadColorSimulation('protanopia')" style="background: #dc3545; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer;">Protanopia (Red-blind)</button>
                                <button onclick="GuidedFixing.loadColorSimulation('deuteranopia')" style="background: #28a745; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer;">Deuteranopia (Green-blind)</button>
                                <button onclick="GuidedFixing.loadColorSimulation('tritanopia')" style="background: #007bff; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer;">Tritanopia (Blue-blind)</button>
                                <button onclick="GuidedFixing.loadColorSimulation('monochrome')" style="background: #6c757d; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer;">Monochrome</button>
                                <button onclick="GuidedFixing.loadColorSimulation('low-contrast')" style="background: #ffc107; color: black; border: none; padding: 12px; border-radius: 6px; cursor: pointer;">Low Contrast</button>
                            </div>
                            
                            <div id="color-simulation-result" style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 8px; border: 2px dashed #dee2e6;">
                                <div style="font-size: 48px; margin-bottom: 15px;">👆</div>
                                <h4 style="margin: 0 0 10px 0; color: #333;">Select a simulation above</h4>
                                <p style="margin: 0; color: #666;">Click any button to see how your page appears to users with different visual conditions</p>
                            </div>
                        </div>
                    </div>
                \`;
                
                document.body.appendChild(modal);
                
                // Store URL for simulations
                window.currentSimulationUrl = url;
                
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.remove();
                    }
                });
            },
            
            loadColorSimulation: async function(simulationType) {
                const resultDiv = document.getElementById('color-simulation-result');
                resultDiv.innerHTML = \`
                    <div style="font-size: 32px; margin-bottom: 15px;">🔄</div>
                    <h4 style="margin: 0 0 10px 0; color: #333;">Generating simulation...</h4>
                    <p style="margin: 0; color: #666;">Please wait while we process the \${simulationType} simulation</p>
                \`;
                
                try {
                    const response = await fetch('/api/color-contrast-preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            url: window.currentSimulationUrl,
                            simulationType: simulationType
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        resultDiv.innerHTML = \`
                            <div style="margin-bottom: 15px;">
                                <h4 style="margin: 0 0 10px 0; color: #333; text-transform: capitalize;">\${simulationType} Simulation</h4>
                                <p style="margin: 0 0 15px 0; color: #666; font-size: 14px;">How your page appears to users with \${simulationType}</p>
                            </div>
                            <div style="border: 2px solid #e9ecef; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                                <img src="\${result.screenshot}" alt="\${simulationType} simulation" 
                                     style="width: 100%; height: auto; display: block; max-height: 400px; object-fit: contain;">
                            </div>
                        \`;
                    } else {
                        throw new Error(result.error);
                    }
                } catch (error) {
                    resultDiv.innerHTML = \`
                        <div style="font-size: 32px; margin-bottom: 15px;">❌</div>
                        <h4 style="margin: 0 0 10px 0; color: #dc3545;">Simulation Failed</h4>
                        <p style="margin: 0; color: #666;">Unable to generate \${simulationType} simulation. Please try again.</p>
                    \`;
                }
            },
            
            // PHASE 2D: Screen Reader functionality
            showScreenReader: async function() {
                try {
                    const currentUrl = window.location.origin;
                    
                    const response = await fetch('/api/screen-reader-preview', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: currentUrl })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        this.showScreenReaderModal(result);
                    } else {
                        throw new Error(result.error || 'Screen reader analysis failed');
                    }
                    
                } catch (error) {
                    console.error('Screen reader error:', error);
                    alert('Screen reader analysis failed: ' + error.message);
                }
            },
            
            showScreenReaderModal: function(data) {
                const modal = document.createElement('div');
                modal.style.cssText = \`
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(0,0,0,0.9); z-index: 10001; display: flex; 
                    align-items: center; justify-content: center; backdrop-filter: blur(5px);
                \`;
                
                modal.innerHTML = \`
                    <div style="background: white; border-radius: 16px; max-width: 95vw; max-height: 95vh; overflow: hidden; box-shadow: 0 25px 80px rgba(0,0,0,0.4);">
                        <div style="background: linear-gradient(135deg, #6f42c1 0%, #e83e8c 100%); color: white; padding: 25px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <h3 style="margin: 0; font-size: 20px; font-weight: 600;">🔊 Screen Reader Analysis</h3>
                                <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove()" 
                                        style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; backdrop-filter: blur(10px); font-size: 16px;">
                                    ✕
                                </button>
                            </div>
                            <p style="margin: 0; opacity: 0.9;">How screen readers interpret your page content</p>
                        </div>
                        
                        <div style="padding: 30px; max-height: 70vh; overflow-y: auto;">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #495057;">\${data.summary.headings}</div>
                                    <div style="color: #6c757d;">Headings</div>
                                </div>
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #495057;">\${data.summary.links}</div>
                                    <div style="color: #6c757d;">Links</div>
                                </div>
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #495057;">\${data.summary.images}</div>
                                    <div style="color: #6c757d;">Images</div>
                                </div>
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #dc3545;">\${data.summary.imagesWithoutAlt}</div>
                                    <div style="color: #6c757d;">Missing Alt Text</div>
                                </div>
                            </div>
                            
                            <div style="background: #e7f3ff; border-radius: 8px; padding: 20px; border-left: 4px solid #0066cc;">
                                <h4 style="margin: 0 0 15px 0; color: #0066cc;">📋 Content Flow</h4>
                                <div style="max-height: 300px; overflow-y: auto;">
                                    \${data.content.slice(0, 20).map(item => \`
                                        <div style="margin-bottom: 10px; padding: 8px; background: white; border-radius: 4px;">
                                            <strong style="color: #495057; text-transform: capitalize;">\${item.type}:</strong>
                                            <span style="color: #6c757d;">\${item.text || item.alt || item.label || 'No text'}</span>
                                        </div>
                                    \`).join('')}
                                    \${data.content.length > 20 ? '<div style="text-align: center; color: #6c757d; font-style: italic;">... and ' + (data.content.length - 20) + ' more items</div>' : ''}
                                </div>
                            </div>
                        </div>
                    </div>
                \`;
                
                document.body.appendChild(modal);
                
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.remove();
                    }
                });
            },
            
            // PHASE 2D: Keyboard Test functionality
            showKeyboardTest: async function() {
                try {
                    const currentUrl = window.location.origin;
                    
                    const response = await fetch('/api/keyboard-navigation-test', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: currentUrl })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        this.showKeyboardTestModal(result);
                    } else {
                        throw new Error(result.error || 'Keyboard test failed');
                    }
                    
                } catch (error) {
                    console.error('Keyboard test error:', error);
                    alert('Keyboard test failed: ' + error.message);
                }
            },
            
            showKeyboardTestModal: function(data) {
                const modal = document.createElement('div');
                modal.style.cssText = \`
                    position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
                    background: rgba(0,0,0,0.9); z-index: 10001; display: flex; 
                    align-items: center; justify-content: center; backdrop-filter: blur(5px);
                \`;
                
                modal.innerHTML = \`
                    <div style="background: white; border-radius: 16px; max-width: 95vw; max-height: 95vh; overflow: hidden; box-shadow: 0 25px 80px rgba(0,0,0,0.4);">
                        <div style="background: linear-gradient(135deg, #17a2b8 0%, #6610f2 100%); color: white; padding: 25px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                                <h3 style="margin: 0; font-size: 20px; font-weight: 600;">⌨️ Keyboard Navigation Test</h3>
                                <button onclick="this.closest('[style*=\\"position: fixed\\"]').remove()" 
                                        style="background: rgba(255,255,255,0.2); color: white; border: none; padding: 10px 15px; border-radius: 8px; cursor: pointer; backdrop-filter: blur(10px); font-size: 16px;">
                                    ✕
                                </button>
                            </div>
                            <p style="margin: 0; opacity: 0.9;">Analysis of keyboard accessibility and focus management</p>
                        </div>
                        
                        <div style="padding: 30px; max-height: 70vh; overflow-y: auto;">
                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 25px;">
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #495057;">\${data.summary.totalFocusableElements}</div>
                                    <div style="color: #6c757d;">Focusable Elements</div>
                                </div>
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #495057;">\${data.summary.visibleFocusableElements}</div>
                                    <div style="color: #6c757d;">Visible & Focusable</div>
                                </div>
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #dc3545;">\${data.summary.elementsWithoutFocusIndicator}</div>
                                    <div style="color: #6c757d;">Missing Focus Indicator</div>
                                </div>
                                <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; text-align: center;">
                                    <div style="font-size: 24px; font-weight: bold; color: #dc3545;">\${data.summary.elementsWithoutAccessibleName}</div>
                                    <div style="color: #6c757d;">Missing Accessible Name</div>
                                </div>
                            </div>
                            
                            <div style="background: #e7f3ff; border-radius: 8px; padding: 20px; border-left: 4px solid #0066cc;">
                                <h4 style="margin: 0 0 15px 0; color: #0066cc;">📋 Tab Order</h4>
                                <div
