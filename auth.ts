import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { query } from "@/lib/db"

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        try {
          const result = await query(
            'SELECT * FROM users WHERE email = $1',
            [credentials.email as string]
          )

          if (result.rows.length === 0) {
            return null
          }

          const user = result.rows[0]

          const passwordMatch = await bcrypt.compare(
            credentials.password as string,
            user.password_hash
          )

          if (!passwordMatch) {
            return null
          }

          // Update last login
          await query(
            'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1',
            [user.id]
          )

          return {
            id: user.id.toString(),
            email: user.email,
            name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
            tier: user.user_tier,
            company: user.company_name
          }
        } catch (error) {
          console.error('Auth error:', error)
          return null
        }
      }
    })
  ],
  pages: {
    signIn: "/login",
    signOut: "/login",
    error: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.tier = user.tier
        token.company = user.company
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.tier = token.tier as string
        session.user.company = token.company as string
      }
      return session
    }
  }
})

