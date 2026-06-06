# Combined First Principles Report: Weeks 1 - 3
## Git-Triggered Headless CI/CD Automation Engine

This report details the architectural layout, core systems-level decisions, and first-principles concepts governing the CI/CD Engine's implementation across Weeks 1, 2, and 3.

---

## 🏛️ Overall Architecture Flow

```
                                          [ 🛡️ WEEK 1 ]
   +-----------------------+              +------------------------+
   |  GitHub Webhook /     |              | Ingestion Gateway      |
   |  test_webhook.js      | --(POST)-->  |  - Signature check     |
   +-----------------------+              |  - URL Normalization   |
                                          +------------------------+
                                                      |
                                                      | (Enqueues Job)
                                                      v
                                          [ ⚡ WEEK 2 ]
                                          +------------------------+
                                          | Redis Broker (BullMQ)  |
                                          +------------------------+
                                                      |
                                                      | (Pulls Job)
                                                      v
                                          [ 🐳 WEEK 3 ]
                                          +------------------------+
                                          | Background Worker      |
                                          |  - Creates temp folder |
                                          |  - Clones source code  |
                                          +------------------------+
                                                      |
                                                      | (Orchestrates Container via Socket)
                                                      v
                                          +------------------------+
                                          | Isolated Container     |
                                          | (node:20-alpine)       |
                                          |  - Mounts workspace    |
                                          |  - Executes tests      |
                                          +------------------------+
```

---

## 📅 Part 1 (Week 1): Secure Ingestion Gateway & Relational Storage

The foundation of the engine is a highly secure, fast ingestion gateway and user session infrastructure.

### 1. Cryptographic Security (HMAC SHA-256 Verification)
Webhooks are public endpoints exposed to the internet. Without security verification, anyone could send a fake POST request triggering continuous builds on your system, starving server resources.
*   **First Principle**: When a webhook is registered with a secret, GitHub hashes the raw payload body using the **HMAC-SHA256** algorithm, attaching it to the `X-Hub-Signature-256` header.
*   **Implementation**: Our gateway reads the raw request buffer (`req.rawBody`) before parsing it as JSON. We compute the expected signature locally using the stored secret and compare it using `crypto.timingSafeEqual` to prevent timing attacks.

### 2. Identifier Consistency (URL Normalization)
Git repository URLs vary widely in format (e.g. uppercase letters, `.git` suffixes, trailing slashes, or whitespace):
*   `https://GitHub.com/user/Repo.git/` vs `https://github.com/user/repo`
*   **First Principle**: To prevent matching failures and duplicate database entries, every URL entered manually or arriving via webhook is normalized:
    *   Cased to lowercase.
    *   Trimmed of leading/trailing spaces.
    *   Stripped of trailing `.git` extensions and slashes.

### 3. Multi-Tenant Relational Design
We mapping relationships using PostgreSQL:
*   `users` ➔ `repositories` (1-to-Many): Repositories are linked using a `user_id` foreign key. This ensures data isolation (a logged-in user can only see or trigger builds on their own repositories).
*   `repositories` ➔ `builds` (1-to-Many): Tracking historical build executions.
*   `builds` ➔ `build_logs` (1-to-Many): Capturing the log streams.
*   **Authentication**: We issue **JWT (JSON Web Token)** payloads containing the encrypted user profile ID on successful GitHub OAuth handshake. This token is passed inside HTTP headers to secure routes.

---

## 📅 Part 2 (Week 2): Distributed Job Queueing & Asynchronous Workers

Heavy computational work (like testing and compiling) cannot be done inside the web server's request-response lifecycle.

### 1. Ingestion Starvation & Fast Gateway Response
If the web server waited for a build to finish before returning an HTTP response, the connection would time out, and GitHub would mark the webhook delivery as failed.
*   **First Principle**: The gateway must immediately yield an $O(1)$ response (under 30ms) returning a `202 Accepted` status with a trace ID (`buildId`). The actual compilation is deferred to a queue.

### 2. Message Broker Architecture (Decoupling)
By inserting a message broker (**Redis**) between the gateway and execution worker, we completely decouple the services.
*   **Job Producer**: The gateway creates a build in the DB as `PENDING` and enqueues a job containing the `buildId`, `repoUrl`, and `commitHash` to BullMQ.
*   **Job Consumer**: Standalone worker processes poll the Redis queue. If a worker crashes, the job remains in Redis, preventing task loss.
*   **Backpressure Control**: If 100 webhooks arrive simultaneously, they are securely buffered in Redis, and workers consume them sequentially according to resource limits rather than overloading the host system.

---

## 📅 Part 3 (Week 3): Docker-Engine Code Lifecycle Execution

To compile and execute code, the worker uses programmatic container virtualization.

### 1. Filesystem Sandboxing
To isolate projects, we create a temporary workspace on the host filesystem under `backend/temp_builds/${buildId}`:
*   Code is cloned into this directory using `simple-git` and the specific commit is checked out.
*   After the execution terminates (success or failure), the worker triggers a clean sweep, recursively deleting the folder to reclaim disk space.

### 2. Unix Domain Socket Integration
Rather than spawning Docker commands via command line scripts (which are prone to shell injection vulnerabilities), the worker communicates programmatically:
*   We connect to `/var/run/docker.sock` using the HTTP-based Docker Engine API via **`dockerode`**.
*   This socket is a local IPC pipeline allowing Node.js to programmatically control container states.

### 3. Ephemeral Mounts & Container Auto-Reclamation
The worker launches an isolated container using the `node:20-alpine` image:
*   **Bind Mount**: We map the host's temporary workspace path to `/app` inside the container. The container processes run isolated from the host operating system but can access the cloned code.
*   **Auto-Reclamation**: Setting `AutoRemove: true` inside the host configuration ensures that the Docker engine deletes container layers and volumes immediately upon exit.

### 4. Output Multiplexing (Pseudo-TTY)
We configure the container with `Tty: true`. This allocates a pseudo-TTY which automatically multiplexes standard output (`stdout`) and standard error (`stderr`) streams. The worker listens to the attached stream and writes the merged execution log directly into the database `build_logs` table.

### 5. Timeout Constraints
To prevent rogue test processes (like infinite loops) from consuming CPU indefinitely:
*   We use JavaScript `Promise.race` to set a hard execution timeout (e.g. 2 minutes).
*   If the timeout triggers first, the worker throws a Timeout Error, runs `container.stop()`, and marks the build state in PostgreSQL as `FAILED`.
*   Otherwise, it captures the exit code (code `0` maps to `SUCCESS`, non-zero maps to `FAILED`).
