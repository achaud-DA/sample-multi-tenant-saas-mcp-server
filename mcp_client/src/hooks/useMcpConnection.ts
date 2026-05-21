import { useState, useEffect, useCallback } from "react";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ListResourcesRequestSchema,
  ListResourcesResultSchema,
  ListPromptsRequestSchema,
  ListPromptsResultSchema,
  CallToolResultSchema,
  ReadResourceRequestSchema,
  ReadResourceResultSchema,
  GetPromptRequestSchema,
  GetPromptResultSchema,
  Tool,
  Resource,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  discoverMcpOAuthServerInfo,
  PlaygroundOAuthClientProvider,
  discoverScopes,
  seedDatabricksOAuthDiscovery,
  type McpOAuthServerInfo,
} from "../lib/auth";
import { ConnectionStatus } from "../lib/constants";
import { z } from "zod";
import { McpConnectionState, EMPTY_MCP_CONNECTION_STATE } from "../lib/auth-types";
import {
  createDatabricksOAuthFetch,
  getDatabricksProtectedResourceMetadataUrl,
  getMcpProxyUrl,
  getOAuthDiscoveryUrl,
  isDatabricksMcpUrl,
} from "../lib/config";

interface UseMcpConnectionOptions {
  serverUrl?: string;
  bearerToken?: string;
  headerName?: string;
  clientId?: string;
  clientSecret?: string;
  onError?: (error: Error) => void;
}

