import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { query } from "@/lib/db"
import { formatDate, calculateComplianceScore } from "@/lib/utils"

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = parseInt(session.user.id)

    // Get total scans
    const totalScansResult = await query(
      'SELECT COUNT(*) as count FROM scans WHERE user_id = $1',
      [userId]
    )
    const totalScans = parseInt(totalScansResult.rows[0]?.count || '0')

    // Get total issues
    const totalIssuesResult = await query(
      `SELECT SUM(total_violations) as total 
       FROM scans 
       WHERE user_id = $1`,
      [userId]
    )
    const totalIssues = parseInt(totalIssuesResult.rows[0]?.total || '0')

    // Get average score
    const avgScoreResult = await query(
      `SELECT 
        AVG(critical_count) as avg_critical,
        AVG(serious_count) as avg_serious,
        AVG(moderate_count) as avg_moderate,
        AVG(minor_count) as avg_minor
       FROM scans 
       WHERE user_id = $1`,
      [userId]
    )
    
    const avgRow = avgScoreResult.rows[0]
    const averageScore = calculateComplianceScore({
      critical: parseFloat(avgRow?.avg_critical || '0'),
      serious: parseFloat(avgRow?.avg_serious || '0'),
      moderate: parseFloat(avgRow?.avg_moderate || '0'),
      minor: parseFloat(avgRow?.avg_minor || '0'),
    })

    // Get recent scans
    const recentScansResult = await query(
      `SELECT 
        id, 
        url, 
        total_violations,
        critical_count,
        serious_count,
        moderate_count,
        minor_count,
        created_at
       FROM scans 
       WHERE user_id = $1
       ORDER BY created_at DESC 
       LIMIT 5`,
      [userId]
    )

    const recentScans = recentScansResult.rows.map(scan => ({
      id: scan.id,
      url: scan.url,
      score: calculateComplianceScore({
        critical: scan.critical_count,
        serious: scan.serious_count,
        moderate: scan.moderate_count,
        minor: scan.minor_count,
      }),
      date: formatDate(scan.created_at),
      violations: scan.total_violations,
    }))

    return NextResponse.json({
      totalScans,
      totalIssues,
      averageScore,
      recentScans,
    })
  } catch (error) {
    console.error('Dashboard stats error:', error)
    return NextResponse.json(
      { error: "Failed to fetch dashboard stats" },
      { status: 500 }
    )
  }
}

