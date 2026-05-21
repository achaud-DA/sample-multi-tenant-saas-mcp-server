/** BroadcastChannel name for OAuth callback when window.opener is unavailable (e.g. _blank tab). */
export const OAUTH_CALLBACK_CHANNEL = "mcp-oauth-callback";

// Session storage keys
export const SESSION_KEYS = {
  /** MCP URL user was connecting when OAuth opened (resume on original tab). */
  PENDING_CONNECT_URL: "mcp_pending_connect_url",
  /** Last MCP server URL entered in the UI (survives callback tab / refresh). */
  LAST_SERVER_URL: "mcp_last_server_url",
  SERVER_URL: "mcp_server_url",
  CLIENT_INFORMATION: "mcp_client_information",
  PREREGISTERED_CLIENT_INFORMATION: "mcp_preregistered_client_information",
  TOKENS: "mcp_tokens",
  CODE_VERIFIER: "mcp_code_verifier",
  SERVER_METADATA: "mcp_server_metadata",
  DISCOVERY_STATE: "mcp_discovery_state",
} as const;

// Generate server-specific session storage key
export const getServerSpecificKey = (baseKey: string, serverUrl: string): string => {
  const urlHash = btoa(serverUrl).replace(/[^a-zA-Z0-9]/g, '');
  return `${baseKey}_${urlHash}`;
};

// Connection status types
export type ConnectionStatus = 
  | "disconnected" 
  | "connecting" 
  | "connected" 
  | "error" 
  | "authenticating"
  | "error-connecting-to-proxy";
