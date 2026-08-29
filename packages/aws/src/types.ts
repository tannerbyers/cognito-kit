/**
 * Structural types for the AWS Cognito API responses.
 *
 * These mirror the small slices of `DescribeUserPool` / `DescribeUserPoolClient`
 * that cognito-kit needs. They are defined structurally so the adapter can be
 * tested without the AWS SDK; the real SDK responses are structurally
 * compatible.
 */

export interface AwsUserPool {
  Id?: string
  Name?: string
  UsernameConfiguration?: { CaseSensitive?: boolean }
  SchemaAttributes?: Array<{
    Name?: string
    AttributeDataType?: string
    Required?: boolean
    Mutable?: boolean
  }>
  AutoVerifiedAttributes?: string[]
  MfaConfiguration?: string
  AccountRecoverySetting?: {
    RecoveryMechanisms?: Array<{ Name?: string; Priority?: number }>
  }
  DeletionProtection?: string
  AliasAttributes?: string[]
  UsernameAttributes?: string[]
  /** The domain name (e.g. `myprefix.auth.us-east-1.amazoncognito.com`). */
  Domain?: string
}

export interface AwsUserPoolClient {
  UserPoolId?: string
  ClientId?: string
  ClientName?: string
  GenerateSecret?: boolean
  CallbackURLs?: string[]
  LogoutURLs?: string[]
  AllowedOAuthFlows?: string[]
  AllowedOAuthFlowsUserPoolClient?: boolean
  AllowedOAuthScopes?: string[]
  IdTokenValidity?: number
  AccessTokenValidity?: number
  RefreshTokenValidity?: number
  ExplicitAuthFlows?: string[]
}

/** The minimal Cognito API surface the control plane needs. */
export interface CognitoSdk {
  describeUserPool(input: { UserPoolId: string }): Promise<{ UserPool?: AwsUserPool }>
  describeUserPoolClient(
    input: { UserPoolId: string; ClientId: string },
  ): Promise<{ UserPoolClient?: AwsUserPoolClient }>
  listUserPools(input: {
    MaxResults: number
    NextToken?: string
  }): Promise<{ UserPools?: Array<{ Id?: string; Name?: string }>; NextToken?: string }>
  listUserPoolClients(input: {
    UserPoolId: string
    MaxResults?: number
  }): Promise<{ UserPoolClients?: Array<{ ClientId?: string; ClientName?: string }> }>
}