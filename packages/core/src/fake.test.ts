import { describe, expect, it } from "vitest"
import type { UserPoolInfo } from "./control-plane.js"
import { FakeCognitoControlPlane } from "./fake.js"

const pool: UserPoolInfo = {
  userPoolId: "us-east-1_AbCdE",
  name: "myapp",
  usernameConfiguration: { caseSensitive: false },
  schemaAttributes: [{ name: "email", required: true, attributeDataType: "String" }],
  autoVerifiedAttributes: ["email"],
  mfaConfiguration: "OFF",
}

describe("FakeCognitoControlPlane", () => {
  it("describes a user pool", async () => {
    const fake = new FakeCognitoControlPlane({ userPools: [pool] })
    const result = await fake.describeUserPool("us-east-1_AbCdE")
    expect(result.name).toBe("myapp")
    expect(result.usernameConfiguration?.caseSensitive).toBe(false)
  })

  it("lists user pools", async () => {
    const fake = new FakeCognitoControlPlane({ userPools: [pool] })
    expect(await fake.listUserPools()).toEqual([{ userPoolId: "us-east-1_AbCdE", name: "myapp" }])
  })

  it("describes app clients", async () => {
    const fake = new FakeCognitoControlPlane({
      userPools: [pool],
      clients: {
        "us-east-1_AbCdE": [
          {
            userPoolId: "us-east-1_AbCdE",
            clientId: "abc123",
            clientName: "myapp-app",
            generateSecret: true,
            callbackURLs: ["http://localhost:3000/auth/callback"],
            allowedOAuthFlows: ["code"],
          },
        ],
      },
    })
    const client = await fake.describeUserPoolClient("us-east-1_AbCdE", "abc123")
    expect(client.allowedOAuthFlows).toEqual(["code"])
    expect(client.generateSecret).toBe(true)
  })

  it("throws a predictable not-found error", async () => {
    const fake = new FakeCognitoControlPlane({ userPools: [] })
    await expect(fake.describeUserPool("nope")).rejects.toMatchObject({ kind: "not-found" })
  })

  it("supports injected API failures", async () => {
    const fake = new FakeCognitoControlPlane({
      userPools: [pool],
      failWith: { kind: "throttling", message: "rate exceeded" },
    })
    await expect(fake.describeUserPool("us-east-1_AbCdE")).rejects.toMatchObject({
      kind: "throttling",
    })
  })

  it("supports injected malformed data", async () => {
    const fake = new FakeCognitoControlPlane({
      userPools: [pool],
      failWith: { kind: "malformed", message: "unexpected response shape" },
    })
    await expect(fake.listUserPoolClients("us-east-1_AbCdE")).rejects.toMatchObject({
      kind: "malformed",
    })
  })

  it("does not mutate injected data", async () => {
    const fake = new FakeCognitoControlPlane({ userPools: [pool] })
    const result = await fake.describeUserPool("us-east-1_AbCdE")
    result.name = "mutated"
    const again = await fake.describeUserPool("us-east-1_AbCdE")
    expect(again.name).toBe("myapp")
  })
})
