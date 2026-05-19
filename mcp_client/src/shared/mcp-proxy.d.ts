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
export declare function handleMcpProxy(request: McpProxyRequest): Promise<McpProxyResponse>;
