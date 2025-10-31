import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { query } from "@/lib/db"
import { scanPage, scanMultiplePages } from "@/lib/scanner"

export async function POST(request: Request) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = parseInt(session.user.id)
    const { url, scanType, maxPages } = await request.json()

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 })
    }

    // Validate URL
    try {
      new URL(url)
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
    }

    const startTime = Date.now()

    // Perform scan
    let scanResults
    if (scanType === 'multi-page') {
      scanResults = await scanMultiplePages(url, maxPages || 10)
    } else {
      const result = await scanPage(url)
      scanResults = [result]
    }

    const scanDuration = Date.now() - startTime

    // Aggregate results
    const totalViolations = scanResults.reduce((sum, r) => sum + r.summary.total, 0)
    const criticalCount = scanResults.reduce((sum, r) => sum + r.summary.critical, 0)
    const seriousCount = scanResults.reduce((sum, r) => sum + r.summary.serious, 0)
    const moderateCount = scanResults.reduce((sum, r) => sum + r.summary.moderate, 0)
    const minorCount = scanResults.reduce((sum, r) => sum + r.summary.minor, 0)

    // Save scan to database
    const scanResult = await query(
      `INSERT INTO scans (
        user_id, url, total_violations, critical_count, serious_count, 
        moderate_count, minor_count, scan_duration, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        userId,
        url,
        totalViolations,
        criticalCount,
        seriousCount,
        moderateCount,
        minorCount,
        scanDuration,
        'completed'
      ]
    )

    const scanId = scanResult.rows[0].id

    // Save violations to database
    for (const pageResult of scanResults) {
      for (const violation of pageResult.violations) {
        for (const node of violation.nodes) {
          await query(
            `INSERT INTO violations (
              scan_id, violation_id, description, impact, help, help_url, 
              selector, html, target
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              scanId,
              violation.id,
              violation.description,
              violation.impact,
              violation.help,
              violation.helpUrl,
              node.target.join(', '),
              node.html,
              node.target
            ]
          )
        }
      }
    }

    return NextResponse.json({
      success: true,
      scanId,
      summary: {
        totalViolations,
        critical: criticalCount,
        serious: seriousCount,
        moderate: moderateCount,
        minor: minorCount,
      },
      pagesScanned: scanResults.length,
      duration: scanDuration,
    })
  } catch (error) {
    console.error('Scan error:', error)
    return NextResponse.json(
      { error: "Failed to perform scan" },
      { status: 500 }
    )
  }
}

