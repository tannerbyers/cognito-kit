import type { JWK } from "jose"

/** A development user. Passwords are plain text — this is a local dev tool. */
export interface LocalUser {
  /** Maps to the `sub` claim. */
  id: string
  email: string
  password: string
  /** Extra claims to embed in ID tokens (e.g. `{ role: "admin" }`). */
  claims?: Record<string, unknown>
  emailVerified?: boolean
}

export interface LocalClient {
  clientId: string
  clientName?: string
  callbackUrls?: string[]
  logoutUrls?: string[]
}

export interface TokenDurations {
  idTokenMinutes: number
  accessTokenMinutes: number
  refreshTokenDays: number
}

export interface AuthServerOptions {
  /** Issuer URL, e.g. `http://localhost:9876`. Defaults to `http://localhost:<port>`. */
  issuer?: string
  host?: string
  port?: number
  users?: LocalUser[]
  clients?: LocalClient[]
  tokenDurations?: Partial<TokenDurations>
  /**
   * Persisted development signing keys. When omitted, an ephemeral RSA key
   * pair is generated on start.
   */
  jwt?: {
    privateKeyJwk?: JWK
    publicKeyJwk?: JWK
  }
  /** Custom logger. Defaults to console. */
  logger?: Pick<Console, "log" | "error">
}

export interface AuthServerHandle {
  /** The resolved issuer URL. */
  issuer: string
  /** Starts listening. Resolves with the bound port. */
  start(port?: number): Promise<{ port: number; url: string }>
  /** Stops listening and releases resources. */
  stop(): Promise<void>
  /** Current public JWKS. */
  jwks(): { keys: JWK[] }
  /** The configured users (passwords stripped). */
  users(): Array<Omit<LocalUser, "password">>
  /** The configured clients. */
  clients(): LocalClient[]
  /** Whether the server is currently listening. */
  isListening(): boolean
}

export const DEFAULT_TOKEN_DURATIONS: TokenDurations = {
  idTokenMinutes: 60,
  accessTokenMinutes: 60,
  refreshTokenDays: 30,
}

export const DEFAULT_PORT = 9876
