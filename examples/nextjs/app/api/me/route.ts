import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth"

/** Protected API route: returns the normalized authenticated user. */
export async function GET() {
  const store = await cookies()
  const user = await verifySessionToken(store.get(SESSION_COOKIE)?.value)

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  return NextResponse.json({ user })
}
