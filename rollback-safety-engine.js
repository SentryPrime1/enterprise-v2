const fs = require('fs').promises;
const path = require('path');

class RollbackSafetyEngine {
    constructor() {
        this.monitoringIntervals = new Map();
        this.healthThresholds = {
            responseTime: 5000, // 5 seconds
            errorRate: 0.1,     // 10%
            uptime: 0.95        // 95%
        };
        console.log('🛡️ Rollback Safety Engine initialized');
    }

    async validateSafetyConditions(deploymentConfig) {
        try {
            console.log('🔍 Validating safety conditions...');
            
            const checks = [
                await this.checkDeploymentLimits(deploymentConfig),
                await this.checkBackupRequirements(deploymentConfig),
                await this.checkHealthStatus(deploymentConfig.url),
                await this.checkConflicts(deploymentConfig)
            ];

            const failedChecks = checks.filter(check => !check.passed);
            
            return {
                safe: failedChecks.length === 0,
                checks: checks,
                blockers: failedChecks.map(check => check.reason),
                riskLevel: this.calculateRiskLevel(checks)
            };

        } catch (error) {
            console.error('Safety validation error:', error);
            return {
                safe: false,
                checks: [],
                blockers: ['Safety validation failed'],
                riskLevel: 'high'
            };
        }
    }

    async checkDeploymentLimits(config) {
        // Check if too many deployments are running
        const activeCount = this.monitoringIntervals.size;
        const maxConcurrent = 3;

        return {
            name: 'Deployment Limits',
            passed: activeCount < maxConcurrent,
            reason: activeCount >= maxConcurrent ? 
                `Too many active deployments (${activeCount}/${maxConcurrent})` : 
                'Within deployment limits'
        };
    }

    async checkBackupRequirements(config) {
        // Verify backup capabilities
        const hasBackupMethod = config.backupMethod || config.method;
        
        return {
            name: 'Backup Requirements',
            passed: !!hasBackupMethod,
            reason: hasBackupMethod ? 
                'Backup method available' : 
                'No backup method specified'
        };
    }

    async checkHealthStatus(url) {
        try {
            // Simulate health check
            const healthScore = Math.random() * 100;
            const isHealthy = healthScore > 70;

            return {
                name: 'Site Health',
                passed: isHealthy,
                reason: isHealthy ? 
                    `Site healthy (${Math.round(healthScore)}%)` : 
                    `Site unhealthy (${Math.round(healthScore)}%)`
            };
        } catch (error) {
            return {
                name: 'Site Health',
                passed: false,
                reason: 'Health check failed'
            };
        }
    }

    async checkConflicts(config) {
        // Check for conflicting deployments
        const hasConflicts = Math.random() < 0.1; // 10% chance of conflicts

        return {
            name: 'Conflict Detection',
            passed: !hasConflicts,
            reason: hasConflicts ? 
                'Conflicting deployment detected' : 
                'No conflicts detected'
        };
    }

    calculateRiskLevel(checks) {
        const failedCount = checks.filter(check => !check.passed).length;
        
        if (failedCount === 0) return 'low';
        if (failedCount <= 1) return 'medium';
        return 'high';
    }

    async startHealthMonitoring(deploymentId, config) {
        try {
            console.log(`📊 Starting health monitoring for: ${deploymentId}`);
            
            const monitoringConfig = {
                deploymentId,
                url: config.url,
                interval: 30000, // 30 seconds
                maxFailures: 3,
                currentFailures: 0
            };

            const intervalId = setInterval(async () => {
                await this.performHealthCheck(monitoringConfig);
            }, monitoringConfig.interval);

            this.monitoringIntervals.set(deploymentId, intervalId);

            return {
                deploymentId,
                status: 'monitoring_started',
                interval: monitoringConfig.interval
            };

        } catch (error) {
            console.error('Health monitoring start error:', error);
            throw error;
        }
    }

    async performHealthCheck(config) {
        try {
            // Simulate health check
            const metrics = {
                responseTime: Math.random() * 3000 + 500,
                errorRate: Math.random() * 0.2,
                uptime: 0.95 + Math.random() * 0.05,
                timestamp: new Date().toISOString()
            };

            const isHealthy = this.evaluateHealth(metrics);
            
            if (!isHealthy) {
                config.currentFailures++;
                console.log(`⚠️ Health check failed for ${config.deploymentId} (${config.currentFailures}/${config.maxFailures})`);
                
                if (config.currentFailures >= config.maxFailures) {
                    await this.triggerAutoRollback(config.deploymentId, 'Health check failures exceeded threshold');
                }
            } else {
                config.currentFailures = 0; // Reset failure count on success
            }

            return {
                deploymentId: config.deploymentId,
                healthy: isHealthy,
                metrics
            };

        } catch (error) {
            console.error('Health check error:', error);
            config.currentFailures++;
        }
    }

    evaluateHealth(metrics) {
        return metrics.responseTime < this.healthThresholds.responseTime &&
               metrics.errorRate < this.healthThresholds.errorRate &&
               metrics.uptime > this.healthThresholds.uptime;
    }

    async rollbackDeployment(deploymentId, reason = 'Manual rollback') {
        try {
            console.log(`🔄 Rolling back deployment: ${deploymentId}`);
            
            // Stop health monitoring
            this.stopHealthMonitoring(deploymentId);
            
            // Simulate rollback process
            await this.simulateRollbackDelay(2000);
            
            const rollbackRecord = {
                deploymentId: deploymentId,
                triggeredAt: new Date().toISOString(),
                reason: reason,
                type: 'manual',
                status: 'completed'
            };

            await this.saveRollbackRecord(rollbackRecord);
            
            return rollbackRecord;

        } catch (error) {
            console.error('Rollback error:', error);
            throw error;
        }
    }

    async triggerAutoRollback(deploymentId, reason) {
        try {
            console.log(`🚨 Auto-rollback triggered for: ${deploymentId}`);
            
            // Stop health monitoring
            this.stopHealthMonitoring(deploymentId);
            
            // Perform rollback
            await this.simulateRollbackDelay(1500);
            
            const rollbackRecord = {
                deploymentId: deploymentId,
                triggeredAt: new Date().toISOString(),
                reason: reason,
                type: 'automatic',
                status: 'completed'
            };

            await this.saveRollbackRecord(rollbackRecord);
            
            return rollbackRecord;

        } catch (error) {
            console.error('Auto-rollback error:', error);
            throw error;
        }
    }

    async simulateRollbackDelay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async saveRollbackRecord(record) {
        try {
            const recordsDir = './rollback-records';
            await fs.mkdir(recordsDir, { recursive: true });
            
            await fs.writeFile(
                path.join(recordsDir, `rollback-${record.deploymentId}.json`),
                JSON.stringify(record, null, 2)
            );

        } catch (error) {
            console.error('Error saving rollback record:', error);
        }
    }

    stopHealthMonitoring(deploymentId) {
        const intervalId = this.monitoringIntervals.get(deploymentId);
        if (intervalId) {
            clearInterval(intervalId);
            this.monitoringIntervals.delete(deploymentId);
            console.log(`⏹️ Health monitoring stopped for: ${deploymentId}`);
            return true;
        }
        return false;
    }

    async getMonitoringStatus() {
        const activeMonitoring = [];
        for (const [deploymentId] of this.monitoringIntervals) {
            activeMonitoring.push({
                deploymentId,
                status: 'active',
                startedAt: new Date().toISOString()
            });
        }
        return activeMonitoring;
    }
}

module.exports = RollbackSafetyEngine;
