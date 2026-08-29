import { FakeCognitoControlPlane, normalizeConfig, defineAuth } from "@cognito-kit/core"
import type { NormalizedPoolConfig, UserPoolClientInfo, UserPoolInfo } from "@cognito-kit/core"

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K]
}

/**
 * Creates a recommended `NormalizedPoolConfig`, optionally overridden.
 *
 * ```ts
 * const pool = createFakeUserPool({
 *   usernameConfiguration: { caseSensitive: true },
 * })
 * ```
 */
export function createFakeUserPool(
  overrides: DeepPartial<NormalizedPoolConfig> = {},
): NormalizedPoolConfig {
  const base = normalizeConfig(
    defineAuth({
      name: "test-app",
      signIn: "email",
      application: {
        type: "web",
        callbackUrls: ["http://localhost:3000/auth/callback"],
        logoutUrls: ["http://localhost:3000"],
      },
    }),
  )
  return mergeDeep(base, overrides) as NormalizedPoolConfig
}

/** Converts a normalized pool config into the control-plane `UserPoolInfo` shape. */
export function toUserPoolInfo(pool: NormalizedPoolConfig): UserPoolInfo {
  return {
    userPoolId: pool.userPoolId ?? "test-pool",
    name: pool.name,
    usernameConfiguration: { caseSensitive: pool.usernameConfiguration.caseSensitive },
    schemaAttributes: [
      ...pool.requiredAttributes.map((name) => ({
        name,
        required: true,
        attributeDataType: "String",
        mutable: false,
      })),
      ...pool.customAttributes.map((a) => ({
        name: a.name,
        required: a.required,
        attributeDataType: a.type === "number" ? "Number" : "String",
        mutable: a.mutable,
      })),
    ],
    autoVerifiedAttributes: pool.autoVerifiedAttributes,
    mfaConfiguration: pool.mfaConfiguration,
    accountRecoverySetting: pool.accountRecovery.enabled
      ? {
          recoveryMechanisms: pool.accountRecovery.methods.map((m, i) => ({
            name:
              m === "email"
                ? "verified_email"
                : m === "phone"
                  ? "verified_phone_number"
                  : "admin_only",
            priority: i + 1,
          })),
        }
      : undefined,
  }
}

/** Converts a normalized pool config into the control-plane `UserPoolClientInfo` shape. */
export function toUserPoolClientInfo(pool: NormalizedPoolConfig): UserPoolClientInfo {
  const flows: Array<"code" | "implicit" | "client_credentials"> = []
  if (pool.appClient.allowedOAuthFlows.authorizationCodeGrant) flows.push("code")
  if (pool.appClient.allowedOAuthFlows.implicitFlow) flows.push("implicit")
  if (pool.appClient.allowedOAuthFlows.clientCredentials) flows.push("client_credentials")
  return {
    userPoolId: pool.userPoolId ?? "test-pool",
    clientId: pool.appClient.clientId,
    clientName: pool.appClient.clientName,
    generateSecret: pool.appClient.generateSecret,
    callbackURLs: pool.appClient.callbackUrls,
    logoutURLs: pool.appClient.logoutUrls,
    allowedOAuthFlows: flows,
    allowedOAuthFlowsUserPoolClient: true,
    allowedOAuthScopes: pool.appClient.allowedOAuthScopes,
    idTokenValidity: pool.appClient.tokenValidity.idTokenMinutes,
    accessTokenValidity: pool.appClient.tokenValidity.accessTokenMinutes,
    refreshTokenValidity: pool.appClient.tokenValidity.refreshTokenDays,
  }
}

/**
 * Creates a fully seeded {@link FakeCognitoControlPlane} with a recommended
 * user pool and app client — ready for tests that exercise control-plane
 * driven logic (doctor, inspection, comparison).
 */
export function createFakeCognitoClient(
  overrides: DeepPartial<NormalizedPoolConfig> = {},
): FakeCognitoControlPlane {
  const pool = createFakeUserPool(overrides)
  return new FakeCognitoControlPlane({
    userPools: [toUserPoolInfo(pool)],
    clients: {
      [pool.userPoolId ?? "test-pool"]: [toUserPoolClientInfo(pool)],
    },
  })
}

function mergeDeep<T>(target: T, source: DeepPartial<T>): T {
  if (Array.isArray(target)) {
    return (source as unknown as T) ?? target
  }
  if (
    typeof target === "object" &&
    target !== null &&
    typeof source === "object" &&
    source !== null
  ) {
    const out: Record<string, unknown> = { ...(target as Record<string, unknown>) }
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const current = (target as Record<string, unknown>)[key]
      if (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        current !== null &&
        typeof current === "object" &&
        !Array.isArray(current)
      ) {
        out[key] = mergeDeep(current, value as DeepPartial<typeof current>)
      } else if (value !== undefined) {
        out[key] = value
      }
    }
    return out as T
  }
  return (source ?? target) as unknown as T
}
