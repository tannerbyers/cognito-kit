import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * PKCE verification (S256 only).
 */

export function generateCodeVerifier(): string {
  return randomBase64Url(32)
}

export function generateCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url")
}

export function verifyPkce(
  codeChallenge: string | null,
  codeChallengeMethod: string | null,
  codeVerifier: string | undefined,
): boolean {
  if (!codeChallenge && !codeVerifier) return true
  if (!codeChallenge) return false
  if (!codeVerifier) return false
  if (codeChallengeMethod && codeChallengeMethod !== "S256") return false
  const expected = generateCodeChallenge(codeVerifier)
  const a = Buffer.from(expected)
  const b = Buffer.from(codeChallenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url")
}
