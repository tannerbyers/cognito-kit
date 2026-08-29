import { exportJWK, generateKeyPair, SignJWT } from "jose"
import type { JWK, KeyLike } from "jose"

export const TEST_ISSUER = "http://localhost:9876"
export const TEST_AUDIENCE = "dev-client"

export interface TestTokenOptions {
  sub?: string
  email?: string
  emailVerified?: boolean
  claims?: Record<string, unknown>
  issuer?: string
  audience?: string | string[]
  expiresIn?: string | number
  privateKey?: KeyLike
  /** When a private key is not provided, one is generated per call. */
  includeAccessToken?: boolean
}

export interface TestTokenResult {
  idToken: string
  accessToken?: string
  /** The JWKS that verifies these tokens. */
  jwks: { keys: JWK[] }
  /** The signing key (for tests that need to sign more). */
  privateKey: KeyLike
}

/**
 * Signs a Cognito-compatible ID token (and optionally an access token) with a
 * fresh RS256 key. This lets tests exercise the exact same runtime validation
 * contract that Cognito tokens use — without Cognito.
 *
 * ```ts
 * const { idToken, jwks } = await createTestToken({
 *   sub: "user-123",
 *   email: "test@example.com",
 * })
 * ```
 */
export async function createTestToken(options: TestTokenOptions = {}): Promise<TestTokenResult> {
  let privateKey = options.privateKey
  let publicKeyJwk: JWK
  if (privateKey) {
    // Derive the public JWK from the private key (strip the private fields).
    const full = await exportJWK(privateKey)
    const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...pub } = full
    publicKeyJwk = pub
  } else {
    const pair = await generateKeyPair("RS256")
    privateKey = pair.privateKey
    publicKeyJwk = await exportJWK(pair.publicKey)
  }

  const issuer = options.issuer ?? TEST_ISSUER
  const audience = options.audience ?? TEST_AUDIENCE
  const expiresIn = options.expiresIn ?? "1h"

  const claims: Record<string, unknown> = {
    sub: options.sub ?? "test-user",
    email: options.email ?? "test@example.com",
    email_verified: options.emailVerified ?? true,
    ...(options.claims ?? {}),
  }

  const idToken = await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresIn)
    .sign(privateKey)

  let accessToken: string | undefined
  if (options.includeAccessToken) {
    accessToken = await new SignJWT({ scope: "openid email profile", token_use: "access" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuedAt()
      .setIssuer(issuer)
      .setAudience(audience)
      .setExpirationTime(expiresIn)
      .sign(privateKey)
  }

  return { idToken, accessToken, jwks: { keys: [publicKeyJwk] }, privateKey }
}
