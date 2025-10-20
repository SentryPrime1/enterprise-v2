/**
 * Deployment Status UI Component for SentryPrime
 * Provides real-time deployment status tracking and progress visualization
 * 
 * Author: Manus AI
 * Date: October 20, 2025
 */

window.DeploymentStatus = (function() {
    'use strict';
    
    let activeDeployments = new Map();
    let eventSources = new Map();
    
    // Create deployment status modal
    function createDeploymentModal() {
        const modalHTML = `
            <div id="deployment-status-modal" class="deployment-modal">
                <div class="deployment-modal-content">
                    <div class="deployment-modal-header">
                        <h2>🚀 Deployment Status</h2>
                        <button class="deployment-close-btn" onclick="DeploymentStatus.closeModal()">&times;</button>
                    </div>
                    <div class="deployment-modal-body">
                        <div id="deployment-list" class="deployment-list">
                            <!-- Deployment items will be inserted here -->
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // Remove existing modal if present
        const existingModal = document.getElementById('deployment-status-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Add modal to body
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Add click outside to close
        const modal = document.getElementById('deployment-status-modal');
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                DeploymentStatus.closeModal();
            }
        });
        
        // Add escape key to close
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                DeploymentStatus.closeModal();
            }
        });
    }
    
    // Create deployment progress bar
    function createProgressBar(progress, status) {
        const progressClass = status === 'failed' ? 'progress-error' : 
                            status === 'completed' ? 'progress-success' : 'progress-active';
        
        return `
            <div class="deployment-progress">
                <div class="progress-bar">
                    <div class="progress-fill ${progressClass}" style="width: ${progress}%"></div>
                </div>
                <span class="progress-text">${progress}%</span>
            </div>
        `;
    }
    
    // Create deployment step indicators
    function createStepIndicators(steps) {
        return steps.map(step => {
            const stepClass = step.status === 'completed' ? 'step-completed' :
                            step.status === 'in_progress' ? 'step-active' :
                            step.status === 'failed' ? 'step-error' : 'step-pending';
            
            const stepIcon = step.status === 'completed' ? '✅' :
                           step.status === 'in_progress' ? '🔄' :
                           step.status === 'failed' ? '❌' : '⏳';
            
            return `
                <div class="deployment-step ${stepClass}">
                    <span class="step-icon">${stepIcon}</span>
                    <span class="step-name">${step.name}</span>
                    <span class="step-message">${step.message}</span>
                </div>
            `;
        }).join('');
    }
    
    // Create deployment item HTML
    function createDeploymentItem(deployment) {
        const statusClass = deployment.status === 'completed' ? 'status-success' :
                          deployment.status === 'failed' ? 'status-error' :
                          deployment.status === 'cancelled' ? 'status-cancelled' : 'status-active';
        
        const statusIcon = deployment.status === 'completed' ? '✅' :
                         deployment.status === 'failed' ? '❌' :
                         deployment.status === 'cancelled' ? '⏹️' : '🔄';
        
        const platformIcon = deployment.platform === 'shopify' ? '🛍️' :
                           deployment.platform === 'wordpress' ? '🔧' : '🌐';
        
        return `
            <div class="deployment-item" data-deployment-id="${deployment.id}">
                <div class="deployment-header">
                    <div class="deployment-info">
                        <span class="platform-icon">${platformIcon}</span>
                        <div class="deployment-details">
                            <div class="deployment-title">
                                ${deployment.platform.charAt(0).toUpperCase() + deployment.platform.slice(1)} Deployment
                            </div>
                            <div class="deployment-url">${deployment.websiteUrl}</div>
                        </div>
                    </div>
                    <div class="deployment-status ${statusClass}">
                        <span class="status-icon">${statusIcon}</span>
                        <span class="status-text">${deployment.status}</span>
                    </div>
                </div>
                
                ${createProgressBar(deployment.progress || 0, deployment.status)}
                
                <div class="deployment-steps">
                    ${createStepIndicators(deployment.steps || [])}
                </div>
                
                <div class="deployment-actions">
                    ${deployment.status !== 'completed' && deployment.status !== 'failed' && deployment.status !== 'cancelled' ? 
                        `<button class="cancel-btn" onclick="DeploymentStatus.cancelDeployment('${deployment.id}')">Cancel</button>` : ''
                    }
                    <button class="logs-btn" onclick="DeploymentStatus.showLogs('${deployment.id}')">View Logs</button>
                </div>
                
                <div id="logs-${deployment.id}" class="deployment-logs" style="display: none;">
                    <!-- Logs will be inserted here -->
                </div>
            </div>
        `;
    }
    
    // Update deployment display
    function updateDeploymentDisplay() {
        const deploymentList = document.getElementById('deployment-list');
        if (!deploymentList) return;
        
        if (activeDeployments.size === 0) {
            deploymentList.innerHTML = `
                <div class="no-deployments">
                    <p>No active deployments</p>
                </div>
            `;
            return;
        }
        
        const deploymentsHTML = Array.from(activeDeployments.values())
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
            .map(deployment => createDeploymentItem(deployment))
            .join('');
        
        deploymentList.innerHTML = deploymentsHTML;
    }
    
    // Start real-time tracking for a deployment
    function startRealtimeTracking(deploymentId) {
        if (eventSources.has(deploymentId)) {
            return; // Already tracking
        }
        
        const eventSource = new EventSource(`/api/deployment/${deploymentId}/stream`);
        
        eventSource.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                
                if (data.type === 'update' || data.type === 'status') {
                    activeDeployments.set(deploymentId, data.deployment);
                    updateDeploymentDisplay();
                }
            } catch (error) {
                console.error('Error parsing SSE data:', error);
            }
        };
        
        eventSource.onerror = function(error) {
            console.error('SSE connection error:', error);
            eventSources.delete(deploymentId);
            eventSource.close();
        };
        
        eventSources.set(deploymentId, eventSource);
    }
    
    // Stop real-time tracking for a deployment
    function stopRealtimeTracking(deploymentId) {
        const eventSource = eventSources.get(deploymentId);
        if (eventSource) {
            eventSource.close();
            eventSources.delete(deploymentId);
        }
    }
    
    // Public API
    return {
        // Show deployment status modal
        showModal: function() {
            createDeploymentModal();
            document.getElementById('deployment-status-modal').style.display = 'flex';
            this.refreshDeployments();
        },
        
        // Close deployment status modal
        closeModal: function() {
            const modal = document.getElementById('deployment-status-modal');
            if (modal) {
                modal.style.display = 'none';
            }
            
            // Close all SSE connections
            eventSources.forEach((eventSource, deploymentId) => {
                eventSource.close();
            });
            eventSources.clear();
        },
        
        // Track a new deployment
        trackDeployment: function(deploymentId) {
            // Fetch initial deployment status
            fetch(`/api/deployment/status/${deploymentId}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        activeDeployments.set(deploymentId, data.deployment);
                        updateDeploymentDisplay();
                        startRealtimeTracking(deploymentId);
                    }
                })
                .catch(error => {
                    console.error('Error fetching deployment status:', error);
                });
        },
        
        // Refresh all deployments
        refreshDeployments: function() {
            fetch('/api/deployment/active')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        activeDeployments.clear();
                        
                        data.deployments.forEach(deployment => {
                            activeDeployments.set(deployment.id, deployment);
                            startRealtimeTracking(deployment.id);
                        });
                        
                        updateDeploymentDisplay();
                    }
                })
                .catch(error => {
                    console.error('Error fetching active deployments:', error);
                });
        },
        
        // Cancel a deployment
        cancelDeployment: function(deploymentId) {
            if (!confirm('Are you sure you want to cancel this deployment?')) {
                return;
            }
            
            fetch(`/api/deployment/${deploymentId}/cancel`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    console.log('Deployment cancelled:', deploymentId);
                } else {
                    alert('Failed to cancel deployment: ' + data.error);
                }
            })
            .catch(error => {
                console.error('Error cancelling deployment:', error);
                alert('Failed to cancel deployment');
            });
        },
        
        // Show deployment logs
        showLogs: function(deploymentId) {
            const logsContainer = document.getElementById(`logs-${deploymentId}`);
            if (!logsContainer) return;
            
            if (logsContainer.style.display === 'none') {
                // Fetch and show logs
                fetch(`/api/deployment/${deploymentId}/logs`)
                    .then(response => response.json())
                    .then(data => {
                        if (data.success) {
                            const logsHTML = data.logs.map(log => {
                                const logClass = log.level === 'error' ? 'log-error' :
                                               log.level === 'warning' ? 'log-warning' : 'log-info';
                                
                                return `
                                    <div class="log-entry ${logClass}">
                                        <span class="log-timestamp">${new Date(log.timestamp).toLocaleTimeString()}</span>
                                        <span class="log-message">${log.message}</span>
                                    </div>
                                `;
                            }).join('');
                            
                            logsContainer.innerHTML = logsHTML || '<p>No logs available</p>';
                            logsContainer.style.display = 'block';
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching logs:', error);
                        logsContainer.innerHTML = '<p>Failed to load logs</p>';
                        logsContainer.style.display = 'block';
                    });
            } else {
                // Hide logs
                logsContainer.style.display = 'none';
            }
        },
        
        // Show deployment notification
        showNotification: function(deploymentId, message, type = 'info') {
            // Create notification element
            const notification = document.createElement('div');
            notification.className = `deployment-notification notification-${type}`;
            notification.innerHTML = `
                <div class="notification-content">
                    <span class="notification-icon">
                        ${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}
                    </span>
                    <span class="notification-message">${message}</span>
                    <button class="notification-close" onclick="this.parentElement.parentElement.remove()">×</button>
                </div>
            `;
            
            // Add to page
            document.body.appendChild(notification);
            
            // Auto-remove after 5 seconds
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
            }, 5000);
        }
    };
})();

