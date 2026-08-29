/**
 * Minimal OIDC issuer configuration + discovery.
 */

export interface IssuerConfig {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUrl: string
  userinfoEndpoint?: string
  logoutEndpoint?: string
  endSessionEndpoint?: string
}

export interface OidcDiscoveryDocument {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
  logout_endpoint?: string
  end_session_endpoint?: string
  response_types_supported?: string[]
  subject_types_supported?: string[]
  id_token_signing_alg_values_supported?: string[]
  [key: string]: unknown
}

/**
 * Fetches an OIDC discovery document and maps it to {@link IssuerConfig}.
 * Works for `@cognito-kit/local-auth`, Cognito's `/.well-known/openid-configuration`,
 * and any standards-compliant provider.
 */
export async function discoverIssuer(
  discoveryUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<IssuerConfig> {
  const res = await fetchImpl(discoveryUrl)
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: HTTP ${res.status} for ${discoveryUrl}`)
  }
  const doc = (await res.json()) as OidcDiscoveryDocument
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error(`OIDC discovery document at ${discoveryUrl} is missing required fields`)
  }
  return {
    issuer: doc.issuer,
    authorizationEndpoint: doc.authorization_endpoint,
    tokenEndpoint: doc.token_endpoint,
    jwksUrl: doc.jwks_uri,
    userinfoEndpoint: doc.userinfo_endpoint,
    logoutEndpoint: doc.logout_endpoint,
    endSessionEndpoint: doc.end_session_endpoint,
  }
}
