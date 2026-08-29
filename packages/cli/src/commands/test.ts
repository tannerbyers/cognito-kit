import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { diagnoseAuthConfig, validateAuthConfig } from "@cognito-kit/core"
import { loadAuthConfig } from "../load.js"

/**
 * Validates an auth configuration file and runs the diagnostics engine
 * against it. Exits non-zero when the configuration has errors.
 */
export async function testCommand(configPath?: string): Promise<void> {
  const path = configPath ?? "./auth/auth.config.ts"
  const resolved = resolve(path)

  if (!existsSync(resolved)) {
    console.error(`Config file not found: ${resolved}`)
    console.error("Run `cognito-kit init` to generate one.")
    process.exitCode = 1
    return
  }

  const config = loadAuthConfig(resolved)
  const issues = validateAuthConfig(config)

  if (issues.length > 0) {
    console.log("Configuration issues:")
    for (const issue of issues) {
      const icon = issue.severity === "error" ? "✗" : "⚠"
      console.log(`${icon} ${issue.path}: ${issue.message}`)
    }
  }

  const report = diagnoseAuthConfig(config)
  console.log("")
  console.log(
    `Diagnostics: ${report.summary.good} passed, ${report.summary.warning} warnings, ${report.summary.critical} critical`,
  )

  const hasErrors = issues.some((i) => i.severity === "error") || report.summary.critical > 0
  if (hasErrors) process.exitCode = 1
}
