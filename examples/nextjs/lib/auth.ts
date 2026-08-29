import { createHash, randomBytes } from "node:crypto"
import { createRemoteTokenVerifier, normalizeUser } from "@cognito-kit/runtime"
import type { AuthenticatedUser } from "@cognito-kit/runtime"

/**
 * Shared auth configuration and verification helpers for the Next.js example.
 *
 * The same code works against `cognito-kit dev` locally and against Amazon
 * Cognito in production — only the environment variables change.
 */

export const authConfig = {
  issuer: process.env.CK_ISSUER ?? "http://localhost:9876",
  clientId: process.env.CK_CLIENT_ID ?? "dev-client",
  redirectUri: process.env.CK_REDIRECT_URI ?? "http://localhost:3000/auth/callback",
  jwksUrl: process.env.CK_JWKS_URL ?? "http://localhost:9876/.well-known/jwks.json",
  logoutRedirectUri: process.env.CK_LOGOUT_REDIRECT_URI ?? "http://localhost:3000",
}

export const SESSION_COOKIE = "ck_session"
export const PKCE_COOKIE = "ck_pkce"

let verifier: ReturnType<typeof createRemoteTokenVerifier> | undefined

export function getVerifier() {
  if (!verifier) {
    verifier = createRemoteTokenVerifier({
      issuer: authConfig.issuer,
      jwksUrl: authConfig.jwksUrl,
      audience: authConfig.clientId,
    })
  }
  return verifier
}

export function authorizationUrl(codeChallenge: string, state: string): string {
  const url = new URL(`${authConfig.issuer}/authorize`)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", authConfig.clientId)
  url.searchParams.set("redirect_uri", authConfig.redirectUri)
  url.searchParams.set("scope", "openid email profile")
  url.searchParams.set("state", state)
  url.searchParams.set("nonce", randomNonce())
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

export function randomNonce(): string {
  return crypto.randomUUID()
}

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url")
}

export async function verifySessionToken(
  token: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!token) return null
  try {
    const { payload } = await getVerifier().verify(token)
    return normalizeUser(payload)
  } catch {
    return null
  }
}
