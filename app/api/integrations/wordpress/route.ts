import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { query } from "@/lib/db"

export async function POST(request: Request) {
  try {
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const userId = parseInt(session.user.id)
    const { siteUrl, username, password } = await request.json()

    if (!siteUrl || !username || !password) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      )
    }

    // Store connection in database
    const result = await query(
      `INSERT INTO website_connections (
        user_id, platform_type, website_url, connection_name, 
        connection_status, connection_config
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        userId,
        'wordpress',
        siteUrl,
        `WordPress - ${new URL(siteUrl).hostname}`,
        'active',
        JSON.stringify({ username, password })
      ]
    )

    return NextResponse.json({
      success: true,
      connectionId: result.rows[0].id,
    })
  } catch (error) {
    console.error('WordPress connection error:', error)
    return NextResponse.json(
      { error: "Failed to connect WordPress site" },
      { status: 500 }
    )
  }
}

