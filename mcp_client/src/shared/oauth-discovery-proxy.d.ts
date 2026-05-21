/** Extract and decode target URL from /api/oauth-discovery/{encoded} (path-based; CloudFront does not forward query strings). */
export declare function extractOAuthDiscoveryTargetFromPath(path: string): string | null;
/** Server-side fetch for Databricks OAuth metadata (browser CORS blocks direct calls). */
export declare function isAllowedOAuthDiscoveryTarget(url: URL): boolean;
export declare function handleOAuthDiscoveryProxy(targetParam: string): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}>;
