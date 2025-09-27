const OpenAI = require('openai');

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

/**
 * AI Fix Suggestions Engine
 * Analyzes accessibility violations and generates specific, actionable code fixes
 */
class AIFixEngine {
    constructor() {
        this.initialized = !!process.env.OPENAI_API_KEY;
        if (!this.initialized) {
            console.log('⚠️ OpenAI API key not found. AI fix suggestions will be disabled.');
        } else {
            console.log('🤖 AI Fix Engine initialized successfully');
        }
    }

    /**
     * Generate AI-powered fix suggestions for accessibility violations
     * @param {Array} violations - Array of accessibility violations from axe-core
     * @param {string} url - The URL that was scanned
     * @returns {Promise<Array>} Array of violations with AI-generated fixes
     */
    async generateFixSuggestions(violations, url = '') {
        if (!this.initialized) {
            console.log('⚠️ AI Fix Engine not initialized, returning violations without fixes');
            return violations.map(violation => ({
                ...violation,
                aiFixSuggestion: null,
                aiFixAvailable: false
            }));
        }

        console.log(`🤖 Generating AI fix suggestions for ${violations.length} violations...`);
        
        const enhancedViolations = [];
        
        // Process violations in batches to avoid rate limits
        const batchSize = 3;
        for (let i = 0; i < violations.length; i += batchSize) {
            const batch = violations.slice(i, i + batchSize);
            const batchPromises = batch.map(violation => this.generateSingleFix(violation, url));
            
            try {
                const batchResults = await Promise.allSettled(batchPromises);
                batchResults.forEach((result, index) => {
                    const originalViolation = batch[index];
                    if (result.status === 'fulfilled') {
                        enhancedViolations.push(result.value);
                    } else {
                        console.log(`❌ Failed to generate fix for ${originalViolation.id}:`, result.reason);
                        enhancedViolations.push({
                            ...originalViolation,
                            aiFixSuggestion: null,
                            aiFixAvailable: false,
                            aiFixError: result.reason.message
                        });
                    }
                });
                
                // Add delay between batches to respect rate limits
                if (i + batchSize < violations.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.log('❌ Batch processing error:', error);
                // Add original violations without fixes
                batch.forEach(violation => {
                    enhancedViolations.push({
                        ...violation,
                        aiFixSuggestion: null,
                        aiFixAvailable: false,
                        aiFixError: error.message
                    });
                });
            }
        }
        
        const successfulFixes = enhancedViolations.filter(v => v.aiFixAvailable).length;
        console.log(`✅ Generated ${successfulFixes}/${violations.length} AI fix suggestions`);
        
        return enhancedViolations;
    }

    /**
     * Generate a fix suggestion for a single violation
     * @param {Object} violation - Single accessibility violation
     * @param {string} url - The URL that was scanned
     * @returns {Promise<Object>} Enhanced violation with AI fix
     */
    async generateSingleFix(violation, url) {
        try {
            const prompt = this.buildFixPrompt(violation, url);
            
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: `You are an expert web accessibility consultant and developer. Your job is to analyze accessibility violations and provide specific, actionable code fixes.

IMPORTANT GUIDELINES:
- Provide SPECIFIC code examples, not generic advice
- Include both HTML and CSS fixes when applicable
- Focus on practical, implementable solutions
- Consider modern web development practices
- Explain WHY the fix works for accessibility
- Keep explanations concise but thorough
- Format code examples clearly with proper syntax highlighting indicators`
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                max_tokens: 800,
                temperature: 0.3
            });

            const aiResponse = response.choices[0].message.content;
            const fixSuggestion = this.parseAIResponse(aiResponse, violation);

            return {
                ...violation,
                aiFixSuggestion: fixSuggestion,
                aiFixAvailable: true,
                aiGeneratedAt: new Date().toISOString()
            };

        } catch (error) {
            console.log(`❌ Error generating fix for ${violation.id}:`, error.message);
            throw error;
        }
    }

    /**
     * Build a comprehensive prompt for the AI to generate fixes
     * @param {Object} violation - Accessibility violation
     * @param {string} url - URL being scanned
     * @returns {string} Formatted prompt for AI
     */
    buildFixPrompt(violation, url) {
        // Extract sample HTML from affected nodes
        const sampleHTML = violation.nodes && violation.nodes.length > 0 
            ? violation.nodes[0].html || 'No HTML sample available'
            : 'No HTML sample available';

        // Get the first few selectors as examples
        const selectors = violation.nodes && violation.nodes.length > 0
            ? violation.nodes.slice(0, 3).map(node => node.target ? node.target.join(' ') : 'Unknown selector')
            : ['No selectors available'];

        return `ACCESSIBILITY VIOLATION ANALYSIS:

Violation ID: ${violation.id}
Impact Level: ${violation.impact}
Description: ${violation.description}
Help Text: ${violation.help}
URL: ${url}

AFFECTED ELEMENTS:
Sample HTML: ${sampleHTML}
CSS Selectors: ${selectors.join(', ')}
Elements Count: ${violation.nodes ? violation.nodes.length : 0}

WCAG Guidelines: ${violation.tags ? violation.tags.join(', ') : 'Not specified'}

TASK:
Provide a specific, actionable fix for this accessibility violation. Include:

1. EXPLANATION: Brief explanation of why this is an accessibility issue
2. HTML_FIX: Specific HTML code changes (if applicable)
3. CSS_FIX: Specific CSS code changes (if applicable)  
4. JAVASCRIPT_FIX: JavaScript code if needed (if applicable)
5. TESTING: How to verify the fix works
6. IMPACT: How this fix improves accessibility

Format your response clearly with these sections. Provide actual code examples, not just descriptions.`;
    }

    /**
     * Parse AI response into structured fix suggestion
     * @param {string} aiResponse - Raw AI response
     * @param {Object} violation - Original violation
     * @returns {Object} Structured fix suggestion
     */
    parseAIResponse(aiResponse, violation) {
        // Extract different sections from the AI response
        const sections = {
            explanation: this.extractSection(aiResponse, 'EXPLANATION'),
            htmlFix: this.extractSection(aiResponse, 'HTML_FIX'),
            cssFix: this.extractSection(aiResponse, 'CSS_FIX'),
            javascriptFix: this.extractSection(aiResponse, 'JAVASCRIPT_FIX'),
            testing: this.extractSection(aiResponse, 'TESTING'),
            impact: this.extractSection(aiResponse, 'IMPACT')
        };

        // Generate a summary fix description
        const summary = this.generateFixSummary(violation, sections);

        return {
            summary: summary,
            explanation: sections.explanation || 'AI-generated fix explanation not available',
            fixes: {
                html: sections.htmlFix || null,
                css: sections.cssFix || null,
                javascript: sections.javascriptFix || null
            },
            testing: sections.testing || 'Test the fix by running another accessibility scan',
            impact: sections.impact || 'This fix will improve accessibility compliance',
            confidence: this.calculateConfidence(sections),
            rawResponse: aiResponse
        };
    }

    /**
     * Extract a specific section from AI response
     * @param {string} response - AI response text
     * @param {string} sectionName - Section to extract
     * @returns {string|null} Extracted section content
     */
    extractSection(response, sectionName) {
        const regex = new RegExp(`${sectionName}:?\\s*([\\s\\S]*?)(?=\\n\\d+\\.|\\n[A-Z_]+:|$)`, 'i');
        const match = response.match(regex);
        return match ? match[1].trim() : null;
    }

    /**
     * Generate a concise summary of the fix
     * @param {Object} violation - Original violation
     * @param {Object} sections - Parsed sections
     * @returns {string} Fix summary
     */
    generateFixSummary(violation, sections) {
        const violationType = violation.id.replace(/-/g, ' ');
        
        if (sections.htmlFix && sections.cssFix) {
            return `Fix ${violationType} by updating HTML structure and adding CSS styles`;
        } else if (sections.htmlFix) {
            return `Fix ${violationType} by updating HTML attributes and structure`;
        } else if (sections.cssFix) {
            return `Fix ${violationType} by adding CSS styles for better accessibility`;
        } else if (sections.javascriptFix) {
            return `Fix ${violationType} using JavaScript to enhance accessibility`;
        } else {
            return `AI-generated fix for ${violationType}`;
        }
    }

    /**
     * Calculate confidence score for the fix suggestion
     * @param {Object} sections - Parsed sections
     * @returns {number} Confidence score (0-100)
     */
    calculateConfidence(sections) {
        let score = 60; // Base score
        
        if (sections.htmlFix) score += 15;
        if (sections.cssFix) score += 15;
        if (sections.explanation) score += 10;
        if (sections.testing) score += 5;
        if (sections.impact) score += 5;
        
        return Math.min(100, score);
    }

    /**
     * Generate a comprehensive fix report for all violations
     * @param {Array} enhancedViolations - Violations with AI fixes
     * @param {Object} scanMetadata - Scan metadata
     * @returns {Object} Comprehensive fix report
     */
    generateFixReport(enhancedViolations, scanMetadata = {}) {
        const fixableViolations = enhancedViolations.filter(v => v.aiFixAvailable);
        const totalFixes = fixableViolations.length;
        
        // Categorize fixes by type
        const fixCategories = {
            html: fixableViolations.filter(v => v.aiFixSuggestion?.fixes?.html).length,
            css: fixableViolations.filter(v => v.aiFixSuggestion?.fixes?.css).length,
            javascript: fixableViolations.filter(v => v.aiFixSuggestion?.fixes?.javascript).length
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
            estimatedFixTime: this.estimateFixTime(fixableViolations),
            generatedAt: new Date().toISOString(),
            scanMetadata: scanMetadata
        };
    }

    /**
     * Estimate time required to implement all fixes
     * @param {Array} fixableViolations - Violations with fixes
     * @returns {Object} Time estimation
     */
    estimateFixTime(fixableViolations) {
        let totalMinutes = 0;
        
        fixableViolations.forEach(violation => {
            // Base time by impact level
            const baseTime = {
                critical: 30,
                serious: 20,
                moderate: 15,
                minor: 10
            }[violation.impact] || 15;
            
            // Additional time based on fix complexity
            let complexity = 1;
            if (violation.aiFixSuggestion?.fixes?.javascript) complexity += 0.5;
            if (violation.aiFixSuggestion?.fixes?.css) complexity += 0.3;
            if (violation.aiFixSuggestion?.fixes?.html) complexity += 0.2;
            
            totalMinutes += Math.round(baseTime * complexity);
        });

        return {
            totalMinutes: totalMinutes,
            estimatedHours: Math.round(totalMinutes / 60 * 10) / 10,
            estimatedDays: Math.round(totalMinutes / (60 * 8) * 10) / 10
        };
    }
}

module.exports = AIFixEngine;
