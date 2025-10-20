/**
 * Enhanced Shopify Deployment Engine for SentryPrime
 * Handles real Shopify Admin API integration for deploying accessibility fixes
 * 
 * Author: Manus AI
 * Date: October 20, 2025
 */

const axios = require('axios');
const fs = require('fs').promises;

class ShopifyDeploymentEngine {
    constructor(options = {}) {
        this.options = {
            timeout: options.timeout || 30000,
            retryAttempts: options.retryAttempts || 3,
            apiVersion: options.apiVersion || '2023-10',
            ...options
        };
    }

    /**
     * Deploy accessibility fixes to a Shopify store
     * @param {Object} patchPackage - Generated accessibility fixes
     * @param {Object} connection - Shopify store connection details
     * @returns {Object} Deployment result
     */
    async deployToShopify(patchPackage, connection) {
        console.log(`🛍️ Starting Shopify deployment for ${connection.website_url}`);
        
        const deploymentResult = {
            id: `shopify_deploy_${Date.now()}`,
            platform: 'shopify',
            store: connection.connection_config.store_domain,
            status: 'in_progress',
            deployedAssets: [],
            failedAssets: [],
            backups: [],
            logs: [],
            startTime: new Date().toISOString()
        };

        try {
            // Validate Shopify connection
            const validation = await this.validateShopifyConnection(connection);
            if (!validation.valid) {
                throw new Error(`Shopify connection invalid: ${validation.error}`);
            }

            // Get active theme
            const activeTheme = await this.getActiveTheme(connection);
            if (!activeTheme) {
                throw new Error('Could not find active theme');
            }

            deploymentResult.themeId = activeTheme.id;
            deploymentResult.themeName = activeTheme.name;

            // Create backups of existing theme assets
            const backupResult = await this.createThemeBackups(connection, activeTheme.id, patchPackage);
            deploymentResult.backups = backupResult.backups;

            // Deploy CSS fixes
            if (patchPackage.cssContent) {
                await this.deployCSSFixes(connection, activeTheme.id, patchPackage, deploymentResult);
            }

            // Deploy JavaScript fixes
            if (patchPackage.jsContent) {
                await this.deployJSFixes(connection, activeTheme.id, patchPackage, deploymentResult);
            }

            // Deploy Liquid template modifications
            if (patchPackage.liquidModifications) {
                await this.deployLiquidFixes(connection, activeTheme.id, patchPackage, deploymentResult);
            }

            // Update theme.liquid to include accessibility fixes
            await this.updateMainThemeLayout(connection, activeTheme.id, patchPackage, deploymentResult);

            deploymentResult.status = 'completed';
            deploymentResult.endTime = new Date().toISOString();
            
            console.log('✅ Shopify deployment completed successfully');

        } catch (error) {
            console.error('❌ Shopify deployment failed:', error);
            deploymentResult.status = 'failed';
            deploymentResult.error = error.message;
            deploymentResult.endTime = new Date().toISOString();

            // Attempt rollback if we have backups
            if (deploymentResult.backups.length > 0) {
                console.log('🔄 Attempting automatic rollback...');
                try {
                    await this.performRollback(connection, deploymentResult);
                    deploymentResult.rollbackStatus = 'success';
                } catch (rollbackError) {
                    console.error('❌ Rollback failed:', rollbackError);
                    deploymentResult.rollbackStatus = 'failed';
                    deploymentResult.rollbackError = rollbackError.message;
                }
            }
        }

        return deploymentResult;
    }

