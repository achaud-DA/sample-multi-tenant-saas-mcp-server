import {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import {
  OAuthClientInformationSchema,
  OAuthClientInformation,
  OAuthTokens,
  OAuthTokensSchema,
  OAuthClientMetadata,
  OAuthMetadata,
  OAuthProtectedResourceMetadata,
  OpenIdProviderDiscoveryMetadataSchema,
  OAuthMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  discoverAuthorizationServerMetadata,
  discoverOAuthProtectedResourceMetadata,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  selectResourceURL,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { OAUTH_CALLBACK_CHANNEL, SESSION_KEYS, getServerSpecificKey } from "./constants";
import {
  createDatabricksOAuthFetch,
  getDatabricksProtectedResourceMetadataUrl,
  getOAuthDiscoveryUrl,
  isDatabricksMcpUrl,
} from "./config";
import { generateOAuthState } from "../utils/oauthUtils";

function formatOAuthError(error: unknown): string {
  if (error instanceof OAuthError) {
    const desc = error.message || "no description";
    return `${error.errorCode}: ${desc}`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    if (typeof record.error_description === "string") {
      return record.error_description;
    }
    if (typeof record.error === "string") {
      return record.error;
    }
  }
  return String(error);
}

/** Cognito may appear as cognito-idp… or {pool}.auth.{region}.amazoncognito.com (see token_endpoint). */
type FetchFn = typeof fetch;

export type McpOAuthServerInfo = Awaited<ReturnType<typeof discoverMcpOAuthServerInfo>>;

async function fetchDatabricksAuthorizationServerMetadata(
  workspaceOrigin: string,
  fetchFn?: FetchFn,
): Promise<OAuthMetadata | undefined> {
  const metadataUrl = `${workspaceOrigin}/oidc/.well-known/oauth-authorization-server`;
  const fn = fetchFn ?? fetch;
  try {
    const response = await fn(metadataUrl, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return undefined;
    }
    const json = await response.json();
    try {
      return OAuthMetadataSchema.parse(json);
    } catch {
      return OpenIdProviderDiscoveryMetadataSchema.parse(json);
    }
  } catch (error) {
    console.debug("Direct Databricks OIDC metadata fetch failed:", error);
    return undefined;
  }
}

/** Discover OAuth for Databricks external MCP (workspace root PRM returns HTML). */
export async function discoverMcpOAuthServerInfo(
  serverUrl: string,
  fetchFn?: FetchFn,
) {
  const discoveryUrl = getOAuthDiscoveryUrl(serverUrl);

  if (!isDatabricksMcpUrl(serverUrl)) {
    return discoverOAuthServerInfo(discoveryUrl, { fetchFn });
  }

  const workspaceOrigin = new URL(serverUrl).origin;
  const resourceMetadataUrl = getDatabricksProtectedResourceMetadataUrl(serverUrl);

  // 1) RFC 9728 on the external MCP connection path
  try {
    const resourceMetadata = await discoverOAuthProtectedResourceMetadata(
      discoveryUrl,
      { resourceMetadataUrl },
      fetchFn,
    );
    const authorizationServerUrl =
      resourceMetadata.authorization_servers?.[0] ?? workspaceOrigin;
    const authorizationServerMetadata =
      await discoverAuthorizationServerMetadata(authorizationServerUrl, {
        fetchFn,
      });
    if (authorizationServerMetadata?.authorization_endpoint) {
      return { authorizationServerUrl, authorizationServerMetadata, resourceMetadata };
    }
  } catch (error) {
    console.debug("Databricks PRM discovery on external URL failed:", error);
  }

  // 2) Workspace OIDC metadata document (known-good URL for Databricks workspaces)
  const directMetadata = await fetchDatabricksAuthorizationServerMetadata(
    workspaceOrigin,
    fetchFn,
  );
  if (directMetadata?.authorization_endpoint) {
    const resourceMetadata = {
      resource: discoveryUrl,
      authorization_servers: [workspaceOrigin],
      scopes_supported: directMetadata.scopes_supported ?? ["all-apis"],
      bearer_methods_supported: ["header"],
    };
    return {
      authorizationServerUrl: workspaceOrigin,
      authorizationServerMetadata: directMetadata,
      resourceMetadata,
    };
  }

  // 3) RFC 8414 discovery via issuer base URLs
  const oidcIssuerCandidates = [`${workspaceOrigin}/oidc`, workspaceOrigin];

  for (const oidcIssuer of oidcIssuerCandidates) {
    try {
      const authorizationServerMetadata =
        await discoverAuthorizationServerMetadata(oidcIssuer, { fetchFn });
      if (!authorizationServerMetadata?.authorization_endpoint) {
        continue;
      }
      const resourceMetadata = {
        resource: discoveryUrl,
        authorization_servers: [workspaceOrigin],
        scopes_supported:
          authorizationServerMetadata.scopes_supported ?? ["all-apis"],
        bearer_methods_supported: ["header"],
      };
      return {
        authorizationServerUrl: workspaceOrigin,
        authorizationServerMetadata,
        resourceMetadata,
      };
    } catch (error) {
      console.debug("Databricks OIDC discovery failed for", oidcIssuer, error);
    }
  }

  throw new Error(
    "Could not discover Databricks OAuth metadata. Verify the External MCP URL and OAuth app redirect URI.",
  );
}

/** RFC 9728 resource metadata for OAuth scope discovery (Databricks uses external path, not workspace root). */
export async function discoverMcpResourceMetadata(
  serverUrl: string,
  fetchFn?: FetchFn,
): Promise<OAuthProtectedResourceMetadata | undefined> {
  try {
    if (isDatabricksMcpUrl(serverUrl)) {
      const serverInfo = await discoverMcpOAuthServerInfo(serverUrl, fetchFn);
      return serverInfo.resourceMetadata;
    }
    return await discoverOAuthProtectedResourceMetadata(
      new URL("/", serverUrl),
      undefined,
      fetchFn,
    );
  } catch {
    return undefined;
  }
}

function shouldOmitResourceParameter(options: {
  authorizationServerUrl?: string | URL;
  tokenEndpoint?: string;
  authorizationServers?: string[];
}): boolean {
  const haystack = [
    String(options.authorizationServerUrl ?? ""),
    options.tokenEndpoint ?? "",
    ...(options.authorizationServers ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return (
    haystack.includes("cognito-idp") || haystack.includes("amazoncognito.com")
  );
}

/**
 * Discovers OAuth scopes from server metadata, with preference for resource metadata scopes
 */
export const discoverScopes = async (
  serverUrl: string,
  resourceMetadata?: OAuthProtectedResourceMetadata,
  _proxyUrl?: string,
  fetchFn?: FetchFn,
): Promise<string | undefined> => {
  try {
    if (isDatabricksMcpUrl(serverUrl)) {
      return "all-apis";
    }

    // Prefer resource metadata scopes
    let scopesSupported = resourceMetadata?.scopes_supported;

    // Resolve authorization server via RFC 9728 (not the MCP host — Cognito lives elsewhere)
    if (!scopesSupported?.length) {
      try {
        const serverInfo = await discoverMcpOAuthServerInfo(serverUrl, fetchFn);
        if (serverInfo.authorizationServerMetadata?.scopes_supported?.length) {
          scopesSupported = serverInfo.authorizationServerMetadata.scopes_supported;
        }
      } catch {
        // optional
      }
    }

    // Be more conservative with scope requests
    if (scopesSupported && scopesSupported.length > 0) {
      // For MCP servers, try common scopes first
      const commonScopes = ['read', 'write', 'mcp', 'api'];
      const availableCommonScopes = scopesSupported.filter(scope => 
        commonScopes.includes(scope.toLowerCase())
      );
      
      if (availableCommonScopes.length > 0) {
        console.log("Using common scopes:", availableCommonScopes);
        return availableCommonScopes.join(" ");
      }
      
      // If no common scopes, try the first scope only (most conservative)
      console.log("Using first available scope:", scopesSupported[0]);
      return scopesSupported[0];
    }

    // If no scopes discovered, try without scope (some servers support this)
    console.log("No scopes discovered, attempting without scope parameter");
    return undefined;
  } catch (error) {
    console.debug("OAuth scope discovery failed:", error);
    return undefined;
  }
};

export const getClientInformationFromSessionStorage = async ({
  serverUrl,
  isPreregistered,
}: {
  serverUrl: string;
  isPreregistered?: boolean;
}) => {
  const key = getServerSpecificKey(
    isPreregistered
      ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
      : SESSION_KEYS.CLIENT_INFORMATION,
    serverUrl,
  );

  const value = sessionStorage.getItem(key);
  if (!value) {
    return undefined;
  }

  return await OAuthClientInformationSchema.parseAsync(JSON.parse(value));
};

export const saveClientInformationToSessionStorage = ({
  serverUrl,
  clientInformation,
  isPreregistered,
}: {
  serverUrl: string;
  clientInformation: OAuthClientInformation;
  isPreregistered?: boolean;
}) => {
  const key = getServerSpecificKey(
    isPreregistered
      ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
      : SESSION_KEYS.CLIENT_INFORMATION,
    serverUrl,
  );
  sessionStorage.setItem(key, JSON.stringify(clientInformation));
};

export const clearClientInformationFromSessionStorage = ({
  serverUrl,
  isPreregistered,
}: {
  serverUrl: string;
  isPreregistered?: boolean;
}) => {
  const key = getServerSpecificKey(
    isPreregistered
      ? SESSION_KEYS.PREREGISTERED_CLIENT_INFORMATION
      : SESSION_KEYS.CLIENT_INFORMATION,
    serverUrl,
  );
  sessionStorage.removeItem(key);
};

export class PlaygroundOAuthClientProvider implements OAuthClientProvider {
  constructor(
    protected serverUrl: string,
    scope?: string,
    protected proxyUrl?: string,
    protected preregisteredClientId?: string,
    protected preregisteredClientSecret?: string,
  ) {
    this.scope = scope;
    // Save the server URL to session storage
    sessionStorage.setItem(SESSION_KEYS.SERVER_URL, serverUrl);
  }
  scope: string | undefined;

  // Helper method to get the base URL for OAuth discovery
  private getOAuthBaseUrl(): string {
    // For OAuth discovery, we need to use the original server URL, not the proxy
    // The proxy is only for the main MCP transport connection
    return this.serverUrl;
  }

  // Custom resource URL validation for proxy scenarios
  async validateResourceURL(defaultResource: URL, configuredResource?: string): Promise<URL | undefined> {
    if (!configuredResource) {
      return undefined;
    }

    // Cognito does not support RFC 8707 resource indicators on authorize/token — sending
    // `resource` causes invalid_grant. DCR may point authorization_servers at API Gateway,
    // while token_endpoint still uses *.amazoncognito.com.
    try {
      const serverInfo = await discoverMcpOAuthServerInfo(this.serverUrl);
      if (
        shouldOmitResourceParameter({
          authorizationServerUrl: serverInfo.authorizationServerUrl,
          tokenEndpoint: serverInfo.authorizationServerMetadata?.token_endpoint,
          authorizationServers: serverInfo.resourceMetadata?.authorization_servers,
        })
      ) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    const configuredUrl = new URL(configuredResource);
    const defaultUrl = defaultResource;

    const isProxyOf = (url: URL, originalUrl: string): boolean =>
      url.href.includes('/api/mcp-proxy/') &&
      url.href.includes(encodeURIComponent(originalUrl));

    // Case 1: defaultResource is the proxy URL, configuredResource is the original server URL
    if (isProxyOf(defaultUrl, configuredResource) || isProxyOf(defaultUrl, this.serverUrl)) {
      return defaultUrl;
    }

    // Case 2: metadata still has proxy URL (legacy) — bind tokens to the real MCP resource
    if (isProxyOf(configuredUrl, defaultUrl.href) || isProxyOf(configuredUrl, this.serverUrl)) {
      return new URL(this.serverUrl);
    }

    // Case 3: origins match
    if (defaultUrl.origin === configuredUrl.origin) {
      return configuredUrl;
    }

    throw new Error(`Protected resource ${configuredResource} does not match expected ${defaultUrl.href} (or origin)`);
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    const key = getServerSpecificKey(SESSION_KEYS.DISCOVERY_STATE, this.serverUrl);
    const value = sessionStorage.getItem(key);
    if (!value) {
      return undefined;
    }
    return JSON.parse(value) as OAuthDiscoveryState;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    const key = getServerSpecificKey(SESSION_KEYS.DISCOVERY_STATE, this.serverUrl);
    sessionStorage.setItem(key, JSON.stringify(state));
  }

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    if (scope === "all" || scope === "discovery") {
      sessionStorage.removeItem(
        getServerSpecificKey(SESSION_KEYS.DISCOVERY_STATE, this.serverUrl),
      );
    }
    if (scope === "all" || scope === "client") {
      clearClientInformationFromSessionStorage({
        serverUrl: this.serverUrl,
        isPreregistered: false,
      });
    }
    if (scope === "all" || scope === "tokens" || scope === "verifier") {
      sessionStorage.removeItem(
        getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl),
      );
      sessionStorage.removeItem(
        getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl),
      );
    }
  }

  get redirectUrl() {
    return window.location.origin + "/oauth/callback";
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      redirect_uris: [this.redirectUrl],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "Amazon Bedrock MCP Playground",
      client_uri: "https://github.com/your-org/mcp-playground",
      scope: this.scope ?? "",
    };
  }

  state(): string | Promise<string> {
    return generateOAuthState();
  }

  async clientInformation() {
    // If pre-registered client credentials are provided, use them
    if (this.preregisteredClientId) {
      const clientInfo: any = {
        client_id: this.preregisteredClientId,
        redirect_uris: [this.redirectUrl],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Amazon Bedrock MCP Playground",
        client_uri: "https://github.com/your-org/mcp-playground",
        scope: this.scope ?? "",
      };
      
      // Add client_secret and auth method if provided
      if (this.preregisteredClientSecret) {
        clientInfo.client_secret = this.preregisteredClientSecret;
        clientInfo.token_endpoint_auth_method = "client_secret_post";
      } else {
        clientInfo.token_endpoint_auth_method = "none";
      }
      
      return clientInfo as OAuthClientInformation;
    }

    // Try to get the preregistered client information from session storage first
    const preregisteredClientInformation =
      await getClientInformationFromSessionStorage({
        serverUrl: this.serverUrl,
        isPreregistered: true,
      });

    // If no preregistered client information is found, get the dynamically registered client information
    return (
      preregisteredClientInformation ??
      (await getClientInformationFromSessionStorage({
        serverUrl: this.serverUrl,
        isPreregistered: false,
      }))
    );
  }

  saveClientInformation(clientInformation: OAuthClientInformation) {
    // For the playground, temporarily store the full client information including secret
    // This allows users to see and copy the credentials
    const playgroundKey = getServerSpecificKey("playground_client_info", this.serverUrl);
    sessionStorage.setItem(playgroundKey, JSON.stringify(clientInformation));
    
    // Remove client_secret before storing in the standard location (not needed after initial OAuth flow)
    const safeInfo = Object.fromEntries(
      Object.entries(clientInformation).filter(
        ([key]) => key !== "client_secret",
      ),
    ) as OAuthClientInformation;

    // Save the dynamically registered client information to session storage
    saveClientInformationToSessionStorage({
      serverUrl: this.serverUrl,
      clientInformation: safeInfo,
      isPreregistered: false,
    });
  }

  // Method to get full client information including secret for playground display
  async getPlaygroundClientInformation() {
    const playgroundKey = getServerSpecificKey("playground_client_info", this.serverUrl);
    const value = sessionStorage.getItem(playgroundKey);
    if (!value) {
      return undefined;
    }
    
    try {
      return await OAuthClientInformationSchema.parseAsync(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  async tokens() {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    const tokens = sessionStorage.getItem(key);
    if (!tokens) {
      return undefined;
    }

    return await OAuthTokensSchema.parseAsync(JSON.parse(tokens));
  }

  saveTokens(tokens: OAuthTokens) {
    const key = getServerSpecificKey(SESSION_KEYS.TOKENS, this.serverUrl);
    sessionStorage.setItem(key, JSON.stringify(tokens));
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (
      authorizationUrl.protocol !== "http:" &&
      authorizationUrl.protocol !== "https:"
    ) {
      throw new Error("Authorization URL must be HTTP or HTTPS");
    }

    // Popup keeps window.opener more reliably than _blank after Cognito redirects.
    const authTab = window.open(
      authorizationUrl.href,
      "mcp_oauth",
      "popup,width=520,height=720,noopener=no,noreferrer=no",
    );

    if (!authTab) {
      throw new Error(
        "Failed to open OAuth window. Allow popups for this site and try again.",
      );
    }

    // Wait for the popup to complete the OAuth flow
    return new Promise((resolve, reject) => {
      let settled = false;
      let pollInterval: ReturnType<typeof setInterval> | undefined;
      let popupClosedAt: number | null = null;
      const oauthChannel =
        typeof BroadcastChannel !== "undefined"
          ? new BroadcastChannel(OAUTH_CALLBACK_CHANNEL)
          : null;

      const cleanup = () => {
        window.removeEventListener("message", messageListener);
        window.removeEventListener("storage", storageListener);
        oauthChannel?.close();
        if (pollInterval) {
          clearInterval(pollInterval);
        }
      };

      const readPendingAuthCode = (): string | null =>
        sessionStorage.getItem("oauth_authorization_code");

      const finishWithCode = (code: string) => {
        if (settled) return;
        settled = true;
        cleanup();

        sessionStorage.setItem("oauth_authorization_code", code);
        this.exchangeAuthorizationCodeForTokens(code)
          .then(() => resolve())
          .catch((error) => {
            console.error("Token exchange failed:", error);
            reject(error);
          });
      };

      const handleOAuthSuccess = (code: string) => {
        console.log("Received OAuth authorization code");
        try {
          window.focus();
        } catch {
          /* ignore */
        }
        finishWithCode(code);
      };

      const handleOAuthFailure = (message: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(message));
      };

      // postMessage from /oauth/callback (popup or tab with window.opener)
      const messageListener = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) {
          return;
        }

        if (event.data.type === "oauth_success" && event.data.code) {
          handleOAuthSuccess(event.data.code);
        } else if (event.data.type === "oauth_error") {
          handleOAuthFailure(event.data.error || "OAuth authentication failed");
        }
      };

      window.addEventListener("message", messageListener);

      // Callback writes code to sessionStorage before BroadcastChannel; storage event is reliable
      const storageListener = (event: StorageEvent) => {
        if (event.key !== "oauth_authorization_code" || !event.newValue || settled) {
          return;
        }
        handleOAuthSuccess(event.newValue);
      };
      window.addEventListener("storage", storageListener);

      // BroadcastChannel fallback when callback popup has no window.opener
      oauthChannel?.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type === "oauth_success" && event.data.code) {
          handleOAuthSuccess(event.data.code);
        } else if (event.data?.type === "oauth_error") {
          handleOAuthFailure(event.data.error || "OAuth authentication failed");
        }
      });

      // Poll for code (popup may report closed briefly during Cognito redirects)
      pollInterval = setInterval(() => {
        if (settled) return;

        const authCode = readPendingAuthCode();
        if (authCode) {
          finishWithCode(authCode);
          return;
        }

        if (authTab.closed) {
          if (!popupClosedAt) {
            popupClosedAt = Date.now();
          }
          // Wait for callback page to finish writing the code before failing
          if (Date.now() - popupClosedAt > 20_000) {
            handleOAuthFailure(
              "OAuth flow was cancelled or timed out. Close the OAuth popup after you see success, or click Connect again.",
            );
          }
        } else {
          popupClosedAt = null;
        }
      }, 400);

      // Timeout after 10 minutes (longer than popup since users might take more time in a tab)
      setTimeout(() => {
        if (settled) return;
        if (!authTab.closed) {
          console.log("OAuth flow timed out, but leaving tab open for user");
        }
        handleOAuthFailure("OAuth flow timed out");
      }, 10 * 60 * 1000);
    });
  }

  async exchangeAuthorizationCodeForTokens(authorizationCode: string): Promise<void> {
    try {
      console.log("🔄 Starting token exchange...");

      const cachedDiscovery = await this.discoveryState();
      const serverInfo = cachedDiscovery?.authorizationServerMetadata
        ? {
            authorizationServerUrl: cachedDiscovery.authorizationServerUrl,
            authorizationServerMetadata:
              cachedDiscovery.authorizationServerMetadata,
          }
        : await discoverMcpOAuthServerInfo(
            this.serverUrl,
            isDatabricksMcpUrl(this.serverUrl)
              ? createDatabricksOAuthFetch()
              : undefined,
          );
      const authServerMetadata = serverInfo.authorizationServerMetadata;

      if (!authServerMetadata?.token_endpoint) {
        throw new Error("No token endpoint found");
      }

      const clientInfo = await this.clientInformation();
      if (!clientInfo?.client_id) {
        throw new Error("No OAuth client_id available — try clearing site data and reconnecting");
      }

      const codeVerifier = this.codeVerifier();

      // Must match the `resource` sent during authorization (RFC 8707 / MCP OAuth)
      let resource = await selectResourceURL(
        this.serverUrl,
        this,
        serverInfo.resourceMetadata,
      );

      const omitResource = shouldOmitResourceParameter({
        authorizationServerUrl: serverInfo.authorizationServerUrl,
        tokenEndpoint: authServerMetadata.token_endpoint,
        authorizationServers: serverInfo.resourceMetadata?.authorization_servers,
      });
      if (omitResource) {
        resource = undefined;
        console.log("Omitting OAuth resource parameter (Cognito does not support RFC 8707)");
      }

      console.log(
        "🔄 Token exchange request:",
        JSON.stringify({
          endpoint: authServerMetadata.token_endpoint,
          redirect_uri: this.redirectUrl,
          resource: resource?.href ?? "(omitted for Cognito)",
          client_id: clientInfo.client_id,
          has_client_secret: !!(clientInfo as { client_secret?: string }).client_secret,
        }),
      );

      const tokens = await exchangeAuthorization(
        serverInfo.authorizationServerUrl,
        {
          metadata: authServerMetadata,
          clientInformation: clientInfo,
          authorizationCode,
          codeVerifier,
          redirectUri: this.redirectUrl,
          resource,
        },
      );

      console.log("🔄 Received tokens:", {
        access_token: tokens.access_token
          ? `${tokens.access_token.substring(0, 20)}...`
          : "missing",
        token_type: tokens.token_type,
        expires_in: tokens.expires_in,
        refresh_token: tokens.refresh_token ? "present" : "missing",
      });

      this.saveTokens(tokens);
      
      // Clear authorization code and code verifier
      sessionStorage.removeItem("oauth_authorization_code");
      sessionStorage.removeItem("oauth_state");
      const codeVerifierKey = getServerSpecificKey(SESSION_KEYS.CODE_VERIFIER, this.serverUrl);
      sessionStorage.removeItem(codeVerifierKey);
      
      console.log("✅ Token exchange completed successfully");
    } catch (error) {
      const detail = formatOAuthError(error);
      console.error("❌ Token exchange failed:", detail, error);

      sessionStorage.removeItem("oauth_authorization_code");
      sessionStorage.removeItem("oauth_state");

      // Stale DCR client (wrong redirect_uri) often surfaces as invalid_grant
      if (detail.includes("invalid_grant") || detail.includes("invalid_client")) {
        clearClientInformationFromSessionStorage({
          serverUrl: this.serverUrl,
          isPreregistered: false,
        });
        sessionStorage.removeItem(
          getServerSpecificKey("playground_client_info", this.serverUrl),
        );
      }

      throw error instanceof Error ? error : new Error(detail);
    }
  }

  saveCodeVerifier(codeVerifier: string) {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    sessionStorage.setItem(key, codeVerifier);
  }

  codeVerifier() {
    const key = getServerSpecificKey(
      SESSION_KEYS.CODE_VERIFIER,
      this.serverUrl,
    );
    const verifier = sessionStorage.getItem(key);
    if (!verifier) {
      throw new Error("No code verifier saved for session");
    }

    return verifier;
  }

  clear() {
    void this.invalidateCredentials("all");
    // Clear playground client information
    sessionStorage.removeItem(
      getServerSpecificKey("playground_client_info", this.serverUrl),
    );
  }
}

/** Pre-seed SDK auth() so it skips broken discovery on the external MCP path. */
export async function seedDatabricksOAuthDiscovery(
  provider: PlaygroundOAuthClientProvider,
  serverUrl: string,
  fetchFn?: FetchFn,
  serverInfo?: McpOAuthServerInfo,
): Promise<void> {
  const resolved =
    serverInfo ?? (await discoverMcpOAuthServerInfo(serverUrl, fetchFn));
  if (!resolved.authorizationServerMetadata?.authorization_endpoint) {
    throw new Error(
      "Could not discover Databricks OAuth authorization endpoint. Check the External MCP URL.",
    );
  }
  await provider.saveDiscoveryState({
    authorizationServerUrl: String(resolved.authorizationServerUrl),
    resourceMetadataUrl: getDatabricksProtectedResourceMetadataUrl(serverUrl).href,
    resourceMetadata: resolved.resourceMetadata,
    authorizationServerMetadata: resolved.authorizationServerMetadata,
  });
}
