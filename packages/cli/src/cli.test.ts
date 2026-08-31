import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { initCommand } from "./commands/init.js"
import { doctorCommand, formatReport } from "./commands/doctor.js"
import { migrateCommand, formatMigration } from "./commands/migrate.js"
import { loadNormalizedPool, loadPoolLike } from "./load.js"
import { renderAuthConfigFile, renderUsersFile } from "./templates.js"

vi.mock("@cognito-kit/aws", async () => {
  const core = await vi.importActual<typeof import("@cognito-kit/core")>("@cognito-kit/core")
  const pool = core.normalizeConfig(
    core.defineAuth({
      signIn: "email",
      application: {
        type: "web",
        callbackUrls: ["http://localhost:3000/auth/callback"],
        logoutUrls: ["http://localhost:3000"],
      },
    }),
  )
  return {
    AwsCognitoControlPlane: class {
      async describeUserPool() {
        return { userPoolId: "us-east-1_AbCdE", name: "mock-pool" }
      }
      async listUserPoolClients() {
        return [{ clientId: "c1", clientName: "app" }]
      }
      async describeUserPoolClient() {
        return {
          userPoolId: "us-east-1_AbCdE",
          clientId: "c1",
          clientName: "app",
          generateSecret: true,
        }
      }
    },
    toNormalizedPool: () => pool,
  }
})

describe("renderAuthConfigFile", () => {
  it("renders a web starter config", () => {
    const content = renderAuthConfigFile({
      name: "myapp",
      signIn: "email",
      application: "web",
      callbackUrls: ["http://localhost:3000/auth/callback"],
      logoutUrls: ["http://localhost:3000"],
    })
    expect(content).toMatchSnapshot()
    expect(content).toContain('signIn: "email"')
    expect(content).toContain('type: "web"')
    expect(content).toContain("http://localhost:3000/auth/callback")
  })

  it("uses per-type defaults when no URLs are provided", () => {
    const spa = renderAuthConfigFile({
      name: "spa-app",
      signIn: "email",
      application: "spa",
      callbackUrls: [],
      logoutUrls: [],
    })
    expect(spa).toContain("http://localhost:5173/auth/callback")
  })

  it("renders a users file with development users", () => {
    const content = renderUsersFile()
    expect(content).toContain("alice@example.com")
    expect(content).toContain("admin@example.com")
  })
})

describe("initCommand (non-interactive)", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ck-init-"))
  })

  afterEach(() => {
    // cleanup handled by OS temp dir
  })

  it("writes a config and users file to the output directory", async () => {
    const result = await initCommand({
      signIn: "email",
      application: "web",
      callbackUrls: ["http://localhost:3000/auth/callback"],
      logoutUrls: ["http://localhost:3000"],
      name: "myapp",
      output: dir,
      yes: true,
    })
    expect(result.configPath).toBe(join(dir, "auth.config.ts"))
    expect(result.usersPath).toBe(join(dir, "users.ts"))

    const config = readFileSync(result.configPath, "utf8")
    expect(config).toContain('name: "myapp"')
    expect(config).toContain('signIn: "email"')
    expect(readFileSync(result.usersPath, "utf8")).toContain("dev_alice")
  })

  it("defaults to email/web when flags are missing and --yes is set", async () => {
    const result = await initCommand({ callbackUrls: [], logoutUrls: [], output: dir, yes: true })
    expect(result.signIn).toBe("email")
    expect(result.application).toBe("web")
  })
})

describe("formatReport", () => {
  it("formats a clean report with checkmarks", () => {
    const report = formatReport({
      findings: [
        {
          ruleId: "ck-email-case-sensitive",
          status: "good",
          title: "Case-insensitive email",
          explanation: "x",
          recommendation: "y",
        },
      ],
      summary: { good: 1, warning: 0, critical: 0 },
    })
    expect(report).toContain("✓ Case-insensitive email")
    expect(report).toContain("Summary: 1 passed, 0 warnings, 0 critical")
  })

  it("formats warnings and critical findings with explanations", () => {
    const report = formatReport({
      findings: [
        {
          ruleId: "ck-custom-attributes",
          status: "warning",
          title: "Custom attributes detected",
          explanation: "Custom attributes cannot easily be removed later.",
          recommendation: "Store profile data in your database.",
          detail: "role, plan",
        },
        {
          ruleId: "ck-email-case-sensitive",
          status: "critical",
          title: "Email usernames are case sensitive",
          explanation: "Duplicates.",
          recommendation: "Use case-insensitive.",
        },
      ],
      summary: { good: 0, warning: 1, critical: 1 },
    })
    expect(report).toContain("⚠ Custom attributes detected")
    expect(report).toContain("role, plan")
    expect(report).toContain("✗ Email usernames are case sensitive")
    expect(report).toContain("→ Use case-insensitive.")
  })
})

