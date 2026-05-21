export interface HealthCheckResponse {
    status: string;
    timestamp: string;
}
export declare function createHealthCheckResponse(): HealthCheckResponse;
export interface ErrorResponse {
    error: string;
    details?: string;
}
export declare function createErrorResponse(error: string, details?: string): ErrorResponse;
export interface LambdaResponse {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
}
export declare function createLambdaResponse(statusCode: number, body: any, contentType?: string): LambdaResponse;
