/**
 * Enhanced Guided Fixing Modal for SentryPrime Enterprise
 * Final Version - Streamlined for Premium Users with Pre-Connected Platforms
 * 
 * Features:
 * - Removed "Connect Platform" button (handled during onboarding)
 * - Enhanced "Deploy Fix" as primary action
 * - Premium user experience optimization
 * - Real-time deployment status integration
 * 
 * Author: Manus AI
 * Date: October 20, 2025
 */

window.GuidedFixing = (function() {
    'use strict';
    
    let currentViolations = [];
    let currentViolationIndex = 0;
    let fixedViolations = [];
    let isModalOpen = false;
    
    // Create the guided fixing modal
    function createModal() {
        const modalHTML = `
            <div id="gf-modal" class="gf-modal">
                <div class="gf-modal-content">
                    <div class="gf-modal-header">
                        <h2>🛠️ Guided Accessibility Fixing</h2>
                        <button class="gf-close-btn" onclick="GuidedFixing.closeModal()">&times;</button>
                    </div>
                    <div class="gf-modal-body">
                        <div id="gf-content">
                            <!-- Content will be dynamically inserted here -->
                        </div>
                    </div>
                    <div class="gf-modal-footer">
                        <div class="gf-navigation">
                            <button id="gf-prev-btn" onclick="GuidedFixing.previousViolation()" disabled>← Previous</button>
                            <span id="gf-counter">1 of 1</span>
                            <button id="gf-next-btn" onclick="GuidedFixing.nextViolation()" disabled>Next →</button>
                        </div>
                        <div class="gf-footer-actions">
                            <button class="gf-generate-report-btn" onclick="GuidedFixing.generateReport()">
                                📄 Generate Complete Report
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if present
        const existingModal = document.getElementById('gf-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Set modal as open
        isModalOpen = true;
        
        // Add click outside to close
        const modal = document.getElementById('gf-modal');
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                GuidedFixing.closeModal();
            }
        });
        
        // Add escape key to close (remove existing listener first)
        document.removeEventListener('keydown', handleEscapeKey);
        document.addEventListener('keydown', handleEscapeKey);
    }
    
    function handleEscapeKey(e) {
        if (e.key === 'Escape' && isModalOpen) {
            GuidedFixing.closeModal();
        }
    }
    
    function sortViolationsByPriority(violations) {
        const priorityOrder = { 'critical': 0, 'serious': 1, 'moderate': 2, 'minor': 3 };
        return violations.sort((a, b) => {
            const aPriority = priorityOrder[a.impact] || 4;
            const bPriority = priorityOrder[b.impact] || 4;
            return aPriority - bPriority;
        });
    }
    
    function getImpactColor(impact) {
        const colors = {
            'critical': '#dc3545',
            'serious': '#fd7e14', 
            'moderate': '#ffc107',
            'minor': '#28a745'
        };
        return colors[impact] || '#6c757d';
    }
    
    function getImpactIcon(impact) {
        const icons = {
            'critical': '🚨',
            'serious': '⚠️',
            'moderate': '⚡',
            'minor': 'ℹ️'
        };
        return icons[impact] || '📋';
    }
    
    function displayViolation(violation, index) {
        const content = document.getElementById('gf-content');
        const impactColor = getImpactColor(violation.impact);
        const impactIcon = getImpactIcon(violation.impact);
        
        content.innerHTML = `
            <div class="gf-violation-header">
                <div class="gf-violation-title">
                    <span class="gf-impact-badge" style="background-color: ${impactColor}">
                        ${impactIcon} ${violation.impact.toUpperCase()}
                    </span>
                    <h3>${violation.description || violation.help || 'Accessibility Issue'}</h3>
                </div>
                <div class="gf-violation-meta">
                    <span class="gf-rule-id">Rule: ${violation.id}</span>
                    ${violation.helpUrl ? `<a href="${violation.helpUrl}" target="_blank" class="gf-help-link">📖 Learn More</a>` : ''}
                </div>
            </div>
            
            <div class="gf-violation-details">
                <div class="gf-description">
                    <h4>📋 Issue Description</h4>
                    <p>${violation.help || violation.description || 'This accessibility issue needs to be addressed to improve website compliance.'}</p>
                </div>
                
                <div class="gf-ai-suggestion" id="gf-ai-suggestion-${index}">
                    <h4>🤖 AI-Generated Fix</h4>
                    <div class="gf-suggestion-content">
                        ${violation.aiSuggestion ? 
                            `<div class="gf-suggestion-ready">
                                <div class="gf-fix-summary">
                                    <h5>💡 Recommended Solution</h5>
                                    <p>${violation.aiSuggestion.summary}</p>
                                </div>
                                <div class="gf-implementation-steps">
                                    <h5>🔧 Implementation Steps</h5>
                                    <ol>
                                        ${violation.aiSuggestion.steps.map(step => `<li>${step}</li>`).join('')}
                                    </ol>
                                </div>
                                <div class="gf-premium-actions">
                                    <div class="gf-premium-badge">
                                        <span class="gf-premium-icon">⭐</span>
                                        <span class="gf-premium-text">Premium Feature</span>
                                    </div>
                                    <div class="gf-action-buttons">
                                        <button id="gf-save-btn" class="gf-save-to-report-btn" onclick="GuidedFixing.saveFixToReport()">
                                            💾 Save to Report
                                        </button>
                                        <button id="gf-deploy-btn" class="gf-deploy-fix-btn" onclick="GuidedFixing.deployFix()">
                                            🚀 Deploy Fix Now
                                        </button>
                                    </div>
                                    <div class="gf-deploy-info">
                                        <p class="gf-deploy-note">
                                            <span class="gf-info-icon">ℹ️</span>
                                            This fix will be automatically deployed to your connected website platform.
                                        </p>
                                    </div>
                                </div>
                            </div>` : 
                            `<div class="gf-suggestion-loading">
                                <button class="gf-generate-suggestion-btn" onclick="GuidedFixing.generateAISuggestion(${index})">
                                    🤖 Generate AI Fix Suggestion
                                </button>
                                <p class="gf-suggestion-note">Click to get a personalized AI-generated solution for this accessibility issue.</p>
                            </div>`
                        }
                    </div>
                </div>
            </div>
        `;
        
        // Update navigation
        updateNavigation();
    }
    
    function updateNavigation() {
        const prevBtn = document.getElementById('gf-prev-btn');
        const nextBtn = document.getElementById('gf-next-btn');
        const counter = document.getElementById('gf-counter');
        
        if (prevBtn) prevBtn.disabled = currentViolationIndex === 0;
        if (nextBtn) nextBtn.disabled = currentViolationIndex === currentViolations.length - 1;
        if (counter) counter.textContent = `${currentViolationIndex + 1} of ${currentViolations.length}`;
    }
    
    function showError(message) {
        const content = document.getElementById('gf-content');
        content.innerHTML = `
            <div class="gf-error">
                <h3>❌ Error</h3>
                <p>${message}</p>
                <button onclick="GuidedFixing.closeModal()" class="gf-close-error-btn">Close</button>
            </div>
        `;
    }
    
    function showLoading(message = 'Loading...') {
        const content = document.getElementById('gf-content');
        content.innerHTML = `
            <div class="gf-loading">
                <div class="gf-spinner"></div>
                <p>${message}</p>
            </div>
        `;
    }
    
    // Public API
    return {
        // Start the guided fixing process
        start: function(violations) {
            if (!violations || violations.length === 0) {
                alert('No accessibility violations found to fix.');
                return;
            }
            
            currentViolations = sortViolationsByPriority(violations);
            currentViolationIndex = 0;
            fixedViolations = [];
            
            createModal();
            document.getElementById('gf-modal').style.display = 'flex';
            
            // Add a small delay to ensure modal is rendered
            setTimeout(() => {
                displayViolation(currentViolations[0], 0);
            }, 100);
        },
        
        // Close the modal
        closeModal: function() {
            const modal = document.getElementById('gf-modal');
            if (modal) {
                modal.remove();
                isModalOpen = false;
            }
        },
        
        // Navigate to previous violation
        previousViolation: function() {
            if (currentViolationIndex > 0) {
                currentViolationIndex--;
                displayViolation(currentViolations[currentViolationIndex], currentViolationIndex);
            }
        },
        
        // Navigate to next violation
        nextViolation: function() {
            if (currentViolationIndex < currentViolations.length - 1) {
                currentViolationIndex++;
                displayViolation(currentViolations[currentViolationIndex], currentViolationIndex);
            }
        },
        
        // Generate AI suggestion for current violation
        generateAISuggestion: function(index) {
            const violation = currentViolations[index];
            const suggestionContainer = document.getElementById(`gf-ai-suggestion-${index}`);
            
            // Show loading state
            suggestionContainer.querySelector('.gf-suggestion-content').innerHTML = `
                <div class="gf-suggestion-loading">
                    <div class="gf-spinner"></div>
                    <p>🤖 AI is analyzing this accessibility issue and generating a custom fix...</p>
                </div>
            `;
            
            // Call AI suggestion API
            fetch('/api/ai-suggestion', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    violation: violation,
                    context: {
                        url: window.location.href,
                        userAgent: navigator.userAgent
                    }
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success && data.suggestion) {
                    // Store the suggestion
                    violation.aiSuggestion = data.suggestion;
                    
                    // Re-display the violation with the new suggestion
                    displayViolation(violation, index);
                } else {
                    showError('Failed to generate AI suggestion. Please try again.');
                }
            })
            .catch(error => {
                console.error('AI suggestion error:', error);
                showError('Failed to get AI suggestion. Please try again.');
            });
        },
        
        // Save current fix to report
        saveFixToReport: function() {
            const violation = currentViolations[currentViolationIndex];
            
            if (violation && violation.aiSuggestion) {
                fixedViolations.push({
                    violation: violation,
                    suggestion: violation.aiSuggestion
                });
                
                // Update button to show saved state
                const saveBtn = document.getElementById('gf-save-btn');
                if (saveBtn) {
                    saveBtn.textContent = '✅ Saved to Report';
                    saveBtn.disabled = true;
                }
                
                console.log('Fix saved to report:', violation.id);
            }
        },
        
        // Deploy current fix to live website
        deployFix: function() {
            const violation = currentViolations[currentViolationIndex];
            
            if (!violation || !violation.aiSuggestion) {
                alert('Please generate an AI fix suggestion first.');
                return;
            }
            
            // Update button to show deploying state
            const deployBtn = document.getElementById('gf-deploy-btn');
            if (deployBtn) {
                deployBtn.textContent = '🔄 Deploying...';
                deployBtn.disabled = true;
            }
            
            // Create violation ID for deployment
            const violationId = 'violation_' + (violation.id || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
            
            // Call the deployment API
            fetch('/api/deploy-fix', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    violationId: violationId,
                    platform: 'auto', // Let the backend determine the platform
                    userId: 1, // This would come from authentication
                    violation: violation,
                    suggestion: violation.aiSuggestion
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Show deployment status
                    if (window.DeploymentStatus) {
                        DeploymentStatus.trackDeployment(data.deploymentId);
                        DeploymentStatus.showNotification(
                            data.deploymentId,
                            'Deployment started successfully! Your accessibility fix is being deployed to your live website.',
                            'success'
                        );
                    }
                    
                    // Update button to show success
                    if (deployBtn) {
                        deployBtn.textContent = '✅ Deployed Successfully';
                        deployBtn.style.background = '#28a745';
                        deployBtn.style.color = 'white';
                    }
                    
                    // Show success message
                    const deployInfo = document.querySelector('.gf-deploy-info');
                    if (deployInfo) {
                        deployInfo.innerHTML = `
                            <p class="gf-deploy-success">
                                <span class="gf-success-icon">✅</span>
                                Deployment successful! Your accessibility fix has been applied to your live website.
                                <a href="#" onclick="DeploymentStatus.showModal()" class="gf-view-status-link">View deployment status</a>
                            </p>
                        `;
                    }
                    
                    console.log('Deployment started:', data.deploymentId);
                    
                } else {
                    // Handle deployment failure
                    let errorMessage = data.message || 'Deployment failed';
                    
                    if (data.upgradeRequired) {
                        errorMessage = 'Premium subscription required for automatic deployment.';
                    } else if (data.requiresConnection) {
                        errorMessage = 'Please ensure your website platform is properly connected. Contact support if this issue persists.';
                    }
                    
                    alert(errorMessage);
                    
                    // Reset button
                    if (deployBtn) {
                        deployBtn.textContent = '🚀 Deploy Fix Now';
                        deployBtn.disabled = false;
                    }
                }
            })
            .catch(error => {
                console.error('Deployment error:', error);
                alert('Deployment failed: ' + error.message);
                
                // Reset button
                if (deployBtn) {
                    deployBtn.textContent = '🚀 Deploy Fix Now';
                    deployBtn.disabled = false;
                }
            });
        },
        
        // Generate complete report
        generateReport: function() {
            if (fixedViolations.length === 0) {
                alert('No fixes have been saved to the report yet. Please save some fixes first.');
                return;
            }
            
            // Generate and download report
            const reportData = {
                violations: fixedViolations,
                timestamp: new Date().toISOString(),
                totalFixed: fixedViolations.length
            };
            
            // Create report window
            const reportWindow = window.open('', '_blank');
            reportWindow.document.write(`
                <html>
                <head>
                    <title>SentryPrime Accessibility Fix Report</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 40px; }
                        .header { border-bottom: 2px solid #007bff; padding-bottom: 20px; margin-bottom: 30px; }
                        .fix-item { border: 1px solid #ddd; padding: 20px; margin: 20px 0; border-radius: 8px; }
                        .impact-critical { border-left: 4px solid #dc3545; }
                        .impact-serious { border-left: 4px solid #fd7e14; }
                        .impact-moderate { border-left: 4px solid #ffc107; }
                        .impact-minor { border-left: 4px solid #28a745; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🛡️ SentryPrime Accessibility Fix Report</h1>
                        <p>Generated: ${new Date().toLocaleString()}</p>
                        <p>Total Fixes: ${fixedViolations.length}</p>
                    </div>
                    ${fixedViolations.map((fix, index) => `
                        <div class="fix-item impact-${fix.violation.impact}">
                            <h3>${fix.violation.description || fix.violation.help}</h3>
                            <p><strong>Impact:</strong> ${fix.violation.impact.toUpperCase()}</p>
                            <p><strong>Rule:</strong> ${fix.violation.id}</p>
                            <div>
                                <h4>AI-Generated Solution:</h4>
                                <p>${fix.suggestion.summary}</p>
                                <ol>
                                    ${fix.suggestion.steps.map(step => `<li>${step}</li>`).join('')}
                                </ol>
                            </div>
                        </div>
                    `).join('')}
                </body>
                </html>
            `);
        }
    };
})();

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('Enhanced Guided Fixing module loaded successfully');
});
