import { createLocalJWKSet, createRemoteJWKSet, jwtVerify } from "jose"
import type { JWK, KeyLike } from "jose"
import type { TokenClaims } from "./claims.js"

/**
 * JWT verification for the normalized auth contract.
 *
 * The same `verify` function works for tokens issued by:
 *  - `@cognito-kit/local-auth` (local development)
 *  - Amazon Cognito (production)
 *  - any other OIDC provider that signs RS256 JWTs and exposes a JWKS
 */

export interface LocalJwks {
  keys: JWK[]
}

export interface TokenVerifier {
  /** Verifies signature, issuer, audience and expiry. Throws on failure. */
  verify(token: string): Promise<VerifiedToken>
}

export interface VerifiedToken {
  header: { alg?: string; kid?: string; typ?: string }
  payload: TokenClaims
}

export interface TokenVerifierOptions {
  /** Expected `iss` claim. */
  issuer: string
  /** Expected `aud` claim(s). */
  audience?: string | string[]
  /** Restrict accepted algorithms. Defaults to `["RS256"]`. */
  algorithms?: string[]
}

export interface LocalTokenVerifierOptions extends TokenVerifierOptions {
  /** Static JWKS (e.g. the local-auth server's public keys or Cognito's). */
  jwks: LocalJwks
}

export interface RemoteTokenVerifierOptions extends TokenVerifierOptions {
  /** URL of the provider's JWKS endpoint. */
  jwksUrl: string
}

/**
 * Creates a verifier against a static JWKS. Suitable for local development
 * and for production apps that cache Cognito's JWKS.
 */
export function createTokenVerifier(options: LocalTokenVerifierOptions): TokenVerifier {
  const keySet = createLocalJWKSet(options.jwks)
  return {
    async verify(token) {
      const { payload, protectedHeader } = await jwtVerify(token, keySet, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: options.algorithms ?? ["RS256"],
      })
      return { header: protectedHeader, payload: payload as TokenClaims }
    },
  }
}

/**
 * Creates a verifier that fetches and caches the provider's JWKS from a URL.
 * Uses `fetch` so it works in Node 22+ and edge runtimes.
 */
export function createRemoteTokenVerifier(options: RemoteTokenVerifierOptions): TokenVerifier {
  const keySet = createRemoteJWKSet(new URL(options.jwksUrl))
  return {
    async verify(token) {
      const { payload, protectedHeader } = await jwtVerify(token, keySet, {
        issuer: options.issuer,
        audience: options.audience,
        algorithms: options.algorithms ?? ["RS256"],
      })
      return { header: protectedHeader, payload: payload as TokenClaims }
    },
  }
}

export type { KeyLike }
