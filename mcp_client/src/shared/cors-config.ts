/** Streamable HTTP MCP headers must be allowed/exposed for browser clients behind the proxy. */
export const MCP_CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, x-custom-auth-header, mcp-session-id, mcp-protocol-version, last-event-id';

export const MCP_CORS_EXPOSE_HEADERS = 'mcp-session-id, mcp-protocol-version';

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': MCP_CORS_ALLOW_HEADERS,
  'Access-Control-Expose-Headers': MCP_CORS_EXPOSE_HEADERS,
};

export function setCorsHeaders(setHeader: (key: string, value: string) => void) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    setHeader(key, value);
  });
}
