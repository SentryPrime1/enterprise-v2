const fs = require('fs').promises;
const path = require('path');

class RollbackSafetyEngine {
    constructor() {
        this.monitoringIntervals = new Map();
        this.safetyThresholds = {
            maxErrorRate: 0.05, // 5% error rate
            minResponseTime: 5000, // 5 seconds max response time
            maxMemoryUsage: 0.8 // 80% memory usage
        };
        console.log('🛡️ Rollback Safety Engine initialized');
    }

    performSafetyCheck(patchId, deploymentConfig) {
        try {
            console.log(`🔍 Performing safety check for patch: ${patchId}`);
            
            const checks = {
                deploymentLimits: this.checkDeploymentLimits(),
                backupRequirements: this.checkBackupRequirements(deploymentConfig),
                healthStatus: this.checkSystemHealth(),
                configValidation: this.validateSafetyConfig(deploymentConfig),
                conflictDetection: this.detectConflicts(patchId)
            };

            const allPassed = Object.values(checks).every(check => check.passed);
            const warnings = Object.values(checks).filter(check => check.warnings?.length > 0);
            const errors = Object.values(checks).filter(check => !check.passed);

            return {
                canProceed: allPassed,
                overallRisk: this.calculateRiskLevel(checks),
                checks: checks,
                warnings: warnings.flatMap(w => w.warnings || []),
                errors: errors.flatMap(e => e.errors || []),
                recommendations: this.generateRecommendations(checks)
            };

        } catch (error) {
            console.error('Safety check error:', error);
            return {
                canProceed: false,
                overallRisk: 'high',
                errors: [error.message]
            };
        }
    }

    checkDeploymentLimits() {
        // Mock deployment limits check
        return {
            passed: true,
            message: 'Deployment limits within acceptable range',
            details: {
                activeDeployments: 0,
                maxConcurrentDeployments: 3,
                dailyDeploymentCount: 2,
                maxDailyDeployments: 10
            }
        };
    }

    checkBackupRequirements(config) {
        const hasBackupConfig = config.createBackup !== false;
        
        return {
            passed: hasBackupConfig,
            message: hasBackupConfig ? 'Backup requirements satisfied' : 'Backup creation required',
            warnings: hasBackupConfig ? [] : ['Backup creation is strongly recommended'],
            details: {
                backupEnabled: hasBackupConfig,
                backupLocation: './deployment-backups',
                retentionDays: 30
            }
        };
    }

    checkSystemHealth() {
        // Mock system health check
        const health = {
            cpu: 0.45, // 45%
            memory: 0.62, // 62%
            disk: 0.33, // 33%
            responseTime: 250 // ms
        };

        const issues = [];
        if (health.cpu > 0.8) issues.push('High CPU usage');
        if (health.memory > 0.8) issues.push('High memory usage');
        if (health.disk > 0.9) issues.push('Low disk space');
        if (health.responseTime > 1000) issues.push('Slow response time');

        return {
            passed: issues.length === 0,
            message: issues.length === 0 ? 'System health optimal' : 'System health issues detected',
            errors: issues,
            details: health
        };
    }

    validateSafetyConfig(config) {
        const errors = [];
        const warnings = [];

        if (!config.enableMonitoring) {
            warnings.push('Health monitoring disabled - consider enabling for safer deployment');
        }

        if (!config.autoRollback) {
            warnings.push('Auto-rollback disabled - manual intervention may be required');
        }

        if (config.skipSafetyChecks) {
            errors.push('Safety checks cannot be skipped');
        }

        return {
            passed: errors.length === 0,
            message: errors.length === 0 ? 'Safety configuration valid' : 'Safety configuration issues',
            errors: errors,
            warnings: warnings
        };
    }

    detectConflicts(patchId) {
        // Mock conflict detection
        return {
            passed: true,
            message: 'No deployment conflicts detected',
            details: {
                conflictingDeployments: [],
                resourceConflicts: [],
                fileConflicts: []
            }
        };
    }

    calculateRiskLevel(checks) {
        const failedChecks = Object.values(checks).filter(check => !check.passed).length;
        const totalChecks = Object.keys(checks).length;
        const failureRate = failedChecks / totalChecks;

        if (failureRate > 0.5) return 'high';
        if (failureRate > 0.2) return 'medium';
        return 'low';
    }

    generateRecommendations(checks) {
        const recommendations = [];

        if (!checks.backupRequirements.passed) {
            recommendations.push('Enable backup creation before deployment');
        }

        if (!checks.healthStatus.passed) {
            recommendations.push('Resolve system health issues before proceeding');
        }

        if (checks.configValidation.warnings?.length > 0) {
            recommendations.push('Review safety configuration warnings');
        }

        return recommendations;
    }

    async startHealthMonitoring(deploymentId, config = {}) {
        try {
            console.log(`📊 Starting health monitoring for deployment: ${deploymentId}`);
            
            const monitoringConfig = {
                interval: config.interval || 30000, // 30 seconds
                duration: config.duration || 300000, // 5 minutes
                thresholds: { ...this.safetyThresholds, ...config.thresholds }
            };

            const startTime = Date.now();
            const monitoringData = {
                deploymentId: deploymentId,
                startTime: startTime,
                config: monitoringConfig,
                healthChecks: []
            };

            // Start monitoring interval
            const intervalId = setInterval(async () => {
                const healthCheck = await this.performHealthCheck(deploymentId);
                monitoringData.healthChecks.push(healthCheck);

                // Check if auto-rollback is needed
                if (this.shouldTriggerAutoRollback(healthCheck, monitoringConfig.thresholds)) {
                    console.log('🚨 Auto-rollback triggered due to health issues');
                    clearInterval(intervalId);
                    await this.triggerAutoRollback(deploymentId, healthCheck);
                }

                // Stop monitoring after duration
                if (Date.now() - startTime > monitoringConfig.duration) {
                    clearInterval(intervalId);
                    console.log(`✅ Health monitoring completed for: ${deploymentId}`);
                }
            }, monitoringConfig.interval);

            this.monitoringIntervals.set(deploymentId, intervalId);
            
            return {
                success: true,
                monitoringId: deploymentId,
                config: monitoringConfig
            };

        } catch (error) {
            console.error('Health monitoring error:', error);
            throw error;
        }
    }

    async performHealthCheck(deploymentId) {
        // Mock health check
        return {
            timestamp: new Date().toISOString(),
            deploymentId: deploymentId,
            status: 'healthy',
            metrics: {
                responseTime: 200 + Math.random() * 100,
                errorRate: Math.random() * 0.02,
                memoryUsage: 0.6 + Math.random() * 0.1
            },
            score: 95 + Math.random() * 5
        };
    }

    shouldTriggerAutoRollback(healthCheck, thresholds) {
        const metrics = healthCheck.metrics;
        
        return (
            metrics.responseTime > thresholds.minResponseTime ||
            metrics.errorRate > thresholds.maxErrorRate ||
            metrics.memoryUsage > thresholds.maxMemoryUsage ||
            healthCheck.score < 70
        );
    }

    async triggerAutoRollback(deploymentId, reason) {
        try {
            console.log(`🔄 Triggering auto-rollback for: ${deploymentId}`);
            
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
}

module.exports = RollbackSafetyEngine;
