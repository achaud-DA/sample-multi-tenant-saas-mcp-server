"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsHeaders = void 0;
exports.setCorsHeaders = setCorsHeaders;
exports.corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-custom-auth-header',
};
function setCorsHeaders(setHeader) {
    Object.entries(exports.corsHeaders).forEach(([key, value]) => {
        setHeader(key, value);
    });
}
