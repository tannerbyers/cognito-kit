import type { IssuerConfig, OidcDiscoveryDocument } from "@cognito-kit/runtime"
import { generateKeyPair, exportJWK } from "jose"
import type { JWK } from "jose"

export interface TestIssuerOptions {
  issuer?: string
  jwks?: { keys: JWK[] }
}

export interface TestIssuer {
  issuer: string
  discoveryUrl: string
  discoveryDocument: OidcDiscoveryDocument
  issuerConfig: IssuerConfig
  jwks: { keys: JWK[] }
}

/**
 * Creates a fake OIDC issuer configuration — the object an application would
 * obtain from discovery. No network is involved.
 */
export async function createTestIssuer(options: TestIssuerOptions = {}): Promise<TestIssuer> {
  const issuer = options.issuer ?? "http://localhost:9876"
  let jwks = options.jwks
  if (!jwks) {
    const { publicKey } = await generateKeyPair("RS256")
    jwks = { keys: [await exportJWK(publicKey)] }
  }

  const discoveryDocument: OidcDiscoveryDocument = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    userinfo_endpoint: `${issuer}/userinfo`,
    end_session_endpoint: `${issuer}/logout`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  }

  const issuerConfig: IssuerConfig = {
    issuer,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    userinfoEndpoint: `${issuer}/userinfo`,
    endSessionEndpoint: `${issuer}/logout`,
  }

  return {
    issuer,
    discoveryUrl: `${issuer}/.well-known/openid-configuration`,
    discoveryDocument,
    issuerConfig,
    jwks,
  }
}
