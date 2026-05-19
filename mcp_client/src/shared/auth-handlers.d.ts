export interface AuthConfig {
    userPoolId?: string;
    clientId?: string;
    region?: string;
}
export declare function getAuthConfig(): AuthConfig;
export interface PlaceholderResponse {
    message: string;
}
export declare function createUserPlaceholderResponse(): PlaceholderResponse;
export declare function createValidatePlaceholderResponse(): PlaceholderResponse;
