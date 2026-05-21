import { corsHeaders } from "./cors-config.js";

/** Extract and decode target URL from /api/oauth-discovery/{encoded} (path-based; CloudFront does not forward query strings). */
export function extractOAuthDiscoveryTargetFromPath(path: string): string | null {
  const match = path.match(/\/api\/oauth-discovery\/(.+)$/);
  if (!match?.[1]) {
    return null;
  }
  let target = decodeURIComponent(match[1]);
  if (target.startsWith("http%3A") || target.startsWith("https%3A")) {
    target = decodeURIComponent(target);
  }
  return target;
}

/** Server-side fetch for Databricks OAuth metadata (browser CORS blocks direct calls). */
export function isAllowedOAuthDiscoveryTarget(url: URL): boolean {
  if (url.protocol !== "https:" || !url.hostname.endsWith(".databricks.com")) {
    return false;
  }
  const path = url.pathname;
  return path.includes("/.well-known/") || path.includes("/oidc/");
}

export async function handleOAuthDiscoveryProxy(targetParam: string): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}> {
  let target: URL;
  try {
    target = new URL(targetParam);
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid target URL" }),
    };
  }

  if (!isAllowedOAuthDiscoveryTarget(target)) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ error: "OAuth discovery target not allowed" }),
    };
  }

  const response = await fetch(target.href, {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
  });

  const body = await response.text();
  const contentType =
    response.headers.get("content-type") ?? "application/json";

  // Avoid 404/403 from API origin — CloudFront maps those to index.html (breaks JSON clients)
  const statusCode =
    response.status === 404 || response.status === 403 ? 502 : response.status;

  return {
    statusCode,
    headers: { ...corsHeaders, "Content-Type": contentType },
    body,
  };
}
