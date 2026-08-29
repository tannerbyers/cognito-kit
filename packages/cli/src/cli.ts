import { Command } from "commander"
import { initCommand } from "./commands/init.js"
import type { InitOptions } from "./commands/init.js"
import { doctorCommand } from "./commands/doctor.js"
import type { DoctorOptions } from "./commands/doctor.js"
import { devCommand } from "./commands/dev.js"
import type { DevOptions } from "./commands/dev.js"
import { testCommand } from "./commands/test.js"
import { migrateCommand } from "./commands/migrate.js"
import type { MigrateOptions } from "./commands/migrate.js"
import { stubCommand } from "./commands/stub.js"

const VERSION = "0.1.0"

export function buildProgram(): Command {
  const program = new Command()
  program
    .name("cognito-kit")
    .description("Cognito without learning Cognito — local-first toolkit for Amazon Cognito")
    .version(VERSION)

  program
    .command("init")
    .description("Generate a starter auth configuration")
    .option("--sign-in <mode>", 'sign-in mode: "email" or "username"')
    .option("--application <type>", 'application type: "web", "spa" or "mobile"')
    .option("--callback-url <url>", "callback URL (repeatable)", collect, [])
    .option("--logout-url <url>", "logout URL (repeatable)", collect, [])
    .option("--name <name>", "application name (default: app)")
    .option("--output <dir>", "output directory (default: ./auth)")
    .option("--yes", "use defaults for anything not provided (non-interactive)")
    .action((options: InitOptions) => {
      run(() => initCommand(options))
    })

  program
    .command("doctor")
    .description("Analyze a Cognito configuration and report dangerous or poor choices")
    .option("--file <path>", "path to a normalized pool JSON document")
    .option("--config <path>", "path to an auth.config.ts (developer-facing config)")
    .option("--pool <id>", "Cognito user pool id to diagnose (requires @cognito-kit/aws)")
    .option("--region <region>", "AWS region for --pool")
    .action((options: DoctorOptions) => {
      run(() => doctorCommand(options))
    })

  program
    .command("dev")
    .description("Run the local OIDC development server")
    .option("--port <port>", "port to listen on (default: 9876)", parseInt)
    .option("--host <host>", "host to bind (default: 127.0.0.1)")
    .option("--issuer <url>", "issuer URL override")
    .option("--users <path>", "path to a users file (.json or .ts)")
    .action((options: DevOptions) => {
      run(() => devCommand(options))
    })

  program
    .command("test")
    .description("Validate an auth configuration")
    .argument("[config]", "path to the auth config file (default: ./auth/auth.config.ts)")
    .action((config?: string) => {
      run(() => testCommand(config))
    })

program
    .command("migrate")
    .description("Analyze a migration between two Cognito configurations")
    .requiredOption("--from <path>", "source configuration (normalized pool document or auth config)")
    .requiredOption("--to <path>", "target configuration (normalized pool document or auth config)")
    .action((options: MigrateOptions) => {
      run(() => migrateCommand(options))
    })

  program
    .command("deploy")
    .description("Deploy the generated infrastructure to your AWS account (planned for a future release)")
    .action(() => stubCommand("deploy"))

  return program
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value)
  return previous
}

/** Runs an async command handler, converting rejections into a clean exit. */
function run(action: () => Promise<unknown>): void {
  action().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
