import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { defineAuth } from "./config.js"
import { diagnoseAuthConfig, diagnoseUserPool } from "./diagnose.js"
import type { NormalizedPoolConfig } from "./normalize.js"
import { normalizeConfig } from "./normalize.js"

function loadFixture(name: string): NormalizedPoolConfig {
  const url = new URL(`../../../tests/fixtures/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(url, "utf8")) as NormalizedPoolConfig
}

function findingsFor(pool: NormalizedPoolConfig) {
  return diagnoseUserPool(pool).findings
}

function statusOf(pool: NormalizedPoolConfig, ruleId: string) {
  return findingsFor(pool).find((f) => f.ruleId === ruleId)?.status
}

describe("diagnoseUserPool — recommended configuration", () => {
  const report = diagnoseUserPool(loadFixture("recommended"))

  it("reports zero critical and zero warning findings", () => {
    expect(report.summary.critical).toBe(0)
    expect(report.summary.warning).toBe(0)
  })

  it("still reports positive confirmations", () => {
    expect(report.summary.good).toBeGreaterThan(0)
    expect(
      report.findings.some((f) => f.ruleId === "ck-email-case-sensitive" && f.status === "good"),
    ).toBe(true)
  })
})

describe("diagnoseUserPool — rule behavior", () => {
  it("prevents case-sensitive email identities", () => {
    const pool = loadFixture("case-sensitive-email")
    expect(statusOf(pool, "ck-email-case-sensitive")).toBe("critical")
  })

  it("warns when email is used as the application identity", () => {
    const pool = loadFixture("bad-pool")
    expect(statusOf(pool, "ck-email-as-identity")).toBe("warning")
  })

  it("confirms Cognito sub as canonical identity", () => {
    expect(statusOf(loadFixture("recommended"), "ck-sub-identity")).toBe("good")
  })

  it("warns when application data is stored in Cognito custom attributes", () => {
    const pool = loadFixture("custom-attributes")
    const finding = findingsFor(pool).find((f) => f.ruleId === "ck-custom-attributes")
    expect(finding?.status).toBe("warning")
    expect(finding?.detail).toContain("role")
    expect(finding?.recommendation).toMatch(/database/)
  })

  it("warns on unnecessary required profile attributes", () => {
    const pool = loadFixture("required-profile-attrs")
    expect(statusOf(pool, "ck-required-attributes")).toBe("warning")
  })

  it("flags the implicit flow as critical", () => {
    const pool = loadFixture("unsafe-oauth-flows")
    expect(statusOf(pool, "ck-implicit-flow")).toBe("critical")
  })

  it("flags the password flow", () => {
    const pool = loadFixture("unsafe-oauth-flows")
    expect(statusOf(pool, "ck-password-flow")).toBe("warning")
  })

  it("flags missing email verification", () => {
    const pool = loadFixture("missing-verification")
    expect(statusOf(pool, "ck-email-verification")).toBe("critical")
  })

  it("flags unsafe callback URLs", () => {
    const pool = loadFixture("invalid-callbacks")
    const findings = findingsFor(pool).filter((f) => f.ruleId === "ck-callback-urls")
    expect(findings.some((f) => f.status === "critical")).toBe(true)
    expect(findings.some((f) => f.detail?.includes("not-a-url"))).toBe(true)
  })

  it("flags wildcard callback assumptions", () => {
    const pool = loadFixture("invalid-callbacks")
    const finding = findingsFor(pool).find((f) => f.ruleId === "ck-wildcard-callback")
    expect(finding?.status).toBe("critical")
    expect(finding?.detail).toContain("*")
  })

  it("flags excessively long tokens", () => {
    const pool = loadFixture("excessive-token-duration")
    expect(statusOf(pool, "ck-token-duration")).toBe("warning")
  })

  it("flags improperly configured recovery", () => {
    const pool = loadFixture("improper-recovery")
    expect(statusOf(pool, "ck-account-recovery")).toBe("warning")
  })

  it("flags incorrect public/confidential client configuration", () => {
    const pool = loadFixture("bad-pool")
    expect(statusOf(pool, "ck-client-visibility")).toBe("warning")
  })

  it("flags excessive Cognito profile storage", () => {
    const pool = loadFixture("cognito-app-coupling")
    expect(statusOf(pool, "ck-profile-storage")).toBe("warning")
  })

  it("flags non-reproducible infrastructure", () => {
    const pool = loadFixture("bad-pool")
    expect(statusOf(pool, "ck-no-iac")).toBe("warning")
  })

  it("flags migration lock-in configuration", () => {
    const pool = loadFixture("username-signin")
    expect(statusOf(pool, "ck-lock-in")).toBe("warning")
  })
})

describe("diagnoseUserPool — bad-pool fixture", () => {
  const report = diagnoseUserPool(loadFixture("bad-pool"))

  it("surfaces multiple critical and warning findings", () => {
    expect(report.summary.critical).toBeGreaterThanOrEqual(3)
    expect(report.summary.warning).toBeGreaterThanOrEqual(5)
  })

  it("produces findings with the documented shape", () => {
    for (const f of report.findings) {
      expect(f.ruleId).toBeTruthy()
      expect(f.title).toBeTruthy()
      expect(f.explanation).toBeTruthy()
      expect(f.recommendation).toBeTruthy()
      expect(["good", "warning", "critical"]).toContain(f.status)
    }
  })
})

describe("diagnoseAuthConfig", () => {
  it("reports no issues for a recommended developer config", () => {
    const report = diagnoseAuthConfig(
      defineAuth({
        signIn: "email",
        application: {
          type: "web",
          callbackUrls: ["http://localhost:3000/auth/callback"],
          logoutUrls: ["http://localhost:3000"],
        },
      }),
    )
    expect(report.summary.critical).toBe(0)
    expect(report.summary.warning).toBe(0)
  })

  it("reports warnings for a non-recommended developer config", () => {
    const report = diagnoseAuthConfig(
      defineAuth({
        signIn: "username",
        application: {
          type: "spa",
          callbackUrls: ["https://app.example.com/auth/callback"],
          logoutUrls: ["https://app.example.com"],
        },
      }),
    )
    expect(report.summary.warning).toBeGreaterThan(0)
  })
})

describe("normalize + diagnose round-trip", () => {
  it("normalizes a safe config to a zero-warning pool", () => {
    const pool = normalizeConfig(
      defineAuth({
        name: "myapp",
        signIn: "email",
        application: {
          type: "web",
          callbackUrls: ["https://app.example.com/auth/callback"],
          logoutUrls: ["https://app.example.com"],
        },
      }),
    )
    const report = diagnoseUserPool(pool)
    expect(report.summary.warning).toBe(0)
    expect(report.summary.critical).toBe(0)
  })
})