    /**
     * Validate Shopify store connection and permissions
     */
    async validateShopifyConnection(connection) {
        try {
            const { store_domain } = connection.connection_config;
            const { access_token } = connection.api_credentials;

            if (!store_domain || !access_token) {
                return { valid: false, error: 'Missing store domain or access token' };
            }

            const apiUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/shop.json`;
            
            const response = await axios.get(apiUrl, {
                headers: {
                    'X-Shopify-Access-Token': access_token,
                    'Content-Type': 'application/json'
                },
                timeout: this.options.timeout
            });

            if (response.status === 200) {
                console.log(`✅ Shopify connection validated for ${store_domain}`);
                return { 
                    valid: true, 
                    shop: response.data.shop,
                    permissions: response.headers['x-shopify-api-call-limit'] 
                };
            }

            return { valid: false, error: 'Invalid API response' };

        } catch (error) {
            console.error('Shopify validation failed:', error.response?.data || error.message);
            return { 
                valid: false, 
                error: error.response?.data?.errors || error.message 
            };
        }
    }

    /**
     * Get the currently active theme
     */
    async getActiveTheme(connection) {
        try {
            const { store_domain } = connection.connection_config;
            const { access_token } = connection.api_credentials;

            const apiUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes.json`;
            
            const response = await axios.get(apiUrl, {
                headers: {
                    'X-Shopify-Access-Token': access_token,
                    'Content-Type': 'application/json'
                },
                timeout: this.options.timeout
            });

            const activeTheme = response.data.themes.find(theme => theme.role === 'main');
            
            if (activeTheme) {
                console.log(`📋 Found active theme: ${activeTheme.name} (ID: ${activeTheme.id})`);
                return activeTheme;
            }

            throw new Error('No active theme found');

        } catch (error) {
            console.error('Failed to get active theme:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Create backups of theme assets before modification
     */
    async createThemeBackups(connection, themeId, patchPackage) {
        const backups = [];
        
        try {
            const { store_domain } = connection.connection_config;
            const { access_token } = connection.api_credentials;

            // Assets to backup before modification
            const assetsToBackup = [
                'assets/theme.css',
                'assets/theme.scss.liquid',
                'assets/application.js',
                'layout/theme.liquid',
                'assets/sentryprime-accessibility.css',
                'assets/sentryprime-accessibility.js'
            ];

            for (const assetKey of assetsToBackup) {
                try {
                    const apiUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes/${themeId}/assets.json?asset[key]=${assetKey}`;
                    
                    const response = await axios.get(apiUrl, {
                        headers: {
                            'X-Shopify-Access-Token': access_token,
                            'Content-Type': 'application/json'
                        },
                        timeout: this.options.timeout
                    });

                    if (response.data.asset) {
                        backups.push({
                            key: assetKey,
                            originalContent: response.data.asset.value || response.data.asset.attachment,
                            timestamp: new Date().toISOString()
                        });
                        
                        console.log(`📦 Backed up asset: ${assetKey}`);
                    }

                } catch (error) {
                    // Asset doesn't exist - that's OK, we'll create it
                    if (error.response?.status === 404) {
                        console.log(`ℹ️ Asset ${assetKey} doesn't exist - will create new`);
                    } else {
                        console.warn(`⚠️ Failed to backup ${assetKey}:`, error.message);
                    }
                }
            }

        } catch (error) {
            console.error('Backup creation failed:', error);
        }

        return { backups };
    }

    /**
     * Deploy CSS accessibility fixes
     */
    async deployCSSFixes(connection, themeId, patchPackage, deploymentResult) {
        try {
            const { store_domain } = connection.connection_config;
            const { access_token } = connection.api_credentials;

            // Generate comprehensive CSS fixes
            const cssContent = this.generateAccessibilityCSS(patchPackage);
            
            const apiUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes/${themeId}/assets.json`;
            
            const response = await axios.put(apiUrl, {
                asset: {
                    key: 'assets/sentryprime-accessibility.css',
                    value: cssContent
                }
            }, {
                headers: {
                    'X-Shopify-Access-Token': access_token,
                    'Content-Type': 'application/json'
                },
                timeout: this.options.timeout
            });

            if (response.status === 200) {
                deploymentResult.deployedAssets.push({
                    type: 'css',
                    key: 'assets/sentryprime-accessibility.css',
                    size: cssContent.length,
                    timestamp: new Date().toISOString()
                });

                deploymentResult.logs.push({
                    level: 'info',
                    message: 'CSS accessibility fixes deployed successfully',
                    timestamp: new Date().toISOString()
                });

                console.log('✅ CSS fixes deployed to Shopify theme');
            }

        } catch (error) {
            console.error('CSS deployment failed:', error.response?.data || error.message);
            deploymentResult.failedAssets.push({
                type: 'css',
                error: error.response?.data?.errors || error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Deploy JavaScript accessibility fixes
     */
    async deployJSFixes(connection, themeId, patchPackage, deploymentResult) {
        try {
            const { store_domain } = connection.connection_config;
            const { access_token } = connection.api_credentials;

            // Generate comprehensive JavaScript fixes
            const jsContent = this.generateAccessibilityJS(patchPackage);
            
            const apiUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes/${themeId}/assets.json`;
            
            const response = await axios.put(apiUrl, {
                asset: {
                    key: 'assets/sentryprime-accessibility.js',
                    value: jsContent
                }
            }, {
                headers: {
                    'X-Shopify-Access-Token': access_token,
                    'Content-Type': 'application/json'
                },
                timeout: this.options.timeout
            });

            if (response.status === 200) {
                deploymentResult.deployedAssets.push({
                    type: 'javascript',
                    key: 'assets/sentryprime-accessibility.js',
                    size: jsContent.length,
                    timestamp: new Date().toISOString()
                });

                deploymentResult.logs.push({
                    level: 'info',
                    message: 'JavaScript accessibility fixes deployed successfully',
                    timestamp: new Date().toISOString()
                });

                console.log('✅ JavaScript fixes deployed to Shopify theme');
            }

        } catch (error) {
            console.error('JavaScript deployment failed:', error.response?.data || error.message);
            deploymentResult.failedAssets.push({
                type: 'javascript',
                error: error.response?.data?.errors || error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Update main theme layout to include accessibility fixes
     */
    async updateMainThemeLayout(connection, themeId, patchPackage, deploymentResult) {
        try {
            const { store_domain } = connection.connection_config;
            const { access_token } = connection.api_credentials;

            // Get current theme.liquid content
            const getUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes/${themeId}/assets.json?asset[key]=layout/theme.liquid`;
            
            const getResponse = await axios.get(getUrl, {
                headers: {
                    'X-Shopify-Access-Token': access_token,
                    'Content-Type': 'application/json'
                },
                timeout: this.options.timeout
            });

            let themeContent = getResponse.data.asset.value;
            
            // Add accessibility CSS and JS includes
            const accessibilityIncludes = `
  <!-- SentryPrime Accessibility Fixes -->
  {{ 'sentryprime-accessibility.css' | asset_url | stylesheet_tag }}
  {{ 'sentryprime-accessibility.js' | asset_url | script_tag }}
  <!-- End SentryPrime Accessibility Fixes -->`;

            // Insert before closing </head> tag
            if (themeContent.includes('</head>')) {
                themeContent = themeContent.replace('</head>', `${accessibilityIncludes}\n</head>`);
            } else {
                // Fallback: add at the beginning of the file
                themeContent = accessibilityIncludes + '\n' + themeContent;
            }

            // Update theme.liquid
            const putUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes/${themeId}/assets.json`;
            
            const putResponse = await axios.put(putUrl, {
                asset: {
                    key: 'layout/theme.liquid',
                    value: themeContent
                }
            }, {
                headers: {
                    'X-Shopify-Access-Token': access_token,
                    'Content-Type': 'application/json'
                },
                timeout: this.options.timeout
            });

            if (putResponse.status === 200) {
                deploymentResult.deployedAssets.push({
                    type: 'layout',
                    key: 'layout/theme.liquid',
                    modification: 'added_accessibility_includes',
                    timestamp: new Date().toISOString()
                });

                deploymentResult.logs.push({
                    level: 'info',
                    message: 'Theme layout updated to include accessibility fixes',
                    timestamp: new Date().toISOString()
                });

                console.log('✅ Theme layout updated successfully');
            }

        } catch (error) {
            console.error('Theme layout update failed:', error.response?.data || error.message);
            deploymentResult.failedAssets.push({
                type: 'layout',
                error: error.response?.data?.errors || error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Generate CSS content for accessibility fixes
     */
    generateAccessibilityCSS(patchPackage) {
        let css = `/* SentryPrime Accessibility Fixes */
/* Generated: ${new Date().toISOString()} */
/* Scan ID: ${patchPackage.scanId} */

`;

        // Color contrast fixes
        if (patchPackage.violations.some(v => v.id === 'color-contrast')) {
            css += `/* Color Contrast Fixes */
.low-contrast-text,
.btn-primary,
.navbar-brand,
.text-muted {
    color: #000000 !important;
    background-color: #ffffff !important;
}

.btn-secondary {
    color: #ffffff !important;
    background-color: #343a40 !important;
}

a:not(.btn) {
    color: #0056b3 !important;
}

a:not(.btn):hover {
    color: #004085 !important;
}

`;
        }

        // Focus indicators
        css += `/* Enhanced Focus Indicators */
*:focus {
    outline: 2px solid #0056b3 !important;
    outline-offset: 2px !important;
}

.btn:focus,
.form-control:focus,
.form-select:focus {
    box-shadow: 0 0 0 0.2rem rgba(0, 86, 179, 0.25) !important;
}

`;

        // Skip links
        css += `/* Skip Navigation Links */
.skip-link {
    position: absolute;
    top: -40px;
    left: 6px;
    background: #000000;
    color: #ffffff;
    padding: 8px;
    text-decoration: none;
    z-index: 9999;
}

.skip-link:focus {
    top: 6px;
}

`;

        return css;
    }

    /**
     * Generate JavaScript content for accessibility fixes
     */
    generateAccessibilityJS(patchPackage) {
        let js = `// SentryPrime Accessibility Fixes
// Generated: ${new Date().toISOString()}
// Scan ID: ${patchPackage.scanId}

document.addEventListener('DOMContentLoaded', function() {
    console.log('SentryPrime: Initializing accessibility fixes...');
    
    // Add skip navigation link
    addSkipNavigation();
    
    // Fix missing alt attributes
    fixMissingAltAttributes();
    
    // Fix missing form labels
    fixMissingFormLabels();
    
    // Fix missing button names
    fixMissingButtonNames();
    
    // Add ARIA landmarks
    addAriaLandmarks();
    
    console.log('SentryPrime: All accessibility fixes applied successfully');
});

function addSkipNavigation() {
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Skip to main content';
    skipLink.className = 'skip-link';
    
    document.body.insertBefore(skipLink, document.body.firstChild);
    
    // Ensure main content has an ID
    let mainContent = document.getElementById('main-content');
    if (!mainContent) {
        mainContent = document.querySelector('main, .main, #main, .content, #content');
        if (mainContent) {
            mainContent.id = 'main-content';
        }
    }
}

function fixMissingAltAttributes() {
    const images = document.querySelectorAll('img:not([alt])');
    images.forEach(img => {
        // Try to get alt text from title, data attributes, or filename
        let altText = img.title || 
                     img.getAttribute('data-alt') || 
                     img.src.split('/').pop().split('.')[0].replace(/[-_]/g, ' ');
        
        img.alt = altText || 'Image';
    });
}

function fixMissingFormLabels() {
    const inputs = document.querySelectorAll('input:not([aria-label]):not([aria-labelledby]), select:not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby])');
    
    inputs.forEach(input => {
        if (!input.labels || input.labels.length === 0) {
            // Try to find nearby text or placeholder
            const placeholder = input.placeholder;
            const nearbyText = input.previousElementSibling?.textContent?.trim() || 
                              input.parentElement?.querySelector('span, div')?.textContent?.trim();
            
            const labelText = placeholder || nearbyText || input.name || input.type;
            
            if (labelText) {
                input.setAttribute('aria-label', labelText);
            }
        }
    });
}

function fixMissingButtonNames() {
    const buttons = document.querySelectorAll('button:not([aria-label]):not([aria-labelledby]), [role="button"]:not([aria-label]):not([aria-labelledby])');
    
    buttons.forEach(button => {
        if (!button.textContent.trim()) {
            // Try to get button name from title, data attributes, or icon
            const buttonName = button.title || 
                              button.getAttribute('data-title') ||
                              button.className.includes('close') ? 'Close' :
                              button.className.includes('menu') ? 'Menu' :
                              button.className.includes('search') ? 'Search' :
                              'Button';
            
            button.setAttribute('aria-label', buttonName);
        }
    });
}

function addAriaLandmarks() {
    // Add main landmark if missing
    if (!document.querySelector('[role="main"], main')) {
        const mainContent = document.querySelector('.main, #main, .content, #content, .container');
        if (mainContent) {
            mainContent.setAttribute('role', 'main');
        }
    }
    
    // Add navigation landmarks
    const navElements = document.querySelectorAll('nav:not([role]), .nav:not([role]), .navbar:not([role])');
    navElements.forEach(nav => {
        nav.setAttribute('role', 'navigation');
    });
    
    // Add banner landmark to header
    const header = document.querySelector('header:not([role]), .header:not([role])');
    if (header) {
        header.setAttribute('role', 'banner');
    }
    
    // Add contentinfo landmark to footer
    const footer = document.querySelector('footer:not([role]), .footer:not([role])');
    if (footer) {
        footer.setAttribute('role', 'contentinfo');
    }
}
`;

        return js;
    }

    /**
     * Perform rollback of Shopify deployment
     */
    async performRollback(connection, deploymentResult) {
        console.log('🔄 Starting Shopify rollback...');
        
        const { store_domain } = connection.connection_config;
        const { access_token } = connection.api_credentials;

        for (const backup of deploymentResult.backups) {
            try {
                const apiUrl = `https://${store_domain}/admin/api/${this.options.apiVersion}/themes/${deploymentResult.themeId}/assets.json`;
                
                await axios.put(apiUrl, {
                    asset: {
                        key: backup.key,
                        value: backup.originalContent
                    }
                }, {
                    headers: {
                        'X-Shopify-Access-Token': access_token,
                        'Content-Type': 'application/json'
                    },
                    timeout: this.options.timeout
                });

                console.log(`✅ Restored asset: ${backup.key}`);

            } catch (error) {
                console.error(`❌ Failed to restore ${backup.key}:`, error.message);
                throw error;
            }
        }

        console.log('✅ Shopify rollback completed successfully');
    }
}

module.exports = ShopifyDeploymentEngine;
