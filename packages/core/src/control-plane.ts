/**
 * The control-plane abstraction.
 *
 * Core logic (doctor, validation, migration analysis, config comparison)
 * depends ONLY on these interfaces — never on the AWS SDK. Two
 * implementations exist:
 *
 *  - {@link FakeCognitoControlPlane} (in `fake.ts`) — deterministic, offline,
 *    supports injected errors. Used by tests and local workflows.
 *  - `AwsCognitoControlPlane` — a future adapter wrapping the AWS SDK, kept
 *    out of the core dependency graph so core stays dependency-free.
 */

/** A deliberately small slice of what `DescribeUserPool` returns. */
export interface UserPoolInfo {
  userPoolId: string
  name: string
  usernameConfiguration?: {
    caseSensitive: boolean
  }
  schemaAttributes?: Array<{
    name: string
    required: boolean
    attributeDataType: string
    mutable?: boolean
  }>
  autoVerifiedAttributes?: string[]
  mfaConfiguration?: string
  accountRecoverySetting?: {
    recoveryMechanisms?: Array<{ name: string; priority: number }>
  }
  /** Present when the pool was created with a custom domain / domain prefix. */
  domain?: {
    domain: string
    managedLogin?: boolean
  }
  /** Sign-in aliases (e.g. `["email"]` for legacy alias pools). */
  aliasAttributes?: string[]
  /** Username attributes (e.g. `["email"]` for email-as-username pools). */
  usernameAttributes?: string[]
  /** Whether deletion protection is active. */
  deletionProtection?: boolean
}

/** A deliberately small slice of what `DescribeUserPoolClient` returns. */
export interface UserPoolClientInfo {
  userPoolId: string
  clientId: string
  clientName?: string
  generateSecret: boolean
  callbackURLs?: string[]
  logoutURLs?: string[]
  allowedOAuthFlows?: Array<"code" | "implicit" | "client_credentials">
  allowedOAuthFlowsUserPoolClient?: boolean
  allowedOAuthScopes?: string[]
  idTokenValidity?: number
  accessTokenValidity?: number
  refreshTokenValidity?: number
  /** Explicit auth flows (e.g. `["ALLOW_USER_PASSWORD_AUTH"]`). */
  explicitAuthFlows?: string[]
}

export interface UserPoolSummary {
  userPoolId: string
  name: string
}

export interface CognitoControlPlane {
  describeUserPool(userPoolId: string): Promise<UserPoolInfo>
  describeUserPoolClient(userPoolId: string, clientId: string): Promise<UserPoolClientInfo>
  listUserPools(): Promise<UserPoolSummary[]>
  listUserPoolClients(userPoolId: string): Promise<Array<{ clientId: string; clientName?: string }>>
}
