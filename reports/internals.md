# Git-Triggered Headless CI/CD Automation Engine: Technical Internals (Week 1 Focus)

This report details exactly how the backend codebase is structured, what each component does, and how the data flows through the system we built in **Week 1**.

---

## 💡 Simplified Project Explanation: The "Shared Book" Analogy

If you have never used services like Vercel or Netlify, think of this project as a **Robotic Proofreader** for a collaborative book:

*   **The Scenario**: You and your friends are writing a book together. Every time someone finishes a chapter, it must be check-read for spelling mistakes, formatting errors, and page consistency before it goes into the final print.
*   **The Problem**: Doing this check manually for every draft is exhausting.
*   **The Solution (Our Project)**:
    1. **The Alert**: A writer saves a draft (this is code pushed to **GitHub**). A bell rings to alert the assistant (**Our Webhook Ingestion Route**).
    2. **The Queue**: If five writers save at the same time, the assistant places the drafts in a neat line (**Our Redis Queue**) to check them one by one.
    3. **The Sandbox**: The assistant takes a copy of the draft into a separate room (**Our Docker Container**) so it can run proofreading tools without messing up the main manuscript.
    4. **The Live Feed**: A dashboard (**Our Frontend**) shows a green light (Success) or lists the spelling mistakes (Failed) in real-time.

---

## 📂 Backend Codebase Directory Structure

Here is how our backend is laid out:

```
backend/
├── .env                  # Configuration variables (e.g., ports, secrets)
├── db.sql                # Database schema (PostgreSQL tables)
└── src/
    ├── index.js          # The entry point of our Express server
    ├── db.js             # PostgreSQL connection pool configuration
    ├── test_webhook.js   # Script to mock GitHub pushes locally
    └── routes/           # Sub-modules holding specific API endpoints
        ├── health.js       # Health checking router
        ├── repositories.js # Repository management router
        ├── builds.js       # Build history retrieval router
        └── webhooks.js     # GitHub webhook receiver (Ingestion Gateway)
```

---

## 🛠️ Step-by-Step Explanation of Week 1 Components

### 1. The Database Schema (`db.sql`)
Before writing any code, we defined the relational structure of our application in PostgreSQL. It consists of four linked tables:
*   **`repositories`**: Holds the registered GitHub projects. Each repository has a unique `github_url`.
*   **`webhook_events`**: Logs every single HTTP request received from GitHub. This is useful for auditing and debugging.
*   **`builds`**: Tracks the status of code runs. Each build is linked to a repository and starts in a `PENDING` state with a specific `commit_hash`.
*   **`build_logs`**: (Week 4 focus) Will store the stdout/stderr output lines from tests.

---

### 2. The Database Connection Pool (`src/db.js`)
We use `pg.Pool` to manage active connections to PostgreSQL.
*   Instead of opening and closing a database connection for every single HTTP request (which is slow and wastes server resources), a **Connection Pool** keeps a set of active database connections warm and ready to use.
*   When a route needs to run a SQL query, it grabs an idle connection from the pool, runs the query, and instantly returns it to the pool.

---

### 3. The Entry Point Server (`src/index.js`)
This initializes our Node Express server. In Week 1, we made two critical changes here:
*   **Raw Body Ingestion**:
    ```javascript
    app.use(express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      }
    }));
    ```
    Usually, Express automatically parses JSON requests into a JavaScript object (`req.body`) and discards the original raw text. However, to verify cryptographic signatures (see below), we need the *exact* original byte-buffer of the request. We store this raw buffer in `req.rawBody`.
*   **Modularity**: Instead of writing all endpoints inside one giant file, we mount independent router modules (`app.use('/api/webhooks', webhookRoutes)`).

---

### 4. The Ingestion Webhook Gateway (`src/routes/webhooks.js`)
This is the core deliverable of Week 1. It acts as our secure bridge from GitHub.

#### How Cryptographic Validation Works:
GitHub wants to ensure that no random hackers send fake webhook payloads to trigger builds on your server.
1. In production, you write a shared secret key in your `.env` file (`GITHUB_WEBHOOK_SECRET`).
2. When GitHub sends a webhook, it hashes the request body using your secret key with the **HMAC SHA-256** algorithm. It sends this hash in the `x-hub-signature-256` header.
3. Our server receives the request, takes the raw request body (`req.rawBody`), and hashes it using the same secret key.
4. We compare our calculated hash with the hash sent by GitHub. If they match, we know the request is authentic. We use `crypto.timingSafeEqual` (a constant-time comparison) to prevent **timing attacks**.

#### Fast $O(1)$ Ingestion Flow:
Once verified, the route performs fast database insertions:
1. It looks up the repository URL in the database. If it doesn't exist, it registers it.
2. It inserts the raw event payload into the `webhook_events` table.
3. It inserts a new record into the `builds` table with `status = 'PENDING'`.
4. It **instantly returns `202 Accepted`**. We do not run any compile/test steps inside this request thread. If we did, the connection would hang, and GitHub would time out. The actual building happens asynchronously (Week 2 & 3).

---

### 5. The Tester Script (`src/test_webhook.js`)
Since we don't want to actually push code to GitHub every time we test a code change, `test_webhook.js` acts as a mock client:
1. It builds a fake GitHub push event JSON payload.
2. It calculates the HMAC SHA-256 signature locally (if you configured a secret).
3. It sends an HTTP `POST` request directly to your local server on port `5001`.
4. It logs the response to prove the ingestion gateway works.
