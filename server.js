const express = require('express');
const puppeteer = require('puppeteer');
const axeCore = require('axe-core');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 8080;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Database connection (optional)
let pool;
try {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });
} catch (error) {
  console.log('No database connection configured');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Scan endpoint
app.post('/api/scan', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  let browser;
  try {
    // Launch browser with specific configuration for Cloud Run
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Set viewport and user agent
    await page.setViewport({ width: 1200, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Navigate to the URL
    await page.goto(url, { 
      waitUntil: 'networkidle0',
      timeout: 30000 
    });

    // Inject axe-core
    await page.addScriptTag({
      content: axeCore.source
    });

    // Run accessibility scan
    const results = await page.evaluate(async () => {
      return await axe.run();
    });

    // Calculate accessibility score
    const totalRules = results.passes.length + results.violations.length + results.incomplete.length;
    const passedRules = results.passes.length;
    const score = totalRules > 0 ? Math.round((passedRules / totalRules) * 100) : 0;

    // Process violations for better display
    const processedViolations = results.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.length,
      tags: violation.tags
    }));

    const scanResult = {
      url,
      timestamp: new Date().toISOString(),
      score,
      summary: {
        violations: results.violations.length,
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length
      },
      violations: processedViolations
    };

    // Store in database if available
    if (pool) {
      try {
        await pool.query(
          'INSERT INTO scans (url, score, violations_count, scan_data, created_at) VALUES ($1, $2, $3, $4, $5)',
          [url, score, results.violations.length, JSON.stringify(scanResult), new Date()]
        );
      } catch (dbError) {
        console.log('Database insert failed:', dbError.message);
      }
    }

    res.json(scanResult);

  } catch (error) {
    console.error('Scan error:', error);
    res.status(500).json({ 
      error: 'Failed to scan website',
      details: error.message 
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

// Main route
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SentryPrime - Enterprise Accessibility Platform</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: #333;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 0 20px;
        }

        .header {
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            position: sticky;
            top: 0;
            z-index: 100;
        }

        .nav {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1rem 0;
        }

        .logo {
            font-size: 1.5rem;
            font-weight: bold;
            color: #667eea;
        }

        .nav-links {
            display: flex;
            list-style: none;
            gap: 2rem;
        }

        .nav-links a {
            text-decoration: none;
            color: #333;
            font-weight: 500;
            transition: color 0.3s;
            cursor: pointer;
        }

        .nav-links a:hover,
        .nav-links a.active {
            color: #667eea;
        }

        .main-content {
            padding: 2rem 0;
        }

        .page {
            display: none;
            background: white;
            border-radius: 12px;
            padding: 2rem;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
            margin-bottom: 2rem;
        }

        .page.active {
            display: block;
        }

        .hero {
            text-align: center;
            padding: 3rem 0;
        }

        .hero h1 {
            font-size: 3rem;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .hero p {
            font-size: 1.2rem;
            color: #666;
            margin-bottom: 2rem;
        }

        .scan-form {
            max-width: 600px;
            margin: 0 auto;
            background: #f8f9fa;
            padding: 2rem;
            border-radius: 8px;
            border: 2px solid #e9ecef;
        }

        .form-group {
            margin-bottom: 1.5rem;
        }

        .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: #333;
        }

        .form-group input {
            width: 100%;
            padding: 0.75rem;
            border: 2px solid #dee2e6;
            border-radius: 6px;
            font-size: 1rem;
            transition: border-color 0.3s;
        }

        .form-group input:focus {
            outline: none;
            border-color: #667eea;
        }

        .btn {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 0.75rem 2rem;
            border-radius: 6px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s;
            width: 100%;
        }

        .btn:hover {
            transform: translateY(-2px);
        }

        .btn:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .loading {
            display: none;
            text-align: center;
            padding: 2rem;
        }

        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .results {
            display: none;
            margin-top: 2rem;
        }

        .score-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem;
            border-radius: 8px;
            text-align: center;
            margin-bottom: 2rem;
        }

        .score {
            font-size: 3rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }

        .score-label {
            font-size: 1.2rem;
            opacity: 0.9;
        }

        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
        }

        .summary-item {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: 8px;
            text-align: center;
            border: 2px solid #e9ecef;
        }

        .summary-number {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 0.5rem;
        }

        .summary-label {
            color: #666;
            font-weight: 500;
        }

        .violations {
            margin-top: 2rem;
        }

        .violation-item {
            background: #fff5f5;
            border: 1px solid #fed7d7;
            border-radius: 8px;
            padding: 1.5rem;
            margin-bottom: 1rem;
        }

        .violation-title {
            font-weight: bold;
            color: #c53030;
            margin-bottom: 0.5rem;
        }

        .violation-description {
            color: #666;
            margin-bottom: 1rem;
        }

        .violation-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.9rem;
            color: #888;
        }

        .impact {
            padding: 0.25rem 0.5rem;
            border-radius: 4px;
            font-weight: 500;
            text-transform: uppercase;
            font-size: 0.8rem;
        }

        .impact.critical { background: #fed7d7; color: #c53030; }
        .impact.serious { background: #feebc8; color: #c05621; }
        .impact.moderate { background: #fefcbf; color: #975a16; }
        .impact.minor { background: #c6f6d5; color: #276749; }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 2rem;
            margin-top: 2rem;
        }

        .stat-card {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            text-align: center;
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            color: #667eea;
            margin-bottom: 0.5rem;
        }

        .stat-label {
            color: #666;
            font-weight: 500;
        }

        .team-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 2rem;
            margin-top: 2rem;
        }

        .team-member {
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            text-align: center;
        }

        .member-avatar {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0 auto 1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5rem;
            font-weight: bold;
        }

        .member-name {
            font-size: 1.2rem;
            font-weight: bold;
            margin-bottom: 0.5rem;
        }

        .member-role {
            color: #666;
            margin-bottom: 1rem;
        }

        .member-email {
            color: #667eea;
            text-decoration: none;
        }

        @media (max-width: 768px) {
            .nav-links {
                gap: 1rem;
            }

            .hero h1 {
                font-size: 2rem;
            }

            .summary {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <header class="header">
        <div class="container">
            <nav class="nav">
                <div class="logo">SentryPrime</div>
                <ul class="nav-links">
                    <li><a href="#" onclick="showPage('dashboard')" class="active">Dashboard</a></li>
                    <li><a href="#" onclick="showPage('scans')">Scans</a></li>
                    <li><a href="#" onclick="showPage('analytics')">Analytics</a></li>
                    <li><a href="#" onclick="showPage('integrations')">Integrations</a></li>
                    <li><a href="#" onclick="showPage('team')">Team</a></li>
                    <li><a href="#" onclick="showPage('settings')">Settings</a></li>
                </ul>
            </nav>
        </div>
    </header>

    <main class="main-content">
        <div class="container">
            <!-- Dashboard Page -->
            <div id="dashboard" class="page active">
                <div class="hero">
                    <h1>Enterprise Accessibility Platform</h1>
                    <p>Comprehensive web accessibility scanning and compliance management for enterprise teams</p>
                </div>

                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">1,247</div>
                        <div class="stat-label">Total Scans</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">94%</div>
                        <div class="stat-label">Average Score</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">156</div>
                        <div class="stat-label">Issues Fixed</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">12</div>
                        <div class="stat-label">Active Projects</div>
                    </div>
                </div>
            </div>

            <!-- Scans Page -->
            <div id="scans" class="page">
                <h2>Website Accessibility Scanner</h2>
                <p>Enter a URL to perform a comprehensive accessibility audit using industry-standard WCAG guidelines.</p>

                <form class="scan-form" onsubmit="startScan(event)">
                    <div class="form-group">
                        <label for="url">Website URL</label>
                        <input 
                            type="url" 
                            id="url" 
                            name="url" 
                            placeholder="https://example.com" 
                            required
                        >
                    </div>
                    <button type="submit" class="btn" id="scanBtn">Start Accessibility Scan</button>
                </form>

                <div class="loading" id="loading">
                    <div class="spinner"></div>
                    <p>Scanning website for accessibility issues...</p>
                </div>

                <div class="results" id="results">
                    <div class="score-card">
                        <div class="score" id="score">--</div>
                        <div class="score-label">Accessibility Score</div>
                    </div>

                    <div class="summary">
                        <div class="summary-item">
                            <div class="summary-number" id="violations-count">--</div>
                            <div class="summary-label">Violations</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number" id="passes-count">--</div>
                            <div class="summary-label">Passes</div>
                        </div>
                        <div class="summary-item">
                            <div class="summary-number" id="incomplete-count">--</div>
                            <div class="summary-label">Incomplete</div>
                        </div>
                    </div>

                    <div class="violations" id="violations-list"></div>
                </div>
            </div>

            <!-- Analytics Page -->
            <div id="analytics" class="page">
                <h2>Analytics Dashboard</h2>
                <p>Comprehensive analytics and reporting for your accessibility compliance efforts.</p>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">89%</div>
                        <div class="stat-label">Compliance Rate</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">342</div>
                        <div class="stat-label">Issues Resolved</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">15</div>
                        <div class="stat-label">Active Monitors</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">7.2</div>
                        <div class="stat-label">Avg. Fix Time (days)</div>
                    </div>
                </div>
            </div>

            <!-- Integrations Page -->
            <div id="integrations" class="page">
                <h2>Platform Integrations</h2>
                <p>Coming soon! Platform integrations will be available here.</p>
            </div>

            <!-- Team Page -->
            <div id="team" class="page">
                <h2>Team Management</h2>
                <p>Manage your accessibility team and assign roles for comprehensive compliance oversight.</p>
                
                <div class="team-grid">
                    <div class="team-member">
                        <div class="member-avatar">JD</div>
                        <div class="member-name">John Doe</div>
                        <div class="member-role">Accessibility Lead</div>
                        <a href="mailto:john@company.com" class="member-email">john@company.com</a>
                    </div>
                    <div class="team-member">
                        <div class="member-avatar">SM</div>
                        <div class="member-name">Sarah Miller</div>
                        <div class="member-role">UX Designer</div>
                        <a href="mailto:sarah@company.com" class="member-email">sarah@company.com</a>
                    </div>
                    <div class="team-member">
                        <div class="member-avatar">MJ</div>
                        <div class="member-name">Mike Johnson</div>
                        <div class="member-role">Developer</div>
                        <a href="mailto:mike@company.com" class="member-email">mike@company.com</a>
                    </div>
                </div>
            </div>

            <!-- Settings Page -->
            <div id="settings" class="page">
                <h2>Settings</h2>
                <p>Configure your accessibility scanning preferences and compliance requirements.</p>
                
                <div class="stats-grid">
                    <div class="stat-card">
                        <div class="stat-number">WCAG 2.1</div>
                        <div class="stat-label">Compliance Standard</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">AA</div>
                        <div class="stat-label">Target Level</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">Daily</div>
                        <div class="stat-label">Scan Frequency</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-number">Enabled</div>
                        <div class="stat-label">Auto-Remediation</div>
                    </div>
                </div>
            </div>
        </div>
    </main>

    <script>
        function showPage(pageId) {
            // Hide all pages
            document.querySelectorAll('.page').forEach(page => {
                page.classList.remove('active');
            });
            
            // Remove active class from all nav links
            document.querySelectorAll('.nav-links a').forEach(link => {
                link.classList.remove('active');
            });
            
            // Show selected page
            document.getElementById(pageId).classList.add('active');
            
            // Add active class to clicked nav link
            event.target.classList.add('active');
        }

        async function startScan(event) {
            event.preventDefault();
            
            const url = document.getElementById('url').value;
            const scanBtn = document.getElementById('scanBtn');
            const loading = document.getElementById('loading');
            const results = document.getElementById('results');
            
            // Reset UI
            scanBtn.disabled = true;
            scanBtn.textContent = 'Scanning...';
            loading.style.display = 'block';
            results.style.display = 'none';
            
            try {
                const response = await fetch('/api/scan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ url })
                });
                
                const data = await response.json();
                
                if (response.ok) {
                    displayResults(data);
                } else {
                    throw new Error(data.error || 'Scan failed');
                }
            } catch (error) {
                alert('Scan failed: ' + error.message);
            } finally {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Start Accessibility Scan';
                loading.style.display = 'none';
            }
        }
        
        function displayResults(data) {
            // Update score
            document.getElementById('score').textContent = data.score;
            
            // Update summary
            document.getElementById('violations-count').textContent = data.summary.violations;
            document.getElementById('passes-count').textContent = data.summary.passes;
            document.getElementById('incomplete-count').textContent = data.summary.incomplete;
            
            // Display violations
            const violationsList = document.getElementById('violations-list');
            violationsList.innerHTML = '';
            
            if (data.violations.length > 0) {
                const violationsTitle = document.createElement('h3');
                violationsTitle.textContent = 'Accessibility Violations';
                violationsList.appendChild(violationsTitle);
                
                data.violations.forEach(violation => {
                    const violationDiv = document.createElement('div');
                    violationDiv.className = 'violation-item';
                    
                    violationDiv.innerHTML = `
                        <div class="violation-title">${violation.help}</div>
                        <div class="violation-description">${violation.description}</div>
                        <div class="violation-meta">
                            <span class="impact ${violation.impact}">${violation.impact}</span>
                            <span>${violation.nodes} element(s) affected</span>
                            <a href="${violation.helpUrl}" target="_blank">Learn more</a>
                        </div>
                    `;
                    
                    violationsList.appendChild(violationDiv);
                });
            } else {
                violationsList.innerHTML = '<p style="text-align: center; color: #28a745; font-weight: bold;">🎉 No accessibility violations found!</p>';
            }
            
            // Show results
            document.getElementById('results').style.display = 'block';
        }
    </script>
</body>
</html>
  `);
});

app.listen(port, () => {
  console.log(`SentryPrime server running on port ${port}`);
});
