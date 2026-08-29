import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib"
import * as Cognito from "aws-cdk-lib/aws-cognito"
import { Construct } from "constructs"
import type { ApplicationConfig, AuthConfig, SignInMode, TokenSettings } from "@cognito-kit/core"
import { normalizeConfig } from "@cognito-kit/core"

export interface CognitoKitAuthProps {
  /** How users sign in. */
  signIn: SignInMode
  /** The application that consumes this user pool. */
  application: ApplicationConfig
  /** Optional pool name used as a resource prefix. */
  name?: string
  /** Optional token lifetime overrides. */
  token?: TokenSettings
}

export interface CognitoKitAuthOutput {
  readonly userPool: Cognito.UserPool
  readonly userPoolClient: Cognito.UserPoolClient
  readonly userPoolDomain: Cognito.UserPoolDomain
  /** The OIDC issuer URL for this pool (e.g. `https://cognito-idp.<region>.amazonaws.com/<poolId>`). */
  readonly issuer: string
}

const DEFAULT_PASSWORD_POLICY = {
  minLength: 12,
  requireLowercase: true,
  requireUppercase: true,
  requireDigits: true,
  requireSymbols: true,
}

/**
 * Synthesizes a safe, opinionated Cognito user pool from the cognito-kit
 * configuration model.
 *
 * ```ts
 * import { CognitoKitAuth } from "@cognito-kit/infrastructure"
 *
 * new CognitoKitAuth(stack, "Auth", {
 *   signIn: "email",
 *   application: {
 *     type: "web",
 *     callbackUrls: ["http://localhost:3000/auth/callback"],
 *     logoutUrls: ["http://localhost:3000"],
 *   },
 * })
 * ```
 *
 * Safe defaults baked in:
 *  - case-insensitive email identities
 *  - email verification required before sign-in
 *  - authorization code flow only (no implicit / password flows)
 *  - PKCE-compatible public clients; secrets only for confidential web apps
 *  - no custom attributes, minimal required attributes
 *  - email account recovery
 *  - deletion protection (RETAIN)
 *  - Managed Login on a hosted domain
 */
export class CognitoKitAuth extends Construct {
  readonly userPool: Cognito.UserPool
  readonly userPoolClient: Cognito.UserPoolClient
  readonly userPoolDomain: Cognito.UserPoolDomain
  readonly issuer: string

  constructor(scope: Construct, id: string, props: CognitoKitAuthProps) {
    super(scope, id)

    const config: AuthConfig = {
      name: props.name,
      signIn: props.signIn,
      application: props.application,
      token: props.token,
    }
    const normalized = normalizeConfig(config)

    const userPool = new Cognito.UserPool(this, "UserPool", {
      userPoolName: normalized.name,
      signInAliases: normalized.signIn.email ? { email: true } : undefined,
      signInCaseSensitive: normalized.usernameConfiguration.caseSensitive,
      selfSignUpEnabled: false,
      accountRecovery: Cognito.AccountRecovery.EMAIL_ONLY,
      mfa: Cognito.Mfa.OFF,
      passwordPolicy: DEFAULT_PASSWORD_POLICY,
      standardAttributes: {
        email: {
          required: true,
          mutable: false,
        },
      },
      ...(normalized.signIn.email
        ? {
            autoVerify: { email: true },
            userVerification: {
              emailStyle: Cognito.VerificationEmailStyle.CODE,
            },
          }
        : {}),
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
    })

    const oAuthScopes = normalized.appClient.allowedOAuthScopes.map((s) => {
      switch (s) {
        case "openid":
          return Cognito.OAuthScope.OPENID
        case "email":
          return Cognito.OAuthScope.EMAIL
        case "profile":
          return Cognito.OAuthScope.PROFILE
        default:
          return Cognito.OAuthScope.custom(s)
      }
    })

    const userPoolClient = userPool.addClient("AppClient", {
      userPoolClientName: normalized.appClient.clientName,
      generateSecret: normalized.appClient.generateSecret,
      preventUserExistenceErrors: true,
      supportedIdentityProviders: [Cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: {
          authorizationCodeGrant: normalized.appClient.allowedOAuthFlows.authorizationCodeGrant,
          implicitCodeGrant: normalized.appClient.allowedOAuthFlows.implicitFlow,
          clientCredentials: normalized.appClient.allowedOAuthFlows.clientCredentials,
        },
        scopes: oAuthScopes,
        callbackUrls: normalized.appClient.callbackUrls,
        logoutUrls: normalized.appClient.logoutUrls,
      },
      idTokenValidity: Duration.minutes(normalized.appClient.tokenValidity.idTokenMinutes),
      accessTokenValidity: Duration.minutes(normalized.appClient.tokenValidity.accessTokenMinutes),
      refreshTokenValidity: Duration.days(normalized.appClient.tokenValidity.refreshTokenDays),
    })

    const domainPrefix = normalized.domain?.prefix ?? `${normalized.name}-auth`
    const userPoolDomain = new Cognito.UserPoolDomain(this, "Domain", {
      userPool,
      cognitoDomain: { domainPrefix },
      managedLoginVersion: Cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    })

    this.userPool = userPool
    this.userPoolClient = userPoolClient
    this.userPoolDomain = userPoolDomain
    this.issuer = `https://cognito-idp.${Stack.of(this).region}.amazonaws.com/${userPool.userPoolId}`
  }
}
