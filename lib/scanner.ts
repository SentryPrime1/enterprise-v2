import puppeteer from 'puppeteer';
import { AxeResults } from 'axe-core';

export interface ScanResult {
  url: string;
  violations: Array<{
    id: string;
    impact: string;
    description: string;
    help: string;
    helpUrl: string;
    nodes: Array<{
      html: string;
      target: string[];
      failureSummary?: string;
    }>;
  }>;
  summary: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
    total: number;
  };
  timestamp: Date;
}

export async function scanPage(url: string): Promise<ScanResult> {
  let browser;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Inject axe-core
    await page.addScriptTag({
      path: require.resolve('axe-core'),
    });

    // Run axe accessibility scan
    const results = await page.evaluate(() => {
      return new Promise((resolve) => {
        // @ts-ignore
        axe.run((err: any, results: any) => {
          if (err) throw err;
          resolve(results);
        });
      });
    }) as AxeResults;

    // Process violations
    const violations: ScanResult['violations'] = results.violations.map(violation => ({
      id: violation.id,
      impact: violation.impact || 'minor',
      description: violation.description,
      help: violation.help,
      helpUrl: violation.helpUrl,
      nodes: violation.nodes.map(node => ({
        html: node.html,
        target: Array.isArray(node.target) ? node.target : [String(node.target)],
        failureSummary: node.failureSummary,
      })) as Array<{ html: string; target: string[]; failureSummary?: string }>,
    })) as ScanResult['violations'];

    // Calculate summary
    const summary = {
      critical: violations.filter(v => v.impact === 'critical').length,
      serious: violations.filter(v => v.impact === 'serious').length,
      moderate: violations.filter(v => v.impact === 'moderate').length,
      minor: violations.filter(v => v.impact === 'minor').length,
      total: violations.length,
    };

    return {
      url,
      violations,
      summary,
      timestamp: new Date(),
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export async function scanMultiplePages(
  baseUrl: string,
  maxPages: number = 10
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  const visitedUrls = new Set<string>();
  const urlsToVisit = [baseUrl];

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    while (urlsToVisit.length > 0 && results.length < maxPages) {
      const url = urlsToVisit.shift()!;
      
      if (visitedUrls.has(url)) continue;
      visitedUrls.add(url);

      try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Inject axe-core
        await page.addScriptTag({
          path: require.resolve('axe-core'),
        });

        // Run axe scan
        const axeResults = await page.evaluate(() => {
          return new Promise((resolve) => {
            // @ts-ignore
            axe.run((err: any, results: any) => {
              if (err) throw err;
              resolve(results);
            });
          });
        }) as AxeResults;

        // Process violations
        const violations: ScanResult['violations'] = axeResults.violations.map(violation => ({
          id: violation.id,
          impact: violation.impact || 'minor',
          description: violation.description,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodes: violation.nodes.map(node => ({
            html: node.html,
            target: Array.isArray(node.target) ? node.target : [String(node.target)],
            failureSummary: node.failureSummary,
          })) as Array<{ html: string; target: string[]; failureSummary?: string }>,
        })) as ScanResult['violations'];

        const summary = {
          critical: violations.filter(v => v.impact === 'critical').length,
          serious: violations.filter(v => v.impact === 'serious').length,
          moderate: violations.filter(v => v.impact === 'moderate').length,
          minor: violations.filter(v => v.impact === 'minor').length,
          total: violations.length,
        };

        results.push({
          url,
          violations,
          summary,
          timestamp: new Date(),
        });

        // Extract links for crawling
        if (results.length < maxPages) {
          const links = await page.evaluate((baseUrl) => {
            const anchors = Array.from(document.querySelectorAll('a[href]'));
            return anchors
              .map(a => (a as HTMLAnchorElement).href)
              .filter(href => {
                try {
                  const linkUrl = new URL(href);
                  const baseUrlObj = new URL(baseUrl);
                  return linkUrl.origin === baseUrlObj.origin;
                } catch {
                  return false;
                }
              });
          }, baseUrl);

          links.forEach(link => {
            if (!visitedUrls.has(link) && !urlsToVisit.includes(link)) {
              urlsToVisit.push(link);
            }
          });
        }

        await page.close();
      } catch (error) {
        console.error(`Failed to scan ${url}:`, error);
      }
    }

    return results;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

