import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { authConfig, PKCE_COOKIE, SESSION_COOKIE } from "@/lib/auth"

/**
 * OAuth callback: exchanges the authorization code for tokens, then stores
 * the ID token in an httpOnly session cookie.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")
  const state = request.nextUrl.searchParams.get("state")

  const store = await cookies()
  const pkceRaw = store.get(PKCE_COOKIE)?.value
  store.delete(PKCE_COOKIE)

  let pkce: { verifier: string; state: string } | null = null
  try {
    pkce = pkceRaw ? (JSON.parse(pkceRaw) as { verifier: string; state: string }) : null
  } catch {
    pkce = null
  }

  if (!code || !pkce || pkce.state !== state) {
    return NextResponse.redirect(new URL("/auth/signin?error=state_mismatch", request.url))
  }

  const tokenRes = await fetch(`${authConfig.issuer}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: authConfig.redirectUri,
      client_id: authConfig.clientId,
      code_verifier: pkce.verifier,
    }).toString(),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/auth/signin?error=token_exchange_failed", request.url))
  }

  const tokens = (await tokenRes.json()) as { id_token: string }

  store.set(SESSION_COOKIE, tokens.id_token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60,
  })

  return NextResponse.redirect(new URL("/", request.url))
}
