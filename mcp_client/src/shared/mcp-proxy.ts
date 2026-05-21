import { MCP_CORS_ALLOW_HEADERS, MCP_CORS_EXPOSE_HEADERS } from './cors-config.js';

export interface McpProxyRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
  queryStringParameters?: Record<string, string> | null;
}

export interface McpProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Request headers forwarded to upstream MCP servers (Streamable HTTP session). */
const MCP_FORWARD_REQUEST_HEADERS = [
  'mcp-session-id',
  'mcp-protocol-version',
  'last-event-id',
] as const;

/** Response headers forwarded back to the browser (must match Access-Control-Expose-Headers). */
const MCP_FORWARD_RESPONSE_HEADERS = [
  'mcp-session-id',
  'mcp-protocol-version',
] as const;

function isHtmlResponse(contentType: string | null, body: string): boolean {
  if (contentType?.includes('text/html') || contentType?.includes('application/xhtml')) {
    return true;
  }
  const start = body.trimStart().slice(0, 256).toLowerCase();
  return start.startsWith('<!doctype') || start.startsWith('<html');
}

function htmlProxyErrorResponse(
  upstreamStatus: number,
  fullUrl: string,
  bodySnippet: string,
): McpProxyResponse {
  console.error('MCP Proxy: upstream returned HTML', {
    upstreamStatus,
    fullUrl,
    snippet: bodySnippet.slice(0, 300),
  });
  return {
    statusCode: 502,
    headers: buildCorsHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      error: 'upstream_html',
      error_description:
        'The MCP server (or CDN) returned HTML instead of JSON/SSE. Verify the MCP URL and bearer token match Cursor. If the playground SPA was deployed with CloudFront 404→index.html rules, redeploy the latest CDK stack.',
      upstream_status: upstreamStatus,
      upstream_url: fullUrl,
    }),
  };
}

function buildCorsHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': MCP_CORS_ALLOW_HEADERS,
    'Access-Control-Expose-Headers': MCP_CORS_EXPOSE_HEADERS,
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    ...extra,
  };
}

