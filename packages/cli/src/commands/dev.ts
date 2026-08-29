import { createAuthServer } from "@cognito-kit/local-auth"
import type { AuthServerOptions } from "@cognito-kit/local-auth"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { loadUsersFile } from "../load.js"

export interface DevOptions {
  port?: number
  host?: string
  issuer?: string
  users?: string
}

/**
 * Starts the local OIDC development server and prints its details.
 * Blocks until interrupted.
 */
export async function devCommand(options: DevOptions): Promise<void> {
  const serverOptions: AuthServerOptions = {
    port: options.port ?? 9876,
    host: options.host ?? "127.0.0.1",
    issuer: options.issuer,
  }

  if (options.users) {
    const path = resolve(options.users)
    if (!existsSync(path)) {
      console.error(`Users file not found: ${path}`)
      process.exitCode = 1
      return
    }
    serverOptions.users = loadUsersFile(path)
  }

  const server = createAuthServer(serverOptions)
  const { url } = await server.start()

  console.log("")
  console.log("Local auth server running:")
  console.log("")
  console.log(`  Issuer:`)
  console.log(`  ${url}`)
  console.log("")
  console.log("  Users:")
  for (const user of server.users()) {
    console.log(`  ${user.email}`)
  }
  console.log("")
  console.log("  Endpoints:")
  console.log(`  ${url}/.well-known/openid-configuration`)
  console.log(`  ${url}/.well-known/jwks.json`)
  console.log(`  ${url}/authorize`)
  console.log(`  ${url}/token`)
  console.log(`  ${url}/userinfo`)
  console.log(`  ${url}/logout`)
  console.log("")
  console.log("  Press Ctrl+C to stop.")
  console.log("")

  const shutdown = async () => {
    await server.stop()
    process.exit(0)
  }
  process.on("SIGINT", () => void shutdown())
  process.on("SIGTERM", () => void shutdown())

  await new Promise<void>(() => {
    // Keep running until interrupted.
  })
}
