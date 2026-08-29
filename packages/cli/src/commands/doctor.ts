import { diagnoseAuthConfig, diagnoseUserPool } from "@cognito-kit/core"
import type { DiagnosticFinding, DiagnosticReport } from "@cognito-kit/core"
import { loadAuthConfig, loadNormalizedPool } from "../load.js"

export interface DoctorOptions {
  file?: string
  config?: string
}

/**
 * Analyzes a normalized Cognito configuration and prints a report.
 * Works entirely offline.
 */
export async function doctorCommand(options: DoctorOptions): Promise<DiagnosticReport> {
  if (!options.file && !options.config) {
    console.error("Usage: cognito-kit doctor --file <normalized-pool.json>")
    console.error("       cognito-kit doctor --config <auth.config.ts>")
    process.exitCode = 1
    return { findings: [], summary: { good: 0, warning: 0, critical: 0 } }
  }

  let report: DiagnosticReport
  if (options.file) {
    const pool = loadNormalizedPool(options.file)
    report = diagnoseUserPool(pool)
  } else {
    const config = loadAuthConfig(options.config!)
    report = diagnoseAuthConfig(config)
  }

  console.log(formatReport(report))
  if (report.summary.critical > 0) {
    process.exitCode = 1
  }
  return report
}

/** Renders a diagnostic report as human-readable text. Pure and testable. */
export function formatReport(report: DiagnosticReport): string {
  const lines: string[] = []
  lines.push("Cognito User Pool")
  lines.push("")

  const findings = [...report.findings].sort((a, b) => statusRank(a.status) - statusRank(b.status))

  for (const finding of findings) {
    lines.push(formatFinding(finding))
  }

  lines.push("")
  lines.push(
    `Summary: ${report.summary.good} passed, ${report.summary.warning} warnings, ${report.summary.critical} critical`,
  )
  return lines.join("\n")
}

function formatFinding(finding: DiagnosticFinding): string {
  const icon = finding.status === "good" ? "✓" : finding.status === "warning" ? "⚠" : "✗"
  const head = `${icon} ${finding.title}`
  if (finding.status === "good") return head
  const detail = finding.detail ? `  ${finding.detail}` : null
  return [head, detail, `  ${finding.explanation}`, `  → ${finding.recommendation}`]
    .filter((l): l is string => l !== null)
    .join("\n")
}

function statusRank(status: DiagnosticFinding["status"]): number {
  return status === "critical" ? 0 : status === "warning" ? 1 : 2
}
