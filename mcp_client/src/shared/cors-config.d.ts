/** Streamable HTTP MCP headers must be allowed/exposed for browser clients behind the proxy. */
export declare const MCP_CORS_ALLOW_HEADERS = "Content-Type, Authorization, x-custom-auth-header, mcp-session-id, mcp-protocol-version, last-event-id";
export declare const MCP_CORS_EXPOSE_HEADERS = "mcp-session-id, mcp-protocol-version";
export declare const corsHeaders: Record<string, string>;
export declare function setCorsHeaders(setHeader: (key: string, value: string) => void): void;