// Add deployment status styles
const deploymentStyles = `
    .deployment-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: none;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    }
    
    .deployment-modal-content {
        background: white;
        border-radius: 8px;
        width: 90%;
        max-width: 800px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    
    .deployment-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #eee;
    }
    
    .deployment-modal-header h2 {
        margin: 0;
        color: #333;
    }
    
    .deployment-close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
    }
    
    .deployment-modal-body {
        padding: 20px;
    }
    
    .deployment-item {
        border: 1px solid #ddd;
        border-radius: 8px;
        margin-bottom: 16px;
        padding: 16px;
        background: #f9f9f9;
    }
    
    .deployment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
    }
    
    .deployment-info {
        display: flex;
        align-items: center;
        gap: 12px;
    }
    
    .platform-icon {
        font-size: 24px;
    }
    
    .deployment-title {
        font-weight: bold;
        color: #333;
    }
    
    .deployment-url {
        font-size: 0.9em;
        color: #666;
    }
    
    .deployment-status {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 12px;
        border-radius: 16px;
        font-size: 0.9em;
        font-weight: bold;
    }
    
    .status-success {
        background: #d4edda;
        color: #155724;
    }
    
    .status-error {
        background: #f8d7da;
        color: #721c24;
    }
    
    .status-active {
        background: #d1ecf1;
        color: #0c5460;
    }
    
    .status-cancelled {
        background: #f0f0f0;
        color: #666;
    }
    
    .deployment-progress {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 12px;
    }
    
    .progress-bar {
        flex: 1;
        height: 8px;
        background: #e9ecef;
        border-radius: 4px;
        overflow: hidden;
    }
    
    .progress-fill {
        height: 100%;
        transition: width 0.3s ease;
    }
    
    .progress-active {
        background: #007bff;
    }
    
    .progress-success {
        background: #28a745;
    }
    
    .progress-error {
        background: #dc3545;
    }
    
    .progress-text {
        font-size: 0.9em;
        color: #666;
        min-width: 40px;
    }
    
    .deployment-steps {
        margin-bottom: 12px;
    }
    
    .deployment-step {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
        font-size: 0.9em;
    }
    
    .step-completed {
        color: #28a745;
    }
    
    .step-active {
        color: #007bff;
    }
    
    .step-error {
        color: #dc3545;
    }
    
    .step-pending {
        color: #6c757d;
    }
    
    .step-name {
        font-weight: bold;
        min-width: 80px;
    }
    
    .step-message {
        color: #666;
    }
    
    .deployment-actions {
        display: flex;
        gap: 8px;
    }
    
    .cancel-btn, .logs-btn {
        padding: 6px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background: white;
        cursor: pointer;
        font-size: 0.9em;
    }
    
    .cancel-btn:hover {
        background: #f8d7da;
        border-color: #dc3545;
        color: #721c24;
    }
    
    .logs-btn:hover {
        background: #e9ecef;
    }
    
    .deployment-logs {
        margin-top: 12px;
        padding: 12px;
        background: #f8f9fa;
        border-radius: 4px;
        max-height: 200px;
        overflow-y: auto;
    }
    
    .log-entry {
        display: flex;
        gap: 8px;
        padding: 2px 0;
        font-size: 0.8em;
    }
    
    .log-timestamp {
        color: #666;
        min-width: 80px;
    }
    
    .log-info {
        color: #333;
    }
    
    .log-warning {
        color: #856404;
    }
    
    .log-error {
        color: #721c24;
    }
    
    .no-deployments {
        text-align: center;
        padding: 40px;
        color: #666;
    }
    
    .deployment-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10001;
        min-width: 300px;
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 16px;
    }
    
    .notification-close {
        background: none;
        border: none;
        cursor: pointer;
        color: #666;
        margin-left: auto;
    }
    
    .notification-success {
        border-left: 4px solid #28a745;
    }
    
    .notification-error {
        border-left: 4px solid #dc3545;
    }
    
    .notification-info {
        border-left: 4px solid #007bff;
    }
`;

// Inject styles
const styleSheet = document.createElement('style');
styleSheet.textContent = deploymentStyles;
document.head.appendChild(styleSheet);
