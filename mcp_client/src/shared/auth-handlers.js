"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAuthConfig = getAuthConfig;
exports.createUserPlaceholderResponse = createUserPlaceholderResponse;
exports.createValidatePlaceholderResponse = createValidatePlaceholderResponse;
function getAuthConfig() {
    return {
        userPoolId: process.env.COGNITO_USER_POOL_ID,
        clientId: process.env.COGNITO_CLIENT_ID,
        region: process.env.COGNITO_REGION || process.env.AWS_REGION || 'us-east-1',
    };
}
function createUserPlaceholderResponse() {
    return {
        message: 'User endpoint - JWT validation not implemented yet',
    };
}
function createValidatePlaceholderResponse() {
    return {
        message: 'Validate endpoint - JWT validation not implemented yet',
    };
}
