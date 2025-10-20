/**
 * Deployment Status Tracker for SentryPrime
 * Provides real-time deployment status tracking and progress monitoring
 * 
 * Author: Manus AI
 * Date: October 20, 2025
 */

class DeploymentStatusTracker {
    constructor(db = null) {
        this.db = db;
        this.activeDeployments = new Map();
        this.deploymentHistory = new Map();
        this.statusCallbacks = new Map();
    }

    /**
     * Start tracking a new deployment
     * @param {string} deploymentId - Unique deployment identifier
     * @param {Object} deploymentInfo - Initial deployment information
     */
    startDeployment(deploymentId, deploymentInfo) {
        const deployment = {
            id: deploymentId,
            status: 'initializing',
            platform: deploymentInfo.platform,
            websiteUrl: deploymentInfo.websiteUrl,
            userId: deploymentInfo.userId,
            violationId: deploymentInfo.violationId,
            startTime: new Date().toISOString(),
            progress: 0,
            steps: [
                { name: 'validation', status: 'pending', message: 'Validating connection...' },
                { name: 'backup', status: 'pending', message: 'Creating backups...' },
                { name: 'deployment', status: 'pending', message: 'Deploying fixes...' },
                { name: 'verification', status: 'pending', message: 'Verifying deployment...' },
                { name: 'completion', status: 'pending', message: 'Finalizing...' }
            ],
            logs: [],
            deployedAssets: [],
            failedAssets: [],
            backups: []
        };

        this.activeDeployments.set(deploymentId, deployment);
        this.logDeploymentEvent(deploymentId, 'info', 'Deployment started');
        
        console.log(`📊 Started tracking deployment: ${deploymentId}`);
        return deployment;
    }

    /**
     * Update deployment status
     * @param {string} deploymentId - Deployment identifier
     * @param {string} status - New status
     * @param {string} message - Status message
     */
    updateStatus(deploymentId, status, message = '') {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) {
            console.warn(`Deployment ${deploymentId} not found for status update`);
            return;
        }

        deployment.status = status;
        deployment.lastUpdate = new Date().toISOString();
        
        if (message) {
            this.logDeploymentEvent(deploymentId, 'info', message);
        }

        // Update progress based on status
        this.updateProgress(deploymentId, status);
        
        // Notify callbacks
        this.notifyStatusChange(deploymentId, deployment);
        
