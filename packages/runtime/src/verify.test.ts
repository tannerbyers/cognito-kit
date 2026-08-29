import { exportJWK, generateKeyPair, SignJWT } from "jose"
import { describe, expect, it } from "vitest"
import { hasIdentity, normalizeUser } from "./normalize.js"
import { createSessionCookie, readSessionCookie, sessionCookieToHeader } from "./session.js"
import { createTokenVerifier } from "./verify.js"

const ISSUER = "http://localhost:9876"
const AUDIENCE = "dev-client"

async function makeKeyPair() {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const jwks = { keys: [await exportJWK(publicKey)] }
  return { publicKey, privateKey, jwks }
}

async function signToken(
  privateKey: Parameters<typeof SignJWT.prototype.sign>[0],
  claims: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string | string[]; expiresIn?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuedAt()
    .setIssuer(overrides.issuer ?? ISSUER)
    .setAudience(overrides.audience ?? AUDIENCE)
    .setExpirationTime(overrides.expiresIn ?? "1h")
    .sign(privateKey)
}

describe("createTokenVerifier", () => {
  it("verifies a valid token and returns claims", async () => {
    const { privateKey, jwks } = await makeKeyPair()
    const token = await signToken(privateKey, {
      sub: "dev_alice",
      email: "alice@example.com",
      email_verified: true,
    })
    const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })
    const { payload } = await verifier.verify(token)
    expect(payload.sub).toBe("dev_alice")
    expect(payload.email).toBe("alice@example.com")
    expect(payload.email_verified).toBe(true)
  })

  it("rejects a token from a different issuer", async () => {
    const { privateKey, jwks } = await makeKeyPair()
    const token = await signToken(
      privateKey,
      { sub: "user-1" },
      { issuer: "http://evil.example.com" },
    )
    const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })
    await expect(verifier.verify(token)).rejects.toThrow()
  })

  it("rejects a token for a different audience", async () => {
    const { privateKey, jwks } = await makeKeyPair()
    const token = await signToken(privateKey, { sub: "user-1" }, { audience: "other-client" })
    const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })
    await expect(verifier.verify(token)).rejects.toThrow()
  })

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeKeyPair()
    const token = await signToken(privateKey, { sub: "user-1" }, { expiresIn: "-1h" })
    const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })
    await expect(verifier.verify(token)).rejects.toThrow()
  })

  it("rejects a token signed with an unknown key", async () => {
    const { privateKey } = await makeKeyPair()
    const { jwks: otherJwks } = await makeKeyPair()
    const token = await signToken(privateKey, { sub: "user-1" })
    const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks: otherJwks })
    await expect(verifier.verify(token)).rejects.toThrow()
  })

  it("rejects a tampered token", async () => {
    const { privateKey, jwks } = await makeKeyPair()
    const token = await signToken(privateKey, { sub: "user-1" })
    const [head, , sig] = token.split(".")
    const tampered = `${head}.${Buffer.from(JSON.stringify({ sub: "attacker" })).toString("base64url")}.${sig}`
    const verifier = createTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwks })
    await expect(verifier.verify(tampered)).rejects.toThrow()
  })
})

describe("normalizeUser", () => {
  it("maps token claims to a normalized authenticated user", () => {
    const user = normalizeUser({
      sub: "dev_alice",
      email: "alice@example.com",
      email_verified: true,
      role: "admin",
    })
    expect(user).toEqual({
      id: "dev_alice",
      email: "alice@example.com",
      emailVerified: true,
      claims: { sub: "dev_alice", email: "alice@example.com", email_verified: true, role: "admin" },
    })
  })

  it("tolerates missing optional claims", () => {
    const user = normalizeUser({ sub: "abc" })
    expect(user.id).toBe("abc")
    expect(user.email).toBeUndefined()
    expect(user.emailVerified).toBeUndefined()
  })

  it("hasIdentity detects a usable sub", () => {
    expect(hasIdentity({ sub: "abc" })).toBe(true)
    expect(hasIdentity({})).toBe(false)
    expect(hasIdentity({ sub: "" })).toBe(false)
  })
})

describe("session helpers", () => {
  it("creates a secure httpOnly cookie", () => {
    const cookie = createSessionCookie("token-123", { secure: true })
    expect(cookie.httpOnly).toBe(true)
    expect(cookie.secure).toBe(true)
    const header = sessionCookieToHeader(cookie)
    expect(header).toContain("HttpOnly")
    expect(header).toContain("Secure")
    expect(header).toContain("ck_session=token-123")
  })

  it("reads the session token back from a Cookie header", () => {
    const header = "other=1; ck_session=token-456; theme=dark"
    expect(readSessionCookie(header)).toBe("token-456")
    expect(readSessionCookie(undefined)).toBeUndefined()
    expect(readSessionCookie("other=1")).toBeUndefined()
  })
})
