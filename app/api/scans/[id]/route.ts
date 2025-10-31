import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { query } from "@/lib/db"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = parseInt(session.user.id)
    const scanId = parseInt(id)

    // Get scan details
    const scanResult = await query(
      `SELECT * FROM scans WHERE id = $1 AND user_id = $2`,
      [scanId, userId]
    )

    if (scanResult.rows.length === 0) {
      return NextResponse.json({ error: "Scan not found" }, { status: 404 })
    }

    const scan = scanResult.rows[0]

    // Get violations for this scan
    const violationsResult = await query(
      `SELECT * FROM violations WHERE scan_id = $1 ORDER BY 
       CASE impact 
         WHEN 'critical' THEN 1
         WHEN 'serious' THEN 2
         WHEN 'moderate' THEN 3
         WHEN 'minor' THEN 4
         ELSE 5
       END`,
      [scanId]
    )

    return NextResponse.json({
      ...scan,
      violations: violationsResult.rows,
    })
  } catch (error) {
    console.error('Get scan error:', error)
    return NextResponse.json(
      { error: "Failed to fetch scan" },
      { status: 500 }
    )
  }
}

