/**
 * Advanced DOM Parsing Engine for SentryPrime Accessibility Scanner
 * Provides precise CSS selector generation and DOM manipulation capabilities
 * for deployment-ready accessibility fixes.
 * 
 * Author: Manus AI
 * Date: October 7, 2025
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
const { parse, generate } = require('css-tree');
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
                root: $.root(),
                
                // Find elements by various criteria
                findBySelector: (selector) => $(selector),
                findByText: (text) => $(`*:contains("${text}")`),
                findByAttribute: (attr, value) => value ? $(`[${attr}="${value}"]`) : $(`[${attr}]`),
                
                // Generate selectors for elements
                generateSelector: (element) => this.generateOptimalSelector(element, $),
                
                // Manipulation methods
                addClass: (selector, className) => $(selector).addClass(className),
                setAttribute: (selector, attr, value) => $(selector).attr(attr, value),
                setStyle: (selector, styles) => $(selector).css(styles),
                insertCSS: (css) => this.insertCSS($, css),
                
                // Serialization
                toHTML: () => $.html(),
                getElementHTML: (selector) => $(selector).html(),
                getOuterHTML: (selector) => $(selector).prop('outerHTML')
            };
        } catch (error) {
            console.error('DOM parsing error:', error);
            throw new Error(`Failed to parse HTML: ${error.message}`);
        }
    }

    /**
     * Generate an optimal CSS selector for a given element
     * Balances specificity with flexibility for deployment-ready fixes
     * @param {Object} element - Cheerio element object
     * @param {Object} $ - Cheerio instance
     * @returns {Object} Selector information with metadata
     */
    generateOptimalSelector(element, $) {
        try {
            // Convert cheerio element to DOM-like structure for css-selector-generator
            const domElement = this.cheerioToDOMElement(element, $);
            
            // Generate multiple selector candidates
            const candidates = this.generateSelectorCandidates(element, $);
            
            // Evaluate and rank selectors
            const rankedSelectors = this.rankSelectors(candidates, $);
            
            // Return the best selector with metadata
            const bestSelector = rankedSelectors[0];
            
            return {
                selector: bestSelector.selector,
                specificity: bestSelector.specificity,
                uniqueness: bestSelector.uniqueness,
                flexibility: bestSelector.flexibility,
                score: bestSelector.score,
                alternatives: rankedSelectors.slice(1, 3), // Top 2 alternatives
                metadata: {
                    elementTag: element.prop('tagName')?.toLowerCase(),
                    hasId: !!element.attr('id'),
                    hasClass: !!element.attr('class'),
                    hasUniqueAttributes: this.hasUniqueAttributes(element, $),
                    depth: this.getElementDepth(element),
                    siblingIndex: element.index()
                }
            };
        } catch (error) {
            console.error('Selector generation error:', error);
            // Fallback to simple selector
            return this.generateFallbackSelector(element);
        }
    }

    /**
     * Generate multiple selector candidates using different strategies
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Array} Array of selector candidates
     */
    generateSelectorCandidates(element, $) {
        const candidates = [];
        
        // Strategy 1: ID-based selector (highest priority)
        const id = element.attr('id');
        if (id && this.isUniqueId(id, $)) {
            candidates.push({
                selector: `#${id}`,
                strategy: 'id',
                specificity: 100
            });
        }

        // Strategy 2: Class-based selector
        const classes = element.attr('class');
        if (classes) {
            const classArray = classes.split(/\s+/).filter(c => c.length > 0);
            if (classArray.length > 0) {
                // Try single class first
                for (const cls of classArray) {
                    const selector = `.${cls}`;
                    if (this.isUniqueSelector(selector, $)) {
                        candidates.push({
                            selector: selector,
                            strategy: 'single-class',
                            specificity: 10
                        });
                    }
                }
                
                // Try class combinations
                if (classArray.length > 1) {
                    const combinedSelector = `.${classArray.join('.')}`;
                    candidates.push({
                        selector: combinedSelector,
                        strategy: 'multi-class',
                        specificity: 10 * classArray.length
                    });
                }
            }
        }

        // Strategy 3: Attribute-based selectors
        const attributes = element.attr();
        if (attributes) {
            for (const [attr, value] of Object.entries(attributes)) {
                if (this.options.preferredAttributes.some(pref => 
                    pref.includes('*') ? attr.startsWith(pref.replace('*', '')) : attr === pref
                )) {
                    const selector = `[${attr}="${value}"]`;
                    if (this.isUniqueSelector(selector, $)) {
                        candidates.push({
                            selector: selector,
                            strategy: 'attribute',
                            specificity: 10
                        });
                    }
                }
            }
        }

        // Strategy 4: Tag + attribute combinations
        const tag = element.prop('tagName')?.toLowerCase();
        if (tag) {
            // Tag + class
            if (classes) {
                const firstClass = classes.split(/\s+/)[0];
                const selector = `${tag}.${firstClass}`;
                candidates.push({
                    selector: selector,
                    strategy: 'tag-class',
                    specificity: 11
                });
            }

            // Tag + attribute
            for (const [attr, value] of Object.entries(attributes || {})) {
                if (attr !== 'class' && attr !== 'id') {
                    const selector = `${tag}[${attr}="${value}"]`;
                    candidates.push({
                        selector: selector,
                        strategy: 'tag-attribute',
                        specificity: 11
                    });
                }
            }
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
     * Generate hierarchical selectors by traversing up the DOM tree
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Array} Array of hierarchical selector candidates
     */
    generateHierarchicalSelectors(element, $) {
        const candidates = [];
        const hierarchy = [];
        let current = element;
        let depth = 0;

        // Build hierarchy up to configured depth
        while (current.length > 0 && current.prop('tagName') && depth < this.options.depth) {
            const tag = current.prop('tagName').toLowerCase();
            const id = current.attr('id');
            const classes = current.attr('class');

            let levelSelector = tag;

            // Prefer ID if unique
            if (id && this.isUniqueId(id, $)) {
                levelSelector = `#${id}`;
                hierarchy.unshift(levelSelector);
                break; // ID is unique, no need to go further up
            }

            // Add class if available
            if (classes) {
                const firstClass = classes.split(/\s+/)[0];
                levelSelector += `.${firstClass}`;
            }

            hierarchy.unshift(levelSelector);
            current = current.parent();
            depth++;
        }

        // Generate selectors with different hierarchy depths
        for (let i = 1; i <= hierarchy.length; i++) {
            const selector = hierarchy.slice(-i).join(' > ');
            candidates.push({
                selector: selector,
                strategy: 'hierarchical',
                specificity: this.calculateSpecificity(selector),
                depth: i
            });

            // Also try descendant selector (space instead of >)
            if (i > 1) {
                const descendantSelector = hierarchy.slice(-i).join(' ');
                candidates.push({
                    selector: descendantSelector,
                    strategy: 'descendant',
                    specificity: this.calculateSpecificity(descendantSelector),
                    depth: i
                });
            }
        }

        return candidates;
    }

    /**
     * Generate nth-child selector as a last resort
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Object|null} nth-child selector candidate
     */
    generateNthChildSelector(element, $) {
        const parent = element.parent();
        if (parent.length === 0) return null;

        const siblings = parent.children();
        const index = siblings.index(element);
        
        if (index >= 0) {
            const tag = element.prop('tagName')?.toLowerCase();
            const selector = `${tag}:nth-child(${index + 1})`;
            
            return {
                selector: selector,
                strategy: 'nth-child',
                specificity: 1,
                warning: 'nth-child selectors are fragile and may break with DOM changes'
            };
        }

        return null;
    }

    /**
     * Rank selectors based on multiple criteria
     * @param {Array} candidates - Array of selector candidates
     * @param {Object} $ - Cheerio instance
     * @returns {Array} Ranked selectors
     */
    rankSelectors(candidates, $) {
        return candidates
            .map(candidate => {
                const uniqueness = this.calculateUniqueness(candidate.selector, $);
                const flexibility = this.calculateFlexibility(candidate);
                const score = this.calculateOverallScore(candidate, uniqueness, flexibility);

                return {
                    ...candidate,
                    uniqueness,
                    flexibility,
                    score
                };
            })
            .sort((a, b) => b.score - a.score)
            .filter(candidate => candidate.uniqueness > 0); // Remove non-unique selectors
    }

    /**
     * Calculate selector specificity based on CSS rules
     * @param {string} selector - CSS selector
     * @returns {number} Specificity score
     */
    calculateSpecificity(selector) {
        let specificity = 0;
        
        // Count IDs (100 points each)
        const idMatches = selector.match(/#[\w-]+/g);
        if (idMatches) specificity += idMatches.length * 100;
        
        // Count classes, attributes, pseudo-classes (10 points each)
        const classMatches = selector.match(/\.[\w-]+/g);
        if (classMatches) specificity += classMatches.length * 10;
        
        const attrMatches = selector.match(/\[[^\]]+\]/g);
        if (attrMatches) specificity += attrMatches.length * 10;
        
        const pseudoMatches = selector.match(/:[\w-]+(\([^)]*\))?/g);
        if (pseudoMatches) specificity += pseudoMatches.length * 10;
        
        // Count elements and pseudo-elements (1 point each)
        const elementMatches = selector.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g);
        if (elementMatches) specificity += elementMatches.length * 1;
        
        return specificity;
    }

    /**
     * Calculate how unique a selector is (1 = unique, 0 = not unique)
     * @param {string} selector - CSS selector
     * @param {Object} $ - Cheerio instance
     * @returns {number} Uniqueness score (0-1)
     */
    calculateUniqueness(selector, $) {
        try {
            const matches = $(selector);
            return matches.length === 1 ? 1 : (matches.length === 0 ? 0 : 1 / matches.length);
        } catch (error) {
            return 0; // Invalid selector
        }
    }

    /**
     * Calculate flexibility score based on selector characteristics
     * @param {Object} candidate - Selector candidate
     * @returns {number} Flexibility score (0-1)
     */
    calculateFlexibility(candidate) {
        let flexibility = 1;

        // Penalize nth-child selectors (very fragile)
        if (candidate.strategy === 'nth-child') {
            flexibility *= 0.1;
        }

        // Penalize very deep hierarchical selectors
        if (candidate.depth && candidate.depth > 4) {
            flexibility *= Math.pow(0.8, candidate.depth - 4);
        }

        // Reward ID-based selectors
        if (candidate.strategy === 'id') {
            flexibility *= 1.2;
        }

        // Reward attribute-based selectors for accessibility elements
        if (candidate.strategy === 'attribute' && candidate.selector.includes('aria-')) {
            flexibility *= 1.1;
        }

        return Math.min(flexibility, 1);
    }

    /**
     * Calculate overall score combining specificity, uniqueness, and flexibility
     * @param {Object} candidate - Selector candidate
     * @param {number} uniqueness - Uniqueness score
     * @param {number} flexibility - Flexibility score
     * @returns {number} Overall score
     */
    calculateOverallScore(candidate, uniqueness, flexibility) {
        // Weighted scoring: uniqueness is most important, then flexibility, then specificity
        const uniquenessWeight = 0.5;
        const flexibilityWeight = 0.3;
        const specificityWeight = 0.2;

        // Normalize specificity (cap at 200 for scoring purposes)
        const normalizedSpecificity = Math.min(candidate.specificity, 200) / 200;

        return (uniqueness * uniquenessWeight) + 
               (flexibility * flexibilityWeight) + 
               (normalizedSpecificity * specificityWeight);
    }

    /**
     * Check if an ID is unique in the document
     * @param {string} id - ID to check
     * @param {Object} $ - Cheerio instance
     * @returns {boolean} True if unique
     */
    isUniqueId(id, $) {
        return $(`#${id}`).length === 1;
    }

    /**
     * Check if a selector is unique in the document
     * @param {string} selector - Selector to check
     * @param {Object} $ - Cheerio instance
     * @returns {boolean} True if unique
     */
    isUniqueSelector(selector, $) {
        try {
            return $(selector).length === 1;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if element has unique attributes
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {boolean} True if has unique attributes
     */
    hasUniqueAttributes(element, $) {
        const attributes = element.attr();
        if (!attributes) return false;

        for (const [attr, value] of Object.entries(attributes)) {
            if (attr !== 'class' && attr !== 'style') {
                const selector = `[${attr}="${value}"]`;
                if (this.isUniqueSelector(selector, $)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Get the depth of an element in the DOM tree
     * @param {Object} element - Cheerio element
     * @returns {number} Depth level
     */
    getElementDepth(element) {
        let depth = 0;
        let current = element;
        
        while (current.parent().length > 0) {
            depth++;
            current = current.parent();
        }
        
        return depth;
    }

    /**
     * Generate a fallback selector when advanced generation fails
     * @param {Object} element - Cheerio element
     * @returns {Object} Fallback selector info
     */
    generateFallbackSelector(element) {
        const tag = element.prop('tagName')?.toLowerCase() || 'unknown';
        const index = element.index();
        
        return {
            selector: `${tag}:nth-child(${index + 1})`,
            specificity: 1,
            uniqueness: 0.5,
            flexibility: 0.1,
            score: 0.2,
            alternatives: [],
            metadata: {
                elementTag: tag,
                hasId: false,
                hasClass: false,
                hasUniqueAttributes: false,
                depth: 0,
                siblingIndex: index,
                fallback: true
            }
        };
    }

    /**
     * Insert CSS into the document
     * @param {Object} $ - Cheerio instance
     * @param {string} css - CSS to insert
     * @returns {Object} Cheerio instance with CSS inserted
     */
    insertCSS($, css) {
        const head = $('head');
        if (head.length === 0) {
            $('html').prepend('<head></head>');
        }
        
        $('head').append(`<style type="text/css">\n${css}\n</style>`);
        return $;
    }

    /**
     * Convert Cheerio element to DOM-like structure for compatibility
     * @param {Object} element - Cheerio element
     * @param {Object} $ - Cheerio instance
     * @returns {Object} DOM-like element
     */
    cheerioToDOMElement(element, $) {
        // This is a simplified conversion for compatibility with css-selector-generator
        // In practice, we use our own selector generation logic above
        return {
            tagName: element.prop('tagName'),
            attributes: element.attr(),
            parentNode: element.parent().length > 0 ? this.cheerioToDOMElement(element.parent(), $) : null,
            children: element.children().toArray().map(child => this.cheerioToDOMElement($(child), $))
        };
    }

    /**
     * Analyze a website's DOM structure for complexity assessment
     * @param {string} html - HTML content
     * @returns {Object} DOM complexity analysis
     */
    analyzeDOMComplexity(html) {
        const dom = this.parseHTML(html);
        const $ = dom.$;

        const analysis = {
            totalElements: $('*').length,
            maxDepth: 0,
            elementsWithIds: $('[id]').length,
            elementsWithClasses: $('[class]').length,
            duplicateIds: 0,
            semanticElements: 0,
            accessibilityElements: 0,
            complexity: 'low'
        };

        // Calculate max depth
        $('*').each((i, el) => {
            const depth = this.getElementDepth($(el));
            analysis.maxDepth = Math.max(analysis.maxDepth, depth);
        });

        // Check for duplicate IDs
        const ids = {};
        $('[id]').each((i, el) => {
            const id = $(el).attr('id');
            ids[id] = (ids[id] || 0) + 1;
        });
        analysis.duplicateIds = Object.values(ids).filter(count => count > 1).length;

        // Count semantic elements
        const semanticTags = ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer'];
        analysis.semanticElements = semanticTags.reduce((count, tag) => count + $(tag).length, 0);

        // Count accessibility elements
        analysis.accessibilityElements = $('[aria-label], [aria-labelledby], [aria-describedby], [role]').length;

        // Determine complexity
        if (analysis.totalElements > 1000 || analysis.maxDepth > 10 || analysis.duplicateIds > 5) {
            analysis.complexity = 'high';
        } else if (analysis.totalElements > 300 || analysis.maxDepth > 6 || analysis.duplicateIds > 0) {
            analysis.complexity = 'medium';
        }

        return analysis;
    }
}

module.exports = DOMParsingEngine;
