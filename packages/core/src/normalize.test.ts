import { describe, expect, it } from "vitest"
import { defineAuth } from "./config.js"
import { normalizeConfig } from "./normalize.js"

const base = () =>
  defineAuth({
    name: "myapp",
    signIn: "email",
    application: {
      type: "web",
      callbackUrls: [
        "http://localhost:3000/auth/callback",
        "https://app.example.com/auth/callback",
      ],
      logoutUrls: ["http://localhost:3000", "https://app.example.com"],
    },
  })

describe("normalizeConfig safe defaults", () => {
  it("produces case-insensitive email identities", () => {
    const pool = normalizeConfig(base())
    expect(pool.signIn.email).toBe(true)
    expect(pool.usernameConfiguration.caseSensitive).toBe(false)
  })

  it("uses Cognito sub as the canonical identity by default", () => {
    expect(normalizeConfig(base()).application.identity).toBe("cognito_sub")
  })

  it("enables email verification", () => {
    const pool = normalizeConfig(base())
    expect(pool.verification.email).toBe("required")
    expect(pool.autoVerifiedAttributes).toContain("email")
  })

  it("enables the authorization code flow with PKCE-compatible settings", () => {
    const pool = normalizeConfig(base())
    expect(pool.appClient.allowedOAuthFlows.authorizationCodeGrant).toBe(true)
    expect(pool.appClient.allowedOAuthFlows.implicitFlow).toBe(false)
    expect(pool.appClient.allowedOAuthFlows.userPassword).toBe(false)
    expect(pool.appClient.allowedOAuthFlows.clientCredentials).toBe(false)
  })

  it("keeps token durations within safe bounds", () => {
    const pool = normalizeConfig(base())
    expect(pool.appClient.tokenValidity.idTokenMinutes).toBe(60)
    expect(pool.appClient.tokenValidity.accessTokenMinutes).toBe(60)
    expect(pool.appClient.tokenValidity.refreshTokenDays).toBe(30)
  })

  it("requires no unnecessary attributes", () => {
    const pool = normalizeConfig(base())
    expect(pool.requiredAttributes).toEqual(["email"])
  })

  it("defines no custom attributes by default", () => {
    expect(normalizeConfig(base()).customAttributes).toEqual([])
  })

  it("configures email account recovery", () => {
    const pool = normalizeConfig(base())
    expect(pool.accountRecovery.enabled).toBe(true)
    expect(pool.accountRecovery.methods).toContain("email")
  })

  it("enables deletion protection", () => {
    expect(normalizeConfig(base()).infrastructure.deletionProtection).toBe(true)
  })

  it("enables Managed Login on the hosted domain", () => {
    const pool = normalizeConfig(base())
    expect(pool.domain?.managedLogin).toBe(true)
    expect(pool.domain?.prefix).toBe("myapp-auth")
  })

  it("generates a client secret only for web (confidential) clients", () => {
    const web = normalizeConfig(base())
    expect(web.appClient.generateSecret).toBe(true)

    const spa = normalizeConfig(
      defineAuth({
        signIn: "email",
        application: {
          type: "spa",
          callbackUrls: ["http://localhost:5173/callback"],
          logoutUrls: ["http://localhost:5173"],
        },
      }),
    )
    expect(spa.appClient.generateSecret).toBe(false)
  })

  it("honors explicit token settings", () => {
    const pool = normalizeConfig(
      defineAuth({
        signIn: "email",
        application: {
          type: "spa",
          callbackUrls: ["http://localhost:5173/callback"],
          logoutUrls: ["http://localhost:5173"],
        },
        token: { idTokenMinutes: 30, accessTokenMinutes: 15, refreshTokenDays: 7 },
      }),
    )
    expect(pool.appClient.tokenValidity).toEqual({
      idTokenMinutes: 30,
      accessTokenMinutes: 15,
      refreshTokenDays: 7,
    })
  })

  it("throws on an invalid configuration", () => {
    expect(() =>
      normalizeConfig(
        defineAuth({
          signIn: "email",
          application: { type: "web", callbackUrls: ["https://app.example.com/*"], logoutUrls: [] },
        }),
      ),
    ).toThrow(/Invalid auth configuration/)
  })

  it("normalizes to a plain, JSON-serializable object", () => {
    const pool = normalizeConfig(base())
    expect(JSON.parse(JSON.stringify(pool))).toEqual(pool)
  })
})
