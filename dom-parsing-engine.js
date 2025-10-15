/**
 * Advanced DOM Parsing Engine for SentryPrime Accessibility Scanner
 * Provides precise CSS selector generation and DOM manipulation capabilities
 * for deployment-ready accessibility fixes.
 * 
 * Author: Manus AI
 * Date: October 7, 2025
 * Version: Node.js Compatible
 */

// CSS selector generator - handle browser vs Node.js environment
let getCssSelector;
try {
    // For Node.js environment, we'll implement our own selector generation
    getCssSelector = null;
} catch (error) {
    console.log('CSS selector generator not available, using fallback');
    getCssSelector = null;
}

// Use Node.js compatible dependencies only
const { DomHandler, Parser } = require('htmlparser2');
const serialize = require('dom-serializer');
const cheerio = require('cheerio');

class DOMParsingEngine {
    constructor(options = {}) {
        this.options = {
            depth: options.depth || 6,
            preferredAttributes: options.preferredAttributes || ['id', 'class', 'data-*', 'aria-*', 'name', 'type'],
            selectorOptions: {
                selectors: ['id', 'class', 'tag', 'attribute', 'nthchild'],
                includeTag: true,
                whitelist: [],
                blacklist: [],
                combineWithinSelector: true,
                combineBetweenSelectors: true,
                root: null,
                maxCombinations: 50
            },
            ...options
        };
        
        console.log('🔍 DOM Parsing Engine initialized (Node.js compatible)');
    }

    /**
     * Parse HTML content and create a manipulable DOM structure
     * @param {string} html - HTML content to parse
     * @returns {Object} Parsed DOM structure with manipulation methods
     */
    parseHTML(html) {
        try {
            const $ = cheerio.load(html, {
                xmlMode: false,
                decodeEntities: true,
                lowerCaseAttributeNames: false
            });

            return {
                $: $,
                
                // Query methods
                find: (selector) => $(selector),
                findByText: (text) => $(`*:contains("${text}")`),
                findByAttribute: (attr, value) => value ? $(`[${attr}="${value}"]`) : $(`[${attr}]`),
                
                // Generate selectors for elements
                generateSelector: (element) => this.generateOptimalSelector(element, $),
                
                // Manipulation methods
                addClass: (selector, className) => $(selector).addClass(className),
                removeClass: (selector, className) => $(selector).removeClass(className),
                setAttribute: (selector, attr, value) => $(selector).attr(attr, value),
                removeAttribute: (selector, attr) => $(selector).removeAttr(attr),
                
                // Serialization
                serialize: () => $.html()
            };
        } catch (error) {
            console.error('DOM parsing error:', error);
            throw new Error(`Failed to parse HTML: ${error.message}`);
        }
    }

    /**
     * Generate optimal CSS selector for an element
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Object} Selector information with metadata
     */
    generateOptimalSelector(element, $) {
        try {
            // Generate multiple selector candidates
            const candidates = this.generateSelectorCandidates(element, $);
            
            // Evaluate and rank selectors
            const rankedSelectors = this.rankSelectors(candidates, $);
            
            return {
                selector: rankedSelectors[0]?.selector || this.generateFallbackSelector(element).selector,
                specificity: rankedSelectors[0]?.specificity || 1,
                uniqueness: rankedSelectors[0]?.uniqueness || false,
                alternatives: rankedSelectors.slice(1, 3).map(s => s.selector),
                metadata: {
                    strategy: rankedSelectors[0]?.strategy || 'fallback',
                    confidence: rankedSelectors[0]?.confidence || 'low',
                    element: {
                        tag: element.prop('tagName')?.toLowerCase(),
                        id: element.attr('id'),
                        classes: element.attr('class')?.split(/\s+/) || []
                    }
                }
            };
        } catch (error) {
            console.error('Selector generation error:', error);
            // Fallback to simple selector
            return this.generateFallbackSelector(element);
        }
    }

    /**
     * Generate multiple selector candidates for an element
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Array} Array of selector candidates
     */
    generateSelectorCandidates(element, $) {
        const candidates = [];
        
        // Strategy 1: ID-based selector (highest priority)
        const id = element.attr('id');
        if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
            candidates.push({
                selector: `#${id}`,
                strategy: 'id',
                specificity: 100,
                confidence: 'high'
            });
        }

        // Strategy 2: Class-based selectors
        const classes = element.attr('class');
        if (classes) {
            const classList = classes.split(/\s+/).filter(cls => 
                cls && /^[a-zA-Z][\w-]*$/.test(cls) && !cls.match(/^(active|selected|hover|focus)$/)
            );
            
            if (classList.length > 0) {
                // Single class selector
                classList.forEach(cls => {
                    candidates.push({
                        selector: `.${cls}`,
                        strategy: 'class',
                        specificity: 10,
                        confidence: 'medium'
                    });
                });
                
                // Combined class selector
                if (classList.length > 1) {
                    candidates.push({
                        selector: `.${classList.join('.')}`,
                        strategy: 'multi-class',
                        specificity: 10 * classList.length,
                        confidence: 'high'
                    });
                }
            }
        }

