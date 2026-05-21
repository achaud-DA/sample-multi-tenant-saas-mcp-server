"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleMcpProxy = void 0;
const cors_config_js_1 = require("./cors-config.js");
/** Request headers forwarded to upstream MCP servers (Streamable HTTP session). */
const MCP_FORWARD_REQUEST_HEADERS = [
    'mcp-session-id',
    'mcp-protocol-version',
    'last-event-id',
];
/** Response headers forwarded back to the browser (must match Access-Control-Expose-Headers). */
const MCP_FORWARD_RESPONSE_HEADERS = [
    'mcp-session-id',
    'mcp-protocol-version',
];
function buildCorsHeaders(extra = {}) {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': cors_config_js_1.MCP_CORS_ALLOW_HEADERS,
        'Access-Control-Expose-Headers': cors_config_js_1.MCP_CORS_EXPOSE_HEADERS,
        ...extra,
    };
}
async function handleMcpProxy(request) {
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
        let parsedUrl;
        try {
            parsedUrl = new URL(fullUrl);
        }
        catch {
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
                statusCode: 403,
                headers: { 'Content-Type': 'application/json' },
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
        const upstreamHeaders = {
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
        const fetchOptions = {
            method: request.method,
            headers: upstreamHeaders,
        };
        // Handle body for non-GET requests
        if (request.method !== 'GET' && request.body) {
            if (getHeader(request.headers, 'content-type') === 'application/x-www-form-urlencoded') {
                fetchOptions.body = typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
            }
            else {
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
                        statusCode: 404,
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
            }
            catch (e) {
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
        return {
            statusCode: response.status,
            headers: responseHeaders,
            body: responseBody,
        };
    }
    catch (error) {
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
exports.handleMcpProxy = handleMcpProxy;
// Helper function to get header value (case-insensitive)
function getHeader(headers, name) {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === lowerName) {
            return Array.isArray(value) ? value[0] : value;
        }
    }
    return undefined;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWNwLXByb3h5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibWNwLXByb3h5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFEQUFtRjtBQWdCbkYsbUZBQW1GO0FBQ25GLE1BQU0sMkJBQTJCLEdBQUc7SUFDbEMsZ0JBQWdCO0lBQ2hCLHNCQUFzQjtJQUN0QixlQUFlO0NBQ1AsQ0FBQztBQUVYLGlHQUFpRztBQUNqRyxNQUFNLDRCQUE0QixHQUFHO0lBQ25DLGdCQUFnQjtJQUNoQixzQkFBc0I7Q0FDZCxDQUFDO0FBRVgsU0FBUyxnQkFBZ0IsQ0FBQyxRQUFnQyxFQUFFO0lBQzFELE9BQU87UUFDTCw2QkFBNkIsRUFBRSxHQUFHO1FBQ2xDLDhCQUE4QixFQUFFLGlDQUFpQztRQUNqRSw4QkFBOEIsRUFBRSx1Q0FBc0I7UUFDdEQsK0JBQStCLEVBQUUsd0NBQXVCO1FBQ3hELEdBQUcsS0FBSztLQUNULENBQUM7QUFDSixDQUFDO0FBRU0sS0FBSyxVQUFVLGNBQWMsQ0FBQyxPQUF3QjtJQUMzRCxJQUFJO1FBQ0YsdUNBQXVDO1FBQ3ZDLElBQUksU0FBUyxHQUFHLE9BQU8sQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLGlCQUFpQixFQUFFLEVBQUUsQ0FBQyxDQUFDO1FBRTNELDBCQUEwQjtRQUMxQixJQUFJLE9BQU8sQ0FBQyxxQkFBcUIsRUFBRTtZQUNqQyxNQUFNLFdBQVcsR0FBRyxJQUFJLGVBQWUsQ0FBQyxPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQyxRQUFRLEVBQUUsQ0FBQztZQUNsRixJQUFJLFdBQVcsRUFBRTtnQkFDZixTQUFTLElBQUksSUFBSSxXQUFXLEVBQUUsQ0FBQzthQUNoQztTQUNGO1FBRUQsa0RBQWtEO1FBQ2xELElBQUksT0FBTyxHQUFHLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBRTVDLGdFQUFnRTtRQUNoRSxJQUFJLE9BQU8sQ0FBQyxVQUFVLENBQUMsU0FBUyxDQUFDLElBQUksT0FBTyxDQUFD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UlMsIE1DUF9DT1JTX0VYUE9TRV9IRUFERVJTIH0gZnJvbSAnLi9jb3JzLWNvbmZpZy5qcyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTWNwUHJveHlSZXF1ZXN0IHtcbiAgbWV0aG9kOiBzdHJpbmc7XG4gIHVybDogc3RyaW5nO1xuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmcgfCBzdHJpbmdbXSB8IHVuZGVmaW5lZD47XG4gIGJvZHk/OiBhbnk7XG4gIHF1ZXJ5U3RyaW5nUGFyYW1ldGVycz86IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gfCBudWxsO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE1jcFByb3h5UmVzcG9uc2Uge1xuICBzdGF0dXNDb2RlOiBudW1iZXI7XG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGJvZHk6IHN0cmluZztcbn1cblxuLyoqIFJlcXVlc3QgaGVhZGVycyBmb3J3YXJkZWQgdG8gdXBzdHJlYW0gTUNQIHNlcnZlcnMgKFN0cmVhbWFibGUgSFRUUCBzZXNzaW9uKS4gKi9cbmNvbnN0IE1DUF9GT1JXQVJEX1JFUVVFU1RfSEVBREVSUyA9IFtcbiAgJ21jcC1zZXNzaW9uLWlkJyxcbiAgJ21jcC1wcm90b2NvbC12ZXJzaW9uJyxcbiAgJ2xhc3QtZXZlbnQtaWQnLFxuXSBhcyBjb25zdDtcblxuLyoqIFJlc3BvbnNlIGhlYWRlcnMgZm9yd2FyZGVkIGJhY2sgdG8gdGhlIGJyb3dzZXIgKG11c3QgbWF0Y2ggQWNjZXNzLUNvbnRyb2wtRXhwb3NlLUhlYWRlcnMpLiAqL1xuY29uc3QgTUNQX0ZPUldBUkRfUkVTUE9OU0VfSEVBREVSUyA9IFtcbiAgJ21jcC1zZXNzaW9uLWlkJyxcbiAgJ21jcC1wcm90b2NvbC12ZXJzaW9uJyxcbl0gYXMgY29uc3Q7XG5cbmZ1bmN0aW9uIGJ1aWxkQ29yc0hlYWRlcnMoZXh0cmE6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fSk6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4ge1xuICByZXR1cm4ge1xuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiBNQ1BfQ09SU19BTExPV19IRUFERVJTLFxuICAgICdBY2Nlc3MtQ29udHJvbC1FeHBvc2UtSGVhZGVycyc6IE1DUF9DT1JTX0VYUE9TRV9IRUFERVJTLFxuICAgIC4uLmV4dHJhLFxuICB9O1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlTWNwUHJveHkocmVxdWVzdDogTWNwUHJveHlSZXF1ZXN0KTogUHJvbWlzZTxNY3BQcm94eVJlc3BvbnNlPiB7XG4gIHRyeSB7XG4gICAgLy8gRXh0cmFjdCB0aGUgdGFyZ2V0IFVSTCBmcm9tIHRoZSBwYXRoXG4gICAgbGV0IHRhcmdldFVybCA9IHJlcXVlc3QudXJsLnJlcGxhY2UoJy9hcGkvbWNwLXByb3h5LycsICcnKTtcbiAgICBcbiAgICAvLyBIYW5kbGUgcXVlcnkgcGFyYW1ldGVyc1xuICAgIGlmIChyZXF1ZXN0LnF1ZXJ5U3RyaW5nUGFyYW1ldGVycykge1xuICAgICAgY29uc3QgcXVlcnlTdHJpbmcgPSBuZXcgVVJMU2VhcmNoUGFyYW1zKHJlcXVlc3QucXVlcnlTdHJpbmdQYXJhbWV0ZXJzKS50b1N0cmluZygpO1xuICAgICAgaWYgKHF1ZXJ5U3RyaW5nKSB7XG4gICAgICAgIHRhcmdldFVybCArPSBgPyR7cXVlcnlTdHJpbmd9YDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBIYW5kbGUgZG91YmxlIGVuY29kaW5nIC0gZGVjb2RlIHR3aWNlIGlmIG5lZWRlZFxuICAgIGxldCBmdWxsVXJsID0gZGVjb2RlVVJJQ29tcG9uZW50KHRhcmdldFVybCk7XG4gICAgXG4gICAgLy8gQ2hlY2sgaWYgaXQncyBzdGlsbCBlbmNvZGVkIChzdGFydHMgd2l0aCBodHRwJTNBIG9yIGh0dHBzJTNBKVxuICAgIGlmIChmdWxsVXJsLnN0YXJ0c1dpdGgoJ2h0dHAlM0EnKSB8fCBmdWxsVXJsLnN0YXJ0c1dpdGgoJ2h0dHBzJTNBJykpIHtcbiAgICAgIGZ1bGxVcmwgPSBkZWNvZGVVUklDb21wb25lbnQoZnVsbFVybCk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgVVJMIGFuZCBibG9jayBpbnRlcm5hbCBuZXR3b3Jrc1xuICAgIGxldCBwYXJzZWRVcmw6IFVSTDtcbiAgICB0cnkge1xuICAgICAgcGFyc2VkVXJsID0gbmV3IFVSTChmdWxsVXJsKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdJbnZhbGlkIFVSTCBmb3JtYXQnIH0pXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIEJsb2NrIGludGVybmFsIG5ldHdvcmtzIGFuZCBtZXRhZGF0YSBzZXJ2aWNlc1xuICAgIGNvbnN0IGhvc3RuYW1lID0gcGFyc2VkVXJsLmhvc3RuYW1lO1xuICAgIGlmIChob3N0bmFtZSA9PT0gJ2xvY2FsaG9zdCcgfHwgaG9zdG5hbWUgPT09ICcxMjcuMC4wLjEnIHx8IFxuICAgICAgICBob3N0bmFtZS5zdGFydHNXaXRoKCcxMC4nKSB8fCBob3N0bmFtZS5zdGFydHNXaXRoKCcxOTIuMTY4LicpIHx8XG4gICAgICAgIC9eMTcyXFwuKDFbNi05XXwyWzAtOV18M1swMV0pXFwuLy50ZXN0KGhvc3RuYW1lKSB8fFxuICAgICAgICBob3N0bmFtZSA9PT0gJzE2OS4yNTQuMTY5LjI1NCcpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMyxcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdBY2Nlc3MgdG8gaW50ZXJuYWwgbmV0d29ya3MgYmxvY2tlZCcgfSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gUHJldmVudCBwYXRoIHRyYXZlcnNhbFxuICAgIGlmIChwYXJzZWRVcmwucGF0aG5hbWUuaW5jbHVkZXMoJy4uLycpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICAgIGhlYWRlcnM6IHsgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnUGF0aCB0cmF2ZXJzYWwgbm90IGFsbG93ZWQnIH0pXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHNlc3Npb25JZEluID0gZ2V0SGVhZGVyKHJlcXVlc3QuaGVhZGVycywgJ21jcC1zZXNzaW9uLWlkJyk7XG4gICAgY29uc29sZS5sb2coYE1DUCBQcm94eTogJHtyZXF1ZXN0Lm1ldGhvZH0gJHtmdWxsVXJsfSR7c2Vzc2lvbklkSW4gPyBgIChtY3Atc2Vzc2lvbi1pZCBwcmVzZW50KWAgOiAnJ31gKTtcblxuICAgIGNvbnN0IHVwc3RyZWFtSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiBnZXRIZWFkZXIocmVxdWVzdC5oZWFkZXJzLCAnY29udGVudC10eXBlJykgfHwgJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2VwdCc6ICdhcHBsaWNhdGlvbi9qc29uLCB0ZXh0L2V2ZW50LXN0cmVhbScsXG4gICAgfTtcblxuICAgIGNvbnN0IGF1dGhvcml6YXRpb24gPSBnZXRIZWFkZXIocmVxdWVzdC5oZWFkZXJzLCAnYXV0aG9yaXphdGlvbicpO1xuICAgIGlmIChhdXRob3JpemF0aW9uKSB7XG4gICAgICB1cHN0cmVhbUhlYWRlcnNbJ0F1dGhvcml6YXRpb24nXSA9IGF1dGhvcml6YXRpb247XG4gICAgfVxuXG4gICAgY29uc3QgY3VzdG9tQXV0aEhlYWRlck5hbWUgPSBnZXRIZWFkZXIocmVxdWVzdC5oZWFkZXJzLCAneC1jdXN0b20tYXV0aC1oZWFkZXInKTtcbiAgICBpZiAoY3VzdG9tQXV0aEhlYWRlck5hbWUpIHtcbiAgICAgIGNvbnN0IGN1c3RvbUF1dGhWYWx1ZSA9IGdldEhlYWRlcihyZXF1ZXN0LmhlYWRlcnMsIGN1c3RvbUF1dGhIZWFkZXJOYW1lKTtcbiAgICAgIGlmIChjdXN0b21BdXRoVmFsdWUpIHtcbiAgICAgICAgdXBzdHJlYW1IZWFkZXJzW2N1c3RvbUF1dGhIZWFkZXJOYW1lXSA9IGN1c3RvbUF1dGhWYWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IG5hbWUgb2YgTUNQX0ZPUldBUkRfUkVRVUVTVF9IRUFERVJTKSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IGdldEhlYWRlcihyZXF1ZXN0LmhlYWRlcnMsIG5hbWUpO1xuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIHVwc3RyZWFtSGVhZGVyc1tuYW1lXSA9IHZhbHVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGZldGNoT3B0aW9uczogUmVxdWVzdEluaXQgPSB7XG4gICAgICBtZXRob2Q6IHJlcXVlc3QubWV0aG9kLFxuICAgICAgaGVhZGVyczogdXBzdHJlYW1IZWFkZXJzLFxuICAgIH07XG5cbiAgICAvLyBIYW5kbGUgYm9keSBmb3Igbm9uLUdFVCByZXF1ZXN0c1xuICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCAhPT0gJ0dFVCcgJiYgcmVxdWVzdC5ib2R5KSB7XG4gICAgICBpZiAoZ2V0SGVhZGVyKHJlcXVlc3QuaGVhZGVycywgJ2NvbnRlbnQtdHlwZScpID09PSAnYXBwbGljYXRpb24veC13d3ctZm9ybS11cmxlbmNvZGVkJykge1xuICAgICAgICBmZXRjaE9wdGlvbnMuYm9keSA9IHR5cGVvZiByZXF1ZXN0LmJvZHkgPT09ICdzdHJpbmcnID8gcmVxdWVzdC5ib2R5IDogSlNPTi5zdHJpbmdpZnkocmVxdWVzdC5ib2R5KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZldGNoT3B0aW9ucy5ib2R5ID0gdHlwZW9mIHJlcXVlc3QuYm9keSA9PT0gJ3N0cmluZycgPyByZXF1ZXN0LmJvZHkgOiBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LmJvZHkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goZnVsbFVybCwgZmV0Y2hPcHRpb25zKTtcblxuICAgIGNvbnNvbGUubG9nKGBSZXNwb25zZSBzdGF0dXM6ICR7cmVzcG9uc2Uuc3RhdHVzfWApO1xuICAgIGNvbnNvbGUubG9nKGBSZXNwb25zZSBjb250ZW50LXR5cGU6ICR7cmVzcG9uc2UuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpfWApO1xuXG4gICAgLy8gSGFuZGxlIE9BdXRoIGVuZHBvaW50cyB0aGF0IGRvbid0IGV4aXN0IG9uIHRoZSBzZXJ2ZXJcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpIHx8ICcnO1xuICAgICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKCd0ZXh0L2h0bWwnKSkge1xuICAgICAgICAvLyBIYW5kbGUgT0F1dGggcmVnaXN0cmF0aW9uIGVuZHBvaW50XG4gICAgICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCA9PT0gJ1BPU1QnICYmIGZ1bGxVcmwuaW5jbHVkZXMoJy9yZWdpc3RlcicpKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ1NlcnZlciBkb2VzIG5vdCBzdXBwb3J0IE9BdXRoIHJlZ2lzdHJhdGlvbiBlbmRwb2ludCwgcHJvdmlkaW5nIGZhbGxiYWNrIHJlc3BvbnNlJyk7XG4gICAgICAgICAgXG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgICAgIGhlYWRlcnM6IGJ1aWxkQ29yc0hlYWRlcnMoeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0pLFxuICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgICAgICBlcnJvcjogJ2ludmFsaWRfY2xpZW50X21ldGFkYXRhJyxcbiAgICAgICAgICAgICAgZXJyb3JfZGVzY3JpcHRpb246ICdEeW5hbWljIGNsaWVudCByZWdpc3RyYXRpb24gaXMgbm90IHN1cHBvcnRlZCBieSB0aGlzIHNlcnZlci4gUGxlYXNlIHVzZSBwcmUtY29uZmlndXJlZCBjbGllbnQgY3JlZGVudGlhbHMgb3IgY29udGFjdCB0aGUgc2VydmVyIGFkbWluaXN0cmF0b3IgZm9yIGFjY2Vzcy4nXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICAvLyBIYW5kbGUgT0F1dGggYXV0aG9yaXphdGlvbiBzZXJ2ZXIgZGlzY292ZXJ5IGVuZHBvaW50XG4gICAgICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCA9PT0gJ0dFVCcgJiYgZnVsbFVybC5pbmNsdWRlcygnLy53ZWxsLWtub3duL29hdXRoLWF1dGhvcml6YXRpb24tc2VydmVyJykpIHtcbiAgICAgICAgICBjb25zb2xlLmxvZygnU2VydmVyIGRvZXMgbm90IHN1cHBvcnQgT0F1dGggYXV0aG9yaXphdGlvbiBzZXJ2ZXIgZGlzY292ZXJ5LCBwcm92aWRpbmcgZmFsbGJhY2sgcmVzcG9uc2UnKTtcbiAgICAgICAgICBcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogNDA0LFxuICAgICAgICAgICAgaGVhZGVyczogYnVpbGRDb3JzSGVhZGVycyh7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSksXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgICAgIGVycm9yOiAnbm90X2ZvdW5kJyxcbiAgICAgICAgICAgICAgZXJyb3JfZGVzY3JpcHRpb246ICdPQXV0aCBhdXRob3JpemF0aW9uIHNlcnZlciBkaXNjb3ZlcnkgaXMgbm90IHN1cHBvcnRlZCBieSB0aGlzIHNlcnZlci4gUGxlYXNlIHVzZSBtYW51YWwgYXV0aGVudGljYXRpb24gb3IgY29udGFjdCB0aGUgc2VydmVyIGFkbWluaXN0cmF0b3IgZm9yIGFjY2Vzcy4nXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gR2V0IHJlc3BvbnNlIGJvZHkgZmlyc3RcbiAgICBjb25zdCByZXNwb25zZUJvZHkgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XG5cbiAgICAvLyBIYW5kbGUgT0F1dGggcmVnaXN0cmF0aW9uIHJlc3BvbnNlcyB0aGF0IG1pZ2h0IGhhdmUgaW5jb3JyZWN0IENvbnRlbnQtVHlwZVxuICAgIGlmIChyZXF1ZXN0Lm1ldGhvZCA9PT0gJ1BPU1QnICYmIGZ1bGxVcmwuaW5jbHVkZXMoJy9yZWdpc3RlcicpICYmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMCB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwNCkpIHtcbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgYSBKU09OIHJlc3BvbnNlIGJ1dCB3aXRoIHdyb25nIENvbnRlbnQtVHlwZVxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QganNvbkRhdGEgPSBKU09OLnBhcnNlKHJlc3BvbnNlQm9keSk7XG4gICAgICAgIGlmIChqc29uRGF0YS5lcnJvcikge1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdGaXhpbmcgQ29udGVudC1UeXBlIGZvciBPQXV0aCByZWdpc3RyYXRpb24gZXJyb3IgcmVzcG9uc2UnKTtcbiAgICAgICAgICBcbiAgICAgICAgICByZXR1cm4ge1xuICAgICAgICAgICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzLFxuICAgICAgICAgICAgaGVhZGVyczogYnVpbGRDb3JzSGVhZGVycyh7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSksXG4gICAgICAgICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShqc29uRGF0YSksIC8vIEVuc3VyZSBpdCdzIHByb3Blcmx5IHN0cmluZ2lmaWVkXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBOb3QgSlNPTiwgY29udGludWUgd2l0aCBub3JtYWwgcHJvY2Vzc2luZ1xuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IHJlc3BvbnNlSGVhZGVycyA9IGJ1aWxkQ29yc0hlYWRlcnMoKTtcblxuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQoJ2NvbnRlbnQtdHlwZScpO1xuICAgIGlmIChjb250ZW50VHlwZSkge1xuICAgICAgcmVzcG9uc2VIZWFkZXJzWydDb250ZW50LVR5cGUnXSA9IGNvbnRlbnRUeXBlO1xuICAgIH1cblxuICAgIGNvbnN0IHd3d0F1dGggPSByZXNwb25zZS5oZWFkZXJzLmdldCgnd3d3LWF1dGhlbnRpY2F0ZScpO1xuICAgIGlmICh3d3dBdXRoKSB7XG4gICAgICByZXNwb25zZUhlYWRlcnNbJ1dXVy1BdXRoZW50aWNhdGUnXSA9IHd3d0F1dGg7XG4gICAgfVxuXG4gICAgZm9yIChjb25zdCBuYW1lIG9mIE1DUF9GT1JXQVJEX1JFU1BPTlNFX0hFQURFUlMpIHtcbiAgICAgIGNvbnN0IHZhbHVlID0gcmVzcG9uc2UuaGVhZGVycy5nZXQobmFtZSk7XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgcmVzcG9uc2VIZWFkZXJzW25hbWVdID0gdmFsdWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IHJlc3BvbnNlLnN0YXR1cyxcbiAgICAgIGhlYWRlcnM6IHJlc3BvbnNlSGVhZGVycyxcbiAgICAgIGJvZHk6IHJlc3BvbnNlQm9keSxcbiAgICB9O1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignTUNQIFByb3h5IGVycm9yOicsIGVycm9yKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogNTAwLFxuICAgICAgaGVhZGVyczogYnVpbGRDb3JzSGVhZGVycyh7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSksXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGVycm9yOiAnUHJveHkgZXJyb3InLFxuICAgICAgICBkZXRhaWxzOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6ICdVbmtub3duIGVycm9yJyxcbiAgICAgIH0pLFxuICAgIH07XG4gIH1cbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBoZWFkZXIgdmFsdWUgKGNhc2UtaW5zZW5zaXRpdmUpXG5mdW5jdGlvbiBnZXRIZWFkZXIoaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQ+LCBuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCBsb3dlck5hbWUgPSBuYW1lLnRvTG93ZXJDYXNlKCk7XG4gIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGhlYWRlcnMpKSB7XG4gICAgaWYgKGtleS50b0xvd2VyQ2FzZSgpID09PSBsb3dlck5hbWUpIHtcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlWzBdIDogdmFsdWU7XG4gICAgfVxuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG4iXX0=