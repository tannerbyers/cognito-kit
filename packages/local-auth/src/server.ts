import { createServer } from "node:http"
import type { IncomingMessage, ServerResponse } from "node:http"
import { exportJWK, generateKeyPair, SignJWT, jwtVerify } from "jose"
import type { JWK, KeyLike } from "jose"
import { randomBase64Url, verifyPkce } from "./pkce.js"
import type {
  AuthServerHandle,
  AuthServerOptions,
  LocalClient,
  LocalUser,
  TokenDurations,
} from "./types.js"
import { DEFAULT_TOKEN_DURATIONS, DEFAULT_PORT } from "./types.js"
import { defaultUsers, findUserByEmail, stripPasswords, verifyPassword } from "./users.js"

const SESSION_COOKIE = "ck_local_session"

interface PendingAuthorization {
  clientId: string
  redirectUri: string
  scope: string
  state: string | null
  codeChallenge: string | null
  codeChallengeMethod: string | null
  nonce: string | null
}

interface AuthCodeRecord extends PendingAuthorization {
  code: string
  user: LocalUser
  expiresAt: number
  used: boolean
}

interface RefreshTokenRecord {
  token: string
  user: LocalUser
  clientId: string
  scope: string
  expiresAt: number
}

interface SigningKeys {
  privateKey: KeyLike
  publicKey: KeyLike
  publicKeyJwk: JWK
}

async function loadOrCreateKeys(options: AuthServerOptions): Promise<SigningKeys> {
  if (options.jwt?.privateKeyJwk && options.jwt?.publicKeyJwk) {
    const { importJWK } = await import("jose")
    const privateKey = (await importJWK(options.jwt.privateKeyJwk, "RS256")) as KeyLike
    const publicKey = (await importJWK(options.jwt.publicKeyJwk, "RS256")) as KeyLike
    return { privateKey, publicKey, publicKeyJwk: options.jwt.publicKeyJwk }
  }
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const publicKeyJwk = await exportJWK(publicKey)
  return { privateKey, publicKey, publicKeyJwk }
}

