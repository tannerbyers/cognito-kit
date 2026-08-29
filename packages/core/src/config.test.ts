import { describe, expect, it } from "vitest"
import { defineAuth, DEFAULT_SCOPES } from "./config.js"
import { assertValidAuthConfig, hasConfigErrors, validateAuthConfig } from "./validate.js"

const goodConfig = () =>
  defineAuth({
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

describe("defineAuth", () => {
  it("returns the config unchanged (pure identity function)", () => {
    const config = goodConfig()
    expect(defineAuth(config)).toEqual(config)
  })
})

describe("validateAuthConfig", () => {
  it("accepts a recommended configuration", () => {
    expect(validateAuthConfig(goodConfig())).toEqual([])
  })

  it("rejects a wildcard callback URL", () => {
    const config = goodConfig()
    config.application.callbackUrls = ["https://app.example.com/*"]
    const issues = validateAuthConfig(config)
    expect(issues.some((i) => i.severity === "error" && i.message.includes("wildcard"))).toBe(true)
    expect(hasConfigErrors(config)).toBe(true)
  })

  it("rejects plain-http callbacks on non-localhost origins", () => {
    const config = goodConfig()
    config.application.callbackUrls = ["http://app.example.com/callback"]
    const issues = validateAuthConfig(config)
    expect(
      issues.some((i) => i.severity === "error" && i.message.includes("insecure-origin")),
    ).toBe(true)
  })

  it("rejects a malformed callback URL", () => {
    const config = goodConfig()
    config.application.callbackUrls = ["not a url"]
    expect(hasConfigErrors(config)).toBe(true)
  })

  it("rejects missing callback URLs", () => {
    const config = goodConfig()
    config.application.callbackUrls = []
    expect(hasConfigErrors(config)).toBe(true)
  })

  it("rejects scopes without openid", () => {
    const config = goodConfig()
    config.application.scopes = ["email", "profile"]
    const issues = validateAuthConfig(config)
    expect(issues.some((i) => i.message.includes("openid"))).toBe(true)
  })

  it("warns on token durations outside safe bounds", () => {
    const config = goodConfig()
    config.token = { idTokenMinutes: 1440 }
    const issues = validateAuthConfig(config)
    expect(issues.some((i) => i.severity === "warning")).toBe(true)
  })

  it("throws only when assertValidAuthConfig is called with errors", () => {
    expect(() => assertValidAuthConfig(goodConfig())).not.toThrow()
    const bad = goodConfig()
    bad.application.callbackUrls = ["https://app.example.com/*"]
    expect(() => assertValidAuthConfig(bad)).toThrow(/Invalid auth configuration/)
  })

  it("defaults scopes to openid/email/profile", () => {
    expect([...DEFAULT_SCOPES]).toEqual(["openid", "email", "profile"])
  })
})