        // Strategy 3: Attribute-based selectors
        const attributes = element.get(0)?.attribs || {};
        Object.entries(attributes).forEach(([attr, value]) => {
            if (['name', 'type', 'role', 'data-testid'].includes(attr) && value) {
                candidates.push({
                    selector: `[${attr}="${value}"]`,
                    strategy: 'attribute',
                    specificity: 10,
                    confidence: 'medium'
                });
            }
        });

        // Strategy 4: Tag-based selectors with context
        const tag = element.prop('tagName')?.toLowerCase();
        if (tag) {
            candidates.push({
                selector: tag,
                strategy: 'tag',
                specificity: 1,
                confidence: 'low'
            });
        }

        // Strategy 5: Hierarchical selectors
        const hierarchicalSelectors = this.generateHierarchicalSelectors(element, $);
        candidates.push(...hierarchicalSelectors);

        // Strategy 6: nth-child selectors (last resort)
        if (candidates.length === 0) {
            const nthChildSelector = this.generateNthChildSelector(element, $);
            if (nthChildSelector) {
                candidates.push(nthChildSelector);
            }
        }

        return candidates;
    }

    /**
     * Generate hierarchical selector candidates
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Array} Array of hierarchical selector candidates
     */
    generateHierarchicalSelectors(element, $) {
        const candidates = [];
        const hierarchy = [];
        let current = element;
        
        // Build hierarchy up to specified depth
        for (let i = 0; i < this.options.depth && current.length > 0; i++) {
            const tag = current.prop('tagName')?.toLowerCase();
            const id = current.attr('id');
            const classes = current.attr('class');
            
            let selectorPart = tag || '';
            
            if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
                selectorPart = `#${id}`;
                hierarchy.unshift(selectorPart);
                break; // ID is unique, no need to go further up
            } else if (classes) {
                const classList = classes.split(/\s+/).filter(cls => 
                    cls && /^[a-zA-Z][\w-]*$/.test(cls)
                );
                if (classList.length > 0) {
                    selectorPart += `.${classList[0]}`;
                }
            }
            
            hierarchy.unshift(selectorPart);
            current = current.parent();
        }
        
        // Generate selectors of different lengths
        for (let len = 1; len <= Math.min(hierarchy.length, 3); len++) {
            const selector = hierarchy.slice(-len).join(' > ');
            if (selector) {
                candidates.push({
                    selector: selector,
                    strategy: 'hierarchical',
                    specificity: len * 5,
                    confidence: len === 1 ? 'low' : 'medium'
                });
            }
        }
        
        return candidates;
    }

    /**
     * Generate nth-child selector for an element
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Object|null} nth-child selector candidate
     */
    generateNthChildSelector(element, $) {
        const parent = element.parent();
        if (parent.length === 0) return null;

        const tag = element.prop('tagName')?.toLowerCase();
        const index = element.index() + 1; // nth-child is 1-indexed
        
        return {
            selector: `${tag}:nth-child(${index})`,
            strategy: 'nth-child',
            specificity: 2,
            confidence: 'low'
        };
    }

    /**
     * Rank selector candidates by effectiveness
     * @param {Array} candidates - Array of selector candidates
     * @param {Object} $ - Cheerio instance
     * @returns {Array} Ranked selectors
     */
    rankSelectors(candidates, $) {
        return candidates
            .map(candidate => {
                try {
                    const matches = $(candidate.selector);
                    const uniqueness = matches.length === 1;
                    const score = this.calculateSelectorScore(candidate, matches.length);
                    
                    return {
                        ...candidate,
                        uniqueness,
                        matchCount: matches.length,
                        score
                    };
                } catch (error) {
                    return {
                        ...candidate,
                        uniqueness: false,
                        matchCount: 0,
                        score: 0
                    };
                }
            })
            .filter(candidate => candidate.matchCount > 0)
            .sort((a, b) => b.score - a.score);
    }

    /**
     * Calculate score for a selector candidate
     * @param {Object} candidate - Selector candidate
     * @param {number} matchCount - Number of elements matched
     * @returns {number} Selector score
     */
    calculateSelectorScore(candidate, matchCount) {
        let score = candidate.specificity;
        
        // Penalty for non-unique selectors
        if (matchCount > 1) {
            score -= (matchCount - 1) * 10;
        }
        
        // Bonus for unique selectors
        if (matchCount === 1) {
            score += 50;
        }
        
        // Strategy-based scoring
        const strategyBonus = {
            'id': 100,
            'multi-class': 50,
            'class': 30,
            'attribute': 25,
            'hierarchical': 20,
            'tag': 10,
            'nth-child': 5
        };
        
        score += strategyBonus[candidate.strategy] || 0;
        
        return Math.max(0, score);
    }

    /**
     * Generate fallback selector for an element
     * @param {Object} element - Cheerio element
     * @returns {Object} Fallback selector info
     */
    generateFallbackSelector(element) {
        const tag = element.prop('tagName')?.toLowerCase() || 'unknown';
        const index = element.index();
        
        return {
            selector: `${tag}:nth-child(${index + 1})`,
            specificity: 1,
            uniqueness: false,
            alternatives: [],
            metadata: {
                strategy: 'fallback',
                confidence: 'low',
                element: {
                    tag: tag,
                    index: index
                }
            }
        };
    }

    /**
     * Extract accessibility-relevant elements from HTML
     * @param {string} html - HTML content
     * @returns {Array} Array of accessibility elements with selectors
     */
    extractAccessibilityElements(html) {
        const dom = this.parseHTML(html);
        const $ = dom.$;
        const elements = [];

        // Interactive elements
        const interactiveSelectors = [
            'button', 'input', 'select', 'textarea', 'a[href]',
            '[role="button"]', '[role="link"]', '[role="menuitem"]',
            '[tabindex]', '[onclick]'
        ];

        interactiveSelectors.forEach(selector => {
            $(selector).each((i, el) => {
                const $el = $(el);
                const selectorInfo = this.generateOptimalSelector($el, $);
                
                elements.push({
                    type: 'interactive',
                    tag: $el.prop('tagName')?.toLowerCase(),
                    selector: selectorInfo.selector,
                    attributes: $el.get(0)?.attribs || {},
                    text: $el.text().trim(),
                    accessibility: {
                        hasAriaLabel: !!$el.attr('aria-label'),
                        hasAriaDescribedBy: !!$el.attr('aria-describedby'),
                        hasRole: !!$el.attr('role'),
                        isKeyboardAccessible: $el.attr('tabindex') !== '-1'
                    }
                });
            });
        });

        // Form elements
        $('form').each((i, form) => {
            const $form = $(form);
            const selectorInfo = this.generateOptimalSelector($form, $);
            
            elements.push({
                type: 'form',
                tag: 'form',
                selector: selectorInfo.selector,
                attributes: $form.get(0)?.attribs || {},
                fields: $form.find('input, select, textarea').length,
                hasLabels: $form.find('label').length > 0
            });
        });

        // Images
        $('img').each((i, img) => {
            const $img = $(img);
            const selectorInfo = this.generateOptimalSelector($img, $);
            
            elements.push({
                type: 'image',
                tag: 'img',
                selector: selectorInfo.selector,
                attributes: $img.get(0)?.attribs || {},
                hasAlt: !!$img.attr('alt'),
                altText: $img.attr('alt') || '',
                isDecorative: $img.attr('alt') === '' || $img.attr('role') === 'presentation'
            });
        });

        return elements;
    }

    /**
     * Analyze DOM complexity and structure
     * @param {string} html - HTML content
     * @returns {Object} DOM complexity analysis
     */
    analyzeDOMComplexity(html) {
        const dom = this.parseHTML(html);
        const $ = dom.$;

        const analysis = {
            totalElements: $('*').length,
            depth: this.calculateMaxDepth($('body').length ? $('body') : $.root()),
            interactiveElements: $('button, input, select, textarea, a[href], [role="button"], [tabindex]').length,
            images: $('img').length,
            forms: $('form').length,
            headings: $('h1, h2, h3, h4, h5, h6').length,
            landmarks: $('[role="main"], [role="navigation"], [role="banner"], [role="contentinfo"], main, nav, header, footer').length,
            complexity: 'low'
        };

        // Determine complexity level
        if (analysis.totalElements > 1000 || analysis.depth > 10) {
            analysis.complexity = 'high';
        } else if (analysis.totalElements > 500 || analysis.depth > 7) {
            analysis.complexity = 'medium';
        }

        return analysis;
    }

    /**
     * Calculate maximum depth of DOM tree
     * @param {Object} element - Starting element
     * @returns {number} Maximum depth
     */
    calculateMaxDepth(element) {
        let maxDepth = 0;
        
        const traverse = (el, depth) => {
            maxDepth = Math.max(maxDepth, depth);
            el.children().each((i, child) => {
                traverse(element.constructor(child), depth + 1);
            });
        };
        
        traverse(element, 0);
        return maxDepth;
    }

    /**
     * Generate CSS modifications for accessibility fixes
     * @param {Array} violations - Accessibility violations
     * @returns {Object} CSS modifications
     */
    generateCSSFixes(violations) {
        const fixes = {
            rules: [],
            variables: {},
            mediaQueries: {}
        };

        violations.forEach(violation => {
            switch (violation.id) {
                case 'color-contrast':
                    fixes.rules.push({
                        selector: violation.target[0],
                        properties: {
                            'color': '#000000',
                            'background-color': '#ffffff'
                        },
                        comment: 'Improved color contrast for accessibility'
                    });
                    break;
                    
                case 'focus-order-semantics':
                    fixes.rules.push({
                        selector: `${violation.target[0]}:focus`,
                        properties: {
                            'outline': '2px solid #0066cc',
                            'outline-offset': '2px'
                        },
                        comment: 'Enhanced focus indicator'
                    });
                    break;
            }
        });

        return fixes;
    }
}

module.exports = DOMParsingEngine;
