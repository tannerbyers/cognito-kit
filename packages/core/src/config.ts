/**
 * The developer-facing safety configuration model.
 *
 * This deliberately exposes a tiny surface. Almost every Cognito knob is
 * hidden behind safe defaults (see {@link DEFAULT_TOKEN_SETTINGS} and the
 * `normalize` module) so that developers cannot accidentally configure
 * insecure behavior.
 */

/** How users sign in. `username` exists for migration scenarios only. */
export type SignInMode = "email" | "username"

/**
 * Application classification.
 *
 * - `web`   : confidential client (server-side web app). A client secret is
 *             generated and the authorization-code + PKCE flow is enabled.
 * - `spa`   : public client (browser). No secret. Authorization code + PKCE.
 * - `mobile`: public client (native app). No secret. Authorization code + PKCE.
 */
export type ApplicationType = "web" | "spa" | "mobile"

export interface ApplicationConfig {
  type: ApplicationType
  /** Exact redirect URIs (no wildcards). Localhost is allowed in development. */
  callbackUrls: string[]
  /** Exact post-logout redirect URIs. */
  logoutUrls: string[]
  /** Optional display name for the app client. Defaults to `<name>` app. */
  clientName?: string
  /**
   * OAuth scopes. Defaults to `["openid", "email", "profile"]`.
   * OpenID Connect requires `openid`.
   */
  scopes?: string[]
}

export interface TokenSettings {
  /** ID token lifetime in minutes. Default 60. */
  idTokenMinutes?: number
  /** Access token lifetime in minutes. Default 60. */
  accessTokenMinutes?: number
  /** Refresh token lifetime in days. Default 30. */
  refreshTokenDays?: number
}

export interface AuthConfig {
  /** Human-readable name used as the user pool / resources prefix. Default `"app"`. */
  name?: string
  signIn: SignInMode
  application: ApplicationConfig
  token?: TokenSettings
}

export const DEFAULT_SCOPES = ["openid", "email", "profile"] as const

export const DEFAULT_TOKEN_SETTINGS = {
  idTokenMinutes: 60,
  accessTokenMinutes: 60,
  refreshTokenDays: 30,
} as const

/**
 * Type-level helper for authoring a configuration file.
 *
 * ```ts
 * import { defineAuth } from "@cognito-kit/core"
 *
 * export default defineAuth({
 *   signIn: "email",
 *   application: {
 *     type: "web",
 *     callbackUrls: ["http://localhost:3000/auth/callback"],
 *     logoutUrls: ["http://localhost:3000"],
 *   },
 * })
 * ```
 *
 * `defineAuth` is an identity function at runtime; it exists so that editors
 * type-check the configuration and so the file can later be consumed by the
 * CLI. It performs no I/O and never throws.
 */
export function defineAuth(config: AuthConfig): AuthConfig {
  return config
}

export function tokenSettingsOf(config: Pick<AuthConfig, "token">): RequiredTokenSettings {
  return {
    idTokenMinutes: config.token?.idTokenMinutes ?? DEFAULT_TOKEN_SETTINGS.idTokenMinutes,
    accessTokenMinutes:
      config.token?.accessTokenMinutes ?? DEFAULT_TOKEN_SETTINGS.accessTokenMinutes,
    refreshTokenDays: config.token?.refreshTokenDays ?? DEFAULT_TOKEN_SETTINGS.refreshTokenDays,
  }
}

export type RequiredTokenSettings = {
  idTokenMinutes: number
  accessTokenMinutes: number
  refreshTokenDays: number
}
