import type {
  CognitoControlPlane,
  UserPoolClientInfo,
  UserPoolInfo,
  UserPoolSummary,
} from "@cognito-kit/core"
import type { CognitoSdk } from "./types.js"

export interface AwsCognitoControlPlaneOptions {
  /** AWS region. Defaults to the SDK's default resolution (env, config). */
  region?: string
  /** Override the service endpoint (e.g. a local Cognito emulator). */
  endpoint?: string
  /** Explicit credentials (e.g. dummy credentials for a local emulator). */
  credentials?: { accessKeyId: string; secretAccessKey: string }
  /** Inject a pre-built SDK (used by tests; otherwise created lazily). */
  sdk?: CognitoSdk
}

/**
 * A {@link CognitoControlPlane} backed by the real AWS SDK.
 *
 * The SDK client is created lazily on first use, so constructing this class
 * never requires AWS credentials. The AWS SDK itself is loaded lazily too —
 * importing this module does not load it.
 */
export class AwsCognitoControlPlane implements CognitoControlPlane {
  private readonly options: AwsCognitoControlPlaneOptions
  private sdkPromise?: Promise<CognitoSdk>

  constructor(options: AwsCognitoControlPlaneOptions = {}) {
    this.options = options
  }

  private sdk(): Promise<CognitoSdk> {
    if (!this.sdkPromise) {
      this.sdkPromise = this.options.sdk
        ? Promise.resolve(this.options.sdk)
        : createAwsCognitoSdk(this.options)
    }
    return this.sdkPromise
  }

  async describeUserPool(userPoolId: string): Promise<UserPoolInfo> {
    try {
      const sdk = await this.sdk()
      const res = await sdk.describeUserPool({ UserPoolId: userPoolId })
      const pool = res.UserPool
      if (!pool) throw new Error(`describeUserPool returned no UserPool for ${userPoolId}`)
      return {
        userPoolId: pool.Id ?? userPoolId,
        name: pool.Name ?? userPoolId,
        usernameConfiguration: pool.UsernameConfiguration
          ? { caseSensitive: pool.UsernameConfiguration.CaseSensitive ?? true }
          : undefined,
        schemaAttributes: (pool.SchemaAttributes ?? []).map((a) => ({
          name: a.Name ?? "",
          required: a.Required ?? false,
          attributeDataType: a.AttributeDataType ?? "String",
          mutable: a.Mutable,
        })),
        autoVerifiedAttributes: pool.AutoVerifiedAttributes,
        mfaConfiguration: pool.MfaConfiguration,
        accountRecoverySetting: pool.AccountRecoverySetting
          ? {
              recoveryMechanisms: (pool.AccountRecoverySetting.RecoveryMechanisms ?? []).map(
                (m) => ({ name: m.Name ?? "admin_only", priority: m.Priority ?? 0 }),
              ),
            }
          : undefined,
        aliasAttributes: pool.AliasAttributes,
        usernameAttributes: pool.UsernameAttributes,
        deletionProtection: pool.DeletionProtection === "ACTIVE",
        domain: pool.Domain ? { domain: pool.Domain } : undefined,
      }
    } catch (err) {
      throw mapSdkError(err)
    }
  }

  async describeUserPoolClient(userPoolId: string, clientId: string): Promise<UserPoolClientInfo> {
    try {
      const sdk = await this.sdk()
      const res = await sdk.describeUserPoolClient({ UserPoolId: userPoolId, ClientId: clientId })
      const client = res.UserPoolClient
      if (!client) {
        throw new Error(`describeUserPoolClient returned no UserPoolClient for ${clientId}`)
      }
      return {
        userPoolId: client.UserPoolId ?? userPoolId,
        clientId: client.ClientId ?? clientId,
        clientName: client.ClientName,
        generateSecret: client.GenerateSecret ?? false,
        callbackURLs: client.CallbackURLs,
        logoutURLs: client.LogoutURLs,
        allowedOAuthFlows: (client.AllowedOAuthFlows ?? []) as UserPoolClientInfo["allowedOAuthFlows"],
        allowedOAuthFlowsUserPoolClient: client.AllowedOAuthFlowsUserPoolClient,
        allowedOAuthScopes: client.AllowedOAuthScopes,
        idTokenValidity: client.IdTokenValidity,
        accessTokenValidity: client.AccessTokenValidity,
        refreshTokenValidity: client.RefreshTokenValidity,
        explicitAuthFlows: client.ExplicitAuthFlows,
      }
    } catch (err) {
      throw mapSdkError(err)
    }
  }

  async listUserPools(): Promise<UserPoolSummary[]> {
    try {
      const sdk = await this.sdk()
      const res = await sdk.listUserPools({ MaxResults: 60 })
      return (res.UserPools ?? []).map((p) => ({
        userPoolId: p.Id ?? "",
        name: p.Name ?? "",
      }))
    } catch (err) {
      throw mapSdkError(err)
    }
  }

  async listUserPoolClients(
    userPoolId: string,
  ): Promise<Array<{ clientId: string; clientName?: string }>> {
    try {
      const sdk = await this.sdk()
      const res = await sdk.listUserPoolClients({ UserPoolId: userPoolId, MaxResults: 60 })
      return (res.UserPoolClients ?? []).map((c) => ({
        clientId: c.ClientId ?? "",
        clientName: c.ClientName,
      }))
    } catch (err) {
      throw mapSdkError(err)
    }
  }
}

/**
 * Creates the real AWS SDK adapter. The SDK is imported lazily so that
 * importing this module never loads it.
 */
export async function createAwsCognitoSdk(
  options: AwsCognitoControlPlaneOptions = {},
): Promise<CognitoSdk> {
  const {
    CognitoIdentityProviderClient,
    DescribeUserPoolCommand,
    DescribeUserPoolClientCommand,
    ListUserPoolsCommand,
    ListUserPoolClientsCommand,
  } = await import("@aws-sdk/client-cognito-identity-provider")
  const client = new CognitoIdentityProviderClient({
    region: options.region,
    endpoint: options.endpoint,
    credentials: options.credentials,
  })
  return {
    describeUserPool: (input) => client.send(new DescribeUserPoolCommand(input)),
    describeUserPoolClient: (input) => client.send(new DescribeUserPoolClientCommand(input)),
    listUserPools: (input) => client.send(new ListUserPoolsCommand(input)),
    listUserPoolClients: (input) => client.send(new ListUserPoolClientsCommand(input)),
  }
}

/**
 * Maps AWS SDK errors onto the same `kind` convention used by
 * {@link FakeCognitoControlPlane} so callers can handle both identically.
 */
export function mapSdkError(err: unknown): Error {
  const name = (err as { name?: string })?.name ?? ""
  const message = (err as { message?: string })?.message ?? String(err)
  if (name.includes("NotFound") || name.includes("ResourceNotFound")) {
    const e = new Error(message)
    ;(e as { kind?: string }).kind = "not-found"
    return e
  }
  if (name.toLowerCase().includes("throttl") || name.toLowerCase().includes("toomanyrequests")) {
    const e = new Error(message)
    ;(e as { kind?: string }).kind = "throttling"
    return e
  }
  return err as Error
}