import { App, Stack } from "aws-cdk-lib"
import { Template } from "aws-cdk-lib/assertions"
import { CognitoKitAuth, CognitoKitStack } from "@cognito-kit/infrastructure"
import type { CognitoKitAuthProps } from "@cognito-kit/infrastructure"
import { describe, expect, it } from "vitest"

/**
 * Layer 3 — infrastructure tests.
 *
 * Synthesizes CloudFormation from the construct and asserts the safe defaults
 * are present. No AWS credentials, no context lookups, fully deterministic.
 */

function synth(props: CognitoKitAuthProps): Template {
  const app = new App()
  const stack = new Stack(app, "TestStack")
  new CognitoKitAuth(stack, "Auth", props)
  return Template.fromStack(stack)
}

const webProps: CognitoKitAuthProps = {
  name: "myapp",
  signIn: "email",
  application: {
    type: "web",
    callbackUrls: ["http://localhost:3000/auth/callback", "https://app.example.com/auth/callback"],
    logoutUrls: ["http://localhost:3000", "https://app.example.com"],
  },
}

describe("CognitoKitAuth — safe defaults", () => {
  it("synthesizes a user pool with case-insensitive email identities", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      UsernameConfiguration: { CaseSensitive: false },
    })
  })

  it("enables email verification", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AutoVerifiedAttributes: ["email"],
    })
  })

  it("requires only email and defines no custom attributes", () => {
    const template = synth(webProps)
    const pools = template.findResources("AWS::Cognito::UserPool")
    const pool = pools[Object.keys(pools)[0]]
    const schema = pool.Properties.Schema as Array<Record<string, unknown>>
    const names = schema.map((s) => s.Name)
    expect(names).toContain("email")
    expect(names.some((n) => String(n).startsWith("custom:"))).toBe(false)
    expect(names).toEqual(["email"])
  })

  it("enables deletion protection", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      DeletionProtection: "ACTIVE",
    })
  })

  it("enables email account recovery", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AccountRecoverySetting: {
        RecoveryMechanisms: [{ Name: "verified_email", Priority: 1 }],
      },
    })
  })

  it("configures the app client for authorization code flow only", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["code"],
      AllowedOAuthFlowsUserPoolClient: true,
    })
  })

  it("registers exact callback and logout URLs", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      CallbackURLs: [
        "http://localhost:3000/auth/callback",
        "https://app.example.com/auth/callback",
      ],
      LogoutURLs: ["http://localhost:3000", "https://app.example.com"],
    })
  })

  it("generates a client secret for confidential web apps", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: true,
    })
  })

  it("does not generate a client secret for public SPA apps", () => {
    const template = synth({
      ...webProps,
      application: {
        type: "spa",
        callbackUrls: ["http://localhost:5173/auth/callback"],
        logoutUrls: ["http://localhost:5173"],
      },
    })
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
    })
  })

  it("keeps token validity within safe bounds", () => {
    const template = synth(webProps)
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      IdTokenValidity: 60,
      AccessTokenValidity: 60,
      // CDK expresses refresh validity in minutes: 30 days = 43_200.
      RefreshTokenValidity: 43_200,
      TokenValidityUnits: {
        IdToken: "minutes",
        AccessToken: "minutes",
        RefreshToken: "minutes",
      },
    })
  })

  it("provisions a hosted domain", () => {
    const template = synth(webProps)
    template.resourceCountIs("AWS::Cognito::UserPoolDomain", 1)
  })

  it("emits outputs for the app", () => {
    const app = new App()
    const stack = new CognitoKitStack(app, "OutputStack", { auth: webProps })
    const template = Template.fromStack(stack)
    template.hasOutput("UserPoolId", {})
    template.hasOutput("UserPoolClientId", {})
    template.hasOutput("Issuer", {})
    template.hasOutput("Domain", {})
  })
})

describe("CognitoKitAuth — determinism", () => {
  it("produces identical CloudFormation across independent syntheses", () => {
    const render = () => JSON.stringify(synth(webProps).toJSON())
    expect(render()).toBe(render())
  })

  it("matches the committed CloudFormation snapshot", () => {
    const template = synth(webProps)
    expect(JSON.stringify(template.toJSON(), null, 2)).toMatchSnapshot()
  })
})
