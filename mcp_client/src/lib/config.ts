/**
 * Configuration utilities for API endpoints and environment-specific settings
 */

/**
 * Get the base URL for API calls based on the current environment
 * In production, API calls go through CloudFront to API Gateway
 * In development, they go through Vite's proxy to the local Express server
 */
export const getApiBaseUrl = (): string => {
  if (typeof window !== "undefined") {
    const isProd =
      (typeof import.meta !== "undefined" && import.meta.env?.PROD === true) ||
      process.env.NODE_ENV === "production";
    return isProd ? window.location.origin : "";
  }

  return process.env.NODE_ENV === "production" ? "" : "http://localhost:3001";
};

export const isDatabricksMcpUrl = (mcpServerUrl: string): boolean => {
  try {
    return new URL(mcpServerUrl).hostname.includes("databricks.com");
  } catch {
    return false;
  }
};

/**
 * Base URL for OAuth discovery (.well-known).
 * - Default MCP servers: host root (/.well-known/... not under /mcp/...)
 * - Databricks external MCP: full connection URL (metadata lives on that path)
 */
export const getOAuthDiscoveryUrl = (mcpServerUrl: string): string => {
  if (isDatabricksMcpUrl(mcpServerUrl)) {
    return mcpServerUrl.replace(/\/$/, "");
  }
  return new URL("/", mcpServerUrl).href;
};

/** RFC 9728 metadata URL for Databricks external MCP connections */
export const getDatabricksProtectedResourceMetadataUrl = (
  mcpServerUrl: string,
): URL => {
  const base = mcpServerUrl.endsWith("/") ? mcpServerUrl : `${mcpServerUrl}/`;
  return new URL(".well-known/oauth-protected-resource", base);
};

/** Routes Databricks OAuth metadata requests through the playground API (CORS-safe). */
export const createDatabricksOAuthFetch = (): typeof fetch => {
  return async (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (!href.includes("databricks.com")) {
      return fetch(input, init);
    }

    // Path-encoded target (same pattern as mcp-proxy) — CloudFront does not forward query strings to API Gateway
    const base = getApiBaseUrl();
    const proxyUrl = `${base}/api/oauth-discovery/${encodeURIComponent(href)}`;
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");

    return fetch(proxyUrl, { ...init, method: "GET", headers });
  };
};

/**
 * Get the full URL for MCP proxy requests
 */
export const getMcpProxyUrl = (targetUrl: string): string => {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}/api/mcp-proxy/${encodeURIComponent(targetUrl)}`;
};

/**
 * Get the full URL for inference API requests
 */
export const getInferenceApiUrl = (): string => {
  const baseUrl = getApiBaseUrl();
  return `${baseUrl}/api/inference`;
};

/**
 * Check if we're running in development mode
 */
export const isDevelopment = (): boolean => {
  return process.env.NODE_ENV === 'development';
};

/**
 * Check if we're running in production mode
 */
export const isProduction = (): boolean => {
  return process.env.NODE_ENV === 'production';
};
