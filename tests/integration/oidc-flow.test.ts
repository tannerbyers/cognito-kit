import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { JWK } from "jose"
import { createAuthServer } from "@cognito-kit/local-auth"
import type { AuthServerHandle } from "@cognito-kit/local-auth"
import { createTokenVerifier, discoverIssuer, normalizeUser } from "@cognito-kit/runtime"
import { createTestUser } from "@cognito-kit/testing"
import { generateCodeChallenge, generateCodeVerifier } from "@cognito-kit/local-auth"

/**
 * Layer 2 — local integration tests.
 *
 * Spins up the real local OIDC server and drives the complete authentication
 * flow over HTTP: discovery → login → authorization code → PKCE → token
 * exchange → JWT validation → normalized user → userinfo → logout.
 *
 * No AWS, no Docker, no manual setup.
 */

const REDIRECT_URI = "http://localhost:3000/auth/callback"
const CLIENT_ID = "dev-client"

let server: AuthServerHandle
let discovery: Awaited<ReturnType<typeof discoverIssuer>>

beforeAll(async () => {
  server = createAuthServer({
    // Ephemeral port so parallel test layers never collide.
    port: 0,
    users: [
      createTestUser({ id: "dev_alice", email: "alice@example.com" }),
      createTestUser({ id: "dev_admin", email: "admin@example.com", claims: { role: "admin" } }),
    ],
  })
  await server.start()
  discovery = await discoverIssuer(`${server.issuer}/.well-known/openid-configuration`)
})

afterAll(async () => {
  await server.stop()
})

