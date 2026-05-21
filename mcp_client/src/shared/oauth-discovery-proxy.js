"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleOAuthDiscoveryProxy = exports.isAllowedOAuthDiscoveryTarget = exports.extractOAuthDiscoveryTargetFromPath = void 0;
const cors_config_js_1 = require("./cors-config.js");
/** Extract and decode target URL from /api/oauth-discovery/{encoded} (path-based; CloudFront does not forward query strings). */
function extractOAuthDiscoveryTargetFromPath(path) {
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
exports.extractOAuthDiscoveryTargetFromPath = extractOAuthDiscoveryTargetFromPath;
/** Server-side fetch for Databricks OAuth metadata (browser CORS blocks direct calls). */
function isAllowedOAuthDiscoveryTarget(url) {
    if (url.protocol !== "https:" || !url.hostname.endsWith(".databricks.com")) {
        return false;
    }
    const path = url.pathname;
    return path.includes("/.well-known/") || path.includes("/oidc/");
}
exports.isAllowedOAuthDiscoveryTarget = isAllowedOAuthDiscoveryTarget;
async function handleOAuthDiscoveryProxy(targetParam) {
    let target;
    try {
        target = new URL(targetParam);
    }
    catch {
        return {
            statusCode: 400,
            headers: { ...cors_config_js_1.corsHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Invalid target URL" }),
        };
    }
    if (!isAllowedOAuthDiscoveryTarget(target)) {
        return {
            statusCode: 403,
            headers: { ...cors_config_js_1.corsHeaders, "Content-Type": "application/json" },
            body: JSON.stringify({ error: "OAuth discovery target not allowed" }),
        };
    }
    const response = await fetch(target.href, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "manual",
    });
    const body = await response.text();
    const contentType = response.headers.get("content-type") ?? "application/json";
    return {
        statusCode: response.status,
        headers: { ...cors_config_js_1.corsHeaders, "Content-Type": contentType },
        body,
    };
}
exports.handleOAuthDiscoveryProxy = handleOAuthDiscoveryProxy;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2F1dGgtZGlzY292ZXJ5LXByb3h5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsib2F1dGgtZGlzY292ZXJ5LXByb3h5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLHFEQUErQztBQUUvQyxpSUFBaUk7QUFDakksU0FBZ0IsbUNBQW1DLENBQUMsSUFBWTtJQUM5RCxNQUFNLEtBQUssR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLCtCQUErQixDQUFDLENBQUM7SUFDMUQsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFO1FBQ2YsT0FBTyxJQUFJLENBQUM7S0FDYjtJQUNELElBQUksTUFBTSxHQUFHLGtCQUFrQixDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQzFDLElBQUksTUFBTSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUMsSUFBSSxNQUFNLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxFQUFFO1FBQ2pFLE1BQU0sR0FBRyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztLQUNyQztJQUNELE9BQU8sTUFBTSxDQUFDO0FBQ2hCLENBQUM7QUFWRCxrRkFVQztBQUVELDBGQUEwRjtBQUMxRixTQUFnQiw2QkFBNkIsQ0FBQyxHQUFRO0lBQ3BELElBQUksR0FBRyxDQUFDLFFBQVEsS0FBSyxRQUFRLElBQUksQ0FBQyxHQUFHLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFO1FBQzFFLE9BQU8sS0FBSyxDQUFDO0tBQ2Q7SUFDRCxNQUFNLElBQUksR0FBRyxHQUFHLENBQUMsUUFBUSxDQUFDO0lBQzFCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0FBQ25FLENBQUM7QUFORCxzRUFNQztBQUVNLEtBQUssVUFBVSx5QkFBeUIsQ0FBQyxXQUFtQjtJQUtqRSxJQUFJLE1BQVcsQ0FBQztJQUNoQixJQUFJO1FBQ0YsTUFBTSxHQUFHLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxDQUFDO0tBQy9CO0lBQUMsTUFBTTtRQUNOLE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxFQUFFLEdBQUcsNEJBQVcsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7WUFDL0QsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxLQUFLLEVBQUUsb0JBQW9CLEVBQUUsQ0FBQztTQUN0RCxDQUFDO0tBQ0g7SUFFRCxJQUFJLENBQUMsNkJBQTZCLENBQUMsTUFBTSxDQUFDLEVBQUU7UUFDMUMsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLEVBQUUsR0FBRyw0QkFBVyxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtZQUMvRCxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxFQUFFLEtBQUssRUFBRSxvQ0FBb0MsRUFBRSxDQUFDO1NBQ3RFLENBQUM7S0FDSDtJQUVELE1BQU0sUUFBUSxHQUFHLE1BQU0sS0FBSyxDQUFDLE1BQU0sQ0FBQyxJQUFJLEVBQUU7UUFDeEMsTUFBTSxFQUFFLEtBQUs7UUFDYixPQUFPLEVBQUUsRUFBRSxNQUFNLEVBQUUsa0JBQWtCLEVBQUU7UUFDdkMsUUFBUSxFQUFFLFFBQVE7S0FDbkIsQ0FBQyxDQUFDO0lBRUgsTUFBTSxJQUFJLEdBQUcsTUFBTSxRQUFRLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDbkMsTUFBTSxXQUFXLEdBQ2YsUUFBUSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsY0FBYyxDQUFDLElBQUksa0JBQWtCLENBQUM7SUFFN0QsT0FBTztRQUNMLFVBQVUsRUFBRSxRQUFRLENBQUMsTUFBTTtRQUMzQixPQUFPLEVBQUUsRUFBRSxHQUFHLDRCQUFXLEVBQUUsY0FBYyxFQUFFLFdBQVcsRUFBRTtRQUN4RCxJQUFJO0tBQ0wsQ0FBQztBQUNKLENBQUM7QUF2Q0QsOERBdUNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgY29yc0hlYWRlcnMgfSBmcm9tIFwiLi9jb3JzLWNvbmZpZy5qc1wiO1xuXG4vKiogRXh0cmFjdCBhbmQgZGVjb2RlIHRhcmdldCBVUkwgZnJvbSAvYXBpL29hdXRoLWRpc2NvdmVyeS97ZW5jb2RlZH0gKHBhdGgtYmFzZWQ7IENsb3VkRnJvbnQgZG9lcyBub3QgZm9yd2FyZCBxdWVyeSBzdHJpbmdzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHRyYWN0T0F1dGhEaXNjb3ZlcnlUYXJnZXRGcm9tUGF0aChwYXRoOiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSBwYXRoLm1hdGNoKC9cXC9hcGlcXC9vYXV0aC1kaXNjb3ZlcnlcXC8oLispJC8pO1xuICBpZiAoIW1hdGNoPy5bMV0pIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBsZXQgdGFyZ2V0ID0gZGVjb2RlVVJJQ29tcG9uZW50KG1hdGNoWzFdKTtcbiAgaWYgKHRhcmdldC5zdGFydHNXaXRoKFwiaHR0cCUzQVwiKSB8fCB0YXJnZXQuc3RhcnRzV2l0aChcImh0dHBzJTNBXCIpKSB7XG4gICAgdGFyZ2V0ID0gZGVjb2RlVVJJQ29tcG9uZW50KHRhcmdldCk7XG4gIH1cbiAgcmV0dXJuIHRhcmdldDtcbn1cblxuLyoqIFNlcnZlci1zaWRlIGZldGNoIGZvciBEYXRhYnJpY2tzIE9BdXRoIG1ldGFkYXRhIChicm93c2VyIENPUlMgYmxvY2tzIGRpcmVjdCBjYWxscykuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbGxvd2VkT0F1dGhEaXNjb3ZlcnlUYXJnZXQodXJsOiBVUkwpOiBib29sZWFuIHtcbiAgaWYgKHVybC5wcm90b2NvbCAhPT0gXCJodHRwczpcIiB8fCAhdXJsLmhvc3RuYW1lLmVuZHNXaXRoKFwiLmRhdGFicmlja3MuY29tXCIpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGNvbnN0IHBhdGggPSB1cmwucGF0aG5hbWU7XG4gIHJldHVybiBwYXRoLmluY2x1ZGVzKFwiLy53ZWxsLWtub3duL1wiKSB8fCBwYXRoLmluY2x1ZGVzKFwiL29pZGMvXCIpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGFuZGxlT0F1dGhEaXNjb3ZlcnlQcm94eSh0YXJnZXRQYXJhbTogc3RyaW5nKTogUHJvbWlzZTx7XG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgYm9keTogc3RyaW5nO1xufT4ge1xuICBsZXQgdGFyZ2V0OiBVUkw7XG4gIHRyeSB7XG4gICAgdGFyZ2V0ID0gbmV3IFVSTCh0YXJnZXRQYXJhbSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDAsXG4gICAgICBoZWFkZXJzOiB7IC4uLmNvcnNIZWFkZXJzLCBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnZhbGlkIHRhcmdldCBVUkxcIiB9KSxcbiAgICB9O1xuICB9XG5cbiAgaWYgKCFpc0FsbG93ZWRPQXV0aERpc2NvdmVyeVRhcmdldCh0YXJnZXQpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwMyxcbiAgICAgIGhlYWRlcnM6IHsgLi4uY29yc0hlYWRlcnMsIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIk9BdXRoIGRpc2NvdmVyeSB0YXJnZXQgbm90IGFsbG93ZWRcIiB9KSxcbiAgICB9O1xuICB9XG5cbiAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaCh0YXJnZXQuaHJlZiwge1xuICAgIG1ldGhvZDogXCJHRVRcIixcbiAgICBoZWFkZXJzOiB7IEFjY2VwdDogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICByZWRpcmVjdDogXCJtYW51YWxcIixcbiAgfSk7XG5cbiAgY29uc3QgYm9keSA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcbiAgY29uc3QgY29udGVudFR5cGUgPVxuICAgIHJlc3BvbnNlLmhlYWRlcnMuZ2V0KFwiY29udGVudC10eXBlXCIpID8/IFwiYXBwbGljYXRpb24vanNvblwiO1xuXG4gIHJldHVybiB7XG4gICAgc3RhdHVzQ29kZTogcmVzcG9uc2Uuc3RhdHVzLFxuICAgIGhlYWRlcnM6IHsgLi4uY29yc0hlYWRlcnMsIFwiQ29udGVudC1UeXBlXCI6IGNvbnRlbnRUeXBlIH0sXG4gICAgYm9keSxcbiAgfTtcbn1cbiJdfQ==