        console.log(`📊 Updated deployment ${deploymentId}: ${status} - ${message}`);
    }

    /**
     * Update deployment step status
     * @param {string} deploymentId - Deployment identifier
     * @param {string} stepName - Name of the step
     * @param {string} status - Step status (pending, in_progress, completed, failed)
     * @param {string} message - Step message
     */
    updateStep(deploymentId, stepName, status, message = '') {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        const step = deployment.steps.find(s => s.name === stepName);
        if (step) {
            step.status = status;
            step.message = message;
            step.timestamp = new Date().toISOString();
        }

        // Update overall progress
        this.calculateProgress(deploymentId);
        
        this.logDeploymentEvent(deploymentId, 'info', `${stepName}: ${message}`);
        this.notifyStatusChange(deploymentId, deployment);
    }

    /**
     * Calculate deployment progress percentage
     */
    calculateProgress(deploymentId) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        const totalSteps = deployment.steps.length;
        const completedSteps = deployment.steps.filter(s => s.status === 'completed').length;
        const failedSteps = deployment.steps.filter(s => s.status === 'failed').length;
        
        if (failedSteps > 0) {
            deployment.progress = Math.floor((completedSteps / totalSteps) * 100);
        } else {
            deployment.progress = Math.floor((completedSteps / totalSteps) * 100);
        }
    }

    /**
     * Update progress based on overall status
     */
    updateProgress(deploymentId, status) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        switch (status) {
            case 'initializing':
                deployment.progress = 5;
                break;
            case 'validating':
                deployment.progress = 15;
                break;
            case 'backing_up':
                deployment.progress = 25;
                break;
            case 'deploying':
                deployment.progress = 60;
                break;
            case 'verifying':
                deployment.progress = 85;
                break;
            case 'completed':
                deployment.progress = 100;
                break;
            case 'failed':
                // Keep current progress for failed deployments
                break;
            default:
                break;
        }
    }

    /**
     * Log deployment event
     * @param {string} deploymentId - Deployment identifier
     * @param {string} level - Log level (info, warning, error)
     * @param {string} message - Log message
     */
    logDeploymentEvent(deploymentId, level, message) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        const logEntry = {
            timestamp: new Date().toISOString(),
            level: level,
            message: message
        };

        deployment.logs.push(logEntry);
        
        // Keep only last 100 log entries to prevent memory issues
        if (deployment.logs.length > 100) {
            deployment.logs = deployment.logs.slice(-100);
        }
    }

    /**
     * Add deployed asset
     * @param {string} deploymentId - Deployment identifier
     * @param {Object} asset - Asset information
     */
    addDeployedAsset(deploymentId, asset) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        deployment.deployedAssets.push({
            ...asset,
            timestamp: new Date().toISOString()
        });

        this.logDeploymentEvent(deploymentId, 'info', `Deployed asset: ${asset.type} - ${asset.key || asset.filename}`);
    }

    /**
     * Add failed asset
     * @param {string} deploymentId - Deployment identifier
     * @param {Object} asset - Failed asset information
     */
    addFailedAsset(deploymentId, asset) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        deployment.failedAssets.push({
            ...asset,
            timestamp: new Date().toISOString()
        });

        this.logDeploymentEvent(deploymentId, 'error', `Failed asset: ${asset.type} - ${asset.error}`);
    }

    /**
     * Add backup information
     * @param {string} deploymentId - Deployment identifier
     * @param {Object} backup - Backup information
     */
    addBackup(deploymentId, backup) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        deployment.backups.push({
            ...backup,
            timestamp: new Date().toISOString()
        });

        this.logDeploymentEvent(deploymentId, 'info', `Created backup: ${backup.key || backup.type}`);
    }

    /**
     * Complete deployment
     * @param {string} deploymentId - Deployment identifier
     * @param {string} status - Final status (completed, failed)
     * @param {Object} result - Final deployment result
     */
    async completeDeployment(deploymentId, status, result = {}) {
        const deployment = this.activeDeployments.get(deploymentId);
        if (!deployment) return;

        deployment.status = status;
        deployment.endTime = new Date().toISOString();
        deployment.duration = new Date(deployment.endTime) - new Date(deployment.startTime);
        deployment.result = result;

        if (status === 'completed') {
            deployment.progress = 100;
            this.logDeploymentEvent(deploymentId, 'info', 'Deployment completed successfully');
        } else {
            this.logDeploymentEvent(deploymentId, 'error', `Deployment failed: ${result.error || 'Unknown error'}`);
        }

        // Save to database if available
        if (this.db) {
            await this.saveDeploymentToDatabase(deployment);
        }

        // Move to history
        this.deploymentHistory.set(deploymentId, deployment);
        this.activeDeployments.delete(deploymentId);

        // Final notification
        this.notifyStatusChange(deploymentId, deployment);

        console.log(`📊 Completed deployment tracking: ${deploymentId} - ${status}`);
    }

    /**
     * Get deployment status
     * @param {string} deploymentId - Deployment identifier
     * @returns {Object} Deployment status
     */
    getDeploymentStatus(deploymentId) {
        return this.activeDeployments.get(deploymentId) || 
               this.deploymentHistory.get(deploymentId) || 
               null;
    }

    /**
     * Get all active deployments
     * @returns {Array} Active deployments
     */
    getActiveDeployments() {
        return Array.from(this.activeDeployments.values());
    }

    /**
     * Get deployment history for a user
     * @param {number} userId - User ID
     * @returns {Array} User's deployment history
     */
    getUserDeploymentHistory(userId) {
        const userDeployments = [];
        
        // Add active deployments
        for (const deployment of this.activeDeployments.values()) {
            if (deployment.userId === userId) {
                userDeployments.push(deployment);
            }
        }
        
        // Add historical deployments
        for (const deployment of this.deploymentHistory.values()) {
            if (deployment.userId === userId) {
                userDeployments.push(deployment);
            }
        }
        
        return userDeployments.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }

    /**
     * Register status change callback
     * @param {string} deploymentId - Deployment identifier
     * @param {Function} callback - Callback function
     */
    onStatusChange(deploymentId, callback) {
        if (!this.statusCallbacks.has(deploymentId)) {
            this.statusCallbacks.set(deploymentId, []);
        }
        this.statusCallbacks.get(deploymentId).push(callback);
    }

    /**
     * Notify status change callbacks
     */
    notifyStatusChange(deploymentId, deployment) {
        const callbacks = this.statusCallbacks.get(deploymentId);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(deployment);
                } catch (error) {
                    console.error('Status callback error:', error);
                }
            });
        }
    }

    /**
     * Save deployment to database
     */
    async saveDeploymentToDatabase(deployment) {
        if (!this.db) return;

        try {
            await this.db.query(`
                INSERT INTO deployment_history 
                (user_id, website_connection_id, scan_id, violation_type, fix_type, 
                 deployment_status, deployment_method, fix_content, deployed_at, deployment_logs)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT DO NOTHING
            `, [
                deployment.userId,
                null, // website_connection_id would need to be passed in
                deployment.id,
                deployment.violationId,
                'automated_fix',
                deployment.status,
                deployment.platform + '_api',
                JSON.stringify({
                    deployedAssets: deployment.deployedAssets,
                    failedAssets: deployment.failedAssets,
                    backups: deployment.backups
                }),
                deployment.endTime,
                JSON.stringify(deployment.logs)
            ]);
            
            console.log(`💾 Saved deployment ${deployment.id} to database`);
            
        } catch (error) {
            console.error('Failed to save deployment to database:', error);
        }
    }

    /**
     * Clean up old deployments from memory
     */
    cleanup() {
        const maxHistorySize = 100;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        const now = new Date();

        // Clean up old history entries
        for (const [id, deployment] of this.deploymentHistory.entries()) {
            const age = now - new Date(deployment.endTime || deployment.startTime);
            if (age > maxAge) {
                this.deploymentHistory.delete(id);
                this.statusCallbacks.delete(id);
            }
        }

        // Limit history size
        if (this.deploymentHistory.size > maxHistorySize) {
            const entries = Array.from(this.deploymentHistory.entries());
            entries.sort((a, b) => new Date(b[1].startTime) - new Date(a[1].startTime));
            
            // Keep only the most recent entries
            const toKeep = entries.slice(0, maxHistorySize);
            this.deploymentHistory.clear();
            toKeep.forEach(([id, deployment]) => {
                this.deploymentHistory.set(id, deployment);
            });
        }
    }
}

module.exports = DeploymentStatusTracker;
