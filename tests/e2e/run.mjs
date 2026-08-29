import { createHash, randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createAuthServer } from "@cognito-kit/local-auth"

/**
 * Layer 4 — end-to-end tests.
 *
 * Runs the example applications against `cognito-kit dev` (the local OIDC
 * server) and proves complete authentication flows work over HTTP.
 *
 * No AWS. Run with: pnpm test:e2e
 */

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..", "..")

const ISSUER = "http://localhost:9876"
const CLIENT_ID = "dev-client"
const NODE_API_PORT = 3001
const NEXT_PORT = 3000

let failures = 0

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function runProcess(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...opts, stdio: "inherit" })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`))
    })
  })
}

async function waitFor(url, timeoutMs = 60000, label = url) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return
    } catch {
      /* not ready yet */
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${label}`)
}

function makeCookieJar() {
  const cookies = new Map()
  return {
    apply(res) {
      for (const sc of res.headers.getSetCookie?.() ?? []) {
        const [pair] = sc.split(";")
        const idx = pair.indexOf("=")
        const name = pair.slice(0, idx).trim()
        const value = pair.slice(idx + 1).trim()
        if (value === "" || sc.toLowerCase().includes("max-age=0")) cookies.delete(name)
        else cookies.set(name, value)
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
    },
  }
}

async function obtainTokens({ username, password }) {
  const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`).then((r) => r.json())
  const verifier = randomBytes(32).toString("base64url")
  const challenge = createHash("sha256").update(verifier).digest("base64url")
  const state = randomBytes(8).toString("hex")

  const authorizeUrl = new URL(discovery.authorization_endpoint)
  authorizeUrl.searchParams.set("response_type", "code")
  authorizeUrl.searchParams.set("client_id", CLIENT_ID)
  authorizeUrl.searchParams.set("redirect_uri", "http://localhost:3000/auth/callback")
  authorizeUrl.searchParams.set("scope", "openid email profile")
  authorizeUrl.searchParams.set("state", state)
  authorizeUrl.searchParams.set("code_challenge", challenge)
  authorizeUrl.searchParams.set("code_challenge_method", "S256")

  const loginPage = await fetch(authorizeUrl)
  if (loginPage.status !== 200)
    throw new Error(`authorize did not render login page (${loginPage.status})`)

  const loginRes = await fetch(`${ISSUER}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      username,
      password,
      client_id: CLIENT_ID,
      redirect_uri: "http://localhost:3000/auth/callback",
      scope: "openid email profile",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString(),
    redirect: "manual",
  })
  const location = loginRes.headers.get("location")
  if (!location) throw new Error("login did not redirect with a code")
  const code = new URL(location).searchParams.get("code")

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
  if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`)
  return tokenRes.json()
}

async function testNodeApi() {
  console.log("\n1) Node API example")
  const tokens = await obtainTokens({ username: "alice@example.com", password: "password" })

  const health = await fetch(`http://localhost:${NODE_API_PORT}/health`)
  check("GET /health returns 200", health.status === 200)

  const unauthorized = await fetch(`http://localhost:${NODE_API_PORT}/api/me`)
  check("GET /api/me without token returns 401", unauthorized.status === 401)

  const authorized = await fetch(`http://localhost:${NODE_API_PORT}/api/me`, {
    headers: { Authorization: `Bearer ${tokens.id_token}` },
  })
  const me = await authorized.json()
  check("GET /api/me with token returns 200", authorized.status === 200)
  check(
    "returns the normalized user",
    me.user?.email === "alice@example.com" && me.user?.id === "dev_alice",
    JSON.stringify(me.user),
  )
}

