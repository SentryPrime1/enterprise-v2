const OpenAI = require('openai');

// Initialize OpenAI client safely
let openai = null;
try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        console.log('🤖 OpenAI client initialized successfully');
    } else {
        console.log('⚠️ OpenAI API key not found. AI fix suggestions will be disabled.');
    }
} catch (error) {
    console.log('❌ Failed to initialize OpenAI client:', error.message);
}

/**
 * Generate AI-powered accessibility fix suggestions
 * @param {Array} violations - Array of accessibility violations from axe-core
 * @param {string} url - The URL that was scanned
 * @returns {Promise<Object>} Fix report with enhanced violations
 */
async function generateAccessibilityFixes(violations, url = '') {
    if (!openai || !process.env.OPENAI_API_KEY) {
        console.log('⚠️ AI Fix Engine not available, returning basic report');
        return {
            fixes: [],
            summary: {
                totalViolations: violations.length,
                fixableViolations: 0,
                fixabilityRate: 0,
                averageConfidence: 0
            },
            categories: { html: 0, css: 0, javascript: 0 },
            impactDistribution: { critical: 0, serious: 0, moderate: 0, minor: 0 },
            estimatedFixTime: { totalMinutes: 0, estimatedHours: 0, estimatedDays: 0 },
            generatedAt: new Date().toISOString(),
            aiEnabled: false
        };
    }

    console.log(`🤖 Generating AI fix suggestions for ${violations.length} violations...`);
    
    const enhancedViolations = [];
    
    // Process violations in smaller batches to avoid rate limits
    const batchSize = 2;
    for (let i = 0; i < violations.length; i += batchSize) {
        const batch = violations.slice(i, i + batchSize);
        
        for (const violation of batch) {
            try {
                const fixSuggestion = await generateSingleFix(violation, url);
                enhancedViolations.push({
                    ...violation,
                    aiFixSuggestion: fixSuggestion,
                    aiFixAvailable: true,
                    aiGeneratedAt: new Date().toISOString()
                });
                
                // Small delay between individual requests
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                console.log(`❌ Failed to generate fix for ${violation.id}:`, error.message);
                enhancedViolations.push({
                    ...violation,
                    aiFixSuggestion: null,
                    aiFixAvailable: false,
                    aiFixError: error.message
                });
            }
        }
        
        // Longer delay between batches
        if (i + batchSize < violations.length) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    
    const successfulFixes = enhancedViolations.filter(v => v.aiFixAvailable).length;
    console.log(`✅ Generated ${successfulFixes}/${violations.length} AI fix suggestions`);
    
    // Generate comprehensive report
    const fixReport = generateFixReport(enhancedViolations);
    
    return {
        fixes: enhancedViolations,
        ...fixReport,
        aiEnabled: true
    };
}

/**
 * Generate a fix suggestion for a single violation
 * @param {Object} violation - Single accessibility violation
 * @param {string} url - The URL that was scanned
 * @returns {Promise<Object>} Fix suggestion object
 */
async function generateSingleFix(violation, url) {
    const prompt = buildFixPrompt(violation, url);
    
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: `You are an expert web accessibility consultant. Provide specific, actionable code fixes for accessibility violations.

GUIDELINES:
- Provide SPECIFIC code examples, not generic advice
- Include HTML, CSS, and JavaScript fixes when applicable
- Focus on practical, implementable solutions
- Explain WHY the fix works for accessibility
- Keep explanations concise but thorough
- Format code examples clearly`
            },
            {
                role: "user",
                content: prompt
            }
        ],
        max_tokens: 600,
        temperature: 0.3
    });

    const aiResponse = response.choices[0].message.content;
    return parseAIResponse(aiResponse, violation);
}

/**
 * Build a comprehensive prompt for the AI to generate fixes
 */
function buildFixPrompt(violation, url) {
    const sampleHTML = violation.nodes && violation.nodes.length > 0 
        ? violation.nodes[0].html || 'No HTML sample available'
        : 'No HTML sample available';

    const selectors = violation.nodes && violation.nodes.length > 0
        ? violation.nodes.slice(0, 2).map(node => node.target ? node.target.join(' ') : 'Unknown selector')
        : ['No selectors available'];

    return `ACCESSIBILITY VIOLATION:

ID: ${violation.id}
Impact: ${violation.impact}
Description: ${violation.description}
Help: ${violation.help}

AFFECTED ELEMENTS:
HTML Sample: ${sampleHTML}
Selectors: ${selectors.join(', ')}
Count: ${violation.nodes ? violation.nodes.length : 0}

Provide a specific fix with:
1. EXPLANATION: Why this is an accessibility issue
2. HTML_FIX: HTML code changes (if needed)
3. CSS_FIX: CSS code changes (if needed)
4. TESTING: How to verify the fix

Be specific and provide actual code examples.`;
}

