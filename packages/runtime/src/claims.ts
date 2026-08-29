/**
 * The normalized token claim contract.
 *
 * Both Amazon Cognito and `@cognito-kit/local-auth` emit ID tokens that carry
 * these claims. Applications should read identity from this contract and never
 * depend on provider-specific internals.
 */

export interface TokenClaims {
  /** Subject — the canonical, immutable user id (Cognito `sub`). */
  sub?: string
  iss?: string
  aud?: string | string[]
  exp?: number
  iat?: number
  nbf?: number
  jti?: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
  [claim: string]: unknown
}

export const STANDARD_CLAIMS = [
  "sub",
  "iss",
  "aud",
  "exp",
  "iat",
  "nbf",
  "jti",
  "email",
  "email_verified",
  "name",
  "preferred_username",
] as const
