import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { authConfig, SESSION_COOKIE } from "@/lib/auth"

/**
 * Signs out: clears the local session cookie and redirects to the provider's
 * end-session endpoint (local-auth logout or Cognito logout).
 */
export async function GET(request: NextRequest) {
  const store = await cookies()
  store.delete(SESSION_COOKIE)

  const logoutUrl = new URL(`${authConfig.issuer}/logout`)
  logoutUrl.searchParams.set("post_logout_redirect_uri", authConfig.logoutRedirectUri)
  logoutUrl.searchParams.set("client_id", authConfig.clientId)

  return NextResponse.redirect(logoutUrl)
}
