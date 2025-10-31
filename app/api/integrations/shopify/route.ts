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
    const { shopUrl, accessToken } = await request.json()

    if (!shopUrl || !accessToken) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      )
    }

    // Ensure shop URL has proper format
    const formattedShopUrl = shopUrl.includes('myshopify.com') 
      ? shopUrl 
      : `${shopUrl}.myshopify.com`

    // Store connection in database
    const result = await query(
      `INSERT INTO website_connections (
        user_id, platform_type, website_url, connection_name, 
        connection_status, connection_config
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        userId,
        'shopify',
        `https://${formattedShopUrl}`,
        `Shopify - ${formattedShopUrl}`,
        'active',
        JSON.stringify({ accessToken })
      ]
    )

    return NextResponse.json({
      success: true,
      connectionId: result.rows[0].id,
    })
  } catch (error) {
    console.error('Shopify connection error:', error)
    return NextResponse.json(
      { error: "Failed to connect Shopify store" },
      { status: 500 }
    )
  }
}