export function createAuthServer(options: AuthServerOptions = {}): AuthServerHandle {
  const users: LocalUser[] = options.users ?? defaultUsers()
  const clients: LocalClient[] = options.clients ?? []
  const tokenDurations: TokenDurations = {
    ...DEFAULT_TOKEN_DURATIONS,
    ...options.tokenDurations,
  }
  const logger = options.logger ?? console
  const host = options.host ?? "127.0.0.1"

  const authCodes = new Map<string, AuthCodeRecord>()
  const refreshTokens = new Map<string, RefreshTokenRecord>()
  let server: ReturnType<typeof createServer> | null = null
  let signingKeys: SigningKeys | null = null
  let boundPort = 0
  let issuer = options.issuer ?? `http://localhost:${options.port ?? DEFAULT_PORT}`

  async function keys(): Promise<SigningKeys> {
    if (!signingKeys) signingKeys = await loadOrCreateKeys(options)
    return signingKeys
  }

  function isKnownClient(clientId: string): boolean {
    if (clients.length === 0) return true
    return clients.some((c) => c.clientId === clientId)
  }

  function isAllowedCallback(clientId: string, redirectUri: string): boolean {
    const client = clients.find((c) => c.clientId === clientId)
    if (!client || !client.callbackUrls || client.callbackUrls.length === 0) return true
    return client.callbackUrls.includes(redirectUri)
  }

  function isAllowedLogout(clientId: string | null, redirectUri: string): boolean {
    if (!clientId) return true
    const client = clients.find((c) => c.clientId === clientId)
    if (!client || !client.logoutUrls || client.logoutUrls.length === 0) return true
    return client.logoutUrls.includes(redirectUri)
  }

  /* ---------------- HTTP plumbing ---------------- */

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Length": Buffer.byteLength(payload),
    })
    res.end(payload)
  }

  function sendHtml(res: ServerResponse, status: number, html: string): void {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" })
    res.end(html)
  }

  function redirect(
    res: ServerResponse,
    location: string,
    extraHeaders: Record<string, string> = {},
  ): void {
    res.writeHead(302, { Location: location, ...extraHeaders })
    res.end()
  }

  async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString("utf8")
  }

  function parseForm(body: string): Record<string, string> {
    const params = new URLSearchParams(body)
    const out: Record<string, string> = {}
    for (const [k, v] of params) out[k] = v
    return out
  }

  function getCookies(req: IncomingMessage): Record<string, string> {
    const header = req.headers.cookie ?? ""
    const out: Record<string, string> = {}
    for (const part of header.split(";")) {
      const idx = part.indexOf("=")
      if (idx === -1) continue
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
    }
    return out
  }

  /* ---------------- OAuth logic ---------------- */

  function validateAuthorizeParams(params: URLSearchParams): PendingAuthorization | string {
    const responseType = params.get("response_type")
    const clientId = params.get("client_id")
    const redirectUri = params.get("redirect_uri")
    const scope = params.get("scope") ?? "openid"

    if (responseType !== "code") return "unsupported_response_type"
    if (!clientId) return "invalid_request"
    if (!isKnownClient(clientId)) return "unauthorized_client"
    if (!redirectUri) return "invalid_request"
    if (!isAllowedCallback(clientId, redirectUri)) return "invalid_redirect_uri"

    return {
      clientId,
      redirectUri,
      scope,
      state: params.get("state"),
      codeChallenge: params.get("code_challenge"),
      codeChallengeMethod: params.get("code_challenge_method"),
      nonce: params.get("nonce"),
    }
  }

  function authorizeErrorRedirect(
    res: ServerResponse,
    redirectUri: string,
    error: string,
    state: string | null,
  ): void {
    const url = new URL(redirectUri)
    url.searchParams.set("error", error)
    if (state) url.searchParams.set("state", state)
    redirect(res, url.toString())
  }

  function issueAuthCode(auth: PendingAuthorization, user: LocalUser): string {
    const code = randomBase64Url(24)
    authCodes.set(code, {
      ...auth,
      code,
      user,
      expiresAt: Date.now() + 5 * 60 * 1000,
      used: false,
    })
    return code
  }

  async function signTokens(
    user: LocalUser,
    clientId: string,
    scope: string,
    nonce: string | null,
  ): Promise<{ idToken: string; accessToken: string; expiresIn: number }> {
    const { privateKey } = await keys()
    const now = Math.floor(Date.now() / 1000)
    const idExp = now + tokenDurations.idTokenMinutes * 60
    const accessExp = now + tokenDurations.accessTokenMinutes * 60

    const idClaims: Record<string, unknown> = {
      sub: user.id,
      email: user.email,
      email_verified: user.emailVerified ?? true,
      ...(user.claims ?? {}),
    }
    if (nonce) idClaims.nonce = nonce

    const idToken = await new SignJWT(idClaims)
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(idExp)
      .setJti(randomBase64Url(12))
      .sign(privateKey)

    const accessToken = await new SignJWT({
      scope,
      client_id: clientId,
      token_use: "access",
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(issuer)
      .setAudience(clientId)
      .setSubject(user.id)
      .setIssuedAt(now)
      .setExpirationTime(accessExp)
      .setJti(randomBase64Url(12))
      .sign(privateKey)

    return { idToken, accessToken, expiresIn: tokenDurations.accessTokenMinutes * 60 }
  }

  async function issueRefreshToken(
    user: LocalUser,
    clientId: string,
    scope: string,
  ): Promise<string> {
    const token = randomBase64Url(32)
    refreshTokens.set(token, {
      token,
      user,
      clientId,
      scope,
      expiresAt: Date.now() + tokenDurations.refreshTokenDays * 24 * 60 * 60 * 1000,
    })
    return token
  }

  /* ---------------- Pages ---------------- */

  function loginPage(error: string | null): string {
    const errHtml = error ? `<p class="error">${escapeHtml(error)}</p>` : ""
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>cognito-kit local auth</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f6f7f9; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  .card { background: #fff; border: 1px solid #e2e5ea; border-radius: 10px; padding: 2rem; width: 340px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size: 1.15rem; margin: 0 0 .25rem; }
  .sub { color: #667; font-size: .85rem; margin-bottom: 1.25rem; }
  label { display: block; font-size: .8rem; margin: .75rem 0 .25rem; color: #334; }
  input { width: 100%; box-sizing: border-box; padding: .5rem .6rem; border: 1px solid #c9ced6; border-radius: 6px; font-size: .9rem; }
  button { margin-top: 1.25rem; width: 100%; padding: .55rem; border: 0; border-radius: 6px; background: #1d4ed8; color: #fff; font-size: .9rem; cursor: pointer; }
  .error { color: #b91c1c; font-size: .85rem; margin: .5rem 0; }
  .hint { margin-top: 1rem; font-size: .75rem; color: #889; text-align: center; }
</style>
</head>
<body>
<form method="post" action="${escapeHtml(issuer)}/login" class="card">
  <h1>cognito-kit local auth</h1>
  <p class="sub">Development sign-in — no AWS involved</p>
  ${errHtml}
  <label for="username">Email</label>
  <input id="username" name="username" type="text" autocomplete="username" required />
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required />
  <button type="submit">Sign in</button>
  <p class="hint">Default dev users: alice@example.com / admin@example.com (password: password)</p>
</form>
</body>
</html>`
  }

  function homePage(): string {
    const userList = stripPasswords(users)
      .map((u) => `<li><code>${escapeHtml(u.email)}</code></li>`)
      .join("")
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>cognito-kit local auth</title></head>
<body>
<h1>cognito-kit local auth</h1>
<p>Issuer: <code>${escapeHtml(issuer)}</code></p>
<p>Endpoints:</p>
<ul>
  <li><code>${escapeHtml(issuer)}/.well-known/openid-configuration</code></li>
  <li><code>${escapeHtml(issuer)}/.well-known/jwks.json</code></li>
  <li><code>${escapeHtml(issuer)}/authorize</code></li>
  <li><code>${escapeHtml(issuer)}/token</code></li>
  <li><code>${escapeHtml(issuer)}/userinfo</code></li>
  <li><code>${escapeHtml(issuer)}/logout</code></li>
</ul>
<p>Users:</p>
<ul>${userList}</ul>
</body>
</html>`
  }

  /* ---------------- Handlers ---------------- */

  async function handleAuthorize(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", issuer)
    const params = url.searchParams
    const auth = validateAuthorizeParams(params)
    if (typeof auth === "string") {
      const redirectUri = params.get("redirect_uri")
      if (redirectUri && validateAuthorizeParams(params) !== "invalid_redirect_uri") {
        authorizeErrorRedirect(res, redirectUri, auth, params.get("state"))
      } else {
        sendHtml(res, 400, loginPage(`Invalid authorization request: ${auth}`))
      }
      return
    }

    const cookies = getCookies(req)
    const sessionUserId = cookies[SESSION_COOKIE]
    const sessionUser = sessionUserId ? users.find((u) => u.id === sessionUserId) : undefined

    if (sessionUser) {
      const code = issueAuthCode(auth, sessionUser)
      const callback = new URL(auth.redirectUri)
      callback.searchParams.set("code", code)
      if (auth.state) callback.searchParams.set("state", auth.state)
      redirect(res, callback.toString())
      return
    }

    // No session: render the login form carrying the OAuth request along.
    const hidden = [
      ["client_id", auth.clientId],
      ["redirect_uri", auth.redirectUri],
      ["scope", auth.scope],
      ["state", auth.state],
      ["code_challenge", auth.codeChallenge],
      ["code_challenge_method", auth.codeChallengeMethod],
      ["nonce", auth.nonce],
    ]
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(String(v))}" />`)
      .join("\n")

    sendHtml(res, 200, loginPage(null).replace("</form>", `${hidden}\n</form>`))
  }

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    const form = parseForm(body)
    const username = form.username ?? ""
    const password = form.password ?? ""

    const user = findUserByEmail(users, username)
    if (!user || !verifyPassword(user, password)) {
      sendHtml(res, 200, loginPage("Invalid email or password."))
      return
    }

    const pending: PendingAuthorization = {
      clientId: form.client_id,
      redirectUri: form.redirect_uri,
      scope: form.scope ?? "openid",
      state: form.state ?? null,
      codeChallenge: form.code_challenge ?? null,
      codeChallengeMethod: form.code_challenge_method ?? null,
      nonce: form.nonce ?? null,
    }

    if (!pending.clientId || !pending.redirectUri) {
      sendHtml(res, 400, loginPage("Authorization request is missing client_id or redirect_uri."))
      return
    }

    const code = issueAuthCode(pending, user)
    const callback = new URL(pending.redirectUri)
    callback.searchParams.set("code", code)
    if (pending.state) callback.searchParams.set("state", pending.state)

    redirect(res, callback.toString(), {
      "Set-Cookie": `${SESSION_COOKIE}=${user.id}; Path=/; HttpOnly; SameSite=Lax`,
    })
  }

  async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req)
    const form = parseForm(body)
    const grantType = form.grant_type

    if (grantType === "authorization_code") {
      const record = authCodes.get(form.code ?? "")
      if (!record || record.used) {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "unknown or used authorization code",
        })
        return
      }
      if (record.expiresAt < Date.now()) {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "authorization code expired",
        })
        return
      }
      if (form.redirect_uri && form.redirect_uri !== record.redirectUri) {
        sendJson(res, 400, { error: "invalid_grant", error_description: "redirect_uri mismatch" })
        return
      }
      if (form.client_id && form.client_id !== record.clientId) {
        sendJson(res, 400, { error: "invalid_grant", error_description: "client_id mismatch" })
        return
      }
      if (!verifyPkce(record.codeChallenge, record.codeChallengeMethod, form.code_verifier)) {
        sendJson(res, 400, {
          error: "invalid_grant",
          error_description: "PKCE verification failed",
        })
        return
      }

      record.used = true
      const { idToken, accessToken, expiresIn } = await signTokens(
        record.user,
        record.clientId,
        record.scope,
        record.nonce,
      )
      const refreshToken = await issueRefreshToken(record.user, record.clientId, record.scope)
      sendJson(res, 200, {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: "Bearer",
        expires_in: expiresIn,
      })
      return
    }

    if (grantType === "refresh_token") {
      const record = refreshTokens.get(form.refresh_token ?? "")
      if (!record || record.expiresAt < Date.now()) {
        sendJson(res, 400, { error: "invalid_grant", error_description: "invalid refresh token" })
        return
      }
      const { idToken, accessToken, expiresIn } = await signTokens(
        record.user,
        record.clientId,
        record.scope,
        null,
      )
      sendJson(res, 200, {
        id_token: idToken,
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
      })
      return
    }

    sendJson(res, 400, {
      error: "unsupported_grant_type",
      error_description: `grant_type ${grantType}`,
    })
  }

  async function handleUserinfo(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers.authorization ?? ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : null
    if (!token) {
      sendJson(res, 401, { error: "invalid_token", error_description: "missing bearer token" })
      return
    }
    try {
      const { publicKey } = await keys()
      const { payload } = await jwtVerify(token, publicKey, { issuer })
      const user = users.find((u) => u.id === payload.sub)
      if (!user) {
        sendJson(res, 401, { error: "invalid_token", error_description: "unknown subject" })
        return
      }
      sendJson(res, 200, {
        sub: user.id,
        email: user.email,
        email_verified: user.emailVerified ?? true,
        ...(user.claims ?? {}),
      })
    } catch {
      sendJson(res, 401, { error: "invalid_token", error_description: "token verification failed" })
    }
  }

  async function handleLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", issuer)
    const postLogout = url.searchParams.get("post_logout_redirect_uri")
    const clientId = url.searchParams.get("client_id")
    const idTokenHint = url.searchParams.get("id_token_hint")
    const logoutUrl = url.searchParams.get("logout_uri")

    const target = postLogout ?? logoutUrl
    if (target && isAllowedLogout(clientId, target)) {
      redirect(res, target, {
        "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      })
      return
    }
    if (idTokenHint) {
      // Nothing to validate locally; just clear the session.
      redirect(res, `${issuer}/`, {
        "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      })
      return
    }
    sendHtml(res, 200, "<h1>Signed out</h1><p>Your local session was cleared.</p>")
  }

  /* ---------------- Server ---------------- */

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", issuer)
    const path = url.pathname

    try {
      if (req.method === "GET" && path === "/.well-known/openid-configuration") {
        sendJson(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/.well-known/jwks.json`,
          end_session_endpoint: `${issuer}/logout`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["openid", "email", "profile"],
          claims_supported: ["sub", "email", "email_verified"],
        })
        return
      }

      if (req.method === "GET" && path === "/.well-known/jwks.json") {
        const { publicKeyJwk } = await keys()
        sendJson(res, 200, { keys: [publicKeyJwk] })
        return
      }

      if (req.method === "GET" && path === "/authorize") {
        await handleAuthorize(req, res)
        return
      }

      if (req.method === "POST" && path === "/login") {
        await handleLogin(req, res)
        return
      }

      if (req.method === "POST" && path === "/token") {
        await handleToken(req, res)
        return
      }

      if (req.method === "GET" && path === "/userinfo") {
        await handleUserinfo(req, res)
        return
      }

      if (req.method === "GET" && path === "/logout") {
        await handleLogout(req, res)
        return
      }

      if (req.method === "GET" && path === "/") {
        sendHtml(res, 200, homePage())
        return
      }

      sendJson(res, 404, { error: "not_found", error_description: `no handler for ${path}` })
    } catch (err) {
      logger.error("local-auth error:", err)
      if (!res.headersSent) {
        sendJson(res, 500, { error: "server_error", error_description: "internal error" })
      }
    }
  }

  return {
    // Live getter: `issuer` is resolved once the server binds its port.
    get issuer(): string {
      return issuer
    },
    async start(port?: number) {
      if (server) return { port: boundPort, url: issuer }
      await keys()
      server = createServer((req, res) => {
        void handle(req, res)
      })
      await new Promise<void>((resolve, reject) => {
        server!.once("error", reject)
        server!.listen(port ?? options.port ?? DEFAULT_PORT, host, () => resolve())
      })
      const address = server.address()
      boundPort =
        typeof address === "object" && address
          ? address.port
          : (port ?? options.port ?? DEFAULT_PORT)
      issuer = options.issuer ?? `http://localhost:${boundPort}`
      return { port: boundPort, url: issuer }
    },
    async stop() {
      if (!server) return
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()))
      })
      server = null
    },
    jwks() {
      return { keys: [signingKeys?.publicKeyJwk].filter((k): k is JWK => Boolean(k)) }
    },
    users() {
      return stripPasswords(users)
    },
    clients() {
      return clients
    },
    isListening() {
      return server !== null
    },
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
