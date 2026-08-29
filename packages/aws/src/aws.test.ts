import { describe, expect, it } from "vitest"
import { diagnoseUserPool } from "@cognito-kit/core"
import { AwsCognitoControlPlane } from "./control-plane.js"
import { toNormalizedPool } from "./normalize.js"
import type { AwsUserPool, AwsUserPoolClient, CognitoSdk } from "./types.js"

const POOL_ID = "us-east-1_AbCdE"

const awsPool: AwsUserPool = {
  Id: POOL_ID,
  Name: "myapp",
  UsernameConfiguration: { CaseSensitive: false },
  SchemaAttributes: [
    { Name: "email", AttributeDataType: "String", Required: true, Mutable: false },
    { Name: "custom:role", AttributeDataType: "String", Required: false, Mutable: true },
  ],
  AutoVerifiedAttributes: ["email"],
  MfaConfiguration: "OFF",
  AccountRecoverySetting: {
    RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
  },
  DeletionProtection: "ACTIVE",
  AliasAttributes: ["email"],
}

const awsClient: AwsUserPoolClient = {
  UserPoolId: POOL_ID,
  ClientId: "abc123",
  ClientName: "myapp-app",
  GenerateSecret: true,
  CallbackURLs: ["http://localhost:3000/auth/callback"],
  LogoutURLs: ["http://localhost:3000"],
  AllowedOAuthFlows: ["code"],
  AllowedOAuthFlowsUserPoolClient: true,
  AllowedOAuthScopes: ["openid", "email", "profile"],
  IdTokenValidity: 60,
  AccessTokenValidity: 60,
  RefreshTokenValidity: 30,
}

const fakeSdk: CognitoSdk = {
  describeUserPool: async () => ({ UserPool: awsPool }),
  describeUserPoolClient: async () => ({ UserPoolClient: awsClient }),
  listUserPools: async () => ({ UserPools: [{ Id: POOL_ID, Name: "myapp" }] }),
  listUserPoolClients: async () => ({
    UserPoolClients: [{ ClientId: "abc123", ClientName: "myapp-app" }],
  }),
}

describe("AwsCognitoControlPlane", () => {
  it("describes a user pool", async () => {
    const plane = new AwsCognitoControlPlane({ sdk: fakeSdk })
    const info = await plane.describeUserPool(POOL_ID)
    expect(info.name).toBe("myapp")
    expect(info.usernameConfiguration?.caseSensitive).toBe(false)
    expect(info.deletionProtection).toBe(true)
    expect(info.aliasAttributes).toContain("email")
    expect(info.schemaAttributes?.some((a) => a.name === "custom:role")).toBe(true)
  })

  it("describes a user pool client", async () => {
    const plane = new AwsCognitoControlPlane({ sdk: fakeSdk })
    const info = await plane.describeUserPoolClient(POOL_ID, "abc123")
    expect(info.generateSecret).toBe(true)
    expect(info.allowedOAuthFlows).toEqual(["code"])
    expect(info.refreshTokenValidity).toBe(30)
  })

  it("lists user pools and clients", async () => {
    const plane = new AwsCognitoControlPlane({ sdk: fakeSdk })
    expect(await plane.listUserPools()).toEqual([{ userPoolId: POOL_ID, name: "myapp" }])
    expect(await plane.listUserPoolClients(POOL_ID)).toEqual([
      { clientId: "abc123", clientName: "myapp-app" },
    ])
  })

  it("maps not-found errors to the shared kind convention", async () => {
    const sdk: CognitoSdk = {
      ...fakeSdk,
      describeUserPool: async () => {
        throw Object.assign(new Error("User pool not found"), {
          name: "ResourceNotFoundException",
        })
      },
    }
    const plane = new AwsCognitoControlPlane({ sdk })
    await expect(plane.describeUserPool("nope")).rejects.toMatchObject({ kind: "not-found" })
  })

  it("maps throttling errors", async () => {
    const sdk: CognitoSdk = {
      ...fakeSdk,
      describeUserPool: async () => {
        throw Object.assign(new Error("Rate exceeded"), { name: "TooManyRequestsException" })
      },
    }
    const plane = new AwsCognitoControlPlane({ sdk })
    await expect(plane.describeUserPool(POOL_ID)).rejects.toMatchObject({ kind: "throttling" })
  })
})

