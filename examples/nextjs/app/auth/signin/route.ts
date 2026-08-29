import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import {
  authorizationUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  PKCE_COOKIE,
  randomNonce,
} from "@/lib/auth"

/**
 * Starts the authorization-code + PKCE flow:
 * 1. stores the code verifier in an httpOnly cookie
 * 2. redirects to the local-auth (or Cognito) authorization endpoint
 */
export async function GET() {
  const store = await cookies()
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = randomNonce()

  store.set(PKCE_COOKIE, JSON.stringify({ verifier, state }), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  })

  return NextResponse.redirect(authorizationUrl(challenge, state))
}
