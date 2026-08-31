import type { AuthConfig } from "./config.js"
import { DEFAULT_SCOPES, tokenSettingsOf } from "./config.js"
import { assertValidAuthConfig } from "./validate.js"

/**
 * The normalized, plain-JSON representation of a Cognito user pool.
 *
 * This is the single contract shared by:
 *  - the safe configuration model (produced by {@link normalizeConfig})
 *  - the diagnostics engine (consumed by {@link diagnoseUserPool})
 *  - the CDK construct (consumed to synthesize CloudFormation)
 *  - the CLI `doctor --file` (fixtures are normalized JSON documents)
 *
 * It is deliberately provider-shaped-but-plain: no classes, no functions,
 * fully serializable. Future AWS adapters convert AWS SDK responses into this
 * same shape so that diagnosis works identically for local fixtures and for
 * real AWS state.
 */

export interface NormalizedCustomAttribute {
  name: string
  type: "string" | "number" | "boolean" | "datetime"
  mutable: boolean
  required: boolean
}

export interface NormalizedAppClient {
  clientId: string
  clientName: string
  generateSecret: boolean
  callbackUrls: string[]
  logoutUrls: string[]
  allowedOAuthFlows: {
    authorizationCodeGrant: boolean
    implicitFlow: boolean
    clientCredentials: boolean
    userPassword: boolean
  }
  allowedOAuthScopes: string[]
  tokenValidity: {
    idTokenMinutes: number
    accessTokenMinutes: number
    refreshTokenDays: number
  }
}

export type AccountRecoveryMethod = "email" | "phone" | "admin_only"

export interface NormalizedPoolConfig {
  formatVersion: 1
  /** Schema version of the config this document was derived from. */
  schemaVersion: 1
  provider: "cognito"
  /** Human-readable pool name. */
  name: string
  /** Cognito user pool id, when known (e.g. `us-east-1_AbCdE`). */
  userPoolId?: string
  usernameConfiguration: {
    caseSensitive: boolean
  }
  signIn: {
    email: boolean
    username: boolean
    phone: boolean
  }
  /** Attributes that are automatically verified on sign-up / sign-in. */
  autoVerifiedAttributes: string[]
  verification: {
    email: "required" | "optional" | "disabled"
    phone: "required" | "optional" | "disabled"
  }
  requiredAttributes: string[]
  customAttributes: NormalizedCustomAttribute[]
  mfaConfiguration: "OFF" | "OPTIONAL" | "REQUIRED"
  accountRecovery: {
    enabled: boolean
    methods: AccountRecoveryMethod[]
  }
  appClient: NormalizedAppClient
  domain?: {
    prefix: string
    managedLogin: boolean
  }
  infrastructure: {
    /** How the pool is (or will be) provisioned. */
    provisionedBy: "cdk" | "console" | "terraform" | "unknown"
    deletionProtection: boolean
    reproducible: boolean
  }
  /**
   * Application-level facts that Cognito itself cannot observe. These are
   * supplied by the consumer (fixtures, CLI, adapters) and drive a few
   * "application coupling" diagnostics.
   */
  application: {
    /** What the application uses as its canonical, immutable user id. */
    identity: "cognito_sub" | "email" | "cognito_username" | "custom"
    /** Whether application profile data is stored in Cognito attributes. */
    storesProfileDataInCognito: boolean
  }
}

export const DEFAULT_APP_CLIENT_ID = "dev-client"

/** The schema version emitted by `normalizeConfig`. */
export const DEFAULT_CONFIG_SCHEMA_VERSION = 1 as const

/**
 * Applies the safe, opinionated defaults and converts a developer-facing
 * {@link AuthConfig} into a normalized, plain-JSON pool configuration.
 *
 * Throws if the config is invalid.
 */
export function normalizeConfig(config: AuthConfig): NormalizedPoolConfig {
  assertValidAuthConfig(config)

  const name = config.name ?? "app"
  const token = tokenSettingsOf(config)
  const scopes = [...(config.application.scopes ?? DEFAULT_SCOPES)]
  // Config schemaVersion defaults to 1; NormalizedPoolConfig carries the
  // literal type `1`, so coerce after validation guarantees a supported value.
  const schemaVersion = (config.schemaVersion ?? DEFAULT_CONFIG_SCHEMA_VERSION) as 1

  const emailSignIn = config.signIn === "email"

  const requiredAttributes = emailSignIn ? ["email"] : ["email"]
  const autoVerifiedAttributes = emailSignIn ? ["email"] : []
  const verification = emailSignIn
    ? { email: "required" as const, phone: "disabled" as const }
    : { email: "optional" as const, phone: "disabled" as const }

  const generateSecret = config.application.type === "web"

  return {
    formatVersion: 1,
    provider: "cognito",
    name,
    usernameConfiguration: {
      // Email sign-in uses email aliases; the auto-generated username is a
      // UUID. Case sensitivity only matters for username sign-in, and even
      // then it is safer to keep identities case-insensitive.
      caseSensitive: false,
    },
    signIn: {
      email: emailSignIn,
      username: !emailSignIn,
      phone: false,
    },
    autoVerifiedAttributes,
    verification,
    requiredAttributes,
    customAttributes: [],
    mfaConfiguration: "OFF",
    accountRecovery: {
      enabled: true,
      methods: ["email"],
    },
    appClient: {
      clientId: DEFAULT_APP_CLIENT_ID,
      clientName: `${name}-app`,
      generateSecret,
      callbackUrls: [...config.application.callbackUrls],
      logoutUrls: [...config.application.logoutUrls],
      allowedOAuthFlows: {
        authorizationCodeGrant: true,
        implicitFlow: false,
        clientCredentials: false,
        userPassword: false,
      },
      allowedOAuthScopes: scopes,
      tokenValidity: {
        idTokenMinutes: token.idTokenMinutes,
        accessTokenMinutes: token.accessTokenMinutes,
        refreshTokenDays: token.refreshTokenDays,
      },
    },
    domain: {
      prefix: `${name}-auth`,
      managedLogin: true,
    },
    infrastructure: {
      provisionedBy: "cdk",
      deletionProtection: true,
      reproducible: true,
    },
    application: {
      identity: "cognito_sub",
      storesProfileDataInCognito: false,
    },
    schemaVersion,
  }
}

/** Normalizes an arbitrary plain object into a typed pool config (for CLI fixtures). */
export function parseNormalizedPoolConfig(input: unknown): NormalizedPoolConfig {
  if (typeof input !== "object" || input === null) {
    throw new Error("normalized pool config must be an object")
  }
  const raw = input as Record<string, unknown>
  if (raw.formatVersion !== 1 || raw.provider !== "cognito") {
    throw new Error(
      "unrecognized pool config format; expected a cognito-kit normalized pool document (formatVersion 1)",
    )
  }
  return raw as unknown as NormalizedPoolConfig
}
