import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { ApplicationType, SignInMode } from "@cognito-kit/core"
import { renderAuthConfigFile, renderUsersFile } from "../templates.js"
import { prompt } from "../prompts.js"

export interface InitOptions {
  signIn?: SignInMode
  application?: ApplicationType
  callbackUrls: string[]
  logoutUrls: string[]
  name?: string
  output?: string
  yes?: boolean
}

export interface InitResult {
  configPath: string
  usersPath: string
  signIn: SignInMode
  application: ApplicationType
}

/**
 * Generates a starter configuration. Non-interactive when the required
 * options are provided (`--yes` or explicit flags); otherwise prompts.
 */
export async function initCommand(options: InitOptions): Promise<InitResult> {
  const interactive = !options.yes

  const signIn: SignInMode = options.signIn ?? (interactive ? await chooseSignIn() : "email")
  const application: ApplicationType =
    options.application ?? (interactive ? await chooseApplication() : "web")

  let callbackUrls = options.callbackUrls ?? []
  let logoutUrls = options.logoutUrls ?? []
  if (interactive && callbackUrls.length === 0) {
    const input = await prompt(
      "Callback URL(s) (comma separated)",
      "http://localhost:3000/auth/callback",
    )
    callbackUrls = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (interactive && logoutUrls.length === 0) {
    const input = await prompt("Logout URL(s) (comma separated)", "http://localhost:3000")
    logoutUrls = input
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }

  const name = options.name ?? "app"
  const outputDir = resolve(options.output ?? "./auth")

  mkdirSync(outputDir, { recursive: true })

  const configContent = renderAuthConfigFile({
    name,
    signIn,
    application,
    callbackUrls,
    logoutUrls,
  })
  const configPath = join(outputDir, "auth.config.ts")
  writeFileSync(configPath, configContent, "utf8")

  const usersContent = renderUsersFile()
  const usersPath = join(outputDir, "users.ts")
  writeFileSync(usersPath, usersContent, "utf8")

  console.log(`✓ Wrote ${configPath}`)
  console.log(`✓ Wrote ${usersPath}`)
  console.log()
  console.log("Next steps:")
  console.log(`  1. Edit ${configPath} to match your app`)
  console.log("  2. Run `cognito-kit dev` to start the local auth server")
  console.log("  3. Run `cognito-kit test` to validate the configuration")

  return { configPath, usersPath, signIn, application }
}

async function chooseSignIn(): Promise<SignInMode> {
  const answer = await prompt("Sign-in mode", "email")
  return answer === "username" ? "username" : "email"
}

async function chooseApplication(): Promise<ApplicationType> {
  const answer = await prompt("Application type", "web")
  if (answer === "spa") return "spa"
  if (answer === "mobile") return "mobile"
  return "web"
}
