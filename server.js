const express = require('express');
const fs = require('fs');
const path = require('path');

console.log('=== DIAGNOSTIC SERVER STARTING ===');
console.log('Current working directory:', process.cwd());
console.log('Node.js version:', process.version);

// Check if engine files exist
const engineFiles = [
    'dom-parsing-engine.js',
    'patch-generation-engine.js', 
    'deployment-automation-engine.js',
    'rollback-safety-engine.js'
];

console.log('\n=== ENGINE FILE CHECK ===');
engineFiles.forEach(file => {
    try {
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            console.log(`✅ ${file} exists (${stats.size} bytes)`);
        } else {
            console.log(`❌ ${file} NOT FOUND`);
        }
    } catch (error) {
        console.log(`❌ ${file} ERROR: ${error.message}`);
    }
});

// Try to load engines one by one with detailed error reporting
console.log('\n=== ENGINE LOADING TEST ===');
let enginesAvailable = false;
let loadingErrors = [];

try {
    console.log('Loading dom-parsing-engine.js...');
    const DOMParsingEngine = require('./dom-parsing-engine');
    console.log('✅ dom-parsing-engine.js loaded successfully');
    
    console.log('Loading patch-generation-engine.js...');
    const PatchGenerationEngine = require('./patch-generation-engine');
    console.log('✅ patch-generation-engine.js loaded successfully');
    
    console.log('Loading deployment-automation-engine.js...');
    const DeploymentAutomationEngine = require('./deployment-automation-engine');
    console.log('✅ deployment-automation-engine.js loaded successfully');
    
    console.log('Loading rollback-safety-engine.js...');
    const RollbackSafetyEngine = require('./rollback-safety-engine');
    console.log('✅ rollback-safety-engine.js loaded successfully');
    
    // Try to instantiate engines
    console.log('\n=== ENGINE INSTANTIATION TEST ===');
    
    console.log('Instantiating DOM Parsing Engine...');
    const domParser = new DOMParsingEngine();
    console.log('✅ DOM Parsing Engine instantiated successfully');
    
    console.log('Instantiating Patch Generation Engine...');
    const patchGenerator = new PatchGenerationEngine();
    console.log('✅ Patch Generation Engine instantiated successfully');
    
    console.log('Instantiating Deployment Automation Engine...');
    const deploymentEngine = new DeploymentAutomationEngine();
    console.log('✅ Deployment Automation Engine instantiated successfully');
    
    console.log('Instantiating Rollback Safety Engine...');
    const safetyEngine = new RollbackSafetyEngine();
    console.log('✅ Rollback Safety Engine instantiated successfully');
    
    enginesAvailable = true;
    console.log('✅ All Phase 2 engines loaded and instantiated successfully');
    
} catch (error) {
    console.log('❌ Engine loading/instantiation failed:');
    console.log('Error message:', error.message);
    console.log('Error stack:', error.stack);
    loadingErrors.push({
        message: error.message,
        stack: error.stack
    });
    enginesAvailable = false;
}

// Basic Express setup
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// Health check endpoint with diagnostic info
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.K_SERVICE ? 'cloud-run' : 'local',
        nodeVersion: process.version,
        cwd: process.cwd(),
        phase2Engines: enginesAvailable ? 'available' : 'unavailable',
        engineFiles: {
            'dom-parsing-engine.js': fs.existsSync('./dom-parsing-engine.js'),
            'patch-generation-engine.js': fs.existsSync('./patch-generation-engine.js'),
            'deployment-automation-engine.js': fs.existsSync('./deployment-automation-engine.js'),
            'rollback-safety-engine.js': fs.existsSync('./rollback-safety-engine.js')
        },
        loadingErrors: loadingErrors
    });
});

