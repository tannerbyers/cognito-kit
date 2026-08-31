import type { NormalizedPoolConfig, UserPoolClientInfo, UserPoolInfo } from "@cognito-kit/core"

export interface ToNormalizedPoolOptions {
  /** How the pool is provisioned. Defaults to `"unknown"` when imported from AWS. */
  provisionedBy?: NormalizedPoolConfig["infrastructure"]["provisionedBy"]
  /** Whether the pool is reproducible from code. Defaults to `false` for AWS-imported pools. */
  reproducible?: boolean
  /** What the application uses as its canonical identity. Defaults to `"cognito_sub"`. */
  identity?: NormalizedPoolConfig["application"]["identity"]
  /** Whether the application stores profile data in Cognito. Defaults to `true` when custom attributes exist. */
  storesProfileDataInCognito?: boolean
}

/**
 * Converts AWS control-plane state (from `AwsCognitoControlPlane`) into the
 * normalized pool document consumed by the diagnostics engine.
 *
 * This is the bridge that lets `cognito-kit doctor` analyze real pools with
 * the exact same rules used for local fixtures.
 */
export function toNormalizedPool(
  pool: UserPoolInfo,
  client: UserPoolClientInfo,
  options: ToNormalizedPoolOptions = {},
): NormalizedPoolConfig {
  const schema = pool.schemaAttributes ?? []

  const emailSignIn =
    pool.aliasAttributes?.includes("email") ?? pool.usernameAttributes?.includes("email") ?? false

  const customAttributes = schema
    .filter((a) => a.name.startsWith("custom:"))
    .map((a) => ({
      name: a.name.slice("custom:".length),
      type: mapAttributeType(a.attributeDataType),
      mutable: a.mutable ?? true,
      required: a.required ?? false,
    }))

  const requiredAttributes = schema
    .filter((a) => a.required && !a.name.startsWith("custom:"))
    .map((a) => a.name)

  const autoVerified = pool.autoVerifiedAttributes ?? []
  const hasEmailAttribute = schema.some((a) => a.name === "email")

  const flows = client.allowedOAuthFlows ?? []
  const explicitFlows = client.explicitAuthFlows ?? []

  const recoveryMechanisms = pool.accountRecoverySetting?.recoveryMechanisms ?? []
  const recoveryMethods = recoveryMechanisms.map((m) => {
    switch (m.name) {
      case "verified_email":
        return "email" as const
      case "verified_phone_number":
        return "phone" as const
      default:
        return "admin_only" as const
    }
  })

  return {
    formatVersion: 1,
    schemaVersion: 1,
    provider: "cognito",
    name: pool.name,
    userPoolId: pool.userPoolId,
    usernameConfiguration: {
      caseSensitive: pool.usernameConfiguration?.caseSensitive ?? true,
    },
    signIn: {
      email: emailSignIn,
      username: !emailSignIn,
      phone: pool.usernameAttributes?.includes("phone_number") ?? false,
    },
    autoVerifiedAttributes: autoVerified,
    verification: {
      email: autoVerified.includes("email")
        ? "required"
        : hasEmailAttribute
          ? "optional"
          : "disabled",
      phone: autoVerified.includes("phone_number") ? "required" : "disabled",
    },
    requiredAttributes,
    customAttributes,
    mfaConfiguration: (pool.mfaConfiguration ?? "OFF") as NormalizedPoolConfig["mfaConfiguration"],
    accountRecovery: {
      enabled: recoveryMethods.length > 0,
      methods: recoveryMethods,
    },
    appClient: {
      clientId: client.clientId,
      clientName: client.clientName ?? `${pool.name}-app`,
      generateSecret: client.generateSecret,
      callbackUrls: client.callbackURLs ?? [],
      logoutUrls: client.logoutURLs ?? [],
      allowedOAuthFlows: {
        authorizationCodeGrant: flows.includes("code"),
        implicitFlow: flows.includes("implicit"),
        clientCredentials: flows.includes("client_credentials"),
        userPassword:
          explicitFlows.includes("ALLOW_USER_PASSWORD_AUTH") ||
          explicitFlows.includes("ALLOW_ADMIN_USER_PASSWORD_AUTH"),
      },
      allowedOAuthScopes: client.allowedOAuthScopes ?? ["openid"],
      tokenValidity: {
        idTokenMinutes: client.idTokenValidity ?? 60,
        accessTokenMinutes: client.accessTokenValidity ?? 60,
        refreshTokenDays: client.refreshTokenValidity ?? 30,
      },
    },
    domain: pool.domain
      ? {
          prefix: pool.domain.domain.split(".")[0] ?? pool.name,
          managedLogin: pool.domain.managedLogin ?? false,
        }
      : undefined,
    infrastructure: {
      provisionedBy: options.provisionedBy ?? "unknown",
      deletionProtection: pool.deletionProtection ?? false,
      reproducible: options.reproducible ?? false,
    },
    application: {
      identity: options.identity ?? "cognito_sub",
      storesProfileDataInCognito:
        options.storesProfileDataInCognito ?? customAttributes.length > 0,
    },
  }
}

function mapAttributeType(
  dataType: string | undefined,
): NormalizedPoolConfig["customAttributes"][number]["type"] {
  switch (dataType) {
    case "Number":
      return "number"
    case "Boolean":
      return "boolean"
    case "DateTime":
      return "datetime"
    default:
      return "string"
  }
}