# MCP Playground — Troubleshooting

Guide for **runtime** issues when connecting MCP servers in the playground. For **deploy/CDK** errors (Vite, Lambda bundling, CDK Nag), see [deployment_troubleshooting.md](../deployment_troubleshooting.md). For OAuth architecture and setup, see [AUTHENTICATION.md](./AUTHENTICATION.md).

---

## Quick diagnosis

| Symptom | Likely cause | Section |
|--------|----------------|---------|
| **Connected**, **0 tools** (works in Cursor) | Optional `prompts/list` failure and/or proxy session headers | [AWS API Gateway MCP](#aws-api-gateway-mcp-connected-but-0-tools) |
| `Unexpected content type: text/html` | API 404/403 replaced by SPA `index.html` | [HTML instead of JSON](#html-instead-of-json-from-mcp-proxy) |
| Repeated **304** on `/api/mcp-proxy/...` | Cached Streamable HTTP GET | [304 responses](#304-not-modified-on-mcp-proxy) |
| Popup **OAuth success**, main tab **cancelled/failed** | Popup closed before code stored; race on callback | [OAuth popup race](#oauth-popup-success-but-main-tab-fails) |
| S3 **NoSuchKey** on `/oauth/callback` | SPA route without CloudFront fallback | [OAuth callback NoSuchKey](#oauth-callback-s3-nosuchkey) |
| Travel MCP auth OK, wrong/no bookings | Wrong Cognito user or tenant; playground `demo` ≠ travel user | [Travel MCP](#travel-mcp-ecs-multi-tenant) |
| Databricks **405** or empty tools | URL missing `/mcp` or wrong auth mode | [Databricks](#databricks-mcp) |
| Deploy/build failures | CDK, ajv, lock file | [deployment_troubleshooting.md](../deployment_troubleshooting.md) |

**First checks for any MCP connection issue:**

1. MCP URL matches what works in Cursor (including `/mcp` suffix if required).
2. Full redeploy: `cd mcp_client && ./deploy.sh` (Lambda **and** CloudFront, not only the static site).
3. Hard refresh the browser (Ctrl+Shift+R / Cmd+Shift+R).
4. DevTools → **Network**: inspect proxied `initialize` and `tools/list` (status, `mcp-session-id`, content-type).

---

## AWS API Gateway MCP: Connected but 0 tools

**Symptoms:** Status **Connected**, tool list empty. **Cursor** shows all tools (e.g. 5) for the same URL.

**Why Cursor works:** Cursor calls API Gateway **directly** with no CloudFront proxy or browser CORS.

**Why the playground failed (fixed in `mcp-playground-fixes`):**

### 1. Optional capabilities — `prompts/list` / `resources/list`

Older playground code called `tools/list`, `resources/list`, and `prompts/list` in one `try` block. Many AWS MCP servers implement **tools only**. If `prompts/list` failed, the catch ran and **never saved tools** → UI showed 0 tools while still **Connected**.

**Current behavior:** `tools/list` is required; `resources/list` and `prompts/list` are optional (warnings only). See `src/hooks/useMcpConnection.ts` → `loadServerData`.

### 2. Streamable HTTP session through the proxy

API Gateway MCP uses **Streamable HTTP**. After `initialize`, responses include **`mcp-session-id`**; later requests must send it back.

All of these must work:

| Layer | Requirement |
|-------|-------------|
| Lambda `mcp-proxy.ts` | Forward `mcp-session-id`, `mcp-protocol-version`, `last-event-id`; expose headers in CORS |
| API Gateway CORS | Allow MCP headers on preflight |
| CloudFront `api/*` | **Forward** viewer headers to origin (not drop `Authorization` / `mcp-session-id`) |
| Browser | `cache: 'no-store'` on proxy fetches (`main.tsx`) |

**Fix:** Deploy branch with proxy fixes, then:

```bash
cd mcp_client && ./deploy.sh
```

**Verify (DevTools → Network):**

1. Proxied `initialize` response includes header `mcp-session-id`.
2. Next POST to `/api/mcp-proxy/...` **sends** `mcp-session-id`.
3. `tools/list` returns **200** and JSON with a `tools` array.

---

## HTML instead of JSON from MCP proxy

**Symptoms:** `Streamable HTTP error: Unexpected content type: text/html`. Network may show **200** on `/api/mcp-proxy/...` but tools stay at 0.

**Cause:** CloudFront custom errors map origin **404/403** → `/index.html` (needed for SPA routes like `/oauth/callback`). If the **API** path 404s, the browser receives HTML instead of JSON/SSE.

**Fix:**

- Redeploy latest CDK + Lambda (unknown API routes return **502** JSON, not 404).
- `mcp-proxy` maps upstream HTML to a 502 JSON error.
- Confirm MCP URL is exact (same as Cursor), e.g. `https://<api-id>.execute-api.<region>.amazonaws.com/mcp`.

---

## 304 Not Modified on MCP proxy

**Symptoms:** Many GETs to `/api/mcp-proxy/...` with **304**; tools never load.

**Cause:** Cached Streamable HTTP GET has no body; session/SSE breaks.

**Fix:** Redeploy proxy (`Cache-Control: no-store` on responses + browser `cache: 'no-store'`). Hard refresh after deploy.

---

## OAuth popup success but main tab fails

**Symptoms:** Popup shows “Authorization successful”; main playground shows `OAuth flow was cancelled or failed`. Clicking **Connect** again works and shows tools.

**Cause:** During Cognito redirects the popup can appear **closed** briefly. Old logic treated that as failure before `/oauth/callback` wrote the auth code to `sessionStorage`.

**Fix (branch `mcp-playground-fixes`):**

- Poll `sessionStorage` for the auth code; listen for `storage` events.
- Wait up to ~20s after popup closes before failing.
- Resume connect when tokens exist even if the waiter returned false.

**User action:** Allow popups for the CloudFront origin; complete OAuth in the popup; main tab should connect without a second **Connect**.

---

## OAuth callback: S3 NoSuchKey

**Symptoms:** XML `NoSuchKey` for `oauth/callback` after MCP OAuth.

**Cause:** S3 has no object at that path; CloudFront must serve `index.html` for client routes (404 → `/index.html`).

**Fix:** Redeploy CDK with SPA `errorConfigurations`. Hard refresh and retry.

Redirect URI must be: `https://<your-cloudfront-domain>/oauth/callback`.

---

## Travel MCP (ECS multi-tenant)

**Symptoms:** Auth errors, empty tools, or data from the wrong “company.”

**Two logins:**

| Pool | Purpose |
|------|---------|
| Playground Cognito (`demo`, `testuser`) | Access Bedrock UI only |
| **Travel server** Cognito | OAuth when connecting travel MCP URL |

Signing in as playground `demo` does **not** authenticate to the travel server.

**Tenant assignment (demo):** Sign up on the **travel** Hosted UI with email `user+tenantname@example.com` (e.g. `alice+acme@company.com` → `tenantId = acme`). See `mcp_server/README.md`.

**URL:** Use the MCP endpoint if your deployment expects it, e.g. `https://mc-....on.aws/mcp`.

---

## Databricks MCP

| Issue | Fix |
|-------|-----|
| **405 Method Not Allowed** on root URL | Use Apps URL ending with **`/mcp`** |
| OAuth / metadata errors | Try **Pre-registered OAuth** with app client id/secret in the playground |
| External MCP + manual bearer fails | Often wrong token type; workspace API may require OAuth, not a PAT pasted as bearer |
| Discovery via proxy | `databricks.com` hosts may use `/api/oauth-discovery/`; `databricksapps.com` may differ |

---

## Playground sign-in (not MCP OAuth)

**No sign-up in the UI** — only sign-in. Create users after deploy:

```bash
export COGNITO_USER_POOL_ID=<from deploy output>
export COGNITO_REGION=us-east-1
npm run users:demo
```

Defaults: `demo` / `DemoPassword123!`, `testuser` / `TestPassword123!`.

---

## After code changes

| Change type | Command |
|-------------|---------|
| Frontend only | `npm run build` then redeploy static assets (or full `./deploy.sh`) |
| Proxy, Lambda, CloudFront headers | **Full** `cd mcp_client && ./deploy.sh` |
| OAuth / `useMcpConnection` | Rebuild + deploy frontend; hard refresh |

---

## Related docs

- [deployment_troubleshooting.md](../deployment_troubleshooting.md) — Vite/ajv, CDK npm, Lambda lock file, CDK Nag, post-deploy steps
- [AUTHENTICATION.md](./AUTHENTICATION.md) — Playground vs MCP OAuth, DCR, bearer tokens
- [README.md](../README.md) — Quick start and features
