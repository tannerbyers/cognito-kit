import { diagnoseAuthConfig, diagnoseUserPool } from "@cognito-kit/core"
import type { DiagnosticFinding, DiagnosticReport } from "@cognito-kit/core"
import { loadAuthConfig, loadNormalizedPool } from "../load.js"

export interface DoctorOptions {
  file?: string
  config?: string
  /** Cognito user pool id to diagnose through the AWS adapter. */
  pool?: string
  /** AWS region for `--pool`. */
  region?: string
}

/**
 * Analyzes a Cognito configuration and prints a report.
 *
 * Sources:
 *  - `--file`   : normalized pool document (offline)
 *  - `--config` : developer-facing auth config (offline)
 *  - `--pool`   : live Cognito pool via the AWS adapter (requires AWS access)
 */
export async function doctorCommand(options: DoctorOptions): Promise<DiagnosticReport> {
  if (!options.file && !options.config && !options.pool) {
    console.error("Usage: cognito-kit doctor --file <normalized-pool.json>")
    console.error("       cognito-kit doctor --config <auth.config.ts>")
    console.error("       cognito-kit doctor --pool <user-pool-id> [--region <region>]")
    process.exitCode = 1
    return { findings: [], summary: { good: 0, warning: 0, critical: 0 } }
  }

  let report: DiagnosticReport
  if (options.file) {
    report = diagnoseUserPool(loadNormalizedPool(options.file))
  } else if (options.config) {
    report = diagnoseAuthConfig(loadAuthConfig(options.config))
  } else {
    report = await diagnoseAwsPool(options)
  }

  console.log(formatReport(report))
  if (report.summary.critical > 0) {
    process.exitCode = 1
  }
  return report
}

async function diagnoseAwsPool(options: DoctorOptions): Promise<DiagnosticReport> {
  let aws: typeof import("@cognito-kit/aws")
  try {
    aws = await import("@cognito-kit/aws")
  } catch {
    console.error("doctor --pool requires @cognito-kit/aws.")
    console.error("Install it with: pnpm add @cognito-kit/aws")
    process.exitCode = 1
    return { findings: [], summary: { good: 0, warning: 0, critical: 0 } }
  }

  const plane = new aws.AwsCognitoControlPlane({ region: options.region })
  const poolInfo = await plane.describeUserPool(options.pool!)
  const clients = await plane.listUserPoolClients(options.pool!)
  if (clients.length === 0) {
    console.error(`No app clients found on pool ${options.pool}`)
    process.exitCode = 1
    return { findings: [], summary: { good: 0, warning: 0, critical: 0 } }
  }
  const clientInfo = await plane.describeUserPoolClient(options.pool!, clients[0].clientId)
  return diagnoseUserPool(aws.toNormalizedPool(poolInfo, clientInfo))
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
