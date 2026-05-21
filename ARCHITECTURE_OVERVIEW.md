# Architecture Overview — Multi-Tenant SaaS MCP Server

> Use a Mermaid-compatible viewer to render these diagrams (VS Code + Mermaid extension, GitHub, Notion, etc.)

---

## 1. High-Level System Architecture

```mermaid
graph TB
    User["👤 End User"]

    subgraph Client ["MCP Client (Playground)"]
        direction TB
        CF_Client["CloudFront + S3\nReact SPA"]
        LambdaBE["Lambda Backend\nExpress.js"]
    end

    subgraph Bedrock ["Amazon Bedrock"]
        Models["Claude / Nova / Llama"]
    end

    subgraph AuthSystem ["Authentication — Amazon Cognito"]
        Cognito["Cognito User Pool"]
        PostTrigger["PostConfirmation Trigger\nassigns tenantId from email alias"]
        PreTrigger["PreToken Trigger\ninjects tenantId into JWT"]
    end

    subgraph MCPSystem ["MCP Server (ECS Fargate + ALB)"]
        CF_OAuth["CloudFront OAuth Proxy\nOpenID Config · DCR Endpoint"]
        DCR_Lambda["DCR Lambda\nRFC 7591 — Dynamic Client Reg"]
        MCPApp["MCP Server\nNode.js · Express · MCP SDK\nTravel booking tools"]
    end

    subgraph DataLayer ["Multi-Tenant Data Layer"]
        STS["STS AssumeRole\n+ Session Tag: tenantId"]
        DDB["DynamoDB\nPartitioned by tenantId"]
        S3Bucket["S3\nPrefixed by tenantId/"]
    end

    User -->|"logs in"| CF_Client
    CF_Client --> LambdaBE
    LambdaBE -->|"AI inference\n(streaming)"| Models
    LambdaBE -->|"MCP tool calls\nvia proxy"| MCPApp

    CF_Client -->|"OAuth flow"| CF_OAuth
    CF_OAuth --> DCR_Lambda
    CF_OAuth --> Cognito
    Cognito --> PostTrigger
    Cognito --> PreTrigger

    MCPApp -->|"verify JWT\nextract tenantId"| Cognito
    MCPApp --> STS
    STS -->|"IAM: LeadingKeys = tenantId"| DDB
    STS -->|"IAM: s3:prefix = tenantId/*"| S3Bucket
```

---

## 2. Authentication & Authorization Flow

```mermaid
sequenceDiagram
    participant User as 👤 User / MCP Client
    participant MCPServer as MCP Server (ECS)
    participant CF as CloudFront OAuth Proxy
    participant DCR as DCR Lambda
    participant Cognito as Amazon Cognito

    Note over User,MCPServer: Step 1 — Discovery (unauthenticated)
    User->>MCPServer: Any request (no token)
    MCPServer-->>User: 401 + WWW-Authenticate header
    User->>MCPServer: GET /.well-known/oauth-protected-resource
    MCPServer-->>User: Protected Resource Metadata (RFC 9728)\n→ points to authorization_server (CF Proxy)

    Note over User,Cognito: Step 2 — Dynamic Client Registration (optional)
    User->>CF: GET /.well-known/openid-configuration (RFC 8414)
    CF-->>User: OpenID Config with registration_endpoint
    User->>DCR: POST /register (RFC 7591)
    DCR->>Cognito: Create App Client (if not exists)
    DCR-->>User: client_id (cached in DynamoDB)

    Note over User,Cognito: Step 3 — OAuth 2.1 Authorization Code + PKCE
    User->>Cognito: Authorization Code Grant
    Cognito-->>User: JWT Access Token\n{ "custom:tenantId": "acmecorp" }

    Note over User,MCPServer: Step 4 — Authenticated MCP Access
    User->>MCPServer: Request + Bearer JWT
    MCPServer->>Cognito: Verify JWT (JWKS endpoint)
    MCPServer->>MCPServer: Extract custom:tenantId from JWT
    MCPServer-->>User: Tool response (tenant-scoped data only)
```

---

## 3. Multi-Tenant Data Isolation

How a single shared infrastructure serves multiple tenants with zero data bleed — enforced by IAM, not application code.

```mermaid
graph LR
    Email["✉️  john+acmecorp\n@example.com"]

    subgraph Signup ["On User Signup"]
        PostConfirm["PostConfirmation Lambda\nextracts alias → tenantId"]
        TenantId["tenantId = acmecorp\nstored on Cognito user"]
    end

    subgraph Token ["On Token Issuance"]
        PreToken["PreToken Lambda"]
        JWT["JWT Access Token\n{ custom:tenantId: 'acmecorp' }"]
    end

    subgraph Server ["On Every MCP Tool Call"]
        VerifyJWT["Verify JWT signature\n(Cognito JWKS)"]
        ExtractTenant["Extract tenantId\nfrom JWT claim"]
        AssumeRole["STS AssumeRole\n+ Session Tag: tenantId=acmecorp"]
    end

    subgraph Data ["Data Layer (IAM-enforced isolation)"]
        DDB["DynamoDB\nPK: acmecorp#booking123\nIAM: LeadingKeys = tenantId"]
        S3["S3\nacmecorp/travel-policy.pdf\nIAM: prefix = tenantId/*"]
    end

    Email --> PostConfirm --> TenantId --> PreToken --> JWT
    JWT --> VerifyJWT --> ExtractTenant --> AssumeRole
    AssumeRole -->|"scoped credentials"| DDB
    AssumeRole -->|"scoped credentials"| S3
```

---

## Key Design Decisions (talking points)

| Decision | Why |
|---|---|
| **Tenant ID via email alias** | Simple demo mechanism — not for production (no ownership validation) |
| **STS session tagging** | Tenant isolation enforced by IAM policies, not app code — more secure |
| **Custom DCR Lambda** | Cognito doesn't support RFC 7591 natively — Lambda + DynamoDB fills the gap |
| **CloudFront OAuth proxy** | Cognito's built-in OpenID endpoint can't be customized; proxy adds `registration_endpoint` |
| **ECS Fargate for MCP Server** | MCP uses persistent HTTP (Streamable HTTP transport), not ideal for Lambda |
| **JWT in-memory only (client)** | Tokens never written to localStorage — reduces XSS attack surface |