/**
 * Parse AI response into structured fix suggestion
 */
function parseAIResponse(aiResponse, violation) {
    const sections = {
        explanation: extractSection(aiResponse, 'EXPLANATION'),
        htmlFix: extractSection(aiResponse, 'HTML_FIX'),
        cssFix: extractSection(aiResponse, 'CSS_FIX'),
        testing: extractSection(aiResponse, 'TESTING')
    };

    const summary = generateFixSummary(violation, sections);

    return {
        summary: summary,
        explanation: sections.explanation || 'AI-generated fix explanation',
        fixes: {
            html: sections.htmlFix || null,
            css: sections.cssFix || null,
            javascript: null
        },
        testing: sections.testing || 'Test by running another accessibility scan',
        confidence: calculateConfidence(sections),
        rawResponse: aiResponse
    };
}

/**
 * Extract a specific section from AI response
 */
function extractSection(response, sectionName) {
    const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n\\d+\\.|\\n[A-Z_]+:|$)`, 'i');
    const match = response.match(regex);
    return match ? match[1].trim() : null;
}

/**
 * Generate a concise summary of the fix
 */
function generateFixSummary(violation, sections) {
    const violationType = violation.id.replace(/-/g, ' ');
    
    if (sections.htmlFix && sections.cssFix) {
        return `Fix ${violationType} by updating HTML and CSS`;
    } else if (sections.htmlFix) {
        return `Fix ${violationType} by updating HTML attributes`;
    } else if (sections.cssFix) {
        return `Fix ${violationType} by adding CSS styles`;
    } else {
        return `AI-generated fix for ${violationType}`;
    }
}

/**
 * Calculate confidence score for the fix suggestion
 */
function calculateConfidence(sections) {
    let score = 60; // Base score
    
    if (sections.htmlFix) score += 20;
    if (sections.cssFix) score += 15;
    if (sections.explanation) score += 10;
    if (sections.testing) score += 5;
    
    return Math.min(100, score);
}

/**
 * Generate a comprehensive fix report
 */
function generateFixReport(enhancedViolations) {
    const fixableViolations = enhancedViolations.filter(v => v.aiFixAvailable);
    const totalFixes = fixableViolations.length;
    
    // Categorize fixes by type
    const fixCategories = {
        html: fixableViolations.filter(v => v.aiFixSuggestion?.fixes?.html).length,
        css: fixableViolations.filter(v => v.aiFixSuggestion?.fixes?.css).length,
        javascript: 0
    };

    // Calculate average confidence
    const avgConfidence = fixableViolations.length > 0
        ? Math.round(fixableViolations.reduce((sum, v) => sum + (v.aiFixSuggestion?.confidence || 0), 0) / fixableViolations.length)
        : 0;

    // Group by impact level
    const fixesByImpact = {
        critical: fixableViolations.filter(v => v.impact === 'critical').length,
        serious: fixableViolations.filter(v => v.impact === 'serious').length,
        moderate: fixableViolations.filter(v => v.impact === 'moderate').length,
        minor: fixableViolations.filter(v => v.impact === 'minor').length
    };

    // Estimate fix time
    const totalMinutes = fixableViolations.reduce((sum, violation) => {
        const baseTime = {
            critical: 30,
            serious: 20,
            moderate: 15,
            minor: 10
        }[violation.impact] || 15;
        return sum + baseTime;
    }, 0);

    return {
        summary: {
            totalViolations: enhancedViolations.length,
            fixableViolations: totalFixes,
            fixabilityRate: enhancedViolations.length > 0 
                ? Math.round((totalFixes / enhancedViolations.length) * 100) 
                : 0,
            averageConfidence: avgConfidence
        },
        categories: fixCategories,
        impactDistribution: fixesByImpact,
        estimatedFixTime: {
            totalMinutes: totalMinutes,
            estimatedHours: Math.round(totalMinutes / 60 * 10) / 10,
            estimatedDays: Math.round(totalMinutes / (60 * 8) * 10) / 10
        },
        generatedAt: new Date().toISOString()
    };
}

module.exports = {
    generateAccessibilityFixes
};
