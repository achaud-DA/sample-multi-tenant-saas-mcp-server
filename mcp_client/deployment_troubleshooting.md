# MCP Client — Deployment Troubleshooting

Common errors encountered when running `./deploy.sh` for the first time and how to fix them.

---

## Error 1: Vite build fails — `ajv/dist/ajv.min.js not found`

**When it appears:** During `Building React application...`

**Error message:**
```
[vite:load-fallback] Could not load ajv/dist/ajv.min.js
(imported by node_modules/@modelcontextprotocol/sdk/dist/esm/validation/ajv-provider.js)
ENOENT: no such file or directory, open 'ajv/dist/ajv.min.js'
```

**Cause:** The `vite.config.ts` resolve alias was backwards — mapping `ajv → ajv/dist/ajv.min.js`, a file that does not exist in ajv v8.

**Fix:** Ensure the alias in `vite.config.ts` is:
```ts
resolve: {
  alias: {
    'ajv/dist/ajv.min.js': 'ajv',  // correct direction
  },
},
```
Also ensure ajv v8 is installed:
```bash
npm install ajv
npm list ajv  # should show ajv@8.x
```

---

## Error 2: CDK `npm install` fails — `Cannot read properties of null (reading 'resolve')`

**When it appears:** During `Installing CDK dependencies...`

**Error message:**
```
npm error Cannot read properties of null (reading 'resolve')
```

**Cause:** Stale or corrupted `node_modules` / `package-lock.json` in the `deploy/` directory from a previous failed run.

**Fix:**
```bash
cd deploy
rm -rf node_modules package-lock.json
cd ..
./deploy.sh
```

---

## Error 3: Lambda bundling fails — `npm ci` lock file mismatch

**When it appears:** During `Starting simple deployment...` while bundling `ApiLambda/Code/Stage`

**Error message:**
```
npm error `npm ci` can only install packages when your package.json and package-lock.json are in sync.
Invalid: lock file's jsonwebtoken@9.0.3 does not satisfy jsonwebtoken@9.0.2
Invalid: lock file's jws@4.0.1 does not satisfy jws@3.2.3
Invalid: lock file's jwa@2.0.1 does not satisfy jwa@1.4.2
```

**Cause:** `deploy.sh` copies the parent `package-lock.json` into `deploy/` for Lambda bundling. The parent lock file resolved `jsonwebtoken` to `9.0.3`, but `deploy/package.json` pinned it exactly to `9.0.2`. `npm ci` rejects any version mismatch.

**Fix:** Change exact version pins to ranges in `deploy/package.json`:
```json
"jsonwebtoken": "^9.0.2",
"jwks-client": "^2.1.0"
```
Then clean and retry:
```bash
cd deploy
rm -rf node_modules package-lock.json
cd ..
./deploy.sh
```

---

## MCP server shows Connected but 0 tools (API Gateway / Streamable HTTP)

**Symptoms:** Playground status is **Connected**, tool list is empty; Cursor shows tools for the same URL. Browser console may show `Failed to load server data`.

**Cause:** Streamable HTTP requires `mcp-session-id` after `initialize`. Three layers must pass it:

1. **Lambda proxy** (`mcp-proxy.ts`) — forwards `mcp-session-id` / `mcp-protocol-version` and sets `Access-Control-Expose-Headers`
2. **API Gateway CORS** — allows those headers on preflight (`mcp-playground-stack.ts`)
3. **CloudFront** — must **forward** viewer headers to API Gateway (`forwardedValues.headers` on the `api/*` behavior). Without this, CloudFront drops `mcp-session-id` and `Authorization` before they reach Lambda.

**Fix:** Redeploy CDK (not only the static site):

```bash
cd mcp_client && ./deploy.sh
```

**Verify in DevTools → Network:** After `initialize`, the proxied response should include `mcp-session-id`; the next POST should send `mcp-session-id` in request headers.

