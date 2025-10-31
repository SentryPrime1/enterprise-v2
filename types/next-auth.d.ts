import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      tier: string
      company?: string
    } & DefaultSession["user"]
  }

  interface User {
    tier?: string
    company?: string
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string
    tier?: string
    company?: string
  }
}

