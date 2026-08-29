/**
 * `pnpm dev` demo.
 *
 * Starts the local OIDC server and the Node API example, then performs a real
 * login flow end to end and prints the result. Both servers stay running so
 * you can poke at them manually.
 */
import { createHash, randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createAuthServer } from "@cognito-kit/local-auth"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..", "..")

const ISSUER = "http://localhost:9876"
const CLIENT_ID = "dev-client"
const NODE_API_PORT = 3001

const authServer = createAuthServer({
  issuer: ISSUER,
  users: [
    { id: "dev_alice", email: "alice@example.com", password: "password", claims: {} },
    {
      id: "dev_admin",
      email: "admin@example.com",
      password: "password",
      claims: { role: "admin" },
    },
  ],
})
await authServer.start()

const nodeApi = spawn("node", ["server.mjs"], {
  cwd: join(root, "examples", "node-api"),
  env: {
    ...process.env,
    PORT: String(NODE_API_PORT),
    CK_ISSUER: ISSUER,
    CK_JWKS_URL: `${ISSUER}/.well-known/jwks.json`,
    CK_AUDIENCE: CLIENT_ID,
  },
  stdio: "inherit",
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(`http://localhost:${NODE_API_PORT}/health`)
    if (res.ok) break
  } catch {
    /* retry */
  }
  await sleep(250)
}

console.log("")
console.log("── cognito-kit dev demo ──────────────────────────────────")
console.log("")
console.log(`  Local auth server: ${ISSUER}`)
console.log(`  Node API example:  http://localhost:${NODE_API_PORT}`)
console.log("")
console.log("  Performing a real login flow (alice@example.com)…")
console.log("")

const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`).then((r) => r.json())
const verifier = randomBytes(32).toString("base64url")
const challenge = createHash("sha256").update(verifier).digest("base64url")

const authorizeUrl = new URL(discovery.authorization_endpoint)
authorizeUrl.searchParams.set("response_type", "code")
authorizeUrl.searchParams.set("client_id", CLIENT_ID)
authorizeUrl.searchParams.set("redirect_uri", "http://localhost:3000/auth/callback")
authorizeUrl.searchParams.set("scope", "openid email profile")
authorizeUrl.searchParams.set("code_challenge", challenge)
authorizeUrl.searchParams.set("code_challenge_method", "S256")

await fetch(authorizeUrl)

const loginRes = await fetch(`${ISSUER}/login`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    username: "alice@example.com",
    password: "password",
    client_id: CLIENT_ID,
    redirect_uri: "http://localhost:3000/auth/callback",
    scope: "openid email profile",
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString(),
  redirect: "manual",
})
const code = new URL(loginRes.headers.get("location")).searchParams.get("code")

const tokenRes = await fetch(discovery.token_endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: "http://localhost:3000/auth/callback",
    client_id: CLIENT_ID,
    code_verifier: verifier,
  }).toString(),
})
const tokens = await tokenRes.json()

const me = await fetch(`http://localhost:${NODE_API_PORT}/api/me`, {
  headers: { Authorization: `Bearer ${tokens.id_token}` },
})
const meBody = await me.json()

console.log("  ✓ discovery → login → authorization code → PKCE → token exchange")
console.log("  ✓ JWT verified by the Node API (same contract as Cognito)")
console.log(`  ✓ authenticated user: ${meBody.user.email} (id: ${meBody.user.id})`)
console.log("")
console.log("  Next.js example (optional):")
console.log("")
console.log("    pnpm --dir examples/nextjs dev")
console.log("    open http://localhost:3000")
console.log("")
console.log("  Press Ctrl+C to stop.")
console.log("")

const shutdown = async () => {
  nodeApi.kill("SIGTERM")
  await authServer.stop()
  process.exit(0)
}
process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

await new Promise(() => {})