describe("local OIDC server — full flow", () => {
  it("exposes a standards-compliant discovery document", () => {
    expect(discovery.issuer).toBe(server.issuer)
    expect(discovery.authorizationEndpoint).toBe(`${server.issuer}/authorize`)
    expect(discovery.tokenEndpoint).toBe(`${server.issuer}/token`)
    expect(discovery.jwksUrl).toBe(`${server.issuer}/.well-known/jwks.json`)
  })

  it("serves a JWKS endpoint", async () => {
    const res = await fetch(discovery.jwksUrl)
    expect(res.status).toBe(200)
    const jwks = (await res.json()) as { keys: unknown[] }
    expect(jwks.keys.length).toBe(1)
  })

  it("completes the authorization code + PKCE flow end to end", async () => {
    const verifier = generateCodeVerifier()
    const challenge = generateCodeChallenge(verifier)

    // 1. Authorization request → login page.
    const authorizeUrl = new URL(discovery.authorizationEndpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI)
    authorizeUrl.searchParams.set("scope", "openid email profile")
    authorizeUrl.searchParams.set("state", "state-123")
    authorizeUrl.searchParams.set("nonce", "nonce-1")
    authorizeUrl.searchParams.set("code_challenge", challenge)
    authorizeUrl.searchParams.set("code_challenge_method", "S256")

    const loginPage = await fetch(authorizeUrl)
    expect(loginPage.status).toBe(200)
    const html = await loginPage.text()
    expect(html).toContain("cognito-kit local auth")

    // 2. Submit credentials → redirect back with an authorization code.
    const loginForm = new URLSearchParams({
      username: "alice@example.com",
      password: "password",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: "openid email profile",
      state: "state-123",
      nonce: "nonce-1",
      code_challenge: challenge,
      code_challenge_method: "S256",
    })
    const loginRes = await fetch(`${server.issuer}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: loginForm.toString(),
      redirect: "manual",
    })
    expect(loginRes.status).toBe(302)
    const location = new URL(loginRes.headers.get("location")!)
    expect(location.origin + location.pathname).toBe(REDIRECT_URI)
    expect(location.searchParams.get("state")).toBe("state-123")
    const code = location.searchParams.get("code")
    expect(code).toBeTruthy()

    // 3. Exchange the code for tokens (PKCE verified server-side).
    const tokenRes = await fetch(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }).toString(),
    })
    expect(tokenRes.status).toBe(200)
    const tokens = (await tokenRes.json()) as {
      id_token: string
      access_token: string
      refresh_token: string
      token_type: string
      expires_in: number
    }
    expect(tokens.token_type).toBe("Bearer")
    expect(tokens.id_token).toBeTruthy()
    expect(tokens.access_token).toBeTruthy()
    expect(tokens.refresh_token).toBeTruthy()

    // 4. Verify the JWT with the runtime verifier.
    const jwks = (await fetch(discovery.jwksUrl).then((r) => r.json())) as { keys: JWK[] }
    const tokenVerifier = createTokenVerifier({
      issuer: server.issuer,
      audience: CLIENT_ID,
      jwks,
    })
    const { payload } = await tokenVerifier.verify(tokens.id_token)
    expect(payload.sub).toBe("dev_alice")
    expect(payload.email).toBe("alice@example.com")
    expect(payload.email_verified).toBe(true)
    expect(payload.nonce).toBe("nonce-1")

    // 5. Normalize into the application-facing user.
    const user = normalizeUser(payload)
    expect(user).toEqual({
      id: "dev_alice",
      email: "alice@example.com",
      emailVerified: true,
      claims: expect.objectContaining({ sub: "dev_alice", email: "alice@example.com" }),
    })

    // 6. userinfo endpoint returns the same identity.
    const userinfoRes = await fetch(discovery.userinfoEndpoint!, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    expect(userinfoRes.status).toBe(200)
    const userinfo = (await userinfoRes.json()) as { sub: string; email: string }
    expect(userinfo.sub).toBe("dev_alice")
    expect(userinfo.email).toBe("alice@example.com")

    // 7. Logout redirects back to the registered post-logout URL.
    const logoutUrl = new URL(discovery.endSessionEndpoint!)
    logoutUrl.searchParams.set("post_logout_redirect_uri", "http://localhost:3000")
    logoutUrl.searchParams.set("client_id", CLIENT_ID)
    const logoutRes = await fetch(logoutUrl, { redirect: "manual" })
    expect(logoutRes.status).toBe(302)
    expect(logoutRes.headers.get("location")).toBe("http://localhost:3000")
  })

  it("rejects a wrong PKCE verifier", async () => {
    const authorizeUrl = new URL(discovery.authorizationEndpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI)
    authorizeUrl.searchParams.set("code_challenge", generateCodeChallenge("verifier-a"))
    authorizeUrl.searchParams.set("code_challenge_method", "S256")

    await fetch(authorizeUrl)
    const loginRes = await fetch(`${server.issuer}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "alice@example.com",
        password: "password",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        code_challenge: generateCodeChallenge("verifier-a"),
        code_challenge_method: "S256",
      }).toString(),
      redirect: "manual",
    })
    const code = new URL(loginRes.headers.get("location")!).searchParams.get("code")!

    const tokenRes = await fetch(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: "wrong-verifier",
      }).toString(),
    })
    expect(tokenRes.status).toBe(400)
    const body = (await tokenRes.json()) as { error: string }
    expect(body.error).toBe("invalid_grant")
  })

  it("rejects an authorization code used twice", async () => {
    const authorizeUrl = new URL(discovery.authorizationEndpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI)
    await fetch(authorizeUrl)

    const loginRes = await fetch(`${server.issuer}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "alice@example.com",
        password: "password",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }).toString(),
      redirect: "manual",
    })
    const code = new URL(loginRes.headers.get("location")!).searchParams.get("code")!

    const exchange = () =>
      fetch(discovery.tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
        }).toString(),
      })

    expect((await exchange()).status).toBe(200)
    expect((await exchange()).status).toBe(400)
  })

  it("rejects invalid credentials", async () => {
    const authorizeUrl = new URL(discovery.authorizationEndpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI)
    await fetch(authorizeUrl)

    const loginRes = await fetch(`${server.issuer}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "alice@example.com",
        password: "wrong-password",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }).toString(),
      redirect: "manual",
    })
    const html = await loginRes.text()
    expect(html).toContain("Invalid email or password")
  })

  it("embeds custom claims from the user record", async () => {
    const authorizeUrl = new URL(discovery.authorizationEndpoint)
    authorizeUrl.searchParams.set("response_type", "code")
    authorizeUrl.searchParams.set("client_id", CLIENT_ID)
    authorizeUrl.searchParams.set("redirect_uri", REDIRECT_URI)
    await fetch(authorizeUrl)

    const loginRes = await fetch(`${server.issuer}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        username: "admin@example.com",
        password: "password",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
      }).toString(),
      redirect: "manual",
    })
    const code = new URL(loginRes.headers.get("location")!).searchParams.get("code")!

    const tokenRes = await fetch(discovery.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      }).toString(),
    })
    const tokens = (await tokenRes.json()) as { id_token: string }
    const jwks = (await fetch(discovery.jwksUrl).then((r) => r.json())) as { keys: JWK[] }
    const { payload } = await createTokenVerifier({
      issuer: server.issuer,
      audience: CLIENT_ID,
      jwks,
    }).verify(tokens.id_token)
    expect(payload.role).toBe("admin")
  })
})
