# Architecture

## Component architecture

```mermaid
flowchart LR
    U[Analyst / Guest Analyst] --> FE
    subgraph Frontend[Frontend - Next.js :3000]
        FE[App shell and pages]
        AUTH[Supabase SSR Auth / PKCE]
        CLIENT[API client + SSE + workspace headers]
        EXPORT[PDF report proxy]
        FE --> AUTH
        FE --> CLIENT
        FE --> EXPORT
    end
    CLIENT -->|HTTP JSON / SSE| API
    EXPORT -->|GET report sections| API
    subgraph Backend[Backend - FastAPI :8000/api/v1]
        API[REST API routes]
        SEC[JWT/JWKS + workspace capability checks]
        PROFILE[Profiling workflow]
        ANALYSIS[Analysis workflow]
        QA[Q&A workflow]
        AGENT[LangGraph agent runtime + trace]
        COMPUTE[Deterministic compute<br/>DuckDB / pandas / NumPy / SciPy]
        QUALITY[Quality gate + bounded aggregates]
        REPO[Repositories + Pydantic models]
        API --> SEC
        SEC --> PROFILE
        SEC --> ANALYSIS
        SEC --> QA
        PROFILE --> COMPUTE
        PROFILE --> AGENT
        ANALYSIS --> QUALITY
        ANALYSIS --> COMPUTE
        QA --> AGENT
        AGENT --> COMPUTE
        PROFILE --> REPO
        ANALYSIS --> REPO
        QA --> REPO
    end
    subgraph Data[Data and persistence]
        DB[(PostgreSQL / Supabase DB<br/>metadata, workspace, audit, checkpoints, traces)]
        STORE[(Dataset storage<br/>Supabase Storage or Google Drive)]
        KB[(Knowledge base<br/>local corpus / retrieval)]
    end
    REPO --> DB
    PROFILE --> STORE
    COMPUTE --> STORE
    AGENT --> KB
    subgraph External[External services]
        SUPA[Supabase Auth]
        LLM[Optional LLM provider]
        DRIVE[Google Drive OAuth]
    end
    AUTH --> SUPA
    AGENT -. narrative / Q&A .-> LLM
    STORE -. configured provider .-> DRIVE
```

## Data flow

```mermaid
sequenceDiagram
    autonumber
    actor A as Analyst
    participant FE as Next.js UI
    participant API as FastAPI API
    participant AUTH as Auth and workspace guard
    participant S as Storage adapter
    participant DB as PostgreSQL
    participant C as Deterministic compute
    participant G as LangGraph / Q&A

    A->>FE: Select workspace and upload dataset
    FE->>API: POST /datasets/upload
    API->>AUTH: Verify token, workspace, capability
    AUTH-->>API: Authorized
    API->>S: Store dataset binary
    API->>DB: Store metadata and content hash

    A->>FE: Create profile run (sample or full)
    FE->>API: POST /profile
    API->>S: Read source dataset
    API->>C: Compute deterministic metrics
    C-->>API: Metrics, evidence and proposals
    API->>DB: Store profile, audit and optional trace
    API-->>FE: Profile report

    A->>FE: Review semantic type, key and PII proposals
    FE->>API: PATCH /profile/{run_id}/confirm
    API->>AUTH: Re-check capability
    API->>DB: Store review decision and audit

    opt Q&A or narrative
        A->>FE: Ask about profile evidence
        FE->>API: POST /qa or /qa/stream
        API->>G: Retrieve bounded evidence and generate answer
        G-->>API: Answer, citations and trace summary
        API->>DB: Store provenance and agent run
        API-->>FE: SSE or JSON answer
    end

    opt Analysis workspace
        A->>FE: Approve context, dimensions and measures
        FE->>API: POST context and quality gate
        API->>C: Run bounded aggregate
        C-->>API: Result, execution ID and result hash
        API->>DB: Store execution and aggregate evidence
        API-->>FE: Analysis result
    end

    A->>FE: Export PDF or JSON report
    FE->>API: GET report / export
    API->>DB: Read report snapshot
    API-->>FE: Redacted report according to policy
```

## Security and data handling

- Frontend never sends raw SQL; Analysis only runs bounded aggregates from approved context.
- Backend checks JWT, workspace membership and capability before every resource operation.
- The compute engine produces deterministic metrics; the LLM is limited to narrative, retrieval and Q&A.
- Raw datasets stay in the configured storage provider; PostgreSQL stores metadata, provenance, audit and results.
- Reports and traces are redacted and do not store raw rows, secrets, chain-of-thought or unnecessary PII.
