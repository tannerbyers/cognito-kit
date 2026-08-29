import { createServer } from "node:http"
import { createRemoteTokenVerifier, normalizeUser } from "@cognito-kit/runtime"

/**
 * Node API example.
 *
 * A dependency-free HTTP server that protects endpoints with the same
 * runtime validation contract used in production against Cognito.
 *
 * Environment:
 *   PORT      - listen port (default 3001)
 *   CK_ISSUER - expected token issuer (default http://localhost:9876)
 *   CK_JWKS_URL - JWKS endpoint (default http://localhost:9876/.well-known/jwks.json)
 *   CK_AUDIENCE - expected audience (default dev-client)
 */

const PORT = Number(process.env.PORT ?? 3001)
const ISSUER = process.env.CK_ISSUER ?? "http://localhost:9876"
const JWKS_URL = process.env.CK_JWKS_URL ?? "http://localhost:9876/.well-known/jwks.json"
const AUDIENCE = process.env.CK_AUDIENCE ?? "dev-client"

const verifier = createRemoteTokenVerifier({
  issuer: ISSUER,
  jwksUrl: JWKS_URL,
  audience: AUDIENCE,
})

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

async function authenticate(req) {
  const header = req.headers.authorization ?? ""
  if (!header.startsWith("Bearer ")) return null
  const token = header.slice(7)
  try {
    const { payload } = await verifier.verify(token)
    return normalizeUser(payload)
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`)

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, { ok: true, issuer: ISSUER })
    return
  }

  if (req.method === "GET" && url.pathname === "/api/me") {
    const user = await authenticate(req)
    if (!user) {
      sendJson(res, 401, { error: "unauthorized", message: "missing or invalid bearer token" })
      return
    }
    sendJson(res, 200, { user })
    return
  }

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
    res.end(
      [
        "cognito-kit node-api example",
        "",
        `issuer: ${ISSUER}`,
        "",
        "GET /health     -> service status",
        "GET /api/me     -> protected; requires Authorization: Bearer <id_token>",
        "",
        "Try:",
        `  curl http://localhost:${PORT}/api/me`,
      ].join("\n"),
    )
    return
  }

  sendJson(res, 404, { error: "not_found" })
})

server.listen(PORT, () => {
  console.log(`node-api example listening on http://localhost:${PORT}`)
  console.log(`verifying tokens from ${ISSUER} (audience: ${AUDIENCE})`)
})
