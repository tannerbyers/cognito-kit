import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initCommand } from "./commands/init.js"
import { formatReport } from "./commands/doctor.js"
import { loadNormalizedPool } from "./load.js"
import { renderAuthConfigFile, renderUsersFile } from "./templates.js"

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