describe("toNormalizedPool", () => {
  it("converts AWS state into a normalized pool config", async () => {
    const plane = new AwsCognitoControlPlane({ sdk: fakeSdk })
    const pool = await plane.describeUserPool(POOL_ID)
    const client = await plane.describeUserPoolClient(POOL_ID, "abc123")
    const normalized = toNormalizedPool(pool, client)

    expect(normalized.provider).toBe("cognito")
    expect(normalized.userPoolId).toBe(POOL_ID)
    expect(normalized.signIn.email).toBe(true)
    expect(normalized.usernameConfiguration.caseSensitive).toBe(false)
    expect(normalized.verification.email).toBe("required")
    expect(normalized.requiredAttributes).toEqual(["email"])
    expect(normalized.customAttributes).toEqual([
      { name: "role", type: "string", mutable: true, required: false },
    ])
    expect(normalized.accountRecovery.methods).toEqual(["email"])
    expect(normalized.appClient.generateSecret).toBe(true)
    expect(normalized.appClient.allowedOAuthFlows.authorizationCodeGrant).toBe(true)
    expect(normalized.appClient.allowedOAuthFlows.implicitFlow).toBe(false)
    expect(normalized.appClient.tokenValidity).toEqual({
      idTokenMinutes: 60,
      accessTokenMinutes: 60,
      refreshTokenDays: 30,
    })
    expect(normalized.infrastructure.deletionProtection).toBe(true)
    expect(normalized.infrastructure.provisionedBy).toBe("unknown")
    expect(normalized.infrastructure.reproducible).toBe(false)
    expect(normalized.application.identity).toBe("cognito_sub")
  })

  it("produces a normalized doc that the diagnostics engine accepts", async () => {
    const plane = new AwsCognitoControlPlane({ sdk: fakeSdk })
    const pool = await plane.describeUserPool(POOL_ID)
    const client = await plane.describeUserPoolClient(POOL_ID, "abc123")
    const normalized = toNormalizedPool(pool, client)
    const report = diagnoseUserPool(normalized)
    expect(report.summary.critical).toBe(0)
    // Warnings: custom attribute (3 rules) + imported-not-reproducible (1).
    expect(report.summary.warning).toBe(4)
    expect(report.findings.some((f) => f.ruleId === "ck-no-iac" && f.status === "warning")).toBe(true)
  })

  it("flags case-sensitive email identities imported from AWS", async () => {
    const caseSensitivePool: AwsUserPool = {
      ...awsPool,
      UsernameConfiguration: { CaseSensitive: true },
    }
    const sdk: CognitoSdk = { ...fakeSdk, describeUserPool: async () => ({ UserPool: caseSensitivePool }) }
    const plane = new AwsCognitoControlPlane({ sdk })
    const pool = await plane.describeUserPool(POOL_ID)
    const client = await plane.describeUserPoolClient(POOL_ID, "abc123")
    const report = diagnoseUserPool(toNormalizedPool(pool, client))
    const finding = report.findings.find((f) => f.ruleId === "ck-email-case-sensitive")
    expect(finding?.status).toBe("critical")
  })

  it("allows callers to declare how the pool is provisioned", async () => {
    const plane = new AwsCognitoControlPlane({ sdk: fakeSdk })
    const pool = await plane.describeUserPool(POOL_ID)
    const client = await plane.describeUserPoolClient(POOL_ID, "abc123")
    const normalized = toNormalizedPool(pool, client, {
      provisionedBy: "cdk",
      reproducible: true,
    })
    expect(normalized.infrastructure.provisionedBy).toBe("cdk")
    expect(normalized.infrastructure.reproducible).toBe(true)
    const report = diagnoseUserPool(normalized)
    // ck-no-iac is gone; custom-attribute warnings remain (3).
    expect(report.findings.some((f) => f.ruleId === "ck-no-iac" && f.status === "warning")).toBe(false)
    expect(report.summary.warning).toBe(3)
  })
})