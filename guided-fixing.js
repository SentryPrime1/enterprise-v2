/**
 * 🛠️ GUIDED FIXING WORKFLOW - STANDALONE MODULE
 * This module is completely independent and will not interfere with existing functionality
 * All functions and variables are namespaced to prevent conflicts
 */

// Namespace to prevent conflicts with existing code
window.GuidedFixing = (function() {
    'use strict';
    
    // Private variables
    let currentViolations = [];
    let currentViolationIndex = 0;
    let fixedViolations = [];
    let isModalOpen = false;
    
    // Private functions
    function createModal() {
        const modalHTML = `
            <div id="gf-modal" class="gf-modal">
                <div class="gf-modal-content">
                    <div class="gf-modal-header">
                        <h2 class="gf-modal-title">
                            🛠️ Guided Accessibility Fixing
                        </h2>
                        <div id="gf-progress-indicator" class="gf-progress-indicator">
                            Violation 1 of 1
                        </div>
                        <button class="gf-close-btn" onclick="GuidedFixing.closeModal()">&times;</button>
                    </div>
                    <div class="gf-modal-body">
                        <div id="gf-violation-content">
                            <!-- Violation details will be inserted here -->
                        </div>
                        <div id="gf-ai-fix-area" class="gf-ai-fix-area">
                            <button id="gf-get-ai-fix-btn" class="gf-get-ai-fix-btn" onclick="GuidedFixing.getAIFixForCurrent()">
                                🤖 Get AI Fix Suggestion
                            </button>
                        </div>
                    </div>
                    <div class="gf-modal-footer">
                        <div class="gf-nav-buttons">
                            <button id="gf-prev-btn" class="gf-nav-btn" onclick="GuidedFixing.previousViolation()">
                                ← Previous
                            </button>
                            <button id="gf-next-btn" class="gf-nav-btn" onclick="GuidedFixing.nextViolation()">
                                Next →
                            </button>
                        </div>
                        <button id="gf-finish-btn" class="gf-finish-btn" onclick="GuidedFixing.finishGuidedFixing()" style="display: none;">
                            📊 Generate Report
                        </button>
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
        
        // Add click outside to close
        const modal = document.getElementById('gf-modal');
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                GuidedFixing.closeModal();
            }
        });
        
        // Add escape key to close
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape' && isModalOpen) {
                GuidedFixing.closeModal();
            }
        });
    }
    
    function sortViolationsByPriority(violations) {
        const priorityOrder = { 'critical': 0, 'serious': 1, 'moderate': 2, 'minor': 3 };
        return violations.sort(function(a, b) {
            return priorityOrder[a.impact] - priorityOrder[b.impact];
        });
    }
    
    function showCurrentViolation() {
        const violation = currentViolations[currentViolationIndex];
        const totalViolations = currentViolations.length;
        
        // Update progress indicator
        document.getElementById('gf-progress-indicator').textContent = 
            'Violation ' + (currentViolationIndex + 1) + ' of ' + totalViolations;
        
        // Update violation content
        const violationContent = document.getElementById('gf-violation-content');
        violationContent.innerHTML = 
            '<div class="gf-violation-details">' +
                '<div class="gf-violation-title">' +
                    violation.id +
                    '<span class="gf-violation-impact gf-impact-' + violation.impact + '">' +
                        violation.impact +
                    '</span>' +
                '</div>' +
                '<div class="gf-violation-description">' +
                    '<strong>Description:</strong> ' + (violation.description || 'No description available') +
                '</div>' +
                '<div class="gf-violation-help">' +
                    '<strong>Help:</strong> ' + (violation.help || 'Refer to WCAG guidelines for more information') +
                '</div>' +
                (violation.helpUrl ? 
                    '<div><strong>Learn more:</strong> <a href="' + violation.helpUrl + '" target="_blank" class="gf-violation-link">' + violation.helpUrl + '</a></div>' 
                    : '') +
            '</div>';
        
        // Reset AI fix area
        const aiFixArea = document.getElementById('gf-ai-fix-area');
        aiFixArea.innerHTML = 
            '<button id="gf-get-ai-fix-btn" class="gf-get-ai-fix-btn" onclick="GuidedFixing.getAIFixForCurrent()">' +
                '🤖 Get AI Fix Suggestion' +
            '</button>';
        
        // Update navigation buttons
        updateNavigationButtons();
    }
    
    function updateNavigationButtons() {
        const prevBtn = document.getElementById('gf-prev-btn');
        const nextBtn = document.getElementById('gf-next-btn');
        const finishBtn = document.getElementById('gf-finish-btn');
        
        // Previous button
        prevBtn.disabled = currentViolationIndex === 0;
        
        // Next button and finish button
        if (currentViolationIndex === currentViolations.length - 1) {
            nextBtn.style.display = 'none';
            finishBtn.style.display = 'inline-block';
        } else {
            nextBtn.style.display = 'inline-block';
            finishBtn.style.display = 'none';
        }
    }
    
    function showLoading() {
        const aiFixArea = document.getElementById('gf-ai-fix-area');
        aiFixArea.innerHTML = 
            '<div class="gf-loading">' +
                '<div class="gf-spinner"></div>' +
                'Getting AI fix suggestion...' +
            '</div>';
    }
    
    function showError(message) {
        const aiFixArea = document.getElementById('gf-ai-fix-area');
        aiFixArea.innerHTML = 
            '<div class="gf-error">' +
                '<h4>Unable to Generate AI Suggestion</h4>' +
                '<p>' + (message || 'Please try again or proceed to the next violation.') + '</p>' +
                '<button class="gf-get-ai-fix-btn" onclick="GuidedFixing.getAIFixForCurrent()" style="margin-top: 16px;">' +
                    '🔄 Try Again' +
                '</button>' +
            '</div>';
    }
    
    function displayAISuggestion(suggestion) {
        const aiFixArea = document.getElementById('gf-ai-fix-area');
        aiFixArea.innerHTML = 
            '<div class="gf-ai-suggestion">' +
                '<div class="gf-ai-suggestion-header">' +
                    '<div class="gf-ai-suggestion-title">🤖 AI Fix Suggestion</div>' +
                    '<span class="gf-priority-badge gf-priority-' + suggestion.priority + '">' +
                        suggestion.priority.toUpperCase() +
                    '</span>' +
                '</div>' +
                '<div class="gf-ai-suggestion-content">' +
                    '<p><strong>Issue:</strong> ' + suggestion.explanation + '</p>' +
                    '<p><strong>Code Example:</strong></p>' +
                    '<div class="gf-code-example">' + suggestion.codeExample + '</div>' +
                    '<div class="gf-implementation-steps">' +
                        '<p><strong>Implementation Steps:</strong></p>' +
                        '<ol>' + 
                            suggestion.steps.map(function(step) {
                                return '<li>' + step + '</li>';
                            }).join('') +
                        '</ol>' +
                    '</div>' +
                    '<button id="gf-save-btn" class="gf-save-to-report-btn" onclick="GuidedFixing.saveFixToReport()">' +
                        '💾 Save to Report' +
                    '</button>' +
                '</div>' +
            '</div>';
        
        // Store the suggestion for potential saving
        currentViolations[currentViolationIndex].aiSuggestion = suggestion;
    }
    
    function generateReport() {
        const reportContent = 
            '# Accessibility Fix Report\n' +
            'Generated on: ' + new Date().toLocaleString() + '\n\n' +
            '## Summary\n' +
            '- Total violations processed: ' + currentViolations.length + '\n' +
            '- Fixes saved to report: ' + fixedViolations.length + '\n\n' +
            '## Fix Details\n\n' +
            fixedViolations.map(function(fix, index) {
                return '### ' + (index + 1) + '. ' + fix.violation.id + '\n' +
                    '**Impact:** ' + fix.violation.impact + '\n' +
                    '**Description:** ' + fix.violation.description + '\n\n' +
                    '**AI Suggestion:**\n' +
                    fix.suggestion.explanation + '\n\n' +
                    '**Code Example:**\n' +
                    fix.suggestion.codeExample + '\n\n' +
                    '**Implementation Steps:**\n' +
                    fix.suggestion.steps.map(function(step, i) {
                        return (i + 1) + '. ' + step;
                    }).join('\n') + '\n\n' +
                    '---\n';
            }).join('') +
            '\n## Next Steps\n' +
            '1. Review each fix suggestion carefully\n' +
            '2. Test implementations in a development environment\n' +
            '3. Validate fixes with accessibility tools\n' +
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
        
        return fixedViolations.length;
    }
    
    // Public API
    return {
        // Initialize the guided fixing workflow
        start: function(violations) {
            if (!violations || violations.length === 0) {
                alert('No violations found to fix.');
                return;
            }
            
            // Sort violations by priority
            currentViolations = sortViolationsByPriority(violations);
            currentViolationIndex = 0;
            fixedViolations = [];
            isModalOpen = true;
            
            // Create and show modal
            createModal();
            document.getElementById('gf-modal').style.display = 'block';
            
            // Show first violation
            showCurrentViolation();
            
            // Focus management for accessibility
            setTimeout(function() {
                const modal = document.getElementById('gf-modal');
                if (modal) {
                    modal.focus();
                }
            }, 100);
        },
        
        // Close the modal
        closeModal: function() {
            const modal = document.getElementById('gf-modal');
            if (modal) {
                modal.style.display = 'none';
                isModalOpen = false;
            }
        },
        
        // Navigate to previous violation
        previousViolation: function() {
            if (currentViolationIndex > 0) {
                currentViolationIndex--;
                showCurrentViolation();
            }
        },
        
        // Navigate to next violation
        nextViolation: function() {
            if (currentViolationIndex < currentViolations.length - 1) {
                currentViolationIndex++;
                showCurrentViolation();
            }
        },
        
        // Get AI fix suggestion for current violation
        getAIFixForCurrent: function() {
            const violation = currentViolations[currentViolationIndex];
            
            // Show loading state
            showLoading();
            
            // Make API call to get AI suggestion
            fetch('/api/ai-fixes', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ violations: [violation] })
            })
            .then(function(response) {
                if (!response.ok) {
                    throw new Error('Failed to get AI suggestion');
                }
                return response.json();
            })
            .then(function(suggestions) {
                const suggestion = suggestions[0];
                if (suggestion) {
                    displayAISuggestion(suggestion);
                } else {
                    throw new Error('No suggestion received');
                }
            })
            .catch(function(error) {
                console.error('Error getting AI suggestion:', error);
                showError('Failed to get AI suggestion. Please try again.');
            });
        },
        
        // Save current fix to report
        saveFixToReport: function() {
            const violation = currentViolations[currentViolationIndex];
            if (violation.aiSuggestion) {
                fixedViolations.push({
                    violation: violation,
                    suggestion: violation.aiSuggestion,
                    timestamp: new Date().toISOString()
                });
                
                // Update button to show saved state
                const saveButton = document.getElementById('gf-save-btn');
                if (saveButton) {
                    saveButton.textContent = '✅ Saved to Report';
                    saveButton.disabled = true;
                    saveButton.className = 'gf-save-to-report-btn gf-saved';
                }
            }
        },
        
        // Finish guided fixing and generate report
        finishGuidedFixing: function() {
            if (fixedViolations.length === 0) {
                alert('No fixes have been saved to the report yet. Please get AI suggestions and save them before generating a report.');
                return;
            }
            
            // Generate and download report
            const savedCount = generateReport();
            
            // Close modal
            this.closeModal();
            
            // Show success message
            alert('Report generated! ' + savedCount + ' fixes saved to your downloads.');
        },
        
        // Add the guided fixing button to scan results
        addButtonToResults: function(violations) {
            // Find the existing buttons container
            const buttonsContainer = document.querySelector('.view-details-btn').parentNode;
            
            // Check if button already exists
            if (document.getElementById('gf-start-fixing-btn')) {
                return;
            }
            
            // Create the guided fixing button
            const guidedFixingButton = document.createElement('button');
            guidedFixingButton.id = 'gf-start-fixing-btn';
            guidedFixingButton.className = 'gf-start-fixing-btn';
            guidedFixingButton.innerHTML = '🛠️ Let\'s Start Fixing';
            guidedFixingButton.onclick = function() {
                GuidedFixing.start(violations);
            };
            
            // Add button to container
            buttonsContainer.appendChild(guidedFixingButton);
        },
        
        // Check if guided fixing is available
        isAvailable: function() {
            return true;
        },
        
        // Get current status
        getStatus: function() {
            return {
                isModalOpen: isModalOpen,
                currentViolationIndex: currentViolationIndex,
                totalViolations: currentViolations.length,
                fixedCount: fixedViolations.length
            };
        }
    };
})();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('🛠️ Guided Fixing module loaded successfully');
});

// Export for potential module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.GuidedFixing;
}
