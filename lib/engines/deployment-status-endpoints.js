/**
 * Deployment Status API Endpoints for SentryPrime
 * Provides REST API endpoints for deployment status tracking
 * 
 * Author: Manus AI
 * Date: October 20, 2025
 */

function setupDeploymentStatusEndpoints(app, deploymentTracker) {
    if (!deploymentTracker) {
        console.log('⚠️ Deployment tracker not available - status endpoints disabled');
        return;
    }

    /**
     * Get deployment status by ID
     */
    app.get('/api/deployment/status/:deploymentId', (req, res) => {
        try {
            const { deploymentId } = req.params;
            const deployment = deploymentTracker.getDeploymentStatus(deploymentId);
            
            if (!deployment) {
                return res.status(404).json({
                    success: false,
                    error: 'Deployment not found',
                    deploymentId: deploymentId
                });
            }
            
            res.json({
                success: true,
                deployment: {
                    id: deployment.id,
                    status: deployment.status,
                    platform: deployment.platform,
                    websiteUrl: deployment.websiteUrl,
                    progress: deployment.progress,
                    steps: deployment.steps,
                    startTime: deployment.startTime,
                    endTime: deployment.endTime,
                    duration: deployment.duration,
                    deployedAssets: deployment.deployedAssets,
                    failedAssets: deployment.failedAssets,
                    logs: deployment.logs.slice(-10), // Last 10 log entries
                    lastUpdate: deployment.lastUpdate
                }
            });
            
        } catch (error) {
            console.error('Get deployment status error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get deployment status'
            });
        }
    });

    /**
     * Get all active deployments
     */
    app.get('/api/deployment/active', (req, res) => {
        try {
            const activeDeployments = deploymentTracker.getActiveDeployments();
            
            res.json({
                success: true,
                count: activeDeployments.length,
                deployments: activeDeployments.map(deployment => ({
                    id: deployment.id,
                    status: deployment.status,
                    platform: deployment.platform,
                    websiteUrl: deployment.websiteUrl,
                    progress: deployment.progress,
                    startTime: deployment.startTime,
                    userId: deployment.userId,
                    violationId: deployment.violationId
                }))
            });
            
        } catch (error) {
            console.error('Get active deployments error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get active deployments'
            });
        }
    });

    /**
     * Get deployment history for a user
     */
    app.get('/api/deployment/history', (req, res) => {
        try {
            const userId = parseInt(req.query.user_id) || 1;
            const limit = parseInt(req.query.limit) || 20;
            
            const deploymentHistory = deploymentTracker.getUserDeploymentHistory(userId);
            const limitedHistory = deploymentHistory.slice(0, limit);
            
            res.json({
                success: true,
                userId: userId,
                total: deploymentHistory.length,
                count: limitedHistory.length,
                deployments: limitedHistory.map(deployment => ({
                    id: deployment.id,
                    status: deployment.status,
                    platform: deployment.platform,
                    websiteUrl: deployment.websiteUrl,
                    violationId: deployment.violationId,
                    startTime: deployment.startTime,
                    endTime: deployment.endTime,
                    duration: deployment.duration,
                    deployedAssetsCount: deployment.deployedAssets?.length || 0,
                    failedAssetsCount: deployment.failedAssets?.length || 0,
                    success: deployment.status === 'completed'
                }))
            });
            
        } catch (error) {
            console.error('Get deployment history error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get deployment history'
            });
        }
    });

    /**
     * Get deployment logs
     */
    app.get('/api/deployment/:deploymentId/logs', (req, res) => {
        try {
            const { deploymentId } = req.params;
            const limit = parseInt(req.query.limit) || 50;
            
            const deployment = deploymentTracker.getDeploymentStatus(deploymentId);
            
            if (!deployment) {
                return res.status(404).json({
                    success: false,
                    error: 'Deployment not found'
                });
            }
            
            const logs = deployment.logs.slice(-limit);
            
            res.json({
                success: true,
                deploymentId: deploymentId,
                count: logs.length,
                logs: logs
            });
            
        } catch (error) {
            console.error('Get deployment logs error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get deployment logs'
            });
        }
    });

    /**
     * Cancel an active deployment
     */
    app.post('/api/deployment/:deploymentId/cancel', async (req, res) => {
        try {
            const { deploymentId } = req.params;
            const deployment = deploymentTracker.getDeploymentStatus(deploymentId);
            
            if (!deployment) {
                return res.status(404).json({
                    success: false,
                    error: 'Deployment not found'
                });
            }
            
            if (deployment.status === 'completed' || deployment.status === 'failed') {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot cancel completed or failed deployment'
                });
            }
            
            // Update deployment status to cancelled
            deploymentTracker.updateStatus(deploymentId, 'cancelled', 'Deployment cancelled by user');
            await deploymentTracker.completeDeployment(deploymentId, 'cancelled', {
                reason: 'User cancelled',
                cancelledAt: new Date().toISOString()
            });
            
            res.json({
                success: true,
                deploymentId: deploymentId,
                status: 'cancelled',
                message: 'Deployment cancelled successfully'
            });
            
        } catch (error) {
            console.error('Cancel deployment error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to cancel deployment'
            });
        }
    });

    /**
     * Get deployment statistics for a user
     */
    app.get('/api/deployment/stats', (req, res) => {
        try {
            const userId = parseInt(req.query.user_id) || 1;
            const deploymentHistory = deploymentTracker.getUserDeploymentHistory(userId);
            
            const stats = {
                total: deploymentHistory.length,
                completed: deploymentHistory.filter(d => d.status === 'completed').length,
                failed: deploymentHistory.filter(d => d.status === 'failed').length,
                cancelled: deploymentHistory.filter(d => d.status === 'cancelled').length,
                active: deploymentHistory.filter(d => 
                    d.status !== 'completed' && 
                    d.status !== 'failed' && 
                    d.status !== 'cancelled'
                ).length,
                platforms: {},
                recentActivity: deploymentHistory.slice(0, 5).map(d => ({
                    id: d.id,
                    status: d.status,
                    platform: d.platform,
                    startTime: d.startTime,
                    endTime: d.endTime
                }))
            };
            
            // Count deployments by platform
            deploymentHistory.forEach(deployment => {
                const platform = deployment.platform;
                stats.platforms[platform] = (stats.platforms[platform] || 0) + 1;
            });
            
            // Calculate success rate
            stats.successRate = stats.total > 0 ? 
                Math.round((stats.completed / stats.total) * 100) : 0;
            
            res.json({
                success: true,
                userId: userId,
                stats: stats
            });
            
        } catch (error) {
            console.error('Get deployment stats error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get deployment statistics'
            });
        }
    });

    /**
     * Server-Sent Events endpoint for real-time deployment updates
     */
    app.get('/api/deployment/:deploymentId/stream', (req, res) => {
        const { deploymentId } = req.params;
        
        // Set up SSE headers
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Cache-Control'
        });
        
        // Send initial deployment status
        const deployment = deploymentTracker.getDeploymentStatus(deploymentId);
        if (deployment) {
            res.write(`data: ${JSON.stringify({
                type: 'status',
                deployment: {
                    id: deployment.id,
                    status: deployment.status,
                    progress: deployment.progress,
                    steps: deployment.steps
                }
            })}\\n\\n`);
        }
        
        // Register for status updates
        const callback = (updatedDeployment) => {
            try {
                res.write(`data: ${JSON.stringify({
                    type: 'update',
                    deployment: {
                        id: updatedDeployment.id,
                        status: updatedDeployment.status,
                        progress: updatedDeployment.progress,
                        steps: updatedDeployment.steps,
                        logs: updatedDeployment.logs.slice(-5) // Last 5 logs
                    }
                })}\\n\\n`);
            } catch (error) {
                console.error('SSE write error:', error);
            }
        };
        
        deploymentTracker.onStatusChange(deploymentId, callback);
        
        // Handle client disconnect
        req.on('close', () => {
            console.log(`SSE client disconnected for deployment ${deploymentId}`);
        });
        
        // Send heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
            try {
                res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\\n\\n`);
            } catch (error) {
                clearInterval(heartbeat);
            }
        }, 30000);
        
        // Clean up on disconnect
        req.on('close', () => {
            clearInterval(heartbeat);
        });
    });

    console.log('✅ Deployment status endpoints initialized');
}

module.exports = { setupDeploymentStatusEndpoints };