export async function handleMcpProxy(request: McpProxyRequest): Promise<McpProxyResponse> {
  try {
    // Extract the target URL from the path
    let targetUrl = request.url.replace('/api/mcp-proxy/', '');
    
    // Handle query parameters
    if (request.queryStringParameters) {
      const queryString = new URLSearchParams(request.queryStringParameters).toString();
      if (queryString) {
        targetUrl += `?${queryString}`;
      }
    }

    // Handle double encoding - decode twice if needed
    let fullUrl = decodeURIComponent(targetUrl);
    
    // Check if it's still encoded (starts with http%3A or https%3A)
    if (fullUrl.startsWith('http%3A') || fullUrl.startsWith('https%3A')) {
      fullUrl = decodeURIComponent(fullUrl);
    }

    // Validate URL and block internal networks
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(fullUrl);
    } catch {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Invalid URL format' })
      };
    }

    // Block internal networks and metadata services
    const hostname = parsedUrl.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || 
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(hostname) ||
        hostname === '169.254.169.254') {
      return {
        statusCode: 502,
        headers: buildCorsHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ error: 'Access to internal networks blocked' })
      };
    }

    // Prevent path traversal
    if (parsedUrl.pathname.includes('../')) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Path traversal not allowed' })
      };
    }

    const sessionIdIn = getHeader(request.headers, 'mcp-session-id');
    console.log(`MCP Proxy: ${request.method} ${fullUrl}${sessionIdIn ? ` (mcp-session-id present)` : ''}`);

    const upstreamHeaders: Record<string, string> = {
      'Content-Type': getHeader(request.headers, 'content-type') || 'application/json',
      'Accept': 'application/json, text/event-stream',
    };

    const authorization = getHeader(request.headers, 'authorization');
    if (authorization) {
      upstreamHeaders['Authorization'] = authorization;
    }

    const customAuthHeaderName = getHeader(request.headers, 'x-custom-auth-header');
    if (customAuthHeaderName) {
      const customAuthValue = getHeader(request.headers, customAuthHeaderName);
      if (customAuthValue) {
        upstreamHeaders[customAuthHeaderName] = customAuthValue;
      }
    }

    for (const name of MCP_FORWARD_REQUEST_HEADERS) {
      const value = getHeader(request.headers, name);
      if (value) {
        upstreamHeaders[name] = value;
      }
    }

    const fetchOptions: RequestInit = {
      method: request.method,
      headers: upstreamHeaders,
      cache: 'no-store',
    };

    // Handle body for non-GET requests
    if (request.method !== 'GET' && request.body) {
      if (getHeader(request.headers, 'content-type') === 'application/x-www-form-urlencoded') {
        fetchOptions.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      } else {
        fetchOptions.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      }
    }

    const response = await fetch(fullUrl, fetchOptions);

    console.log(`Response status: ${response.status}`);
    console.log(`Response content-type: ${response.headers.get('content-type')}`);

    // Handle OAuth endpoints that don't exist on the server
    if (response.status === 404) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        // Handle OAuth registration endpoint
        if (request.method === 'POST' && fullUrl.includes('/register')) {
          console.log('Server does not support OAuth registration endpoint, providing fallback response');
          
          return {
            statusCode: 400,
            headers: buildCorsHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              error: 'invalid_client_metadata',
              error_description: 'Dynamic client registration is not supported by this server. Please use pre-configured client credentials or contact the server administrator for access.'
            }),
          };
        }
        
        // Handle OAuth authorization server discovery endpoint
        if (request.method === 'GET' && fullUrl.includes('/.well-known/oauth-authorization-server')) {
          console.log('Server does not support OAuth authorization server discovery, providing fallback response');
          
          return {
            statusCode: 502,
            headers: buildCorsHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              error: 'not_found',
              error_description: 'OAuth authorization server discovery is not supported by this server. Please use manual authentication or contact the server administrator for access.'
            }),
          };
        }
      }
    }

    // Get response body first
    const responseBody = await response.text();
    const upstreamContentType = response.headers.get('content-type');

    // HTML usually means CloudFront SPA fallback (index.html) or API Gateway error page — not valid MCP
    if (isHtmlResponse(upstreamContentType, responseBody)) {
      return htmlProxyErrorResponse(response.status, fullUrl, responseBody);
    }

    // Handle OAuth registration responses that might have incorrect Content-Type
    if (request.method === 'POST' && fullUrl.includes('/register') && (response.status === 400 || response.status === 404)) {
      // Check if it's a JSON response but with wrong Content-Type
      try {
        const jsonData = JSON.parse(responseBody);
        if (jsonData.error) {
          console.log('Fixing Content-Type for OAuth registration error response');
          
          return {
            statusCode: response.status,
            headers: buildCorsHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(jsonData), // Ensure it's properly stringified
          };
        }
      } catch (e) {
        // Not JSON, continue with normal processing
      }
    }

    const responseHeaders = buildCorsHeaders();

    const contentType = response.headers.get('content-type');
    if (contentType) {
      responseHeaders['Content-Type'] = contentType;
    }

    const wwwAuth = response.headers.get('www-authenticate');
    if (wwwAuth) {
      responseHeaders['WWW-Authenticate'] = wwwAuth;
    }

    for (const name of MCP_FORWARD_RESPONSE_HEADERS) {
      const value = response.headers.get(name);
      if (value) {
        responseHeaders[name] = value;
      }
    }

    // Do not forward validators that cause 304 responses on repeated SSE GETs
    delete responseHeaders['etag'];
    delete responseHeaders['ETag'];
    delete responseHeaders['last-modified'];
    delete responseHeaders['Last-Modified'];

    // CloudFront custom errors map origin 404/403 → index.html; use 502 for those statuses
    const statusCode =
      response.status === 404 || response.status === 403 ? 502 : response.status;

    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody,
    };

  } catch (error) {
    console.error('MCP Proxy error:', error);
    return {
      statusCode: 500,
      headers: buildCorsHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        error: 'Proxy error',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

// Helper function to get header value (case-insensitive)
function getHeader(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}
