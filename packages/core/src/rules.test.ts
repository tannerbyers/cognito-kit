import { describe, expect, it } from "vitest"
import { defineAuth } from "./config.js"
import { diagnoseUserPool } from "./diagnose.js"
import {
  crit,
  defineRule,
  diagnoseWithRules,
  good,
  warn,
} from "./rules.js"
import type { DiagnosticRule } from "./rules.js"
import { normalizeConfig } from "./normalize.js"

// DIAGNOSTIC_RULES lives in diagnose.ts; import here to test combinations.
import { DIAGNOSTIC_RULES } from "./diagnose.js"
const requireDiagnostics = () => ({ DIAGNOSTIC_RULES })

function safePool() {
  return normalizeConfig(
    defineAuth({
      name: "app",
      signIn: "email",
      application: {
        type: "web",
        callbackUrls: ["https://app.example.com/auth/callback"],
        logoutUrls: ["https://app.example.com"],
      },
    }),
  )
}

describe("defineRule + diagnoseWithRules", () => {
  it("lets a user define and run a custom rule", () => {
    const rule = defineRule({
      id: "COGNITO017",
      severity: "warning",
      title: "MFA is disabled",
      explanation: "Accounts without MFA are at higher risk.",
      recommendation: "Enable MFA (OPTIONAL or REQUIRED).",
      check(pool) {
        return pool.mfaConfiguration === "OFF"
          ? [warn(this, "mfaConfiguration = OFF")]
          : [good(this, "MFA enabled")]
      },
    })

    const report = diagnoseWithRules(safePool(), [rule])
    const finding = report.findings.find((f) => f.ruleId === "COGNITO017")
    expect(finding?.status).toBe("warning")
    expect(finding?.detail).toBe("mfaConfiguration = OFF")
    expect(report.summary.warning).toBe(1)
    expect(finding).toMatchObject({
      title: "MFA is disabled",
      explanation: "Accounts without MFA are at higher risk.",
      recommendation: "Enable MFA (OPTIONAL or REQUIRED).",
    })
  })

  it("can emit critical findings", () => {
    const rule = defineRule({
      id: "COGNITO018",
      severity: "critical",
      title: "dev",
      explanation: "x",
      recommendation: "y",
      check: () => [crit(rule)],
    })
    const report = diagnoseWithRules(safePool(), [rule])
    expect(report.summary.critical).toBe(1)
  })

  it("custom rules can run alongside built-ins", () => {
    const { DIAGNOSTIC_RULES } = requireDiagnostics()
    const aux = defineRule({
      id: "COGNITO019",
      severity: "warning",
      title: "custom",
      explanation: "x",
      recommendation: "y",
      check: () => [warningForAux(aux)],
    })
    const report = diagnoseWithRules(safePool(), [...DIAGNOSTIC_RULES, aux])
    const doc = diagnoseUserPool(safePool())
    expect(report.findings.length).toBe(doc.findings.length + 1)
    expect(report.summary.warning).toBe(doc.summary.warning + 1)
  })

it("issues a warning directive with rule metadata", () => {
    const rule = defineRule({
      id: "CK-warning-helper",
      severity: "warning",
      title: "warns",
      explanation: "x",
      recommendation: "y",
      check: () => [warn(rule)],
    })
    const report = diagnoseWithRules(safePool(), [rule])
    expect(report.findings[0]).toMatchObject({
      ruleId: "CK-warning-helper",
      status: "warning",
      title: "warns",
    })
  })

function warningForAux(rule: DiagnosticRule) {
  return warn(rule)
}

  it("rules are independently reusable across pools", () => {
    const rule = defineRule({
      id: "CK-EMAIL-MISSING",
      severity: "critical",
      title: "no email attribute",
      explanation: "x",
      recommendation: "y",
      check(p) {
        return p.signIn.email ? [good(this)] : [crit(this)]
      },
    })
    const emailPool = safePool()
    const usernamePool = safePool()
    usernamePool.signIn = { email: false, username: true, phone: false }
    expect(diagnoseWithRules(emailPool, [rule]).summary.critical).toBe(0)
    expect(diagnoseWithRules(usernamePool, [rule]).summary.critical).toBe(1)
  })
})