import type { TokenClaims } from "./claims.js"

/**
 * The normalized authenticated user.
 *
 * Applications should depend on this shape — never on Cognito-specific or
 * local-auth-specific token internals. It is identical regardless of whether
 * the token came from local-auth, Cognito, or another OIDC provider.
 */
export interface AuthenticatedUser {
  /** Canonical, immutable identity (the token `sub`). */
  id: string
  email?: string
  emailVerified?: boolean
  /** Full verified claims (minus nothing — callers may inspect extras). */
  claims: TokenClaims
}

/**
 * Converts verified token claims into the normalized {@link AuthenticatedUser}.
 */
export function normalizeUser(payload: TokenClaims): AuthenticatedUser {
  return {
    id: String(payload.sub ?? ""),
    email: typeof payload.email === "string" ? payload.email : undefined,
    emailVerified: typeof payload.email_verified === "boolean" ? payload.email_verified : undefined,
    claims: { ...payload },
  }
}

/** True when the payload carries a usable `sub`. */
export function hasIdentity(payload: TokenClaims): boolean {
  return typeof payload.sub === "string" && payload.sub.length > 0
}