describe("loadNormalizedPool", () => {
  it("loads and validates a fixture document", () => {
    const url = new URL("../../../tests/fixtures/recommended.json", import.meta.url)
    const pool = loadNormalizedPool(url.pathname)
    expect(pool.provider).toBe("cognito")
    expect(pool.appClient.allowedOAuthFlows.authorizationCodeGrant).toBe(true)
  })

  it("rejects malformed documents", () => {
    expect(() => loadNormalizedPool("/nonexistent.json")).toThrow()
  })
})

describe("doctorCommand --pool", () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it("diagnoses a pool through the AWS adapter", async () => {
    const report = await doctorCommand({ pool: "us-east-1_AbCdE", region: "us-east-1" })
    expect(report.summary.critical).toBe(0)
    expect(report.summary.warning).toBe(0)
  })
})

describe("doctorCommand --demo", () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it("diagnoses a built-in bad pool offline", async () => {
    const report = await doctorCommand({ demo: true })
    expect(report.summary.critical).toBeGreaterThan(0)
    expect(report.summary.warning).toBeGreaterThan(0)
  })

  it("sets exit code 1 when findings reach the fail-on threshold", async () => {
    await doctorCommand({ demo: true, failOn: "critical" })
    expect(process.exitCode).toBe(1)
  })

  it("defaults failOn to critical", async () => {
    const report = await doctorCommand({ demo: true })
    expect(report.summary.critical).toBeGreaterThan(0)
    expect(process.exitCode).toBe(1)
  })

  it("outputs JSON with --format json", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined)
    try {
      await doctorCommand({ demo: true, format: "json" })
      const output = spy.mock.calls[0][0] as string
      const parsed = JSON.parse(output) as { summary: { critical: number } }
      expect(parsed.summary.critical).toBeGreaterThan(0)
    } finally {
      spy.mockRestore()
    }
  })
})

describe("migrateCommand", () => {
  afterEach(() => {
    process.exitCode = undefined
  })

  it("compares two normalized pool documents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ck-migrate-"))
    const from = join(dir, "from.json")
    const to = join(dir, "to.json")
    const url = new URL("../../../tests/fixtures/recommended.json", import.meta.url)
    const recommended = readFileSync(url.pathname, "utf8")
    writeFileSync(from, recommended, "utf8")
    writeFileSync(
      to,
      JSON.stringify(
        {
          ...JSON.parse(recommended),
          usernameConfiguration: { caseSensitive: true },
        },
        null,
        2,
      ),
      "utf8",
    )

    const analysis = await migrateCommand({ from, to })
    const change = analysis.changes.find((c) => c.path === "usernameConfiguration.caseSensitive")
    expect(change?.impact).toBe("high")
    expect(analysis.risks.some((r) => r.severity === "critical")).toBe(true)
    expect(process.exitCode).toBe(1)
  })
})

describe("formatMigration", () => {
  it("renders changes and risks", () => {
    const text = formatMigration({
      changes: [
        {
          path: "signIn.email",
          kind: "changed",
          from: true,
          to: false,
          impact: "high",
        },
      ],
      risks: [
        {
          path: "signIn",
          severity: "critical",
          message: "sign-in mode cannot be changed in place",
        },
      ],
      summary: { low: 0, medium: 0, high: 1 },
    })
    expect(text).toContain("✗ [high] signIn.email")
    expect(text).toContain("✗ sign-in mode cannot be changed in place")
    expect(text).toContain("Summary: 0 low, 0 medium, 1 high impact changes")
  })
})

describe("loadPoolLike", () => {
  it("loads a normalized pool document", () => {
    const url = new URL("../../../tests/fixtures/recommended.json", import.meta.url)
    const pool = loadPoolLike(url.pathname)
    expect(pool.provider).toBe("cognito")
  })
})
