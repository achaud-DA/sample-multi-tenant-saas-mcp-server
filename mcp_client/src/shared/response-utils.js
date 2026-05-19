"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthCheckResponse = createHealthCheckResponse;
exports.createErrorResponse = createErrorResponse;
exports.createLambdaResponse = createLambdaResponse;
const cors_config_js_1 = require("./cors-config.js");
function createHealthCheckResponse() {
    return {
        status: 'ok',
        timestamp: new Date().toISOString(),
    };
}
function createErrorResponse(error, details) {
    return {
        error,
        ...(details && { details }),
    };
}
function createLambdaResponse(statusCode, body, contentType = 'application/json') {
    return {
        statusCode,
        headers: { ...cors_config_js_1.corsHeaders, 'Content-Type': contentType },
        body: typeof body === 'string' ? body : JSON.stringify(body),
    };
}
