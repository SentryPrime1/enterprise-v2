import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { query } from "@/lib/db"

export async function GET() {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = parseInt(session.user.id)

    const result = await query(
      `SELECT 
        id, url, total_violations, critical_count, serious_count, 
        moderate_count, minor_count, created_at
       FROM scans 
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    )

    return NextResponse.json(result.rows)
  } catch (error) {
    console.error('List scans error:', error)
    return NextResponse.json(
      { error: "Failed to fetch scans" },
      { status: 500 }
    )
  }
}