## OAuth redirect: S3 `NoSuchKey` for `/oauth/callback`

**Symptoms:** Browser shows XML `NoSuchKey` / `The specified key does not exist` for `oauth/callback` after MCP OAuth login.

**Cause:** The React app is a SPA; S3 has no file at `oauth/callback`. CloudFront must serve `index.html` for that path (custom error 404→`/index.html`).

**Fix:** Redeploy CDK so `errorConfigurations` are present on the distribution. Hard-refresh and retry OAuth.

---

## Error: `Unexpected content type: text/html`

**Symptoms:** Console shows `Streamable HTTP error: Unexpected content type: text/html`; Network shows **200** on `/api/mcp-proxy/...` but tools stay at 0.

**Cause:** CloudFront **custom error responses** turn origin **404/403** into **`/index.html`**. That is required for SPA routes like `/oauth/callback`, but if the **API** returns 404/403, MCP calls get HTML instead of JSON/SSE.

**Fix:** Redeploy latest CDK + Lambda. API handlers use **502** (not 404/403); `mcp-proxy` detects HTML. SPA fallback stays enabled for `/oauth/callback`.

**Also verify:** MCP URL matches Cursor exactly (e.g. `https://5bqjluycme.execute-api.us-east-1.amazonaws.com/mcp` — no extra characters).

---

### Many GET requests with status 304

**Symptoms:** Network tab shows repeated `fetch` calls to `/api/mcp-proxy/...` with **304 Not Modified** (initiator `main.tsx`).

**Cause:** Browser or CloudFront cached the MCP SSE GET. Streamable HTTP needs a live response body; 304 returns no body and tools never load.

**Fix:** Redeploy after proxy changes (`Cache-Control: no-store` on proxy responses + `cache: 'no-store'` on browser fetch). Hard-refresh the page (Ctrl+Shift+R) after deploy.

---

## Error 4: CDK Nag blocks deployment — `AwsSolutions-COG8`

**When it appears:** During CDK synthesis/deployment

**Error message:**
```
[Error at /McpPlaygroundStack/McpPlaygroundUserPool/Resource] AwsSolutions-COG8:
The Cognito user pool is not on the plus tier / feature plan.
Found errors
```

**Cause:** CDK Nag (AWS Solutions security checks) requires Cognito Advanced Security (plus tier) by default. This is an additional paid feature not needed for a demo deployment.

**Fix:** Add suppression to `deploy/lib/nag-suppressions.ts` inside `addCommonSuppressions()`:
```ts
{
  id: 'AwsSolutions-COG8',
  reason: 'Cognito plus tier not required for demo application - enable in production'
},
```

---

## Warnings (non-blocking — safe to ignore)

| Warning | Cause | Action |
|---|---|---|
| `CloudFrontWebDistribution is deprecated` | CDK uses an older CloudFront construct | Cosmetic only, does not affect deployment |
| `NodeVersionSupportWarning: requires node >=22` | Running on Node v20 | Upgrade to Node 22 for future-proofing, not required now |
| `AWS SDK v2 not in Lambda runtime` | Lambda uses Node 18+ which dropped SDK v2 | No action needed — this project uses SDK v3 |

---

## Post-Deployment Steps

After a successful deployment:

1. **Export Cognito environment variables** (printed at end of deploy output):
   ```bash
   export COGNITO_USER_POOL_ID=<from output>
   export COGNITO_CLIENT_ID=<from output>
   export COGNITO_REGION=us-east-1
   ```

2. **Create demo users:**
   ```bash
   npm run users:demo
   ```

3. **Open the app** at the `WebsiteURL` from the deployment output and sign in:
   - Username: `demo` / Password: `DemoPassword123!`
   - Username: `testuser` / Password: `TestPassword123!`

4. **To redeploy after code changes:**
   ```bash
   ./deploy.sh
   ```

5. **To tear down all resources:**
   ```bash
   cd deploy
   npx cdk destroy
   ```
