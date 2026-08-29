import { describe, expect, it } from "vitest"
import { defineAuth } from "./config.js"
import { analyzeMigration } from "./migrate.js"
import { normalizeConfig } from "./normalize.js"

function pool(overrides: Partial<ReturnType<typeof normalizeConfig>> = {}) {
  return {
    ...normalizeConfig(
      defineAuth({
        name: "app",
        signIn: "email",
        application: {
          type: "web",
          callbackUrls: ["https://app.example.com/auth/callback"],
          logoutUrls: ["https://app.example.com"],
        },
      }),
    ),
    ...overrides,
  }
}

describe("analyzeMigration", () => {
  it("reports no changes between identical configurations", () => {
    const analysis = analyzeMigration(pool(), pool())
    expect(analysis.changes).toEqual([])
    expect(analysis.risks).toEqual([])
    expect(analysis.summary).toEqual({ low: 0, medium: 0, high: 0 })
  })

  it("flags sign-in mode changes as high impact and critical", () => {
    const from = pool()
    const to = pool({ signIn: { email: false, username: true, phone: false } })
    const analysis = analyzeMigration(from, to)
    expect(analysis.changes.some((c) => c.path === "signIn.email" && c.impact === "high")).toBe(true)
    expect(analysis.risks.some((r) => r.severity === "critical" && r.message.includes("sign-in mode"))).toBe(true)
  })

  it("flags case-sensitivity changes as critical", () => {
    const from = pool()
    const to = pool()
    to.usernameConfiguration.caseSensitive = true
    const analysis = analyzeMigration(from, to)
    expect(analysis.risks.some((r) => r.severity === "critical" && r.message.includes("case sensitivity"))).toBe(true)
  })

  it("warns when required attributes would be removed", () => {
    const from = pool()
    from.requiredAttributes = ["email", "name"]
    const analysis = analyzeMigration(from, pool())
    expect(analysis.risks.some((r) => r.severity === "critical" && r.message.includes("required attributes cannot be removed"))).toBe(true)
  })

  it("warns when custom attributes would be removed", () => {
    const from = pool()
    from.customAttributes = [{ name: "role", type: "string", mutable: true, required: false }]
    const analysis = analyzeMigration(from, pool())
    expect(analysis.risks.some((r) => r.severity === "critical" && r.message.includes("custom attributes cannot be removed"))).toBe(true)
  })

  it("detects token duration changes as low impact", () => {
    const from = pool()
    const to = pool()
    to.appClient.tokenValidity.accessTokenMinutes = 15
    const analysis = analyzeMigration(from, to)
    const change = analysis.changes.find((c) => c.path === "appClient.tokenValidity.accessTokenMinutes")
    expect(change?.impact).toBe("low")
    expect(change?.from).toBe(60)
    expect(change?.to).toBe(15)
  })

  it("warns on identity changes", () => {
    const from = pool()
    const to = pool()
    to.application.identity = "email"
    const analysis = analyzeMigration(from, to)
    expect(analysis.risks.some((r) => r.severity === "warning" && r.message.includes("re-keying"))).toBe(true)
  })

  it("summarizes impact counts", () => {
    const from = pool()
    const to = pool({
      signIn: { email: false, username: true, phone: false },
      appClient: {
        ...pool().appClient,
        tokenValidity: { idTokenMinutes: 30, accessTokenMinutes: 30, refreshTokenDays: 7 },
      },
    })
    const analysis = analyzeMigration(from, to)
    expect(analysis.summary.high).toBeGreaterThan(0)
    expect(analysis.summary.low).toBeGreaterThan(0)
    expect(analysis.summary.low + analysis.summary.medium + analysis.summary.high).toBe(
      analysis.changes.length,
    )
  })
})