async function testNextjs() {
  console.log("\n2) Next.js example")
  const jar = makeCookieJar()

  const home = await fetch(`http://localhost:${NEXT_PORT}/`)
  check("GET / returns 200", home.status === 200)

  // Protected page without a session redirects into the auth flow.
  const protectedNoSession = await fetch(`http://localhost:${NEXT_PORT}/protected`, {
    redirect: "manual",
  })
  check("GET /protected without session redirects", [302, 307].includes(protectedNoSession.status))

  // Start the PKCE flow through the app.
  const signin = await fetch(`http://localhost:${NEXT_PORT}/auth/signin`, { redirect: "manual" })
  jar.apply(signin)
  check(
    "GET /auth/signin redirects to the provider",
    [302, 307, 308].includes(signin.status),
    `status ${signin.status}`,
  )
  const authorizeUrl = signin.headers.get("location")
  check(
    "redirect target is the authorization endpoint",
    authorizeUrl?.startsWith(`${ISSUER}/authorize`),
  )

  // Follow to the login page.
  const loginPage = await fetch(authorizeUrl, { headers: { Cookie: jar.header() } })
  check("authorization endpoint renders the login page", loginPage.status === 200)

  // A browser submits the login form including its hidden OAuth fields.
  const loginHtml = await loginPage.text()
  const hiddenInputs = [
    ...loginHtml.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)" \/>/g),
  ].map((m) => [m[1], m[2]])
  const loginForm = new URLSearchParams([
    ["username", "alice@example.com"],
    ["password", "password"],
    ...hiddenInputs,
  ])

  // Submit credentials; the app's callback receives the code.
  const loginRes = await fetch(`${ISSUER}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: loginForm.toString(),
    redirect: "manual",
  })
  const callbackUrl = loginRes.headers.get("location")
  check(
    "login redirects to the app callback",
    callbackUrl?.startsWith("http://localhost:3000/auth/callback"),
  )

  const callback = await fetch(callbackUrl, {
    redirect: "manual",
    headers: { Cookie: jar.header() },
  })
  jar.apply(callback)
  check(
    "callback sets a session cookie",
    jar.header().includes("ck_session="),
    `cookie jar: ${jar.header() || "(empty)"}`,
  )

  const me = await fetch(`http://localhost:${NEXT_PORT}/api/me`, {
    headers: { Cookie: jar.header() },
  })
  const meBody = await me.json()
  check(
    "GET /api/me with session returns the user",
    me.status === 200 && meBody.user?.email === "alice@example.com",
    `status ${me.status}`,
  )

  const protectedPage = await fetch(`http://localhost:${NEXT_PORT}/protected`, {
    headers: { Cookie: jar.header() },
  })
  const protectedHtml = await protectedPage.text()
  check(
    "GET /protected with session renders user data",
    protectedPage.status === 200 && protectedHtml.includes("alice@example.com"),
  )

  const signout = await fetch(`http://localhost:${NEXT_PORT}/auth/signout`, {
    redirect: "manual",
    headers: { Cookie: jar.header() },
  })
  check(
    "signout redirects to the provider logout",
    [302, 307, 308].includes(signout.status) &&
      signout.headers.get("location")?.includes("/logout"),
    `status ${signout.status}`,
  )
}

async function main() {
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
  console.log(`local auth server: ${authServer.issuer}`)

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

  const nextEnv = {
    ...process.env,
    PORT: String(NEXT_PORT),
    CK_ISSUER: ISSUER,
    CK_JWKS_URL: `${ISSUER}/.well-known/jwks.json`,
    CK_CLIENT_ID: CLIENT_ID,
    CK_REDIRECT_URI: `http://localhost:${NEXT_PORT}/auth/callback`,
    CK_LOGOUT_REDIRECT_URI: `http://localhost:${NEXT_PORT}`,
  }

  // Build the Next.js app before starting the production server.
  console.log("building next.js example…")
  await runProcess("pnpm", ["build"], {
    cwd: join(root, "examples", "nextjs"),
    env: nextEnv,
  })

  const nextStart = spawn("pnpm", ["start"], {
    cwd: join(root, "examples", "nextjs"),
    env: nextEnv,
    stdio: "inherit",
  })

  try {
    await waitFor(`http://localhost:${NODE_API_PORT}/health`, 30000, "node-api")
    await waitFor(`http://localhost:${NEXT_PORT}/`, 90000, "next.js")
    await testNodeApi()
    await testNextjs()
  } finally {
    nodeApi.kill("SIGTERM")
    nextStart.kill("SIGTERM")
    await authServer.stop()
  }

  console.log("")
  if (failures > 0) {
    console.log(`e2e FAILED with ${failures} failure(s)`)
    process.exit(1)
  }
  console.log("e2e passed")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