// Diagnostic endpoint
app.get('/diagnostic', (req, res) => {
    const diagnosticInfo = {
        timestamp: new Date().toISOString(),
        environment: {
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            cwd: process.cwd(),
            isCloudRun: !!process.env.K_SERVICE
        },
        files: {
            currentDirectory: [],
            engineFiles: {}
        },
        engines: {
            available: enginesAvailable,
            errors: loadingErrors
        }
    };
    
    // List all files in current directory
    try {
        const files = fs.readdirSync('.');
        diagnosticInfo.files.currentDirectory = files.map(file => {
            const stats = fs.statSync(file);
            return {
                name: file,
                type: stats.isDirectory() ? 'directory' : 'file',
                size: stats.isFile() ? stats.size : null
            };
        });
    } catch (error) {
        diagnosticInfo.files.error = error.message;
    }
    
    // Check engine files specifically
    engineFiles.forEach(file => {
        try {
            if (fs.existsSync(file)) {
                const stats = fs.statSync(file);
                diagnosticInfo.files.engineFiles[file] = {
                    exists: true,
                    size: stats.size,
                    modified: stats.mtime
                };
            } else {
                diagnosticInfo.files.engineFiles[file] = {
                    exists: false
                };
            }
        } catch (error) {
            diagnosticInfo.files.engineFiles[file] = {
                error: error.message
            };
        }
    });
    
    res.json(diagnosticInfo);
});

// Simple dashboard
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>SentryPrime Diagnostic Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .status { padding: 20px; border-radius: 8px; margin: 20px 0; }
        .healthy { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; }
        .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; }
        .info { background: #d1ecf1; border: 1px solid #bee5eb; color: #0c5460; }
        pre { background: #f8f9fa; padding: 10px; border-radius: 4px; overflow-x: auto; }
    </style>
</head>
<body>
    <h1>🛡️ SentryPrime Diagnostic Dashboard</h1>
    
    <div class="status ${enginesAvailable ? 'healthy' : 'error'}">
        <h3>Phase 2 Engine Status</h3>
        <p><strong>Engines Available:</strong> ${enginesAvailable ? 'YES' : 'NO'}</p>
        <p><strong>Environment:</strong> ${process.env.K_SERVICE ? 'Cloud Run' : 'Local'}</p>
        <p><strong>Node.js Version:</strong> ${process.version}</p>
        <p><strong>Working Directory:</strong> ${process.cwd()}</p>
    </div>
    
    <div class="status info">
        <h3>Engine Files</h3>
        <ul>
            ${engineFiles.map(file => `
                <li>${file}: ${fs.existsSync(file) ? '✅ EXISTS' : '❌ MISSING'}</li>
            `).join('')}
        </ul>
    </div>
    
    ${loadingErrors.length > 0 ? `
    <div class="status error">
        <h3>Loading Errors</h3>
        ${loadingErrors.map(error => `
            <div>
                <p><strong>Error:</strong> ${error.message}</p>
                <pre>${error.stack}</pre>
            </div>
        `).join('')}
    </div>
    ` : ''}
    
    <div class="status info">
        <h3>Endpoints</h3>
        <ul>
            <li><a href="/health">Health Check</a></li>
            <li><a href="/diagnostic">Full Diagnostic</a></li>
        </ul>
    </div>
</body>
</html>
    `);
});

// Start server
app.listen(PORT, () => {
    console.log('\n=== SERVER STARTED ===');
    console.log('🚀 SentryPrime Diagnostic Server running on port ' + PORT);
    console.log('📊 Health check: http://localhost:' + PORT + '/health');
    console.log('🔍 Dashboard: http://localhost:' + PORT + '/');
    console.log('🔧 Phase 2 Engines: ' + (enginesAvailable ? 'Available' : 'Unavailable'));
    console.log('🌐 Environment: ' + (process.env.K_SERVICE ? 'Cloud Run' : 'Local'));
    
    if (loadingErrors.length > 0) {
        console.log('\n⚠️ ERRORS DETECTED:');
        loadingErrors.forEach((error, index) => {
            console.log(`${index + 1}. ${error.message}`);
        });
    }
});
