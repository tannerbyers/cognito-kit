import { describe, expect, it } from "vitest"
import { createAuthServer } from "@cognito-kit/local-auth"
import { createTestToken, createTestUser } from "@cognito-kit/testing"
import { createTokenVerifier, normalizeUser } from "@cognito-kit/runtime"

/**
 * Layer 2 — contract tests.
 *
 * Proves that tokens from the local OIDC server and Cognito-compatible tokens
 * satisfy the SAME runtime validation contract and normalize to the SAME
 * authenticated user shape.
 */

const AUDIENCE = "dev-client"

async function startLocalServer() {
  const server = createAuthServer({
    // Ephemeral port so parallel test layers never collide.
    port: 0,
    users: [createTestUser({ id: "dev_alice", email: "alice@example.com" })],
  })
  await server.start()
  return server
}

describe("normalized auth contract — local vs Cognito-compatible tokens", () => {
  it("produces identical normalized users for local and Cognito-compatible tokens", async () => {
    const server = await startLocalServer()
    try {
      const issuer = server.issuer
      // 1) Cognito-compatible token (signed with a fresh key, same claim shape).
      const cognito = await createTestToken({
        sub: "dev_alice",
        email: "alice@example.com",
        emailVerified: true,
        issuer,
        audience: AUDIENCE,
      })

      // 2) Local token (signed by the local-auth server).
      const { idToken } = await signLocalToken(server)

      // 3) Both must verify under the same runtime contract (same issuer,
      //    audience and algorithms) — each against its own provider's keys.
      const localJwks = (await fetch(`${server.issuer}/.well-known/jwks.json`).then((r) =>
        r.json(),
      )) as { keys: import("jose").JWK[] }

      const verifiedCognito = await createTokenVerifier({
        issuer,
        audience: AUDIENCE,
        jwks: cognito.jwks,
      }).verify(cognito.idToken)
      const verifiedLocal = await createTokenVerifier({
        issuer,
        audience: AUDIENCE,
        jwks: localJwks,
      }).verify(idToken)

      // 4) Both normalize to the same authenticated user. Provider-specific
      //    extras (nonce, jti) may differ; the normalized identity contract
      //    must be identical.
      const userFromCognito = normalizeUser(verifiedCognito.payload)
      const userFromLocal = normalizeUser(verifiedLocal.payload)

      expect(userFromLocal.id).toBe(userFromCognito.id)
      expect(userFromLocal.email).toBe(userFromCognito.email)
      expect(userFromLocal.emailVerified).toBe(userFromCognito.emailVerified)
      expect(userFromLocal).toEqual({
        id: "dev_alice",
        email: "alice@example.com",
        emailVerified: true,
        claims: expect.objectContaining({
          sub: "dev_alice",
          email: "alice@example.com",
          email_verified: true,
        }),
      })
    } finally {
      await server.stop()
    }
  })

  it("rejects unknown issuers identically for both token sources", async () => {
    const server = await startLocalServer()
    try {
      const issuer = server.issuer
      const cognito = await createTestToken({
        sub: "dev_alice",
        email: "alice@example.com",
        issuer: "https://evil.example.com",
        audience: AUDIENCE,
      })
      const { idToken } = await signLocalToken(server)

      const verifier = createTokenVerifier({
        issuer,
        audience: AUDIENCE,
        jwks: cognito.jwks,
      })

      await expect(verifier.verify(cognito.idToken)).rejects.toThrow()
      await expect(verifier.verify(idToken)).rejects.toThrow()
    } finally {
      await server.stop()
    }
  })
})

async function signLocalToken(
  server: ReturnType<typeof createAuthServer>,
): Promise<{ idToken: string }> {
  // Drive the local server's token endpoint directly.
  const discovery = (await fetch(`${server.issuer}/.well-known/openid-configuration`).then((r) =>
    r.json(),
  )) as { authorization_endpoint: string; token_endpoint: string }
  const authorizeUrl = new URL(discovery.authorization_endpoint)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", AUDIENCE)
  authorizeUrl.searchParams.set("redirect_uri", "http://localhost:3000/auth/callback")
  authorizeUrl.searchParams.set("scope", "openid email profile")
  authorizeUrl.searchParams.set("state", "st")
  authorizeUrl.searchParams.set("nonce", "n1")

  const loginPage = await fetch(authorizeUrl)
  expect(loginPage.status).toBe(200)

  const loginForm = new URLSearchParams({
    username: "alice@example.com",
    password: "password",
    client_id: AUDIENCE,
    redirect_uri: "http://localhost:3000/auth/callback",
    scope: "openid email profile",
    state: "st",
    nonce: "n1",
  })
  const loginRes = await fetch(`${server.issuer}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: loginForm.toString(),
    redirect: "manual",
  })
  expect(loginRes.status).toBe(302)
  const location = new URL(loginRes.headers.get("location")!)
  const code = location.searchParams.get("code")
  expect(code).toBeTruthy()

  const tokenRes = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: "http://localhost:3000/auth/callback",
      client_id: AUDIENCE,
    }).toString(),
  })
  expect(tokenRes.status).toBe(200)
  const tokens = (await tokenRes.json()) as { id_token: string }
  return { idToken: tokens.id_token }
}
