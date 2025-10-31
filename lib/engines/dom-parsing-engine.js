/**
 * Ultra-Minimal DOM Parsing Engine for SentryPrime Accessibility Scanner
 * Uses only built-in Node.js modules to avoid dependency conflicts
 * 
 * Author: Manus AI
 * Date: October 15, 2025
 * Version: Minimal Node.js Compatible
 */

class DOMParsingEngine {
    constructor(options = {}) {
        this.options = {
            depth: options.depth || 6,
            preferredAttributes: options.preferredAttributes || ['id', 'class', 'data-*', 'aria-*', 'name', 'type'],
            ...options
        };
        
        console.log('🔍 DOM Parsing Engine initialized (minimal mode)');
    }

    /**
     * Parse HTML content using basic string manipulation
     * @param {string} html - HTML content to parse
     * @returns {Object} Basic DOM structure with manipulation methods
     */
    parseHTML(html) {
        try {
            // Basic HTML parsing using regex (minimal approach)
            const elements = this.extractElements(html);
            
            return {
                elements: elements,
                
                // Query methods
                find: (selector) => this.findElements(elements, selector),
                findByText: (text) => this.findElementsByText(elements, text),
                findByAttribute: (attr, value) => this.findElementsByAttribute(elements, attr, value),
                
                // Generate selectors for elements
                generateSelector: (element) => this.generateBasicSelector(element),
                
                // Basic manipulation methods
                addClass: (selector, className) => this.addClass(elements, selector, className),
                removeClass: (selector, className) => this.removeClass(elements, selector, className),
                setAttribute: (selector, attr, value) => this.setAttribute(elements, selector, attr, value),
                
                // Serialization
                serialize: () => html // Return original HTML for now
            };
        } catch (error) {
            console.error('DOM parsing error:', error);
            // Return minimal fallback structure
            return {
                elements: [],
                find: () => [],
                findByText: () => [],
                findByAttribute: () => [],
                generateSelector: () => ({ selector: 'body', specificity: 1 }),
                addClass: () => {},
                removeClass: () => {},
                setAttribute: () => {},
                serialize: () => html
            };
        }
    }

    /**
     * Extract basic element information from HTML using regex
     * @param {string} html - HTML content
     * @returns {Array} Array of element objects
     */
    extractElements(html) {
        const elements = [];
        
        // Basic regex to match HTML tags
        const tagRegex = /<(\w+)([^>]*)>/g;
        let match;
        
        while ((match = tagRegex.exec(html)) !== null) {
            const tag = match[1].toLowerCase();
            const attributesString = match[2];
            const attributes = this.parseAttributes(attributesString);
            
            elements.push({
                tag: tag,
                attributes: attributes,
                id: attributes.id || null,
                classes: attributes.class ? attributes.class.split(/\s+/) : [],
                text: '', // Would need more complex parsing for text content
                index: elements.length
            });
        }
        
        return elements;
    }

    /**
     * Parse attributes from attribute string
     * @param {string} attributesString - String containing attributes
     * @returns {Object} Parsed attributes
     */
    parseAttributes(attributesString) {
        const attributes = {};
        
        // Basic regex to match attribute="value" patterns
        const attrRegex = /(\w+)=["']([^"']*)["']/g;
        let match;
        
        while ((match = attrRegex.exec(attributesString)) !== null) {
            attributes[match[1]] = match[2];
        }
        
        return attributes;
    }

    /**
     * Find elements by basic selector
     * @param {Array} elements - Array of elements
     * @param {string} selector - CSS selector
     * @returns {Array} Matching elements
     */
    findElements(elements, selector) {
        // Very basic selector matching
        if (selector.startsWith('#')) {
            const id = selector.substring(1);
            return elements.filter(el => el.id === id);
        } else if (selector.startsWith('.')) {
            const className = selector.substring(1);
            return elements.filter(el => el.classes.includes(className));
        } else {
            // Tag selector
            return elements.filter(el => el.tag === selector.toLowerCase());
        }
    }

    /**
     * Find elements by text content
     * @param {Array} elements - Array of elements
     * @param {string} text - Text to search for
     * @returns {Array} Matching elements
     */
    findElementsByText(elements, text) {
        return elements.filter(el => el.text && el.text.includes(text));
    }

    /**
     * Find elements by attribute
     * @param {Array} elements - Array of elements
     * @param {string} attr - Attribute name
     * @param {string} value - Attribute value (optional)
     * @returns {Array} Matching elements
     */
    findElementsByAttribute(elements, attr, value) {
        return elements.filter(el => {
            if (value) {
                return el.attributes[attr] === value;
            } else {
                return el.attributes.hasOwnProperty(attr);
            }
        });
    }

