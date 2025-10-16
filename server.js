const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');
const OpenAI = require('openai');

// ENHANCEMENT: Import deployment engines (optional - with feature flag)
const ENABLE_DEPLOYMENT_FEATURES = process.env.ENABLE_DEPLOYMENT_FEATURES || 'true';
let DOMParsingEngine, PatchGenerationEngine, DeploymentAutomationEngine, RollbackSafetyEngine;
let domParsingEngine, patchGenerationEngine, deploymentEngine, safetyEngine;

// SURGICAL PATCH: Replace lines 12-28 in your server.js with this improved engine loading code

if (ENABLE_DEPLOYMENT_FEATURES === 'true') {
    console.log('🚀 Attempting to load Phase 2 deployment engines...');
    
    // Load engines individually with detailed error handling
    try {
        console.log('Loading DOM Parsing Engine...');
        DOMParsingEngine = require('./dom-parsing-engine.js');
        domParsingEngine = new DOMParsingEngine();
        console.log('✅ DOM Parsing Engine loaded successfully');
    } catch (error) {
        console.log('⚠️ DOM Parsing Engine failed:', error.message);
        DOMParsingEngine = null;
        domParsingEngine = null;
    }
    
    try {
        console.log('Loading Patch Generation Engine...');
        PatchGenerationEngine = require('./patch-generation-engine.js');
        patchGenerationEngine = new PatchGenerationEngine();
        console.log('✅ Patch Generation Engine loaded successfully');
    } catch (error) {
        console.log('⚠️ Patch Generation Engine failed:', error.message);
        PatchGenerationEngine = null;
        patchGenerationEngine = null;
    }
    
    try {
        console.log('Loading Deployment Automation Engine...');
        DeploymentAutomationEngine = require('./deployment-automation-engine.js');
        deploymentEngine = new DeploymentAutomationEngine();
        console.log('✅ Deployment Automation Engine loaded successfully');
    } catch (error) {
        console.log('⚠️ Deployment Automation Engine failed:', error.message);
        DeploymentAutomationEngine = null;
        deploymentEngine = null;
    }
    
    try {
        console.log('Loading Rollback Safety Engine...');
        RollbackSafetyEngine = require('./rollback-safety-engine.js');
        safetyEngine = new RollbackSafetyEngine();
        console.log('✅ Rollback Safety Engine loaded successfully');
    } catch (error) {
        console.log('⚠️ Rollback Safety Engine failed:', error.message);
        RollbackSafetyEngine = null;
        safetyEngine = null;
    }
    
    // Summary of loaded engines
    const loadedEngines = [domParsingEngine, patchGenerationEngine, deploymentEngine, safetyEngine].filter(Boolean);
    console.log(`✅ Phase 2 Status: ${loadedEngines.length}/4 engines loaded successfully`);
    
    if (loadedEngines.length === 0) {
        console.log('⚠️ No Phase 2 engines available - running in core mode');
    }
}


const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// PHASE 2 ENHANCEMENT: Serve static files from public directory
app.use(express.static(__dirname + '/public'));

// Database connection - PRESERVED FROM WORKING VERSION
