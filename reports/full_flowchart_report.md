# Comprehensive System Flowchart: Weeks 1 - 3

This report contains a detailed architectural flowchart mapping the end-to-end flow of actions within the CI/CD Engine, including User Authentication, Repository Registration, Webhook Ingestion, Queueing, Docker Sandboxed Execution, and database tracking.

---

## 📊 End-to-End System Flowchart

The following flowchart maps out every operation, from the user logging in to the worker executing container tests and performing resource reclamation.

```mermaid
flowchart TD
    classDef process fill:#475569,stroke:#64748b,color:#f8fafc;
    classDef system fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc;
    classDef database fill:#1e293b,stroke:#475569,stroke-width:1px,color:#f8fafc;

    A["GitHub Push / Mock Event<br/>(test_webhook.js)"] --> B("1. POST Request with HMAC signature")
    B --> C["API Ingestion Gateway<br/>(index.js & routes/webhooks.js)"]
    
    C --> D("2. Verify Signature & Create Records")
    D --> E[("PostgreSQL Database<br/>(db.js & db.sql)")]
    
    C --> F("3. Enqueue Job")
    F --> G[("Redis Task Queue / BullMQ<br/>(queue.js)")]
    
    G --> H("4. Pull Build Task")
    H --> I["Worker Pool<br/>(worker.js)"]
    
    I --> J("5. Mount Workspace & Run Tests<br/>(workspace.js)")
    J --> K["Isolated Docker Container<br/>(node:20-alpine sandbox)"]
    
    I --> L("8. Clean up containers & volumes")
    L --> M["Garbage Collection<br/>(workspace.js sweeper)"]
    
    K --> N("6. Stream stdout/stderr & Save Logs")
    N --> O["Socket.io / SSE Stream<br/>(routes/builds.js)"]
    
    O --> P("7. Live Terminal Feed")
    P --> Q["Developer Dashboard React<br/>(App.jsx)"]

    class B,D,F,H,J,L,N,P process;
    class A,C,I,K,M,O,Q system;
    class E,G database;
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