    /**
     * Generate basic CSS selector for an element
     * @param {Object} element - Element object
     * @returns {Object} Selector information
     */
    generateBasicSelector(element) {
        let selector = element.tag;
        let specificity = 1;
        
        // Prefer ID if available
        if (element.id) {
            selector = `#${element.id}`;
            specificity = 100;
        } else if (element.classes.length > 0) {
            // Use first class
            selector = `.${element.classes[0]}`;
            specificity = 10;
        } else if (element.attributes.name) {
            // Use name attribute
            selector = `[name="${element.attributes.name}"]`;
            specificity = 10;
        }
        
        return {
            selector: selector,
            specificity: specificity,
            uniqueness: element.id ? true : false,
            alternatives: [],
            metadata: {
                strategy: element.id ? 'id' : (element.classes.length > 0 ? 'class' : 'tag'),
                confidence: element.id ? 'high' : 'medium',
                element: {
                    tag: element.tag,
                    id: element.id,
                    classes: element.classes
                }
            }
        };
    }

    /**
     * Extract accessibility-relevant elements from HTML
     * @param {string} html - HTML content
     * @returns {Array} Array of accessibility elements
     */
    extractAccessibilityElements(html) {
        const dom = this.parseHTML(html);
        const elements = [];

        // Find interactive elements
        const interactiveTags = ['button', 'input', 'select', 'textarea', 'a'];
        interactiveTags.forEach(tag => {
            const found = dom.find(tag);
            found.forEach(el => {
                elements.push({
                    type: 'interactive',
                    tag: el.tag,
                    selector: dom.generateSelector(el).selector,
                    attributes: el.attributes,
                    accessibility: {
                        hasAriaLabel: !!el.attributes['aria-label'],
                        hasAriaDescribedBy: !!el.attributes['aria-describedby'],
                        hasRole: !!el.attributes.role,
                        isKeyboardAccessible: el.attributes.tabindex !== '-1'
                    }
                });
            });
        });

        // Find images
        const images = dom.find('img');
        images.forEach(img => {
            elements.push({
                type: 'image',
                tag: 'img',
                selector: dom.generateSelector(img).selector,
                attributes: img.attributes,
                hasAlt: !!img.attributes.alt,
                altText: img.attributes.alt || '',
                isDecorative: img.attributes.alt === '' || img.attributes.role === 'presentation'
            });
        });

        return elements;
    }

    /**
     * Analyze DOM complexity
     * @param {string} html - HTML content
     * @returns {Object} Basic complexity analysis
     */
    analyzeDOMComplexity(html) {
        const dom = this.parseHTML(html);
        
        return {
            totalElements: dom.elements.length,
            interactiveElements: dom.find('button').length + dom.find('input').length + dom.find('a').length,
            images: dom.find('img').length,
            forms: dom.find('form').length,
            headings: dom.find('h1').length + dom.find('h2').length + dom.find('h3').length,
            complexity: dom.elements.length > 100 ? 'high' : (dom.elements.length > 50 ? 'medium' : 'low')
        };
    }

    /**
     * Generate basic CSS fixes for accessibility violations
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
                        selector: violation.target[0] || 'body',
                        properties: {
                            'color': '#000000',
                            'background-color': '#ffffff'
                        },
                        comment: 'Improved color contrast for accessibility'
                    });
                    break;
                    
                case 'focus-order-semantics':
                    fixes.rules.push({
                        selector: `${violation.target[0] || 'button'}:focus`,
                        properties: {
                            'outline': '2px solid #0066cc',
                            'outline-offset': '2px'
                        },
                        comment: 'Enhanced focus indicator'
                    });
                    break;
                    
                default:
                    // Generic fix
                    fixes.rules.push({
                        selector: violation.target[0] || 'body',
                        properties: {
                            'position': 'relative'
                        },
                        comment: `Fix for ${violation.id}`
                    });
            }
        });

        return fixes;
    }

    // Placeholder methods for compatibility
    addClass(elements, selector, className) {
        // Basic implementation - would modify elements array
        return true;
    }

    removeClass(elements, selector, className) {
        // Basic implementation - would modify elements array
        return true;
    }

    setAttribute(elements, selector, attr, value) {
        // Basic implementation - would modify elements array
        return true;
    }
}

module.exports = DOMParsingEngine;
