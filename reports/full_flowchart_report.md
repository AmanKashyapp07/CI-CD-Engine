# Comprehensive System Flowchart: Weeks 1 - 3

This report contains a detailed architectural flowchart mapping the end-to-end flow of actions within the CI/CD Engine, including User Authentication, Repository Registration, Webhook Ingestion, Queueing, Docker Sandboxed Execution, and database tracking.

---

## 📊 End-to-End System Flowchart

The following flowchart maps out every operation, from the user logging in to the worker executing container tests and performing resource reclamation.

```mermaid
flowchart TD
    %% Define styles
    classDef gateway fill:#1e293b,stroke:#3b82f6,stroke-width:2px,color:#f8fafc;
    classDef worker fill:#1e1b4b,stroke:#6366f1,stroke-width:2px,color:#f8fafc;
    classDef database fill:#0f172a,stroke:#10b981,stroke-width:2px,color:#f8fafc;
    classDef external fill:#27272a,stroke:#71717a,stroke-width:2px,color:#f8fafc;
    classDef dec decision;

    %% Week 1: Authentication & Repository Setup
    subgraph Auth & Setup [1. Session & Repo Setup]
        A[Developer UI Dashboard] -->|Click Login| B(GitHub OAuth API)
        B -->|OAuth Code Callback| C(Auth Router: /api/auth/callback)
        C -->|Fetch User Profile| D[GitHub API]
        C -->|Upsert User & Generate JWT| DB[(PostgreSQL DB)]
        C -->|Redirect with Session Token| A
        A -->|Register Repo Url| E(Repo Router: /api/repositories)
        E -->|Normalize URL| F[Normalize: lowercase, strip .git / slashes]
        F -->|Insert Repo under User ID| DB
    end

    %% Webhook Ingestion (Week 1)
    subgraph Webhook Ingestion [2. Ingestion Gateway]
        G[GitHub / test_webhook.js] -->|POST payload & x-hub-signature-256| H(Webhook Router: /api/webhooks/github)
        H -->|Check signature using HMAC SHA-256| I{Valid Signature?}
        I -->|No| J[Return 401 Unauthorized]
        I -->|Yes| K[Extract & Normalize clone_url]
        K -->|Query DB to match Repo| DB
        K -->|Insert Build Trace: PENDING| DB
    end

    %% Asynchronous Broker (Week 2)
    subgraph Job Queueing [3. BullMQ Broker]
        K -->|Enqueue Job: buildId, repoUrl, commitHash| L[(Redis Queue: build-queue)]
        L -.->|Send Fast Response| M[Return 202 Accepted Status]
    end

    %% Background Worker & Container Sandbox (Week 3)
    subgraph Background Worker Lifecycle [4. Isolated Execution & Sandboxing]
        L -->|Pull Job| N[Background Worker Process]
        N -->|Update Build to RUNNING & started_at| DB
        N -->|Create Workspace temp_builds/buildId| O[Host Local Filesystem]
        N -->|Run Git Clone & Checkout Commit| O
        N -->|Check if package.json exists| P{package.json present?}
        P -->|No| Q[Fail Build Immediately]
        P -->|Yes| R[Inspect Local Cache for node:20-alpine]
        R -->|Not Found| S[Pull Image from Docker Hub]
        R & S -->|Connect to /var/run/docker.sock| T(Spawn Isolated Container)
        T -->|Bind Mount temp_builds/buildId to /app| T
        T -->|Attach Log Stream & Tty: true| T
        T -->|Execute npm install && npm test| T
        T -->|Race Timeout Constraint: 2 Mins| U{Command Complete?}
        U -->|Timed Out| V[Force Stop & Kill Container]
        U -->|Complete| W[Capture Exit Code]
    end

    %% Cleanup & Logging (Week 3/4)
    subgraph Output Resolution [5. State Resolution & Sweeper]
        Q & V --> X[Update DB: FAILED & finished_at]
        W -->|Exit Code = 0| Y[Update DB: SUCCESS & finished_at]
        W -->|Exit Code != 0| X
        T -->|AutoRemove: true| Z[Container Destroyed]
        X & Y --> AA[Insert Merged stdout/stderr Logs to DB]
        AA --> AB[Delete local temp_builds/buildId]
        AB --> AC[UI Dashboard Displays Final State & Live Logs]
    end

    %% Apply Styles
    class C,E,H gateway;
    class N,T,V,W worker;
    class DB,L database;
    class B,D,G external;
    class I,P,U dec;
```

---

## 🔄 Detailed Breakdown of Flows

### 1. Ingestion Gate Response ($O(1)$ Complexity)
Note that **Job Queueing** runs concurrently with the Gateway response. The gateway pushes the build payload to the **Redis Queue** and immediately triggers `Return 202 Accepted Status` back to GitHub (or `test_webhook.js`) in under 30 milliseconds. The heavy sandboxed worker process only begins executing *after* the gateway has closed the HTTP connection, preventing connection timeouts.

### 2. Sandbox Filesystem Binding (Volume Isolation)
During container execution, the directory `temp_builds/${buildId}` on your local Mac serves as a physical host path. It is bind-mounted directly into `/app` inside the Alpine Node container. When processes inside the container write files (like logging dependencies or creating lockfiles), they write directly to this host directory.

### 3. Cleanup Cascade (Resource Reclamation)
As shown in **State Resolution**, cleanup is a two-step process:
1.  **Container Cleanup**: Handled natively by Docker daemon because the worker sets `AutoRemove: true`. The container removes its execution layers automatically on exit.
2.  **Filesystem Cleanup**: Handled by the worker's `finally` block which calls `workspace.js` to recursively run `fs.rm` on the host workspace directory, preventing disk bloat.
