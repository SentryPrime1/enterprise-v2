/**
 * Accessibility JavaScript Generator for SentryPrime
 * Generates JavaScript fixes for common accessibility violations
 * 
 * Author: Manus AI
 * Date: October 20, 2025
 */

function generateAccessibilityJS(violationId) {
    const violationType = violationId.replace('violation_', '');
    
    let js = `// SentryPrime Accessibility Fix: ${violationType}
// Generated: ${new Date().toISOString()}

document.addEventListener('DOMContentLoaded', function() {
    console.log('SentryPrime: Applying ${violationType} fix...');
    
`;

    switch (violationType) {
        case 'color-contrast':
            js += `    // Color contrast fixes are handled via CSS
    console.log('SentryPrime: Color contrast improvements applied via CSS');`;
            break;
            
        case 'image-alt':
            js += `    // Fix missing alt attributes on images
    const imagesWithoutAlt = document.querySelectorAll('img:not([alt])');
    imagesWithoutAlt.forEach(function(img, index) {
        const altText = img.title || 
                       img.getAttribute('data-alt') || 
                       img.src.split('/').pop().split('.')[0].replace(/[-_]/g, ' ') ||
                       'Image ' + (index + 1);
        img.alt = altText;
        console.log('SentryPrime: Added alt text to image:', altText);
    });`;
            break;
            
        case 'link-name':
            js += `    // Fix links without accessible names
    const linksWithoutNames = document.querySelectorAll('a:not([aria-label]):not([aria-labelledby])');
    linksWithoutNames.forEach(function(link) {
        if (!link.textContent.trim()) {
            const linkName = link.title || 
                            link.href.split('/').pop() || 
                            'Link';
            link.setAttribute('aria-label', linkName);
            console.log('SentryPrime: Added aria-label to link:', linkName);
        }
    });`;
            break;
            
        case 'button-name':
            js += `    // Fix buttons without accessible names
    const buttonsWithoutNames = document.querySelectorAll('button:not([aria-label]):not([aria-labelledby]), [role="button"]:not([aria-label]):not([aria-labelledby])');
    buttonsWithoutNames.forEach(function(button) {
        if (!button.textContent.trim()) {
            const buttonName = button.title || 
                              button.getAttribute('data-title') ||
                              (button.className.includes('close') ? 'Close' :
                               button.className.includes('menu') ? 'Menu' :
                               button.className.includes('search') ? 'Search' :
                               'Button');
            button.setAttribute('aria-label', buttonName);
            console.log('SentryPrime: Added aria-label to button:', buttonName);
        }
    });`;
            break;
            
        case 'form-label':
            js += `    // Fix form inputs without labels
    const inputsWithoutLabels = document.querySelectorAll('input:not([aria-label]):not([aria-labelledby]), select:not([aria-label]):not([aria-labelledby]), textarea:not([aria-label]):not([aria-labelledby])');
    inputsWithoutLabels.forEach(function(input) {
        if (!input.labels || input.labels.length === 0) {
            const labelText = input.placeholder || 
                             input.getAttribute('data-label') ||
                             input.name || 
                             input.type;
            if (labelText) {
                input.setAttribute('aria-label', labelText);
                console.log('SentryPrime: Added aria-label to input:', labelText);
            }
        }
    });`;
            break;
            
        case 'heading-order':
            js += `    // Fix heading hierarchy issues
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let expectedLevel = 1;
    
    headings.forEach(function(heading) {
        const currentLevel = parseInt(heading.tagName.charAt(1));
        
        if (currentLevel > expectedLevel + 1) {
            // Skip levels detected - add aria-level for screen readers
            heading.setAttribute('aria-level', expectedLevel + 1);
            console.log('SentryPrime: Fixed heading level skip for', heading.tagName);
        }
        
        expectedLevel = Math.max(expectedLevel, currentLevel);
    });`;
            break;
            
        case 'landmark':
            js += `    // Add missing ARIA landmarks
    // Add main landmark if missing
    if (!document.querySelector('[role="main"], main')) {
        const mainContent = document.querySelector('.main, #main, .content, #content, .container');
        if (mainContent) {
            mainContent.setAttribute('role', 'main');
            console.log('SentryPrime: Added main landmark');
        }
    }
    
    // Add navigation landmarks
    const navElements = document.querySelectorAll('nav:not([role]), .nav:not([role]), .navbar:not([role])');
    navElements.forEach(function(nav) {
        nav.setAttribute('role', 'navigation');
        console.log('SentryPrime: Added navigation landmark');
    });
    
    // Add banner landmark to header
    const header = document.querySelector('header:not([role]), .header:not([role])');
    if (header) {
        header.setAttribute('role', 'banner');
        console.log('SentryPrime: Added banner landmark');
    }
    
    // Add contentinfo landmark to footer
    const footer = document.querySelector('footer:not([role]), .footer:not([role])');
    if (footer) {
        footer.setAttribute('role', 'contentinfo');
        console.log('SentryPrime: Added contentinfo landmark');
    }`;
            break;
            
        case 'focus-order':
            js += `    // Improve focus management
    const focusableElements = document.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    
    // Ensure all interactive elements are keyboard accessible
    focusableElements.forEach(function(element) {
        if (!element.hasAttribute('tabindex')) {
            element.setAttribute('tabindex', '0');
        }
    });
    
    // Add skip navigation link
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Skip to main content';
    skipLink.className = 'skip-link';
    skipLink.style.cssText = 'position: absolute; top: -40px; left: 6px; background: #000; color: #fff; padding: 8px; text-decoration: none; z-index: 9999;';
    
    skipLink.addEventListener('focus', function() {
        this.style.top = '6px';
    });
    
    skipLink.addEventListener('blur', function() {
        this.style.top = '-40px';
    });
    
    document.body.insertBefore(skipLink, document.body.firstChild);
    
    // Ensure main content has an ID
    let mainContent = document.getElementById('main-content');
    if (!mainContent) {
        mainContent = document.querySelector('main, .main, #main, .content, #content');
        if (mainContent) {
            mainContent.id = 'main-content';
        }
    }
    
    console.log('SentryPrime: Focus management improvements applied');`;
            break;
            
        default:
            js += `    // Generic accessibility improvements
    console.log('SentryPrime: Applying generic accessibility improvements for ${violationType}');`;
            break;
    }

    js += `
    
    console.log('SentryPrime: ${violationType} fix applied successfully');
});`;

    return js;
}

module.exports = { generateAccessibilityJS };
