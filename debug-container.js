const fs = require('fs');
const path = require('path');

console.log('=== Container Debug Information ===');
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);
console.log('__filename:', __filename);

console.log('\n=== Files in current directory ===');
try {
    const files = fs.readdirSync('.');
    files.forEach(file => {
        const stats = fs.statSync(file);
        console.log(`${stats.isDirectory() ? 'DIR ' : 'FILE'} ${file}`);
    });
} catch (error) {
    console.error('Error reading directory:', error.message);
}

console.log('\n=== Looking for engine files ===');
const engineFiles = [
    'dom-parsing-engine.js',
    'patch-generation-engine.js', 
    'deployment-automation-engine.js',
    'rollback-safety-engine.js'
];

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

console.log('\n=== Trying to require engine files ===');
engineFiles.forEach(file => {
    try {
        require(`./${file}`);
        console.log(`✅ ${file} can be required`);
    } catch (error) {
        console.log(`❌ ${file} require failed: ${error.message}`);
    }
});

console.log('\n=== Environment Variables ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('PORT:', process.env.PORT);
console.log('K_SERVICE:', process.env.K_SERVICE);