export function useMcpConnection({
  serverUrl,
  bearerToken,
  headerName,
  clientId,
  clientSecret,
  onError,
}: UseMcpConnectionOptions = {}) {
  const [state, setState] = useState<McpConnectionState>(EMPTY_MCP_CONNECTION_STATE);
  const [client, setClient] = useState<Client | null>(null);

  const updateState = useCallback((updates: Partial<McpConnectionState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const handleError = useCallback((error: Error) => {
    console.error("MCP Connection Error:", error);
    updateState({ 
      status: "error", 
      error: error.message 
    });
    onError?.(error);
  }, [onError, updateState]);

  const isAuthRequiredError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return (
      msg.includes("401") ||
      msg.includes("unauthorized") ||
      msg.includes("authentication failed") ||
      msg.includes("invalid_token") ||
      msg.includes("missing authorization") ||
      msg.includes("www-authenticate")
    );
  };

  const handleAuthError = async (
    error: unknown,
    url: string,
    retryWithoutScope: boolean = false,
    connectRetryCount: number = 0,
  ) => {
    if (isAuthRequiredError(error)) {
      // If we have a manual bearer token, don't try OAuth - just fail fast
      if (bearerToken) {
        console.log("🔍 401 error with manual bearer token - failing immediately");
        return false;
      }

      if (connectRetryCount >= 3) {
        handleError(
          new Error(
            "Authentication failed after multiple attempts. Check the MCP server URL, OAuth redirect URI, and client credentials.",
          ),
        );
        return false;
      }
      
      updateState({ status: "authenticating" });
      
      let serverAuthProvider: PlaygroundOAuthClientProvider | null = null;
      
      try {
        console.log("Starting OAuth flow for:", url);
        
        let scope = undefined;
        const proxyUrl = getMcpProxyUrl(url);
        const databricksFetch = isDatabricksMcpUrl(url)
          ? createDatabricksOAuthFetch()
          : undefined;

        let databricksServerInfo: McpOAuthServerInfo | undefined;
        if (isDatabricksMcpUrl(url) && databricksFetch) {
          databricksServerInfo = await discoverMcpOAuthServerInfo(
            url,
            databricksFetch,
          );
        }

        if (!retryWithoutScope) {
          scope = await discoverScopes(
            url,
            databricksServerInfo?.resourceMetadata,
            proxyUrl,
            databricksFetch,
          );
        } else {
          // Retry attempt: try without any scope
          console.log("Retrying OAuth without scope parameter");
          scope = undefined;
        }

        if (!scope && isDatabricksMcpUrl(url)) {
          scope = "all-apis";
        }
        
        console.log("Using scope:", scope);

        // Drop leftover codes from a previous attempt (they cause invalid_grant if reused)
        sessionStorage.removeItem("oauth_authorization_code");
        sessionStorage.removeItem("oauth_state");

        serverAuthProvider = new PlaygroundOAuthClientProvider(
          url, 
          scope, 
          proxyUrl,
          clientId,
          clientSecret
        );
        
        // Tokens exist but we still got 401 — they are stale or for the wrong resource
        const existingTokens = await serverAuthProvider.tokens();
        if (existingTokens?.access_token) {
          console.log("Clearing stale OAuth tokens after 401");
          serverAuthProvider.clear();
        }

        if (isDatabricksMcpUrl(url) && databricksServerInfo) {
          await seedDatabricksOAuthDiscovery(
            serverAuthProvider,
            url,
            databricksFetch,
            databricksServerInfo,
          );
        }

        const authOptions: Parameters<typeof auth>[1] = {
          serverUrl: getOAuthDiscoveryUrl(url),
          scope,
          fetchFn: databricksFetch,
        };
        if (isDatabricksMcpUrl(url)) {
          authOptions.resourceMetadataUrl =
            getDatabricksProtectedResourceMetadataUrl(url);
        }
        const result = await auth(serverAuthProvider, authOptions);
        
        console.log("🔍 Auth result:", result);
        console.log("🔍 Auth result === 'AUTHORIZED':", result === "AUTHORIZED");
        
        // Check sessionStorage after auth
        console.log("🔍 SessionStorage after auth:");
        const tokens = await serverAuthProvider.tokens();
        console.log("  Tokens available:", !!tokens);
        console.log("  Access token:", tokens?.access_token ? "present" : "missing");

        // SDK returns REDIRECT after browser OAuth even when tokens were saved in redirectToAuthorization
        if (tokens?.access_token) {
          return true;
        }

        if (result === "REDIRECT") {
          handleError(
            new Error(
              "OAuth login completed but token exchange failed. Check browser console and that your OAuth app's redirect URI matches this app exactly.",
            ),
          );
          return false;
        }

        return result === "AUTHORIZED";
      } catch (authError) {
        console.error("OAuth flow failed:", authError);
        
        // If tab is blocked but we have an authorization code, try to continue
        // Clear authorization code if auth failed to prevent confusion
        sessionStorage.removeItem("oauth_authorization_code");
        sessionStorage.removeItem("oauth_state");
        
        // Check if it's an invalid_scope error and we haven't retried yet
        if (!retryWithoutScope && 
            authError instanceof Error && 
            (authError.message.includes("invalid_scope") || authError.message.includes("invalid_request"))) {
          console.log("Got invalid_scope error, retrying without scope");
          return await handleAuthError(error, url, true, connectRetryCount);
        }
        
        handleError(new Error(`Authentication failed: ${authError instanceof Error ? authError.message : String(authError)}`));
        return false;
      }
    }
    return false;
  };

  const loadServerData = async (mcpClient: Client) => {
    const skipped: string[] = [];

    let toolsResponse = { tools: [] as Tool[] };
    try {
      toolsResponse = await mcpClient.request(
        { method: "tools/list" },
        ListToolsResultSchema,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn("Failed to load tools:", error);
      updateState({
        error: `Connected but tools/list failed: ${detail}`,
      });
      return;
    }

    let resourcesResponse = { resources: [] as Resource[] };
    try {
      resourcesResponse = await mcpClient.request(
        { method: "resources/list" },
        ListResourcesResultSchema,
      );
    } catch (error) {
      console.warn("resources/list not available:", error);
      skipped.push("resources");
    }

    let promptsResponse = { prompts: [] as Prompt[] };
    try {
      promptsResponse = await mcpClient.request(
        { method: "prompts/list" },
        ListPromptsResultSchema,
      );
    } catch (error) {
      console.warn("prompts/list not available:", error);
      skipped.push("prompts");
    }

    try {
      // Attach callTool method to each tool - capture mcpClient in closure
      const toolsWithCallTool = (toolsResponse.tools || []).map((tool: any) => ({
        ...tool,
        callTool: async (args: any) => {
          try {
            const response = await mcpClient.request({
              method: "tools/call",
              params: {
                name: tool.name,
                arguments: args || {},
              },
            }, CallToolResultSchema);
            
            return response;
          } catch (error) {
            console.error("Tool call error:", error);
            throw error;
          }
        }
      }));

      // Attach readResource method to each resource - capture mcpClient in closure
      const resourcesWithReadResource = (resourcesResponse.resources || []).map((resource: any) => ({
        ...resource,
        readResource: async () => {
          try {
            const response = await mcpClient.request({
              method: "resources/read",
              params: {
                uri: resource.uri,
              },
            }, ReadResourceResultSchema);
            
            return response;
          } catch (error) {
            console.error("Error reading resource:", error);
            throw error;
          }
        },
      }));

      // Attach getPrompt method to each prompt - capture mcpClient in closure
      const promptsWithGetPrompt = (promptsResponse.prompts || []).map((prompt: any) => ({
        ...prompt,
        getPrompt: async (args: any = {}) => {
          try {
            const response = await mcpClient.request({
              method: "prompts/get",
              params: {
                name: prompt.name,
                arguments: args,
              },
            }, GetPromptResultSchema);
            
            return response;
          } catch (error) {
            console.error("Error getting prompt:", error);
            throw error;
          }
        },
      }));

      updateState({
        tools: toolsWithCallTool,
        resources: resourcesWithReadResource,
        prompts: promptsWithGetPrompt,
        error:
          skipped.length > 0
            ? `Connected (${toolsWithCallTool.length} tools). Optional features unavailable: ${skipped.join(", ")}.`
            : null,
      });
    } catch (error) {
      console.warn("Failed to process server data:", error);
      const detail = error instanceof Error ? error.message : String(error);
      updateState({
        error: `Connected but failed to process server data: ${detail}`,
      });
    }
  };

  const connect = async (url: string, retryCount: number = 0) => {
    if (!url) return;

    updateState({ 
      status: "connecting", 
      serverUrl: url, 
      error: null 
    });

    try {
      // Create MCP client - exactly like Inspector
      const mcpClient = new Client(
        {
          name: "mcp-playground",
          version: "1.0.0",
        },
        {
          capabilities: {
            sampling: {},
          },
        },
      );

      // Prepare headers - exactly like Inspector
      const headers: HeadersInit = {};
      
      // Create proxy URL first
      const proxyUrl = getMcpProxyUrl(url);
      
      // Discover scope for auth provider consistency - use original server URL for OAuth discovery
      let scope = undefined;
      if (!bearerToken) {
        // Only do OAuth discovery if no manual bearer token is provided
        const databricksFetch = isDatabricksMcpUrl(url)
          ? createDatabricksOAuthFetch()
          : undefined;
        scope = await discoverScopes(
          url,
          undefined,
          proxyUrl,
          databricksFetch,
        );
      }
      
      // Create auth provider with discovered scope (consistent with OAuth flow)
      const serverAuthProvider = new PlaygroundOAuthClientProvider(
        url, 
        scope, 
        proxyUrl,
        clientId,
        clientSecret
      );
      
      // Use manually provided bearer token if available, otherwise use OAuth tokens - exactly like Inspector
      let token: string | undefined;
      if (bearerToken) {
        // Manual bearer token provided - use it directly, skip OAuth
        token = bearerToken;
        console.log("🔍 Token Debug:");
        console.log("  Using manual bearer token");
        console.log("  Token length:", token.length);
      } else {
        // No manual token - use cached OAuth tokens or run the flow before connecting
        token = (await serverAuthProvider.tokens())?.access_token;
        if (!token) {
          console.log("No MCP access token in session — starting OAuth before connect");
          const oauthReady = await handleAuthError(
            new Error("Missing Authorization header"),
            url,
            false,
            retryCount,
          );
          if (!oauthReady) {
            return;
          }
          updateState({ status: "connecting", serverUrl: url, error: null });
          token = (await serverAuthProvider.tokens())?.access_token;
        }
      }
      
      if (token) {
        const authHeaderName = headerName || "Authorization";
        if (authHeaderName.toLowerCase() !== "authorization") {
          headers[authHeaderName] = token;
          headers["x-custom-auth-header"] = authHeaderName;
        } else {
          headers[authHeaderName] = `Bearer ${token}`;
        }
      }

      // Create transport using our proxy - environment-aware URL
      const transportOptions: StreamableHTTPClientTransportOptions = {
        // OAuth is handled in handleAuthError with the real MCP server URL.
        // Passing authProvider here would run auth() against the CloudFront proxy URL
        // and can break PKCE / resource binding (invalid_grant on token exchange).
        requestInit: {
          headers,
        },
        reconnectionOptions: {
          maxReconnectionDelay: 5000,  // Reduced from 30000 to 5000 (5 seconds max)
          initialReconnectionDelay: 500,  // Reduced from 1000 to 500 (0.5 seconds initial)
          reconnectionDelayGrowFactor: 1.5,
          maxRetries: 3,  // Keep retries but with faster timeouts
        },
      };

      const transport = new StreamableHTTPClientTransport(
        new URL(proxyUrl, window.location.origin),
        transportOptions
      );

      console.log("🔍 Transport created with URL:", proxyUrl);
      console.log("🔍 Transport options:", transportOptions);

      // Connect - exactly like Inspector
      console.log("🔍 Attempting to connect...");
      await mcpClient.connect(transport);
      
      console.log("🔍 Connection established successfully!");
      console.log("🔍 Server capabilities:", mcpClient.getServerCapabilities());
      
      setClient(mcpClient);
      updateState({ status: "connected" });

      // Load server data
      await loadServerData(mcpClient);

    } catch (error) {
      console.error("Connection failed:", error);
      
      // Handle auth errors - exactly like Inspector
      const shouldRetry = await handleAuthError(error, url, false, retryCount);
      
      if (shouldRetry) {
        return connect(url, retryCount + 1);
      }
      
      if (isAuthRequiredError(error) && !bearerToken) {
        handleError(
          new Error(
            "Authentication did not complete. Verify OAuth redirect URI and client credentials, then try again.",
          ),
        );
        return;
      }
      
      // For other errors, show them
      handleError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  const disconnect = useCallback(async () => {
    if (client) {
      try {
        await client.close();
      } catch (error) {
        console.warn("Error closing client:", error);
      }
      setClient(null);
    }
    setState(EMPTY_MCP_CONNECTION_STATE);
  }, [client]);

  const callTool = useCallback(async (name: string, args: any = {}) => {
    if (!client) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const response = await client.request({
        method: "tools/call",
        params: {
          name: name,
          arguments: args || {},
        },
      }, CallToolResultSchema);
      
      return response;
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }, [client, handleError]);

  const readResource = useCallback(async (uri: string) => {
    if (!client) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const response = await client.request({
        method: "resources/read",
        params: {
          uri,
        },
      }, ReadResourceResultSchema);
      
      return response;
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }, [client, handleError]);

  const getPrompt = useCallback(async (name: string, args: any = {}) => {
    if (!client) {
      throw new Error("Not connected to MCP server");
    }

    try {
      const response = await client.request({
        method: "prompts/get",
        params: {
          name,
          arguments: args,
        },
      }, GetPromptResultSchema);
      
      return response;
    } catch (error) {
      handleError(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }, [client, handleError]);

  // Auto-connect when serverUrl changes
  useEffect(() => {
    if (serverUrl && state.status === "disconnected") {
      connect(serverUrl);
    }
  }, [serverUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (client) {
        client.close().catch(console.warn);
      }
    };
  }, [client]);

  return {
    ...state,
    connect: (url: string) => connect(url),
    disconnect,
    callTool,
    readResource,
    getPrompt,
    isConnected: state.status === "connected",
    isConnecting: state.status === "connecting",
    isAuthenticating: state.status === "authenticating",
  };
}
